import {it,expect,vi} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Storage} from '../src/storage';
import {asyncFixture} from './environment-async-fixture';
import {NOW} from './helpers';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {freezeEnvironmentSnapshot} from '../src/environment/snapshot';
import {ensureEnvironmentBatch} from '../src/environment/scheduler';
import {runEnvironmentStep} from '../src/environment/runtime';
import {environmentStages, type EnvironmentChangeSet} from '../src/environment/types';
import {MemoryStore} from '../src/memory/store';
import {MemoryRetrieval} from '../src/memory/retrieval';
import {compactTerminalEnvironmentStep} from '../src/environment/payload-compaction';
import {schoolPlan,schoolItem,expand} from './world-school-fixture';
const event={kind:'world' as const,description:'public event',startsAt:NOW,endsAt:null,basis:'fiction' as const,sourceUrls:[]};
// Independent canonical SHA fixture oracle: keys are ordered by the JSON replacer.
function sha(value:unknown){const keys=new Set<string>();JSON.stringify(value,(key,v)=>{if(key)keys.add(key);return v;});return createHash('sha256').update(JSON.stringify(value,[...keys].sort())).digest('hex');}

it.each(environmentStages.flatMap(stage=>['committed','superseded'].map(status=>({stage,status}))))('compacts $stage $status with exact IDs, fingerprints and retained metadata',async({stage,status})=>{
 const compact=compactTerminalEnvironmentStep,{d,step}=asyncFixture(stage),store=new MemoryStore(d.storage);store.migrate(NOW);
 d.storage.set('memory_embedding_signature','compaction-fixture');
 for(let i=0;i<100;i++){const row=store.makeOwner({ownerType:'detail',ownerId:'detail-'+i},{key:'key-'+i,value:'x'.repeat(4096),content:'x'.repeat(4096),sourceIds:[]},NOW);store.saveOwner(row);store.saveVector(row,'compaction-fixture',Float32Array.from([1,0]));}
 const retrieval=new MemoryRetrieval(store,{configSignature:'compaction-fixture',dimensions:2,query:vi.fn(),stats:{}} as any,{}, {lexical:{fact:1,experience:1},semantic:{fact:0.5,experience:0.5,configSignature:'compaction-fixture'}});
 d.storage.save('school_plans',schoolPlan.id,schoolPlan);d.storage.save('school_plan_items','meeting',schoolItem());expand(d);
 const snapshot=freezeEnvironmentSnapshot({...d,retrieval,memoryStore:store},step,NOW);
 expect(snapshot.retrieval.candidates).toHaveLength(100);expect(snapshot.retrieval.candidates[0].normalizedVector).toEqual([1,0]);
 snapshot.usedBasis={owners:[],messageIds:[],sources:[]};
 const result:EnvironmentChangeSet=stage==='world'?{stage,changes:[{action:'create',id:'new-b',event},{action:'create',id:'new-a',event},{action:'update',id:'old',event:{description:'changed'}},{action:'cancel',id:'gone'}]}:stage==='school_week'?{stage,instances:d.schoolStore.instances(),notices:d.schoolStore.notices(),weeks:d.schoolStore.weeks()}:{stage,plans:[stage==='school_group'?{...schoolPlan,owner:'group',kind:'group'}:schoolPlan],items:[stage==='school_group'?schoolItem({owner:'group',kind:'research'}):schoolItem()]};
 const expectedIds=stage==='world'?{createdEvents:['new-b','new-a'],updatedEvents:['old'],cancelledEvents:['gone']}:stage==='school_week'?{instances:result.stage==='school_week'?result.instances.map(r=>r.id):[],notices:d.schoolStore.notices().map(r=>r.id),weeks:d.schoolStore.weeks().map(r=>r.id)}:{plans:['semester'],items:['meeting']};
 const source={...step,status:status as 'committed'|'superseded',attempt:3,preparationGeneration:7,startedAt:NOW,completedAt:NOW,retryAt:NOW,lastError:'retained failure',staleReason:'retained reason',extraAudit:{trace:'retain'},inputSnapshot:snapshot.input,preparationSnapshot:snapshot,frozenResult:result};
 const before=JSON.stringify(source),out=compact(source,NOW)!;
 expect(out).not.toBeNull();expect(out).toEqual({...source,inputSnapshot:null,preparationSnapshot:null,frozenResult:null,terminalAudit:{version:1,compactedAt:NOW,input:{modelContractVersion:1,requiredNoticeIds:stage==='school_week'?(snapshot.input.context as any).requiredNoticeKeys.map((n:any)=>n.id):null},basis:{businessBasis:snapshot.businessBasis,retrievalSignature:snapshot.retrieval.signature,usedBasisDigest:sha(snapshot.usedBasis),inputDigest:sha(snapshot.input),preparationDigest:sha(snapshot),resultDigest:sha(result)},result:{stage,entityIds:expectedIds,counts:Object.fromEntries(Object.entries(expectedIds).map(([key,ids])=>[key,ids!.length]))}}});
 expect(JSON.stringify(source)).toBe(before);expect(Buffer.byteLength(JSON.stringify(out))).toBeLessThan(Buffer.byteLength(before)*0.05);
 const larger=structuredClone(source);larger.preparationSnapshot.retrieval.candidates.push(...structuredClone(snapshot.retrieval.candidates));
 expect(Buffer.byteLength(JSON.stringify(compact(larger,NOW)))).toBe(Buffer.byteLength(JSON.stringify(out)));
 expect(compact(out,'2026-10-08T10:00:00+08:00')).toBeNull();d.storage.close();
});

