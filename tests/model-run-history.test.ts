import {ModelRunHistory} from '../src/model/run-history';
import {afterEach,expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Storage} from '../src/storage';
import {ModelClient,ModelRequestError} from '../src/model/client';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {MemoryStore} from '../src/memory/store';
import {compactCompletedPayloads} from '../src/memory/payload-compaction';
import {TestClock} from './helpers';
import type {WebModelCheckpoint,ModelRunRef} from '../src/web/types';
const clean:Array<()=>void>=[];afterEach(()=>clean.splice(0).reverse().forEach(f=>f()));
const checkpoint:WebModelCheckpoint={formatVersion:2,input:{privateText:'original input',imageObservationRef:'observation-1'},repairCount:1,lookupUsed:true,pendingOperationId:null,toolResults:[],privateLookupResult:{text:'private lookup'},repair:{original:'bad draft',errors:'invalid'}};
const task={name:'narrative',prompt:'test',schema:{},parse:(v:unknown)=>{if(v!==42)throw Error('expected 42');return v;}};
function records(storage:Storage){return storage.hasTable('model_run_records')?storage.prepare('SELECT data FROM model_run_records ORDER BY rowid').all().map(r=>JSON.parse(String(r.data))):[];}
async function fixture(path=':memory:'){
 const storage=new Storage(path),clock=new TestClock();clean.push(()=>storage.close());
 const store=new WebSearchStore(storage),web=new WebSearchService(store,undefined,clock,{enabled:false});
 const history=new ModelRunHistory(storage,clock);
 const ref=store.openStage('turn','owner','narrative','narrative');return {storage,clock,store,web,history,ref};
}
it('records_final_invalid_response_when_repair_budget_is_exhausted',async()=>{
 const d=await fixture();let n=0;const client=new ModelClient({complete:async()=>`invalid-${++n}`},undefined,2,d.history);
 await expect(client.runModel(task,{privateText:'input'},{runRef:d.ref,web:d.web.openSession(d.ref),executionAttempt:{retryCycle:3,attemptId:'attempt-1'}})).rejects.toThrow('narrative');
 expect(records(d.storage).map(r=>r.rawResponse)).toEqual(['invalid-1','invalid-2','invalid-3']);
 expect(records(d.storage)[2]).toMatchObject({type:'failure',runId:d.ref.runId,ownerType:'turn',ownerId:'owner',retryCycle:3,attemptId:'attempt-1',category:'format',checkpoint:{input:{privateText:'input'},repairCount:2}});
});
it('foreground_resume_keeps_all_invalid_response_records',async()=>{
 const d=await fixture();let n=0;const client=new ModelClient({complete:async()=>`invalid-${++n}`},undefined,2,d.history),options={runRef:d.ref,web:d.web.openSession(d.ref)};
 await expect(client.runModel(task,{},options)).rejects.toThrow();await expect(client.runModel(task,{},options)).rejects.toThrow();
 expect(records(d.storage).map(r=>r.rawResponse)).toEqual(['invalid-1','invalid-2','invalid-3','invalid-4']);expect(new Set(records(d.storage).map(r=>r.id)).size).toBe(4);expect(d.store.checkpoint(d.ref.runId)!.repairCount).toBe(2);
});
it.each(['stages','owner','memory','payload'] as const)('archive_before_each_compaction_entrypoint: %s',async entry=>{
 const d=await fixture();d.store.saveCheckpoint(d.ref.runId,checkpoint);
 if(entry==='stages')d.storage.transaction(()=>d.store.compactStages('turn','owner',['narrative']));
 if(entry==='owner')d.store.compactOwnerCheckpoint('turn','owner');
 if(entry==='memory'){const memory=new MemoryStore(d.storage),ref=d.store.openStage('maintenance','job','prepare','memory_consolidation');d.store.saveCheckpoint(ref.runId,checkpoint);memory.saveJob('memory_maintenance_jobs',{id:'job',status:'done'});}
 if(entry==='payload'){d.storage.save('turns','owner',{id:'owner',done:true} as any);compactCompletedPayloads(d.storage);}
 expect(records(d.storage)).toHaveLength(1);expect(records(d.storage)[0]).toMatchObject({type:'checkpoint',checkpoint});
 const archivedRun=records(d.storage)[0].runId;expect(d.store.checkpoint(archivedRun)).toBeNull();
 if(entry==='owner')d.store.compactOwnerCheckpoint('turn','owner');if(entry==='stages')d.store.compactStages('turn','owner',['narrative']);if(entry==='payload')compactCompletedPayloads(d.storage);
 expect(records(d.storage)).toHaveLength(1);
});
it.each(['stages','owner','memory','payload'] as const)('archive_write_failure_keeps_live_checkpoint: %s',async entry=>{
 const d=await fixture();const ref=entry==='memory'?d.store.openStage('maintenance','job','prepare','memory_consolidation'):d.ref;d.store.saveCheckpoint(ref.runId,checkpoint);
 // Force a genuine SQLite write failure, independent of the history implementation.
 d.storage.prepare('CREATE TABLE IF NOT EXISTS model_run_records(id TEXT PRIMARY KEY,data TEXT NOT NULL)').run();d.storage.prepare("CREATE TRIGGER reject_archive BEFORE INSERT ON model_run_records BEGIN SELECT RAISE(ABORT,'archive unavailable'); END").run();
 const memory=new MemoryStore(d.storage);d.storage.save('turns','owner',{id:'owner',done:true} as any);
 const clear=()=>{if(entry==='stages')d.store.compactStages('turn','owner',['narrative']);if(entry==='owner')d.store.compactOwnerCheckpoint('turn','owner');if(entry==='memory')memory.saveJob('memory_maintenance_jobs',{id:'job',status:'done'});if(entry==='payload')compactCompletedPayloads(d.storage);};
 expect(clear).toThrow('archive unavailable');expect(d.store.checkpoint(ref.runId)).toEqual(checkpoint);expect(records(d.storage)).toEqual([]);
 if(entry==='memory')expect(memory.job('memory_maintenance_jobs','job')).toBeNull();
});
it('history_survives_success_resume_purge_and_reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'m1-history-'));clean.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'history.sqlite');const d=await fixture(path);
 let n=0;const client=new ModelClient({complete:async()=>++n===1?'bad draft':'42'},undefined,2,d.history);
 expect(await client.runModel(task,{}, {runRef:d.ref,web:d.web.openSession(d.ref)})).toBe(42);await d.web.finalizeOwner('turn','owner');
 const before=records(d.storage);expect(before).toHaveLength(2);expect(d.store.checkpoint(d.ref.runId)).toBeNull();
 await client.runModel(task,{}, {runRef:d.ref,web:d.web.openSession(d.ref)});await d.web.finalizeOwner('turn','owner');
 const memory=new MemoryStore(d.storage);memory.purgeOwner({ownerType:'short',ownerId:'unrelated'},d.clock.now());compactCompletedPayloads(d.storage);
 const reopened=new Storage(path);clean.push(()=>reopened.close());expect(records(reopened).slice(0,2)).toEqual(before);
});
it('history_record_identity_survives_reopen',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'m1-identity-'));clean.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'history.sqlite');const d=await fixture(path);
 let n=0;const client=new ModelClient({complete:async()=>`bad-${++n}`},undefined,2,d.history);await expect(client.runModel(task,{}, {runRef:d.ref,web:d.web.openSession(d.ref)})).rejects.toThrow();
 const reopened=await fixture(path),client2=new ModelClient({complete:async()=>`bad-${++n}`},undefined,2,reopened.history);const ref=reopened.store.openStage('turn','owner','narrative','narrative');
 await expect(client2.runModel(task,{}, {runRef:ref,web:reopened.web.openSession(ref)})).rejects.toThrow();expect(records(reopened.storage).map(r=>r.rawResponse)).toEqual(['bad-1','bad-2','bad-3','bad-4']);expect(new Set(records(reopened.storage).map(r=>r.id)).size).toBe(4);
});
it('readonly_open_does_not_create_history_table',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m1-readonly-'));clean.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'old.sqlite');const old=new DatabaseSync(path);old.exec('CREATE TABLE untouched(id TEXT PRIMARY KEY)');old.close();
 const readOnly=new Storage(path,{readOnly:true});expect(readOnly.hasTable('model_run_records')).toBe(false);readOnly.close();const writable=new Storage(path);clean.push(()=>writable.close());expect(writable.hasTable('model_run_records')).toBe(true);
});
it('history_is_not_automatically_retrieved',async()=>{
 const d=await fixture();d.store.saveCheckpoint(d.ref.runId,checkpoint);d.store.compactOwnerCheckpoint('turn','owner');expect(records(d.storage)).toHaveLength(1);
 const inputs:any[]=[];const client=new ModelClient({complete:async(request:any)=>{inputs.push(request);return '42';}},undefined,2,d.history);await client.runModel(task,{fresh:'current'}, {runRef:d.ref,web:d.web.openSession(d.ref)});
 expect(inputs[0].input).toEqual({fresh:'current'});expect(inputs[0].repair).toBeUndefined();expect(inputs[0].lookupResult).toBeUndefined();expect(JSON.stringify(inputs)).not.toContain('original input');
});

