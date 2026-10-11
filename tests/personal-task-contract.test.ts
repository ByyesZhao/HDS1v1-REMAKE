import {expect,it} from 'vitest';
import {personalTask} from '../src/model/contracts';
import {ChatCompletionsTransport,ModelClient} from '../src/model/client';
import {Storage} from '../src/storage';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import type {ScheduledTask,SharedTurnMeta} from '../src/types';
import {NOW,silent,TestClock} from './helpers';

const later='2026-10-07T10:30:00+08:00';
const appointment:ScheduledTask={id:'meeting',kind:'appointment',at:later,description:'双方约定',status:'pending'};
const check:ScheduledTask={id:'check',kind:'check_messages',at:later,description:'检查',status:'pending',checkReason:'unread',messageIds:['a']};
const scene:ScheduledTask={id:'scene',kind:'scene_step',at:later,description:'共同推进',status:'pending'};
const meta:SharedTurnMeta={activityId:'activity',sceneTaskId:'scene',stepNumber:2,maxSteps:10,idleSeconds:60,advanceReason:'automatic',phase:'ongoing',controlRequestIds:[],allowSimulatedUserActions:false};
const create={action:'create',task:{kind:'appointment',at:NOW,description:'双方约定'}};
const output=(kind:string,taskChanges:unknown)=>kind==='life'?{innerThought:'休息',emotions:[],contact:{willing:false},taskChanges}:{...silent,taskChanges};
const selected=(kind:'chat'|'life'|'shared',tasks:ScheduledTask[])=>personalTask(kind,NOW,tasks,kind==='shared'?'shared_online':'chat',['a'],kind==='shared'?meta:undefined);

it.each(['chat','life','shared'] as const)('rejects_program_task_changes_in_%s',kind=>{
 const task=selected(kind,[check,scene,appointment]);
 for(const program of [check,scene])for(const change of [
  {action:'create',task:{kind:program.kind,at:later,description:'程序任务',...(program.kind==='check_messages'?{checkReason:'unread',messageIds:['a']}:{})}},
  {action:'update',id:program.id,task:{at:later}},
  {action:'update',id:program.id,task:{kind:'appointment'}},
  {action:'cancel',id:program.id},
 ])expect(()=>task.parse(output(kind,[change]))).toThrow();
});

it.each([
 {...create,id:'client-id'},
 {...create,task:{...create.task,id:'client-id'}},
 {...create,task:{...create.task,status:'pending'}},
 {...create,task:{...create.task,checkReason:'unread'}},
 {...create,task:{...create.task,messageIds:['a']}},
 {action:'update',id:'meeting',task:{description:'改描述',extra:true}},
 {action:'update',id:'meeting',extra:true,task:{description:'改描述'}},
 {action:'cancel',id:'meeting',task:{}},
])('rejects_foreign_task_fields: %j',change=>{
 expect(()=>selected('chat',[appointment]).parse({...silent,taskChanges:[change]})).toThrow();
});

it('uses_only_pending_appointment_ids_and_rejects_duplicate_changes',()=>{
 const task=selected('chat',[appointment,{...appointment,id:'completed',status:'completed'},{...appointment,id:'cancelled',status:'cancelled'},check]);
 for(const patch of [{at:later},{description:'描述变更'},{kind:'appointment'}])expect(task.parse({...silent,taskChanges:[{action:'update',id:'meeting',task:patch}]})).toMatchObject({taskChanges:[{task:patch}]});
 expect(task.parse({...silent,taskChanges:[{action:'cancel',id:'meeting'}]})).toMatchObject({taskChanges:[{action:'cancel',id:'meeting'}]});
 for(const id of ['unknown','completed','cancelled','check'])for(const action of ['update','cancel'])expect(()=>task.parse({...silent,taskChanges:[{action,id,...(action==='update'?{task:{description:'变更'}}:{})}]})).toThrow();
 expect(()=>task.parse({...silent,taskChanges:[{action:'update',id:'meeting',task:{at:later}},{action:'cancel',id:'meeting'}]})).toThrow(/duplicate/);
 expect(task.parse({...silent,taskChanges:[create]})).toMatchObject({taskChanges:[create]});
});

it('empty_appointment_set_allows_create_only_and_keeps_role_required_fields',()=>{
 for(const kind of ['chat','life','shared'] as const){
  const task=selected(kind,[]),schema=task.schema as any;
  expect(schema.properties.taskChanges.items.properties.action.const).toBe('create');
  expect(JSON.stringify(schema)).not.toContain('"enum":[]');
  expect(()=>task.parse(output(kind,[]))).not.toThrow();expect(()=>task.parse(output(kind,[create]))).not.toThrow();
  for(const action of ['update','cancel'])expect(()=>task.parse(output(kind,[{action,id:'missing',task:{}}]))).toThrow();
  const omitted=output(kind,undefined);delete (omitted as any).taskChanges;
  if(kind==='life')expect(()=>task.parse(omitted)).not.toThrow();else expect(()=>task.parse(omitted)).toThrow();
 }
});

