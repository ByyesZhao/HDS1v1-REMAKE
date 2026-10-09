import {test,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {performance} from 'node:perf_hooks';
import {validateWeekText} from '../src/school/calendar';
import type {SchoolExpansionInput} from '../src/school/types';
const {parseEnvelopeRequest,mockEnvironmentResponse,waitForEnvironmentBatch}=createRequire(import.meta.url)('../runtime/plugin-smoke-fixtures.cjs');
test('real Koishi smoke completes empty and required-notice V1 batches without repairs',{timeout:30000},()=>{
 const result=spawnSync(process.execPath,[resolve('runtime/plugin-smoke.cjs')],{encoding:'utf8',timeout:25000});
 expect(result.error).toBeUndefined();expect(result.status,result.stdout+'\n'+result.stderr).toBe(0);
 expect(result.stdout).toContain('empty_week');expect(result.stdout).toContain('required_notice');
});
test('current envelope stage is nested; obsolete top-level input cannot silently pass',()=>{
 const init=(input:object)=>({body:JSON.stringify({messages:[{}, {content:JSON.stringify({input,resources:{messages:[],tasks:[],owners:[],materials:[]}})}]})});
 expect(parseEnvelopeRequest(init({context:{stage:'world'},roles:{}})).stage).toBe('world');
 expect(()=>parseEnvelopeRequest(init({stage:'world',roles:{}}))).toThrow('envelope');
});
test('week response covers actual V1 keys and production validation rejects obsolete, missing, and duplicate keys',()=>{
 const response=mockEnvironmentResponse({stage:'school_week',notices:[{key:'required-1',title:'班会'}],weekStarts:['2026-10-05']},'required_notice');
 const input={requiredNoticeKeys:[{id:'required-1'}],weekStarts:['2026-10-05']} as SchoolExpansionInput;
 expect(response.noticeTexts).toEqual([{key:'required-1',text:'离线通知：班会'}]);
 expect(()=>validateWeekText(response,input)).not.toThrow();
 expect(()=>validateWeekText({stage:'school_week',instanceChanges:[]} as any,input)).toThrow('version1');
 expect(()=>validateWeekText({...response,noticeTexts:[]},input)).toThrow('missing');
 expect(()=>validateWeekText({...response,noticeTexts:[...response.noticeTexts,...response.noticeTexts]},input)).toThrow('duplicate');
});
test('HTTP count does not complete wait before all four steps commit',async()=>{
 let committed=false,done=false;
 const steps=['world','school_campus','school_group','school_week'].map(stage=>({stage,status:'ready',lastError:null}));
 const promise=waitForEnvironmentBatch(()=>({batch:{id:'b',status:committed?'committed':'active'},steps:steps.map(s=>({...s,status:committed?'committed':'ready'})),calls:{world:4}}),'b',performance.now()+1000).then(()=>{done=true;});
 await new Promise(resolve=>setImmediate(resolve));expect(done).toBe(false);committed=true;await promise;expect(done).toBe(true);
});
test('failure and timeout retain batch and stage diagnostics',async()=>{
 const inspect=()=>({batch:{id:'b',status:'active'},steps:[{stage:'world',status:'pending',attempt:1,retryAt:'later',lastError:'bad shape'}]});
 await expect(waitForEnvironmentBatch(inspect,'b',performance.now()+1000)).rejects.toThrow('bad shape');
 await expect(waitForEnvironmentBatch(inspect,'b',performance.now()-1)).rejects.toThrow('world');
});
