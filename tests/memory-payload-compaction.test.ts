import {it,expect} from 'vitest';
import {fixture,long,at} from './memory-capacity-fixture';
import {WebSearchStore} from '../src/web/store';
import {countCompletedPayloads,compactCompletedPayloads,installPayloadIndexes} from '../src/memory/payload-compaction';
import {freezeEnvironmentSnapshot,digest} from '../src/environment/snapshot';
import type {EnvironmentStep} from '../src/environment/types';
import {DatabaseSync} from 'node:sqlite';
import {Storage} from '../src/storage';
import {vi} from 'vitest';
it('bounded old compaction visits each residual once and keeps recovery bodies',()=>{
 const d=fixture(),web=new WebSearchStore(d.storage);d.storage.save('turns','done',{id:'done',done:true} as any);d.storage.save('turns','pending',{id:'pending',done:false} as any);
 const put=(table:string,id:string,value:any)=>d.storage.prepare('INSERT INTO '+table+'(id,data) VALUES(?,?)').run(id,JSON.stringify(value));
 for(let i=0;i<3;i++){put('memory_index_jobs','i'+i,{id:'i'+i,status:'done',text:'正文',result:[1]});put('memory_maintenance_jobs','m'+i,{id:'m'+i,status:'done',snapshot:[{content:'正文'}],readSet:[],result:[],selectedIds:['keep']});}
 d.storage.save('post_jobs','done',{turnId:'done',result:{body:'正文'} as any});d.storage.save('post_jobs','pending',{turnId:'pending',result:{body:'恢复'} as any});
 const done=web.openStage('turn','done','memory','memory'),pending=web.openStage('turn','pending','memory','memory');const cp={formatVersion:2 as const,input:{body:'恢复'},repairCount:1,lookupUsed:false,pendingOperationId:null,toolResults:[]};web.saveCheckpoint(done.runId,cp);web.saveCheckpoint(pending.runId,cp);
 let total=0;for(let n=0;n<10;n++){const report=d.storage.transaction(()=>d.store.compactCompletedPayloads(3));expect(report.totalUpdated).toBeLessThanOrEqual(3);total+=report.totalUpdated;if(!report.hasMore)break;}
 expect(total).toBe(8);expect(d.store.compactCompletedPayloads(3)).toMatchObject({totalUpdated:0,hasMore:false});expect(d.storage.read('post_jobs','pending')!.result).toEqual({body:'恢复'});expect(web.snapshot(pending.runId).checkpoint).toEqual(cp);expect(web.snapshot(done.runId).counters).toEqual({successReads:0,failures:0});
});
it('owner checkpoint compaction is idempotent; prune last started retry immediately compacts terminal owner',()=>{
 const d=fixture(),web=new WebSearchStore(d.storage),a=long(d.store,'a');d.store.saveJob('memory_maintenance_jobs',{id:'job',kind:'consolidation',startedAt:at,createdAt:at,cutoff:at,status:'pending',snapshot:[a],readSet:[a],selectedIds:['a'],result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:at,lastError:null});
 const ref=web.openStage('maintenance','job','prepare','memory_consolidation');web.saveCheckpoint(ref.runId,{formatVersion:2,input:{body:'正文'},repairCount:1,lookupUsed:false,pendingOperationId:null,toolResults:[]});
 d.store.purgeOwner(a,at);expect(d.store.job<any>('memory_maintenance_jobs','job').status).toBe('done');expect(web.snapshot(ref.runId).checkpoint).toBeNull();
 d.storage.prepare('CREATE TABLE updates(n INTEGER)').run();d.storage.prepare('CREATE TRIGGER count_web AFTER UPDATE ON web_sessions BEGIN INSERT INTO updates VALUES(1); END').run();web.compactOwnerCheckpoint('maintenance','job');expect(d.storage.prepare('SELECT count(*) n FROM updates').get()!.n).toBe(0);
});
it('pruning reads only referencing unfinished maintenance jobs',()=>{
 const d=fixture(),a=long(d.store,'a'),b=long(d.store,'b');for(let i=0;i<1000;i++)d.store.saveJob('memory_maintenance_jobs',{id:'done'+i,status:'done',createdAt:at,snapshot:[],readSet:[],result:null});
 for(const [id,row,status] of [['target',a,'pending'],['other',b,'computing']] as const)d.store.saveJob('memory_maintenance_jobs',{id,createdAt:at,cutoff:at,status,snapshot:[row],readSet:[row],selectedIds:[row.id],result:null,appliedUnitKeys:[],staleUnitKeys:[]});
 expect(d.store.activeMaintenanceJobsReferencing(a).map(j=>j.id)).toEqual(['target']);d.store.purgeOwner(a,at);expect(d.store.job<any>('memory_maintenance_jobs','other').snapshot).toEqual([b]);
});

