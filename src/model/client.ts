import { buildCompletionEnvelope } from './resource-pool';
import { isStageModelInput } from './context-types';
import type { PromptStage } from './context-types';
import { buildPromptPolicy,factsFromInput,policyRules,applicableResourceRules } from './prompt-policy';
import type { ModelTask, ModelRunner } from '../types';
import type { ModelConnection } from '../config';
import type { LookupRequest, ModelRunOptions } from '../memory/types';
import { z } from 'zod';
import { parseWebTool,webSearchToolSchema,webReadToolSchema } from '../web/content';
import type { WebMaterial,WebModelCheckpoint,WebSearchResponse } from '../web/types';

export interface CompletionRequest { task: ModelTask<unknown>; input: unknown; repair?: { original: unknown; errors: string }; lookupResult?: unknown;tools?:{web:boolean;lookup:boolean};webMaterials?:WebMaterial[];webStatus?:{counters:{successReads:number;failures:number};stopReason:'quota'|null};webResults?:WebSearchResponse[] }
export interface Transport { complete(request: CompletionRequest, options?: {signal?:AbortSignal}): Promise<unknown> }
export class ModelFormatError extends Error {}
export class ModelRequestError extends Error {
  readonly taskName?:string; readonly httpStatus?:number; readonly providerCode?:string;
  readonly kind:'context_limit'|'request';
  constructor(message:string,info:{taskName?:string;httpStatus?:number;providerCode?:string;kind?:'context_limit'|'request'}={}){super(message);this.name='ModelRequestError';this.taskName=info.taskName;this.httpStatus=info.httpStatus;this.providerCode=info.providerCode;this.kind=info.kind??'request';}
}
function contextLimit(code:string|undefined,message:string):boolean {
  return code==='context_length_exceeded'||/\bcontext length (?:is )?exceeded\b/i.test(message)||/\bmaximum context length is \d+ tokens\b/i.test(message);
}
export class ModelClient implements ModelRunner {
  constructor(private transport: Transport, private lookupDetails?: (query: string) => unknown, private repairLimit = 2) {}
  async runModel<T>(task: ModelTask<T>, input: unknown, options: ModelRunOptions = {}): Promise<T> {
    options.signal?.throwIfAborted();
    const policy=task.promptPolicy??buildPromptPolicy(task.name as PromptStage,factsFromInput(input));
    const selectedTask=task.promptPolicy?task:{...task,promptPolicy:policy,prompt:task.prompt+'\n'+policyRules(policy)};
    const web=options.web;
    const checkpoint:WebModelCheckpoint=web?.snapshot().checkpoint??{input,repairCount:0,lookupUsed:false,pendingOperationId:null,toolResults:[]};
    // Regeneration uses the current business input; the phase identity and confirmed tool progress survive.
    checkpoint.input=input;
    const save=()=>{options.signal?.throwIfAborted();web?.saveCheckpoint(checkpoint);};
    const lookup = options.lookup === undefined
      ? this.lookupDetails && (async (request: LookupRequest) => this.lookupDetails!(typeof request === 'string' ? request : request.query))
      : options.lookup;
    const perform=async(operationId:string)=>{
      const op=web!.snapshot().operations.find(o=>o.operationId===operationId)!;
      const result=op.request.kind==='search'?await web!.searchAndRead(op.request.request,{operationId,signal:options.signal}):await web!.readPage(op.request.url,{operationId,signal:options.signal});
      checkpoint.toolResults.push(result);checkpoint.pendingOperationId=null;save();
    };
    const performLookup=async()=>{checkpoint.privateLookupResult=await lookup!(checkpoint.lookupRequest!);checkpoint.lookupPending=false;save();};
    save();if(checkpoint.lookupPending&&checkpoint.lookupRequest&&lookup)await performLookup();
    if(checkpoint.pendingOperationId)await perform(checkpoint.pendingOperationId);
    while(true) {
      options.signal?.throwIfAborted();const snapshot=web?.snapshot();
      const quota=!!web&&!!snapshot&&(snapshot.counters.successReads>=web.limits.successReads||snapshot.counters.failures>=web.limits.failures);
      const tools={web:!!web?.available&&!quota,lookup:!!lookup&&!checkpoint.lookupUsed};
      const materials=snapshot?.materials??[];
      const raw=await this.transport.complete({task:selectedTask,input,repair:checkpoint.repair,lookupResult:checkpoint.privateLookupResult,tools,webMaterials:materials,webResults:checkpoint.toolResults,webStatus:snapshot?{counters:snapshot.counters,stopReason:quota?'quota':null}:undefined},{signal:options.signal});
      options.signal?.throwIfAborted();if(materials.length)web!.markProvided(materials.map(m=>m.id));
      let value:any,operation:ReturnType<typeof parseWebTool>;
      try {
        value=typeof raw==='string'?JSON.parse(raw):raw;
        operation=parseWebTool(value);
        if(operation&&!tools.web)throw Error('web tools unavailable or quota reached; return final task JSON');
        if(!operation&&value&&typeof value==='object'&&'lookupDetails' in value){
          if(!tools.lookup) return task.parse(value);
          lookupRequestSchema.parse(value.lookupDetails);
        }else if(!operation)return task.parse(value);
      } catch (error) {
        if (options.signal?.aborted) throw error;
        const errors=error instanceof Error?error.message:String(error);
        if(checkpoint.repairCount>=this.repairLimit)throw new ModelFormatError(`${task.name}: ${errors}`);
        checkpoint.repairCount++;checkpoint.repair={original:raw,errors};save();continue;
      }
      delete checkpoint.repair;
      if(operation){const op=web!.beginOperation(operation);checkpoint.pendingOperationId=op.operationId;save();await perform(op.operationId);}
      else {checkpoint.lookupUsed=true;checkpoint.lookupRequest=value.lookupDetails;checkpoint.lookupPending=true;save();await performLookup();}
    }
  }
}