it('diagnostic_runs_without_web_or_owner_keep_distinct_failures_without_recovery',async()=>{
 const d=await fixture();const client=new ModelClient({complete:async()=>'{invalid'},undefined,0,d.history);
 await expect(client.runModel(task,{fresh:'diagnostic'})).rejects.toThrow();await expect(client.runModel(task,{fresh:'diagnostic'})).rejects.toThrow();
 const rows=records(d.storage);expect(rows).toHaveLength(2);expect(rows[0].ownerType).toBeUndefined();expect(rows[0].ownerId).toBeUndefined();expect(rows[0].runId).not.toBe(rows[1].runId);expect(d.store.checkpoint(d.ref.runId)).toBeNull();
});
it('archive_retains_attempt_linkage_and_tool_material_references',async()=>{
 const d=await fixture();d.storage.save('image_observations','observation-1',{id:'observation-1',contentHash:'synthetic-hash',recognizerVersion:'test-v1',origin:'vision',observation:{description:'retained image observation',visibleText:[],possibleTone:null,uncertain:false},confirmedAt:d.clock.now()});const material={id:'body-1',url:'https://example.test/body',title:'reference',body:'full material body',readAt:d.clock.now(),bodyCharacters:18,selectionMode:'full_body',sourceKind:'external_reference'};
 d.storage.prepare('INSERT INTO web_materials VALUES(?,?)').run(`${d.ref.runId}:body-1`,JSON.stringify({runId:d.ref.runId,material,firstOperationId:'op-1',provided:true}));
 d.store.saveCheckpoint(d.ref.runId,{...checkpoint,toolResults:[{materialIds:['body-1'],counters:{successReads:1,failures:0},stopReason:'satisfied'}]});
 const client=new ModelClient({complete:async()=> 'bad final draft'},undefined,1,d.history);await expect(client.runModel(task,checkpoint.input,{runRef:d.ref,web:d.web.openSession(d.ref),executionAttempt:{retryCycle:7,attemptId:'background-attempt'}})).rejects.toThrow();
 d.store.compactOwnerCheckpoint('turn','owner','cancelled');const archived=records(d.storage).find(r=>r.type==='checkpoint');
 expect(archived).toMatchObject({reason:'cancelled',retryCycle:7,attemptId:'background-attempt',checkpoint:{privateLookupResult:{text:'private lookup'},repair:{original:'bad draft'},toolResults:[{materialIds:['body-1']}]}});
 expect(d.store.materials(d.ref.runId,['body-1'])[0].body).toBe('full material body');expect(d.storage.read('image_observations','observation-1')!.observation.description).toBe('retained image observation');
});
it('history_constructor_and_readonly_list_do_not_install_missing_schema',()=>{
 const dir=mkdtempSync(join(tmpdir(),'m1-history-readonly-'));clean.push(()=>rmSync(dir,{recursive:true,force:true}));const path=join(dir,'old.sqlite');const old=new DatabaseSync(path);old.exec('CREATE TABLE untouched(id TEXT PRIMARY KEY)');old.close();
 const storage=new Storage(path,{readOnly:true});try{const history=new ModelRunHistory(storage,new TestClock());expect(history.list({ownerType:'turn',ownerId:'owner'})).toEqual([]);expect(storage.hasTable('model_run_records')).toBe(false);}finally{storage.close();}
});
it('history_append_and_archive_are_immutable_and_idempotent',async()=>{
 const d=await fixture();const failure={id:'fixed-identity',type:'failure' as const,invocationId:'executor-call',responseSequence:1,runId:d.ref.runId,ownerType:'turn' as const,ownerId:'owner',taskName:'narrative',occurredAt:d.clock.now(),stage:'executor',category:'timeout',error:'first error'};
 d.history.append(failure);d.history.append({...failure,error:'replacement'});d.history.archiveCheckpoint(d.ref,checkpoint,'superseded');d.history.archiveCheckpoint(d.ref,structuredClone(checkpoint),'superseded');
 expect(d.history.list({ownerType:'turn',ownerId:'owner'})).toHaveLength(2);expect(d.history.list({ownerType:'turn',ownerId:'owner'})[0]).toMatchObject({error:'first error'});expect(d.store.checkpoint(d.ref.runId)).toBeNull();
});
it('bare_legacy_compaction_fails_closed_only_when_deleting_checkpoint',()=>{
 const db=new DatabaseSync(':memory:');try{db.exec('CREATE TABLE web_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL); CREATE TABLE turns(id TEXT PRIMARY KEY,data TEXT NOT NULL)');db.prepare('INSERT INTO turns VALUES(?,?)').run('done',JSON.stringify({done:true}));
 expect(compactCompletedPayloads(db).totalUpdated).toBe(0);db.prepare('INSERT INTO web_sessions VALUES(?,?)').run('legacy',JSON.stringify({ref:{runId:'legacy',ownerType:'turn',ownerId:'done',stageKey:'memory',taskName:'memory',ordinal:1},checkpoint}));
 expect(()=>compactCompletedPayloads(db)).toThrow('model_run_records');expect(JSON.parse(String(db.prepare("SELECT data FROM web_sessions WHERE id='legacy'").get()!.data)).checkpoint).toEqual(checkpoint);
 }finally{db.close();}
});

it('transport_failures_preserve_category_and_attempt_without_credentials',async()=>{
 const d=await fixture(),failure=new ModelRequestError('narrative: model HTTP 400 (context_limit)',{taskName:'narrative',httpStatus:400,kind:'context_limit'});
 const client=new ModelClient({complete:async()=>{throw failure;}},undefined,2,d.history);
 await expect(client.runModel(task,{context:'current'}, {runRef:d.ref,executionAttempt:{retryCycle:2,attemptId:'transport-attempt'}})).rejects.toBe(failure);
 expect(records(d.storage)).toHaveLength(1);expect(records(d.storage)[0]).toMatchObject({stage:'transport',category:'context_limit',attemptId:'transport-attempt',error:'narrative: model HTTP 400 (context_limit)',checkpoint:{input:{context:'current'}}});
 const noOwner=new ModelClient({complete:async()=>{throw Error('Authorization: Bearer synthetic-secret');}},undefined,2,d.history);await expect(noOwner.runModel(task,{})).rejects.toThrow('synthetic-secret');expect(JSON.stringify(records(d.storage))).not.toContain('synthetic-secret');
});
