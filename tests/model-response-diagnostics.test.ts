import {afterEach,expect,it} from 'vitest';
import {ChatCompletionsTransport,ModelClient,ModelRequestError} from '../src/model/client';
import {Storage} from '../src/storage';
import {ModelRunHistory} from '../src/model/run-history';
import {HdsiApp} from '../src/app';
import {setup,saveInput,NOW,TestClock} from './helpers';
const secret='synthetic-private-body-and-key';
const connection={baseUrl:'https://example.invalid',apiKey:secret,model:'offline',reasoningEffort:'low' as const};
const task={name:'narrative',prompt:'fixture',schema:{},parse:(v:unknown)=>v};
const stores:Storage[]=[];afterEach(()=>stores.splice(0).forEach(s=>s.close()));
async function fail(body:string,status=200,headers:Record<string,string>={'content-type':'application/json','x-request-id':'req-safe-123'}){
 const transport=new ChatCompletionsTransport(()=>connection,async()=>new Response(body,{status,headers}) as never);
 try{await transport.complete({task,input:{private:secret}});}catch(e){return e as ModelRequestError;}
 throw Error('expected transport failure');
}
it.each([
 ['<html>gateway '+secret+'</html>','invalid_json'],
 ['', 'empty_body'],
 ['null','invalid_envelope'],
 ['{}','missing_choices'],
 ['{"choices":[]}','empty_choices'],
 ['{"choices":[{}]}','missing_message'],
 ['{"choices":[{"message":{}}]}','missing_content'],
 ['{"choices":[{"message":{"content":null},"finish_reason":"length"}]}','non_string_content'],
 ['{"error":{"code":"server_error","message":"'+secret+'"}}','provider_error'],
])('distinguishes %s from other successful-HTTP envelope failures',async(body,reason)=>{
 const e=await fail(body);expect(e).toMatchObject({httpStatus:200,diagnostic:{reason,httpStatus:200,contentType:'application/json',requestId:'req-safe-123',responseBytes:Buffer.byteLength(body)}});
 expect(e.message).toContain(reason);expect(JSON.stringify(e)).not.toContain(secret);expect(e.message).not.toContain(secret);
});
it('preserves HTTP status and context-limit classification without the provider body',async()=>{
 const e=await fail(JSON.stringify({error:{code:'context_length_exceeded',message:secret}}),400);
 expect(e).toMatchObject({kind:'context_limit',httpStatus:400,providerCode:'context_length_exceeded',diagnostic:{reason:'http_error',httpStatus:400}});
 expect(JSON.stringify(e)).not.toContain(secret);
});
it('does not expose credentials echoed through response metadata',async()=>{
 const e=await fail('{}',200,{'content-type':'text/'+secret,'x-request-id':secret});
 expect(JSON.stringify(e)).not.toContain(secret);expect(e.message).not.toContain(secret);
});
it('retains a safe provider code for a JSON error returned with HTTP 200',async()=>{
 const e=await fail(JSON.stringify({error:{code:'server_error',message:secret}}));
 expect(e).toMatchObject({diagnostic:{reason:'provider_error',providerCode:'server_error'}});expect(JSON.stringify(e)).not.toContain(secret);
});
it('does not turn a caller cancellation during body reading into a provider error',async()=>{
 const controller=new AbortController();const stream=new ReadableStream({start(body){controller.abort(Error('caller cancelled body'));body.error(Error('body aborted'));}});
 const transport=new ChatCompletionsTransport(()=>connection,async()=>new Response(stream));
 await expect(transport.complete({task,input:{}},{signal:controller.signal})).rejects.toThrow('caller cancelled body');
});
it('separates incomplete body reads from invalid JSON',async()=>{
 const stream=new ReadableStream({start(controller){controller.error(Object.assign(Error(secret),{code:'UND_ERR_BODY_TIMEOUT'}));}});
 const transport=new ChatCompletionsTransport(()=>connection,async()=>new Response(stream,{headers:{'content-type':'application/json'}}) as never);
 await expect(transport.complete({task,input:{}})).rejects.toMatchObject({diagnostic:{phase:'body',reason:'body_read_failed',networkCode:'UND_ERR_BODY_TIMEOUT',httpStatus:200}});
});
it('records only an allowlisted network cause code',async()=>{
 const transport=new ChatCompletionsTransport(()=>connection,async()=>{throw Object.assign(Error(secret),{cause:Object.assign(Error(secret),{code:'UND_ERR_CONNECT_TIMEOUT'})});});
 await expect(transport.complete({task,input:{}})).rejects.toMatchObject({diagnostic:{phase:'request',reason:'network_error',networkCode:'UND_ERR_CONNECT_TIMEOUT'}});
});
it('persists structured transport diagnosis without recording response bodies or consuming format repairs',async()=>{
 const storage=new Storage(':memory:');stores.push(storage);
 const history=new ModelRunHistory(storage,new TestClock());let calls=0;
 const transport=new ChatCompletionsTransport(()=>connection,async()=>{calls++;return new Response('<html>'+secret+'</html>',{headers:{'content-type':'text/html','x-request-id':'req-safe-123'}});});
 const client=new ModelClient(transport,undefined,2,history);
 await expect(client.runModel(task,{})).rejects.toBeInstanceOf(ModelRequestError);
 const row=JSON.parse(String(storage.prepare('SELECT data FROM model_run_records').get()!.data));
 expect(row).toMatchObject({stage:'transport',category:'request',requestDiagnostic:{reason:'invalid_json',contentType:'text/html',requestId:'req-safe-123'},checkpoint:{repairCount:0}});
 expect(row.rawResponse).toBeUndefined();expect(JSON.stringify(row)).not.toContain(secret);expect(calls).toBe(1);
});
it('shows a safe reason in the pause notice and retains the unfinished turn',async()=>{
 const d=setup();stores.push(d.storage);saveInput(d.storage,'input','hello');const error=await fail('{}');
 d.models.runModel=async()=>{throw error;};await expect(new HdsiApp(d).runTurn({inputMessageIds:['input'],taskIds:[],triggerKinds:['input']})).rejects.toBe(error);
 expect(d.storage.runtime()).toMatchObject({paused:true,lastFailure:{kind:'request',stage:'generation'}});
 expect(d.sender.errors[0]).toContain('missing_choices');expect(d.sender.errors[0]).toContain('HTTP 200');expect(d.sender.errors[0]).not.toContain(secret);
 expect(d.storage.unfinishedTurn()).not.toBeNull();
});
it('keeps successful string content and caller cancellation behavior',async()=>{
 const controller=new AbortController(),transport=new ChatCompletionsTransport(()=>connection,async()=>new Response(JSON.stringify({choices:[{message:{content:'{"ok":true}'}}]})));
 await expect(transport.complete({task,input:{}})).resolves.toBe('{"ok":true}');
 const stopped=new ChatCompletionsTransport(()=>connection,async()=>{controller.abort(Error('caller cancelled'));throw controller.signal.reason;});
 await expect(stopped.complete({task,input:{}},{signal:controller.signal})).rejects.toThrow('caller cancelled');
});