it('freezes_appointment_permissions_for_schema_and_parse',()=>{
 const original=[structuredClone(appointment)];const task=selected('chat',original),schema=structuredClone(task.schema);
 Object.assign(original[0],{id:'mutated',kind:'check_messages',status:'completed'});original.push({...appointment,id:'added'});
 expect(task.schema).toEqual(schema);
 for(const action of ['update','cancel'])expect(()=>task.parse({...silent,taskChanges:[{action,id:'meeting',...(action==='update'?{task:{description:'改描述'}}:{})}]})).not.toThrow();
 for(const id of ['mutated','added'])expect(()=>task.parse({...silent,taskChanges:[{action:'cancel',id}]})).toThrow();
 const fresh=selected('chat',original);expect(()=>fresh.parse({...silent,taskChanges:[{action:'cancel',id:'added'}]})).not.toThrow();
 expect(()=>fresh.parse({...silent,taskChanges:[{action:'cancel',id:'meeting'}]})).toThrow();
});

function inspectSchema(schema:any){
 const business=schema.anyOf?schema.anyOf.find((s:any)=>s.properties?.taskChanges):schema;
 const branches=business.properties.taskChanges.items.oneOf??business.properties.taskChanges.items.anyOf??[business.properties.taskChanges.items];
 for(const branch of branches){
  expect(branch.additionalProperties).toBe(false);
  if(branch.properties.task){expect(branch.properties.task.additionalProperties).toBe(false);expect(branch.properties.task.properties.kind?.const).toBe('appointment');expect(branch.properties.task.properties).not.toHaveProperty('messageIds');}
  if(branch.properties.id)expect(branch.properties.id.enum??[branch.properties.id.const]).toEqual(['meeting']);
 }
}
it.each(['json_object','json_schema'] as const)('transport_keeps_appointment_contract_in_%s',async outputMode=>{
 const task=selected('chat',[appointment,check]);let body:any;
 const transport=new ChatCompletionsTransport(()=>({model:'offline',apiKey:'offline',baseUrl:'https://example.test',outputMode}),async(_url,options)=>{
  body=JSON.parse(String(options?.body));return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(silent)}}]}));
 });
 await transport.complete({task,input:{},tools:{web:true,lookup:true}});
 const schema=outputMode==='json_schema'?body.response_format.json_schema.schema:JSON.parse(body.messages[0].content.split('JSON Schema:\n')[1].split('\n')[0]);
 inspectSchema(schema);expect(JSON.stringify(schema)).toContain('lookupDetails');expect(JSON.stringify(schema)).toContain('webSearch');expect(JSON.stringify(schema)).toContain('webRead');
});

it('lookup_and_repair_keep_original_appointment_capabilities',async()=>{
 const tasks=[structuredClone(appointment)],task=selected('chat',tasks),requests:any[]=[];let lookups=0;
 const values=[{lookupDetails:'local'}, {...silent,taskChanges:[{action:'cancel',id:'meeting'}]}, {...silent,taskChanges:[{action:'update',id:'meeting',task:{description:'合法更新'}}]}];
 // The tool callback mutates caller data. Cancelling the originally authorized ID remains valid.
 values[1]={...silent,taskChanges:[{action:'create',task:{kind:'check_messages',at:later,description:'非法检查',checkReason:'unread',messageIds:['a']}}]} as any;
 const result=await new ModelClient({complete:async r=>{requests.push({schema:structuredClone(r.task.schema),repair:structuredClone(r.repair),tools:r.tools});return values.shift();}}).runModel(task,{}, {lookup:async()=>{lookups++;tasks[0].id='mutated';return {fact:'合成'};}});
 expect(result).toMatchObject({taskChanges:[{action:'update',id:'meeting'}]});expect(lookups).toBe(1);expect(requests).toHaveLength(3);expect(requests[1].tools.lookup).toBe(false);expect(requests[2].repair).toBeDefined();
 requests.forEach(r=>{expect(r.schema).toEqual(task.schema);inspectSchema(r.schema);});
});

it('web_continuation_keeps_appointment_contract_without_spending_repairs',async()=>{
 const db=new Storage(':memory:');try{
  const store=new WebSearchStore(db);let reads=0;
  const service=new WebSearchService(store,{signature:'personal-contract',search:async()=>[],read:async()=>{reads++;return {title:'合成',body:'合成公开正文',bodyFormat:'text'};}},new TestClock(),{enabled:true});
  const task=selected('chat',[appointment]),web=service.openSession(store.openStage('turn','synthetic','personal',task.name));const schemas:unknown[]=[];
  const values=[{webRead:{url:'https://example.test/personal-contract'}},{...silent,taskChanges:[create]}];
  const result=await new ModelClient({complete:async r=>{schemas.push(r.task.schema);return values.shift();}}).runModel(task,{}, {web,lookup:null});
  expect(result).toMatchObject({taskChanges:[create]});expect(reads).toBe(1);expect(web.checkpoint()!.repairCount).toBe(0);expect(web.state().counters.successReads).toBe(1);schemas.forEach(inspectSchema);
 }finally{db.close();}
});
