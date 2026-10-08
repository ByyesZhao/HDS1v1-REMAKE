import {expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Storage} from '../src/storage';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {ModelClient} from '../src/model/client';
import {HdsiApp} from '../src/app';
import {setup,narrative,emptyMemory} from './helpers';
it('completes four stages after a file-database model failure and reopen, preserving long page tail and stable reading provenance',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-web-integration-')),path=join(dir,'story.sqlite'),d=setup();let db=new Storage(path);const fullBody='公开阅读资料。'.repeat(2500)+'完整尾部标记';let readCalls=0;
 const provider={signature:'fixture',search:async()=>[{url:'https://example.test/page',title:'摘要'}],read:async()=>{readCalls++;return {title:'正文',body:fullBody};}};let web=new WebSearchService(new WebSearchStore(db),provider,d.clock,{enabled:true});db.set('character',d.storage.character());d.storage.close();d.random.next=()=>0;let first=true;
 try {
 const broken=new ModelClient({complete:async r=>{if(r.task.name==='narrative'&&first){first=false;return {webSearch:{query:'公开阅读'}};}throw Error('offline interrupted model');}});await expect(new HdsiApp({...d,storage:db,web,models:broken}).runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['autonomous']})).rejects.toThrow('interrupted');const turnId=db.unfinishedTurn()!.id,run=web.store.openStage('turn',turnId,'narrative','narrative');db.close();db=new Storage(path);web=new WebSearchService(new WebSearchStore(db),provider,d.clock,{enabled:true});const requests:any[]=[];
 const models=new ModelClient({complete:async r=>{requests.push(r);if(!r.webMaterials?.length)return {webSearch:{query:'公开阅读'}};expect(r.webMaterials[0].body.endsWith('完整尾部标记')).toBe(true);if(r.task.name==='narrative')return narrative;if(r.task.name==='personal_life')return {innerThought:'查阅资料的感觉',emotions:[],contact:{willing:true,intention:'分享',draft:'阅读所得'}};if(r.task.name==='expression')return {parts:[{kind:'text',content:'阅读所得'}]};const source=(r.input as any).roles.selfReadSources[0];return {...emptyMemory,shortTermChanges:[{action:'create',clientRef:'reading',content:'查阅了公开资料',eventSummary:'查阅资料',feelingSummary:'平静',topics:['阅读'],sourceIds:[source.id],importance:'normal'}]};}});
 db.set('runtime',{...db.runtime(),paused:false});await new HdsiApp({...d,storage:db,web,models}).resumeUnfinishedTurn();expect(web.store.snapshot(run.runId).counters.successReads).toBe(1);expect(db.read('turns',turnId)!.done).toBe(true);expect(db.outbox(turnId)[0].status).toBe('confirmed');expect(db.read('post_jobs',turnId)!.selfWebReadSources).toHaveLength(1);expect(db.all('memories').find((m:any)=>m.kind==='short')?.content).toContain('查阅');expect(readCalls).toBe(2);expect(new Set(requests.map(r=>r.task.name)).size).toBe(4);
 } finally {db.close();rmSync(dir,{recursive:true});}
});