it.each([undefined,0,1] as const)('keeps nonterminal and legacy payloads byte-for-byte (preparationVersion %s)',async version=>{
 const compact=compactTerminalEnvironmentStep,{d,step}=asyncFixture(),snapshot=freezeEnvironmentSnapshot(d,step,NOW);
 for(const status of ['pending','running','ready','committed','superseded'] as const){if(version===1&&(status==='committed'||status==='superseded'))continue;const row={...step,preparationVersion:version,status,inputSnapshot:snapshot.input,preparationSnapshot:snapshot,frozenResult:{stage:'world' as const,changes:[]}},before=JSON.stringify(row);expect(compact(row,NOW)).toBeNull();expect(JSON.stringify(row)).toBe(before);}
 d.storage.close();
});

it('superseded without result has no invented result; empty week preserves applicable empty notice IDs',async()=>{
 const compact=compactTerminalEnvironmentStep,{d,step}=asyncFixture('school_week'),snapshot=freezeEnvironmentSnapshot(d,step,NOW);
 const out=compact({...step,status:'superseded',inputSnapshot:snapshot.input,preparationSnapshot:snapshot},NOW)!;
 expect(out.terminalAudit).toMatchObject({input:{modelContractVersion:1,requiredNoticeIds:[]},result:null,basis:{resultDigest:null,usedBasisDigest:null}});
 const absent=compact({...step,status:'superseded'},NOW)!;expect(absent.terminalAudit).toMatchObject({input:{modelContractVersion:null,requiredNoticeIds:null},basis:{inputDigest:null,preparationDigest:null}});d.storage.close();
});

it('ready publication stays recoverable until its execution settles',async()=>{
 const {d,step}=asyncFixture();d.generateEnvironment=async()=>({stage:'world',changes:[{action:'create',event}]});const p=new EnvironmentPreparation(d),save=d.environmentStore.saveStep.bind(d.environmentStore);let boundary:any;
 vi.spyOn(d.environmentStore,'saveStep').mockImplementation(row=>{save(row);if(row.status==='ready'){boundary=p.applyReady(row.id,NOW);expect(d.environmentStore.step(row.id)?.frozenResult).toEqual(row.frozenResult);}});
 p.startOne(step.id,NOW);await p.wait();expect(boundary).toBe('none');expect(d.storage.all('events')).toHaveLength(0);expect(p.applyReady(step.id,NOW)).toBe('applied');expect(d.environmentStore.step(step.id)).toMatchObject({status:'committed',inputSnapshot:null,preparationSnapshot:null,frozenResult:null,terminalAudit:{version:1}});await p.stop();d.storage.close();
});

it.each(['events','environment_steps'] as const)('transaction rollback at %s keeps ready payload and retries exactly once',async table=>{
 const {d,step}=asyncFixture();const generate=vi.fn(async()=>({stage:'world' as const,changes:[{action:'create' as const,event}]}));d.generateEnvironment=generate;const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await p.wait();const ready=d.environmentStore.step(step.id)!,id=(ready.frozenResult as any).changes[0].id;
 d.storage.prepare(`CREATE TRIGGER fail_compaction BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'injected write'); END`).run();
 expect(()=>p.applyReady(step.id,NOW)).toThrow('injected write');expect(d.environmentStore.step(step.id)).toEqual(ready);expect(d.storage.all('events')).toHaveLength(0);
 d.storage.prepare('DROP TRIGGER fail_compaction').run();expect(p.applyReady(step.id,NOW)).toBe('applied');expect(p.applyReady(step.id,NOW)).toBe('none');expect(d.storage.all('events')).toEqual([{...event,id,status:'active'}]);expect(d.environmentStore.step(step.id)?.frozenResult).toBeNull();expect(generate).toHaveBeenCalledTimes(1);await p.stop();d.storage.close();
});