export class ChatCompletionsTransport implements Transport {
  constructor(private connectionFor: (taskName: string) => ModelConnection, private fetcher: typeof fetch = fetch) {}
  async complete(request: CompletionRequest, options: {signal?:AbortSignal} = {}): Promise<unknown> {
    const c = this.connectionFor(request.task.name);
    const envelope=buildCompletionEnvelope(request);
    const view=isStageModelInput(request.input)?request.input:undefined;
    const imageUrl=view&&typeof view.context.imageDataUrl==='string'?view.context.imageDataUrl:request.input&&typeof request.input==='object'&&'imageDataUrl' in request.input?String(request.input.imageDataUrl):undefined;
    if(imageUrl&&envelope.input&&typeof envelope.input==='object'){
      const textInput={...envelope.input as Record<string,unknown>};
      if(view){const context={...view.context};delete context.imageDataUrl;textInput.context=context;}else delete textInput.imageDataUrl;
      envelope.input=textInput;
    }
    const branches=[request.task.schema,...(request.tools?.web?[z.toJSONSchema(webSearchToolSchema),z.toJSONSchema(webReadToolSchema)]:[]),...(request.tools?.lookup?[z.toJSONSchema(z.object({lookupDetails:lookupRequestSchema}))]:[])];
    const schema=branches.length===1?branches[0]:{anyOf:branches};
    const userText=JSON.stringify(envelope);
    const policy=request.task.promptPolicy??buildPromptPolicy(request.task.name as PromptStage,factsFromInput(request.input));
    const business=request.task.prompt+(request.task.promptPolicy?'':'\n'+policyRules(policy));
    const resources=view?{...view,resources:envelope.resources}:undefined;
    const hasContextRefs=!!envelope.lookupResult&&typeof envelope.lookupResult==='object'&&'contextRefs' in envelope.lookupResult;
    const capabilities=[request.tools?.lookup?'如需本地事实查询，可先只返回 {"lookupDetails":"主题"}；最多一次。':'',request.tools?.web?'如需公开资料，可返回 {"webSearch":{"query":"查询","requestedPages":1}} 或 {"webRead":{"url":"https://..."}}，取得正文后继续或输出任务 JSON。':'',applicableResourceRules(resources,policy.stage,!!request.tools?.web,envelope.resources.materials.length>0,hasContextRefs)].filter(Boolean).join('\n');
    const schemaText=c.outputMode==='json_schema'?'\n输出合法JSON，遵循response_format。':`\nJSON Schema:\n${JSON.stringify(schema)}`;
    const messages:Array<Record<string,unknown>>=[{role:'system',content:business+schemaText+'\n'+capabilities},{role:'user',content:imageUrl?[{type:'text',text:userText},{type:'image_url',image_url:{url:imageUrl}}]:userText}];
    const format = c.outputMode ?? 'json_object';
    const responseFormat = format === 'prompt' ? undefined : format === 'json_schema'
      ? { type: 'json_schema', json_schema: { name: request.task.name, strict: false, schema } }
      : { type: 'json_object' };
    let response:Response;
    try {response = await this.fetcher(`${c.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      signal: options.signal, method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${c.apiKey}` },
      body: JSON.stringify({ model: c.model, reasoning_effort: c.reasoningEffort, stream: false, messages, response_format: responseFormat }),
    });}catch(error){if(options.signal?.aborted)throw error;throw new ModelRequestError(`${request.task.name}: model network request failed`,{taskName:request.task.name});}
    if (!response.ok) {
      let code:string|undefined,message='';
      try{const body=await response.json() as {error?:{code?:unknown;message?:unknown}};
        if(typeof body.error?.code==='string'&&/^[a-zA-Z0-9_.-]{1,80}$/.test(body.error.code))code=body.error.code;
        if(typeof body.error?.message==='string')message=body.error.message;
      }catch{}
      const kind=contextLimit(code,message)?'context_limit':'request';
      throw new ModelRequestError(`${request.task.name}: model HTTP ${response.status} (${kind})`,{taskName:request.task.name,httpStatus:response.status,providerCode:code,kind});
    }
    try {const body = await response.json() as { choices: Array<{ message: { content: string | null } }> };
      const content = body.choices?.[0]?.message?.content;if(typeof content!=='string')throw Error('missing response content');return content;
    }catch(error){throw new ModelRequestError(`${request.task.name}: invalid response envelope`,{taskName:request.task.name});}
  }
}
const lookupRequestSchema=z.union([z.string(),z.object({query:z.string(),scope:z.enum(['current','archive']),includeDetailHistory:z.boolean()})]);

