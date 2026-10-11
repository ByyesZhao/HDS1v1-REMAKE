import {afterEach,expect,it,vi} from 'vitest';
import {Storage} from '../src/storage';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {ModelClient,ChatCompletionsTransport} from '../src/model/client';
import {TestClock} from './helpers';
import type {ModelTask} from '../src/types';
const opened:Storage[]=[];afterEach(()=>opened.splice(0).forEach(s=>s.close()));
const task:ModelTask<{answer:string}>={name:'personal_life',prompt:'fixture',schema:{type:'object',properties:{answer:{type:'string'}},required:['answer']},parse(v:any){if(typeof v?.answer!=='string')throw Error('answer required');return v;}};
function setup(){const db=new Storage(':memory:');opened.push(db);const store=new WebSearchStore(db),provider={signature:'fixture',search:vi.fn(async()=>[{url:'https://example.test/a',title:'snippet'}]),read:vi.fn(async()=>({bodyFormat:'text' as const,title:'Page',body:'公开正文'}))},service=new WebSearchService(store,provider,new TestClock(),{enabled:true});const web=service.openSession(store.openStage('turn','t','personal',task.name));return {db,store,provider,service,web};}
it('loops web search, read and one private lookup without spending repair allowance; actual provided body creates a life source',async()=>{
 const d=setup(),requests:any[]=[],values=[{webSearch:{query:'课程'}},{webRead:{url:'https://example.test/b'}},{lookupDetails:'phone'},{bad:1},{answer:'done'}];const lookup=vi.fn(async()=>({phone:'local'}));
 const client=new ModelClient({complete:async r=>{requests.push(r);return values.shift();}});
 expect(await client.runModel(task,{visible:'input'},{web:d.web,runRef:d.web.ref,lookup})).toEqual({answer:'done'});
 expect(requests).toHaveLength(5);expect(lookup).toHaveBeenCalledTimes(1);expect(d.web.snapshot().repairCount).toBe(1);expect(d.web.snapshot().lookupUsed).toBe(true);expect(d.web.snapshot().counters.successReads).toBe(2);expect(d.service.selfReadSources('t')).toHaveLength(2);expect(requests[1].webMaterials[0].sourceKind).toBe('external_reference');
});
it('loads one checkpoint and uses direct operation and body reads through lookup tools and repair',async()=>{
 const d=setup(),snapshot=vi.spyOn(d.store,'snapshot'),checkpoint=vi.spyOn(d.store,'checkpoint'),requests:any[]=[],values=[{webRead:{url:'https://example.test/a'}},{lookupDetails:'local'},{bad:true},{answer:'ok'}];
 await new ModelClient({complete:async r=>{const {task:_,...request}=r;requests.push(structuredClone(request));return values.shift();}}).runModel(task,{}, {web:d.web,lookup:async()=>({private:'fact'})});
 expect(checkpoint).toHaveBeenCalledTimes(1);expect(snapshot).not.toHaveBeenCalled();expect(requests.slice(1).map(r=>r.webMaterials[0].body)).toEqual(['公开正文','公开正文','公开正文']);expect(requests[3].repair).toBeDefined();expect(d.service.selfReadSources('t')).toHaveLength(1);
});
it('failed model transmission neither registers a source nor triggers format repair; retry reuses confirmed operation',async()=>{
 const d=setup();let calls=0;const client=new ModelClient({complete:async()=>{calls++;if(calls===1)return {webSearch:{query:'q'}};throw Error('context length exceeded');}});
 await expect(client.runModel(task,{}, {web:d.web,lookup:null})).rejects.toThrow('context length exceeded');expect(calls).toBe(2);expect(d.web.snapshot().counters.successReads).toBe(1);expect(d.service.selfReadSources('t')).toEqual([]);
 await new ModelClient({complete:async()=>({answer:'recovered'})}).runModel(task,{}, {web:d.web,lookup:null});expect(d.provider.read).toHaveBeenCalledTimes(1);expect(d.service.selfReadSources('t')).toHaveLength(1);
});
it('resumes a pending provider operation and retains private lookup and repair state',async()=>{
 const d=setup(),op=d.web.beginOperation({kind:'read',url:'https://example.test/a'});d.web.saveCheckpoint({input:{private:'owner'},repairCount:1,repair:{original:{bad:1},errors:'bad'},lookupUsed:true,privateLookupResult:{phone:'private'},pendingOperationId:op.operationId,toolResults:[]});
 const requests:any[]=[];const lookup=vi.fn();await new ModelClient({complete:async r=>{requests.push(r);return {answer:'ok'};}}).runModel(task,{private:'owner'},{web:d.web,lookup});expect(lookup).not.toHaveBeenCalled();expect(requests[0].lookupResult).toEqual({phone:'private'});expect(requests[0].repair.errors).toBe('bad');expect(d.web.snapshot().checkpoint!.pendingOperationId).toBeNull();expect(d.provider.read).toHaveBeenCalledTimes(1);
});
it('stops tools at quota and returns budget feedback without extra provider calls',async()=>{
 const d=setup(),record=JSON.parse(String(d.db.prepare('SELECT data FROM web_sessions WHERE id=?').get(d.web.id)!.data));record.counters={successReads:20,failures:2};d.db.prepare('UPDATE web_sessions SET data=? WHERE id=?').run(JSON.stringify(record),d.web.id);let request:any;
 await new ModelClient({complete:async r=>{request=r;return {answer:'existing context'};}}).runModel(task,{}, {web:d.web,lookup:null});expect(request.tools.web).toBe(false);expect(request.webStatus.stopReason).toBe('quota');expect(d.provider.read).not.toHaveBeenCalled();
});
it('transport schema permits only available tools and preserves task model settings',async()=>{
 let body:any;const transport=new ChatCompletionsTransport(()=>({model:'deepseek-flash',reasoningEffort:'low',apiKey:'offline',baseUrl:'https://example.test',outputMode:'json_schema'}),(async(_u,o)=>{body=JSON.parse(String(o?.body));return new Response(JSON.stringify({choices:[{message:{content:'{}'}}]}));}) as typeof fetch);
 await transport.complete({task,input:{},tools:{web:true,lookup:true},webMaterials:[]});expect(JSON.stringify(body.response_format.json_schema.schema)).toContain('webSearch');expect(JSON.stringify(body.response_format.json_schema.schema)).toContain('lookupDetails');expect(body.reasoning_effort).toBe('low');
 await transport.complete({task,input:{},tools:{web:false,lookup:false}});expect(JSON.stringify(body.response_format.json_schema.schema)).not.toContain('webSearch');expect(body.messages[0].content).not.toContain('可先只返回');
});
it('an already stopped run cannot save a checkpoint or call transport while replaying a completed operation',async()=>{
 const d=setup(),op=d.web.beginOperation({kind:'read',url:'https://example.test/a'});await d.web.readPage('https://example.test/a',{operationId:op.operationId});d.web.saveCheckpoint({input:{},repairCount:0,lookupUsed:false,pendingOperationId:op.operationId,toolResults:[]});const save=vi.spyOn(d.web,'saveCheckpoint'),complete=vi.fn(async()=>({answer:'late'})),controller=new AbortController();controller.abort(Error('backend stopped'));
 await expect(new ModelClient({complete}).runModel(task,{}, {web:d.web,signal:controller.signal,lookup:null})).rejects.toThrow('backend stopped');expect(save).not.toHaveBeenCalled();expect(complete).not.toHaveBeenCalled();
});
