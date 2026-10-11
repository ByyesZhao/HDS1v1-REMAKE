import {it,expect} from 'vitest';
import {fixture,at} from './memory-capacity-fixture';
import {WebSearchStore} from '../src/web/store';
const checkpoint={formatVersion:2 as const,input:{body:'完整恢复正文'},repairCount:2,lookupUsed:true,pendingOperationId:'unfinished-op',toolResults:[],privateLookupResult:{body:'细节'}};
const states=[
 ...['pending','running','ready','committed','superseded'].map(status=>({type:'environment',status,terminal:['committed','superseded'].includes(status)})),
 ...['pending','computing','ready','done'].map(status=>({type:'maintenance',status,terminal:status==='done'})),
 ...[false,true].map(done=>({type:'turn',status:String(done),terminal:done})),
];
it.each(states)('bounded recycler protects $type $status recovery and retains evidence',({type,status,terminal})=>{
 const d=fixture(),s=d.storage,web=new WebSearchStore(s);
 {
  const id='owner',put=(table:string,key:string,value:unknown)=>s.prepare('INSERT INTO '+table+'(id,data) VALUES(?,?)').run(key,JSON.stringify(value));
  const maintenance={id,status,cutoff:at,createdAt:at,startedAt:at,retryAt:at,lastError:'保留',snapshot:[{content:'完整维护输入'}],readSet:[{kind:'long',id:'long',revision:2,stateVersion:3}],result:[{input:'完整结果'}],selectedIds:['long'],appliedUnitKeys:['applied'],staleUnitKeys:['stale'],prunedOwnerKeys:['pruned']};
  if(type==='environment')put('environment_steps',id,{id,batchId:'batch',stage:'world',status,attempt:2,inputSnapshot:{body:'环境输入'},frozenResult:{body:'冻结结果'}});
  if(type==='maintenance')put('memory_maintenance_jobs',id,maintenance); // bypass current writer to emulate residual old payload
  if(type==='turn'){s.save('turns',id,{id,done:terminal} as any);put('post_jobs',id,{turnId:id,result:{body:'post恢复'},appliedUnitKeys:['post-applied']});}
  const ref=web.openStage(type as any,id,'recovery','personal_life'),op=web.beginOperation(ref.runId,{kind:'read',url:'https://synthetic.invalid/page'});
  const material={id:'material',url:'https://synthetic.invalid/page',title:'合成资料',body:'完整公开正文',readAt:at,bodyCharacters:6,selectionMode:'full_body' as const,sourceKind:'external_reference' as const};
  web.commitStep(ref.runId,{operationId:op.operationId,stepIndex:0,nextCandidateIndex:1,material});web.commitStep(ref.runId,{operationId:op.operationId,stepIndex:1,nextCandidateIndex:2,reason:'合成失败'});
  web.finishOperation(ref.runId,op.operationId,{materials:[material],counters:{successReads:1,failures:1},stopReason:'satisfied'});web.markProvided(ref.runId,[material.id]);web.incrementMetric(ref.runId,'cacheHits');web.saveCheckpoint(ref.runId,checkpoint);
  // A genuine self-read source is retained alongside every owner-kind sample.
  const self=web.openStage('turn','self-turn','self','personal_life'),selfOp=web.beginOperation(self.runId,{kind:'read',url:material.url});
  web.commitStep(self.runId,{operationId:selfOp.operationId,stepIndex:0,nextCandidateIndex:1,material});web.markProvided(self.runId,[material.id]);
  const evidence=()=>Object.fromEntries(['web_operations','web_materials','self_web_read_sources'].map(table=>[table,s.prepare('SELECT id,data FROM '+table+' ORDER BY rowid').all()]));
  const evidenceBefore=evidence(),sessionBefore=web.snapshot(ref.runId),maintenanceBefore=type==='maintenance'?d.store.job<any>('memory_maintenance_jobs',id):null,environmentBefore=type==='environment'?s.read('environment_steps',id):null;
  const report=d.store.compactCompletedPayloads(50);expect(report.totalUpdated).toBe(terminal?(type==='environment'?1:2):0);expect(report.hasMore).toBe(false);
  const after=web.snapshot(ref.runId);expect(after.checkpoint).toEqual(terminal?null:checkpoint);
  const {checkpoint:beforeCp,repairCount:beforeRepair,lookupUsed:beforeLookup,...stableBefore}=sessionBefore;
  const {checkpoint:afterCp,repairCount:afterRepair,lookupUsed:afterLookup,...stableAfter}=after;
  expect(stableAfter).toEqual(stableBefore);expect(evidence()).toEqual(evidenceBefore);expect(web.selfReadSources('self-turn',self.runId)).toHaveLength(1);
  if(type==='maintenance'){const job=d.store.job<any>('memory_maintenance_jobs',id);expect(job).toEqual(terminal?{...maintenanceBefore,snapshot:[],readSet:[],result:null}:maintenanceBefore);}
  if(type==='environment')expect(s.read('environment_steps',id)).toEqual(environmentBefore);
  if(type==='turn')expect(s.read('post_jobs',id)).toEqual({turnId:id,result:terminal?null:{body:'post恢复'},appliedUnitKeys:['post-applied']});
  expect(d.store.compactCompletedPayloads(50)).toMatchObject({totalUpdated:0,hasMore:false});
 }
});
it.each(['pending','computing','ready','done'])('bounded recycler preserves index job %s state',status=>{
 const d=fixture();{const job={id:'index',status,text:'完整索引正文',result:[1,2,3],owner:{ownerType:'long',ownerId:'owner',revision:2},configSignature:'signature',createdAt:at,startedAt:at,retryAt:at,completedAt:at,completionReason:'applied',lastError:null};
 d.storage.prepare('INSERT INTO memory_index_jobs(id,data) VALUES(?,?)').run(job.id,JSON.stringify(job));const report=d.store.compactCompletedPayloads(50);
 expect(report.totalUpdated).toBe(status==='done'?1:0);const after=d.store.job<any>('memory_index_jobs',job.id);const {result,...rest}=job;
 expect(after).toEqual(status==='done'?{...rest,text:''}:job);expect(d.store.compactCompletedPayloads(50).totalUpdated).toBe(0);
 }
});
