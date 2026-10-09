const fs = require('node:fs');
const assert = require('node:assert/strict');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText, filename);
const {asyncFixture} = require('../../../../../../tests/environment-async-fixture.ts');
const {NOW} = require('../../../../../../tests/helpers.ts');
const {schoolPlan,schoolItem,expand} = require('../../../../../../tests/world-school-fixture.ts');
const {MemoryStore} = require('../../../../../../src/memory/store.ts');
const {MemoryRetrieval} = require('../../../../../../src/memory/retrieval.ts');
const {freezeEnvironmentSnapshot,frozenSchoolView,lookupFrozenEnvironment,lookupBasisCurrent,environmentBusinessBasis} = require('../../../../../../src/environment/snapshot.ts');
const {schoolCampusTask} = require('../../../../../../src/school/contracts.ts');
const {resolveResult} = require('../../../../../../src/environment/runtime.ts');
const {EnvironmentPreparation} = require('../../../../../../src/environment/preparation.ts');
const {releaseSchoolNotices} = require('../../../../../../src/school/notices.ts');
const results=[];
async function run(name,fn){await fn();results.push({name,status:'passed'});}
(async()=>{
 await run('detached parse and resolver reject live storage access',async()=>{
  const {d,step}=asyncFixture('school_campus');const item=schoolItem();d.storage.save('school_plans',schoolPlan.id,schoolPlan);d.storage.save('school_plan_items',item.id,item);
  const snapshot=JSON.parse(JSON.stringify(freezeEnvironmentSnapshot(d,step,NOW)));
  const forbidden=new Proxy(d.storage,{get(){throw Error('live access');}}),detached={...d,storage:forbidden,schoolStore:new Proxy(d.schoolStore,{get(){throw Error('live school access');}})};
  const raw={stage:'school_campus',planChanges:[{action:'update',id:schoolPlan.id,expectedRevision:1,plan:{summary:'new'}}],itemChanges:[{action:'update',id:item.id,expectedRevision:1,item:{title:'new'}}]};
  const parsed=schoolCampusTask(detached,()=>[],frozenSchoolView(snapshot)).parse(raw);
  const result=resolveResult(detached,parsed,snapshot.input,frozenSchoolView(snapshot),snapshot.at);
  assert.equal(result.items[0].title,'new');assert.equal(result.plans[0].revision,2);d.storage.close();
 });
 await run('JSON vectors, calibrated retrieval and lookup do not read live store',async()=>{
  const {d,step}=asyncFixture();const store=new MemoryStore(d.storage);store.migrate(NOW);
  const row=store.makeOwner({ownerType:'long',ownerId:'old'},{content:'previous material',retainedFrom:NOW,expiresAt:'2027-01-01T00:00:00Z',sourceIds:[]},NOW);store.saveOwner(row);
  const index={configSignature:'fixture',dimensions:2,query:async()=>Float32Array.from([1,0]),stats:{}};d.storage.set('memory_embedding_signature','fixture');store.saveVector(row,'fixture',Float32Array.from([1,0]));
  const retrieval=new MemoryRetrieval(store,index,{}, {lexical:{fact:1,experience:1},semantic:{fact:0.9,experience:0.9,configSignature:'fixture'}}),snapshot=JSON.parse(JSON.stringify(freezeEnvironmentSnapshot({...d,retrieval,memoryStore:store},step,NOW)));
  assert.deepEqual(snapshot.retrieval.candidates[0].normalizedVector,[1,0]);retrieval.store=new Proxy(store,{get(){throw Error('live retrieval access');}});
  const value=await lookupFrozenEnvironment(snapshot,{query:'different text',scope:'current'},retrieval);assert.equal(value.context.longTerm[0].ownerId,'old');d.storage.close();
 });
 for(const table of ['messages','experiences','self_web_read_sources'])await run(table+' deletion only invalidates returned sources',async()=>{
  const {d,step}=asyncFixture();const store=new MemoryStore(d.storage);store.migrate(NOW);
  const source=table==='messages'?{id:'source',content:'body',direction:'incoming',seenTurnId:'old',turnId:null,receivedAt:NOW,platformMessageIds:[],outboxSeq:null,batchId:null}:{id:'source'};
  d.storage.prepare('INSERT INTO '+table+'(id,data) VALUES(?,?)').run('source',JSON.stringify(source));
  store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'phone',value:'A',content:'A',sourceIds:['source']},NOW));const retrieval=new MemoryRetrieval(store),dep={...d,retrieval,memoryStore:store},snapshot=freezeEnvironmentSnapshot(dep,step,NOW);
  snapshot.usedBasis=(await lookupFrozenEnvironment(snapshot,'phone',retrieval)).usedBasis;assert.equal(lookupBasisCurrent(dep,snapshot),true);d.storage.prepare('DELETE FROM '+table+' WHERE id=?').run('source');assert.equal(lookupBasisCurrent(dep,snapshot),false);
  snapshot.usedBasis=(await lookupFrozenEnvironment(snapshot,'unmatched',retrieval)).usedBasis;assert.equal(lookupBasisCurrent(dep,snapshot),true);d.storage.close();
 });
 await run('notification lifecycle is ignored but structure and invalidation are detected',async()=>{
  const {d}=asyncFixture('school_week');d.storage.save('school_plans',schoolPlan.id,schoolPlan);d.storage.save('school_plan_items','meeting',schoolItem());expand(d);const before=environmentBusinessBasis(d,'school_week');
  releaseSchoolNotices(d.storage,NOW,d.config.timezone);assert.equal(environmentBusinessBasis(d,'school_week'),before);const notice=d.schoolStore.notices()[0];
  d.storage.save('school_notices',notice.id,{...notice,status:'read',releasedAt:NOW,readAt:NOW,readTurnId:'turn',nextWakeAt:null});assert.equal(environmentBusinessBasis(d,'school_week'),before);
  d.storage.save('school_notices',notice.id,{...notice,status:'invalidated'});assert.notEqual(environmentBusinessBasis(d,'school_week'),before);d.storage.close();
 });
 await run('research, knowledge and pending appointments enter stage basis',async()=>{
  const {d}=asyncFixture('school_group');const before=environmentBusinessBasis(d,'school_group');d.storage.save('school_progress','progress',{id:'progress',taskId:'research',kind:'feedback',summary:'new feedback',turnId:'turn',experienceId:'experience'});assert.notEqual(environmentBusinessBasis(d,'school_group'),before);
  let week=environmentBusinessBasis(d,'school_week');d.storage.save('tasks','appointment',{id:'appointment',kind:'appointment',status:'pending',at:NOW,messageIds:[],description:'meeting'});assert.notEqual(environmentBusinessBasis(d,'school_week'),week);week=environmentBusinessBasis(d,'school_week');
  const item=schoolItem();d.storage.save('school_knowledge','knowledge',{id:'knowledge',snapshot:{entityKind:'plan_item',entityId:item.id,revision:1,value:item},acquiredAt:NOW});assert.notEqual(environmentBusinessBasis(d,'school_week'),week);d.storage.close();
 });
 await run('advance past issue catches hidden future update at apply',async()=>{
  const {d,step}=asyncFixture('school_campus');d.clock.time='2026-10-07T09:59:00+08:00';d.storage.save('school_plans',schoolPlan.id,schoolPlan);d.storage.save('school_plan_items','meeting',schoolItem());
  d.generateEnvironment=async()=>({stage:'school_campus',planChanges:[],itemChanges:[{action:'update',id:'meeting',expectedRevision:1,item:{issuedAt:'2026-10-07T12:00:00+08:00'}}]});const prep=new EnvironmentPreparation(d);assert.equal(prep.startOne(step.id,d.clock.now()),true);await prep.wait();assert.equal(prep.takeError(),undefined);d.clock.advance(120000);assert.equal(prep.applyReady(step.id,d.clock.now()),'stale');await prep.stop();d.storage.close();
 });
 fs.writeFileSync(__dirname+'/snapshot.json',JSON.stringify({results},null,2));console.log(JSON.stringify({results},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