it('scheduler supersede keeps an active web-backed execution payload until settle and rejects its late result',async()=>{
 const {d,step}=asyncFixture();let finish!:(v:any)=>void;const web=d.web.openSession.bind(d.web);vi.spyOn(d.web,'openSession').mockImplementation((...args)=>({...web(...args),readPage:async()=>new Promise(resolve=>finish=resolve)}));
 d.generateEnvironment=async(_input,options)=>{await options!.modelOptions!.web!.readPage('https://example.test',{operationId:'terminal-web-operation'});return {stage:'world',changes:[{action:'create',event}]};};
 const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);const snapshot=d.environmentStore.step(step.id)!.preparationSnapshot;d.clock.advance(86400000);ensureEnvironmentBatch(d.storage,d.config,d.clock.now());p.reconcile(d.clock.now());expect(d.environmentStore.step(step.id)).toMatchObject({status:'superseded',preparationSnapshot:snapshot});finish({});await p.wait();expect(d.environmentStore.step(step.id)).toMatchObject({status:'superseded',inputSnapshot:null,preparationSnapshot:null,frozenResult:null,terminalAudit:{result:null}});expect(d.storage.all('events')).toHaveLength(0);await p.stop();d.storage.close();
});

it.each(['reconcile','applyReady'] as const)('observed inactive ready step is compacted after scheduler supersede through %s',async method=>{
 const {d,step}=asyncFixture();d.generateEnvironment=async()=>({stage:'world',changes:[]});const p=new EnvironmentPreparation(d);p.startOne(step.id,NOW);await p.wait();d.clock.advance(86400000);if(method==='reconcile')ensureEnvironmentBatch(d.storage,d.config,d.clock.now());
 if(method==='reconcile')p.reconcile(d.clock.now());else expect(p.applyReady(step.id,d.clock.now())).toBe('stale');
 expect(d.environmentStore.step(step.id)).toMatchObject({status:'superseded',preparationSnapshot:null,terminalAudit:{version:1}});const save=vi.spyOn(d.environmentStore,'saveStep');p.reconcile(d.clock.now());p.applyReady(step.id,d.clock.now());expect(save).not.toHaveBeenCalled();await p.stop();d.storage.close();
});

it('disk reopen does not sweep unobserved historical superseded payloads',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-r4a-')),file=join(dir,'test.sqlite');let storage:Storage|undefined;
 try{
 const {d,step}=asyncFixture('world',storage=new Storage(file));const snapshot=freezeEnvironmentSnapshot(d,step,NOW);d.environmentStore.saveStep({...step,inputSnapshot:snapshot.input,preparationSnapshot:snapshot,status:'running'});d.clock.advance(86400000);ensureEnvironmentBatch(d.storage,d.config,d.clock.now());const saved=d.environmentStore.step(step.id);d.storage.close();storage=undefined;
 const {d:next}=asyncFixture('world',storage=new Storage(file));next.clock.advance(86400000);const p=new EnvironmentPreparation(next);p.reconcile(next.clock.now());expect(next.environmentStore.step(step.id)).toEqual(saved);await p.stop();
 }finally{storage?.close();rmSync(dir,{recursive:true,force:true});}
});

it('reconcile remembers recovered active batch steps before the scheduler changes firstActiveBatch',async()=>{
 const {d,step}=asyncFixture(),snapshot=freezeEnvironmentSnapshot(d,step,NOW);d.environmentStore.saveStep({...step,status:'ready',inputSnapshot:snapshot.input,preparationSnapshot:snapshot,frozenResult:{stage:'world',changes:[]}});
 const p=new EnvironmentPreparation(d);p.reconcile(NOW);d.clock.advance(86400000);ensureEnvironmentBatch(d.storage,d.config,d.clock.now());p.reconcile(d.clock.now());expect(d.environmentStore.step(step.id)).toMatchObject({status:'superseded',inputSnapshot:null,preparationSnapshot:null,frozenResult:null,terminalAudit:{result:{stage:'world'}}});await p.stop();d.storage.close();
});

it('retains unknown audit extensions while recomputing a partial terminal compaction',()=>{
 const {d,step}=asyncFixture(),snapshot=freezeEnvironmentSnapshot(d,step,NOW),source={...step,status:'committed' as const,inputSnapshot:snapshot.input,preparationSnapshot:snapshot,frozenResult:{stage:'world' as const,changes:[]}};
 const audit=compactTerminalEnvironmentStep(source,NOW)!.terminalAudit!,out=compactTerminalEnvironmentStep({...source,terminalAudit:{...audit,externalTrace:'retained'} as typeof audit},NOW)!;
 expect(out.terminalAudit).toMatchObject({externalTrace:'retained',basis:{preparationDigest:sha(snapshot)}});expect(out.preparationSnapshot).toBeNull();d.storage.close();
});

it('one-shot v1 runner commits and compacts after its execution settles',async()=>{
 const {d,step}=asyncFixture();await runEnvironmentStep(d,step.id,async()=>({stage:'world',changes:[{action:'create',event}]}));expect(d.environmentStore.step(step.id)).toMatchObject({status:'committed',frozenResult:null,terminalAudit:{version:1,result:{counts:{createdEvents:1}}}});expect(d.storage.all('events')).toHaveLength(1);d.storage.close();
});