it('environment payload selection is explicit and shares the existing batch limit',()=>{
 const d=fixture();new WebSearchStore(d.storage);
 const raw=new Map<string,string>();
 for(const [id,status,version] of [
  ...Array.from({length:7},(_,i)=>[`terminal-${i}`,i%2?'superseded':'committed',1] as const),
  ['legacy-zero','committed',0],['legacy-missing','superseded',undefined],['pending','pending',1],['running','running',1],['ready','ready',1],
 ] as const){
  const step:EnvironmentStep={id,batchId:'batch',stage:'world',status:status as EnvironmentStep['status'],preparationVersion:version as 0|1|undefined,attempt:2,startedAt:at,completedAt:at,retryAt:null,lastError:'retained reason',inputSnapshot:null,frozenResult:{stage:'world',changes:[]}};
  step.preparationSnapshot=freezeEnvironmentSnapshot(d,step,at);step.inputSnapshot=step.preparationSnapshot.input;
  d.storage.save('environment_steps',id,step);raw.set(id,JSON.stringify(step));
 }
 for(let i=0;i<2;i++)d.storage.prepare('INSERT INTO memory_index_jobs VALUES(?,?)').run(`index-${i}`,JSON.stringify({id:`index-${i}`,status:'done',text:'索引原文'}));
 const beforeRows=d.storage.prepare('SELECT id,data FROM environment_steps ORDER BY id').all(),prepare=vi.spyOn(d.storage,'prepare');
 expect(countCompletedPayloads(d.storage)).toMatchObject({indexJobs:2,environmentSteps:0});
 expect(countCompletedPayloads(d.storage,{includeEnvironment:true})).toMatchObject({indexJobs:2,environmentSteps:7});
 expect(prepare.mock.calls.every(([sql])=>!/^SELECT (?:\*|data|id,data) FROM environment_steps/.test(sql))).toBe(true);prepare.mockRestore();
 expect(d.storage.prepare('SELECT id,data FROM environment_steps ORDER BY id').all()).toEqual(beforeRows);
 expect(()=>compactCompletedPayloads(d.storage,3,{includeEnvironment:true})).toThrow(/at|time/i);
 expect(countCompletedPayloads(d.storage).indexJobs).toBe(2);
 installPayloadIndexes(d.storage);expect(d.storage.prepare("SELECT name FROM sqlite_master WHERE name='environment_payload_residual'").get()).toBeUndefined();
 installPayloadIndexes(d.storage,{includeEnvironment:true});expect(d.storage.prepare("SELECT name FROM sqlite_master WHERE name='environment_payload_residual'").get()).toBeDefined();
 const first=d.storage.transaction(()=>compactCompletedPayloads(d.storage,3,{includeEnvironment:true,at}));expect(first).toMatchObject({totalUpdated:3,updated:{indexJobs:2,environmentSteps:1},hasMore:true});
 const second=d.storage.transaction(()=>compactCompletedPayloads(d.storage,3,{includeEnvironment:true,at}));expect(second).toMatchObject({totalUpdated:3,updated:{environmentSteps:3},hasMore:true});
 const last=d.storage.transaction(()=>compactCompletedPayloads(d.storage,3,{includeEnvironment:true,at}));expect(last).toMatchObject({totalUpdated:3,updated:{environmentSteps:3},hasMore:false});
 for(const [id,data] of raw){const row=d.storage.read('environment_steps',id)!;
  if(id.startsWith('terminal')){const original=JSON.parse(data);expect(row).toMatchObject({inputSnapshot:null,preparationSnapshot:null,frozenResult:null,lastError:'retained reason',terminalAudit:{version:1,compactedAt:at,basis:{inputDigest:digest(original.inputSnapshot),preparationDigest:digest(original.preparationSnapshot),resultDigest:digest(original.frozenResult)}}});}
  else expect(String(d.storage.prepare('SELECT data FROM environment_steps WHERE id=?').get(id)!.data)).toBe(data);
 }
 expect(compactCompletedPayloads(d.storage,3,{includeEnvironment:true,at:'2026-11-01T00:00:00Z'})).toMatchObject({totalUpdated:0,hasMore:false});
 expect(d.storage.read('environment_steps','terminal-0')!.terminalAudit!.compactedAt).toBe(at);
});

it('environment opt-in does not create missing legacy tables or accept an uncontrolled clock',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE memory_index_jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  expect(countCompletedPayloads(db,{includeEnvironment:true}).environmentSteps).toBe(0);
  installPayloadIndexes(db,{includeEnvironment:true});
  expect(compactCompletedPayloads(db,3,{includeEnvironment:true,at})).toMatchObject({totalUpdated:0,updated:{environmentSteps:0},hasMore:false});
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'environment%'").all()).toEqual([]);
 }finally{db.close();}
});

it('legacy web checkpoints only use owner tables that exist',()=>{
 const db=new DatabaseSync(':memory:');try{
  db.exec('CREATE TABLE web_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE turns(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE memory_maintenance_jobs(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
  Storage.initializeModelRunHistory(db);
  db.prepare('INSERT INTO turns VALUES(?,?)').run('done-turn',JSON.stringify({done:true}));
  db.prepare('INSERT INTO memory_maintenance_jobs VALUES(?,?)').run('done-job',JSON.stringify({status:'done'}));
  const originals=new Map<string,string>();
  for(const [id,ownerType,ownerId] of [['turn','turn','done-turn'],['job','maintenance','done-job'],['unknown','environment','old-step'],['pending','turn','missing-turn']]){
   const data=JSON.stringify({ref:{runId:id,ownerType,ownerId},checkpoint:{input:{text:'must remain until owner known terminal'}}});
   originals.set(id,data);db.prepare('INSERT INTO web_sessions VALUES(?,?)').run(id,data);
  }
  expect(countCompletedPayloads(db,{includeEnvironment:true})).toMatchObject({webSessions:2,environmentSteps:0});
  expect(countCompletedPayloads(db)).toMatchObject({webSessions:2,environmentSteps:0});
  installPayloadIndexes(db,{includeEnvironment:true});
  expect(compactCompletedPayloads(db,1,{includeEnvironment:true,at})).toMatchObject({totalUpdated:1,updated:{webSessions:1,environmentSteps:0},hasMore:true});
  expect(compactCompletedPayloads(db,1,{includeEnvironment:true,at})).toMatchObject({totalUpdated:1,hasMore:false});
  for(const id of ['unknown','pending'])expect(db.prepare('SELECT data FROM web_sessions WHERE id=?').get(id)!.data).toBe(originals.get(id));
  expect(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'environment%'").all()).toEqual([]);
 }finally{db.close();}
});
