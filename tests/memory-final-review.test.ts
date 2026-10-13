import {afterEach,expect,it} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
import {consolidationTask} from '../src/model/contracts';
import {organizeMemory} from '../src/memory/organize';
import {ModelClient} from '../src/model/client';
import {WebSearchService} from '../src/web/service';
import {WebSearchStore} from '../src/web/store';
import {setup,NOW,saveInput,emptyMemory} from './helpers';
import {addMs} from '../src/time';
import type {TurnRecord} from '../src/types';
const closed:Storage[]=[];afterEach(()=>closed.splice(0).forEach(s=>s.close()));
const day=86400000;
function create(){const db=new Storage(':memory:');closed.push(db);const store=new MemoryStore(db);store.migrate(NOW);return {db,store,life:new MemoryLifecycle(store)};}
function event(d:ReturnType<typeof create>,id:string){d.store.saveOwner(d.store.makeOwner({ownerType:'long',ownerId:id},{content:`考试${id}`,sourceIds:['e'],retainedFrom:NOW,expiresAt:addMs(NOW,90*day)},NOW));const short=d.store.makeOwner({ownerType:'short',ownerId:`${id}-short`},{content:'详细过程',sourceIds:['e'],shortExpiresAt:NOW,linkedLongId:id},NOW);d.store.saveOwner(short);return short;}
it('rejects a merge that would write linked long owners outside its closed read set',()=>{
 const d=create(),a=event(d,'a'),b=event(d,'b');expect(()=>consolidationTask([a,b,d.store.canonical('a')!,d.store.canonical('b')!],[a.id,b.id]).parse({units:[{unitKey:'u',action:'merge',readOwners:[a.id,b.id],ids:[a.id,b.id],canonicalId:a.id,content:'合并',sourceIds:['e']}]})).toThrow(/linked|long|canonical/);
});
it('compression after merge uses canonical linked identity and can complete both short revisions',async()=>{
 const d=create(),a=event(d,'a'),b=event(d,'b');d.life.merge(['a','b'],'a');let taskInput:any;
 const models:any={runModel:async(task:any,input:any)=>{taskInput=input;return task.parse({units:[{unitKey:'merged',action:'refine',readOwners:[a.id,b.id,'a'],ids:[a.id,b.id,'a'],content:'合并后简要记忆',sourceIds:['e']}]});}};
 const maintenance=new MemoryMaintenance(d.store,d.life,new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:{now:()=>NOW}}),models,{clock:{now:()=>NOW}});d.db.set('runtime',{...d.db.runtime(),nextMaintenanceAt:NOW});maintenance.startOne(NOW);for(let i=0;i<20;i++)await Promise.resolve();expect(taskInput.resources.owners.find((s:any)=>s.id===b.id).linkedLongId).toBe('a');expect(d.store.jobs<any>('memory_maintenance_jobs')[0].status).toBe('ready');expect(maintenance.applyOneReady(NOW)).toBe('applied');expect(d.store.owner(b)!.consolidatedRevision).toBe(b.revision);await maintenance.stop();
});
it('same-event progress refreshes a durable experience projection and index rather than recalling its old summary',async()=>{
 const d=create();event(d,'a');const original=d.store.canonical('a')!;d.store.saveOwner({...original,totalAwakenings:30});d.life.promote('a','learned','旧考试认识','durable_experience',false,['a'],NOW);const before=d.store.owner({ownerType:'learned',ownerId:'learned'})!;
 const result={schemaVersion:3 as const,shortTermChanges:[{action:'create' as const,clientRef:'progress',existingLongId:'learned',hasNewEventProgress:true,content:'考试结果新进展',eventSummary:'考试新结果',feelingSummary:'安心',topics:['考试'],sourceIds:['e'],importance:'normal' as const}],longTermChanges:[],detailChanges:[]};d.life.apply(result,'new',addMs(NOW,day),['e']);const after=d.store.owner(before)!;expect(after.content).toContain('考试新结果');expect(after.revision).toBeGreaterThan(before.revision);expect(d.store.jobs<any>('memory_index_jobs').some(j=>j.owner.ownerId==='learned'&&j.owner.revision===after.revision)).toBe(true);const ctx=await new MemoryRetrieval(d.store).build(makeRetrievalRequest('考试新结果',addMs(NOW,8*day),'personal_chat'));expect(ctx.learned.map(r=>r.content).join('')).toContain('考试新结果');expect(d.store.canonical('a')!.expiresAt).toBeNull();
});
it('merging two durable aliases leaves one current experience projection and keeps both old IDs awakening the same canonical event',async()=>{
 const d=create();for(const id of ['a','b']){event(d,id);d.store.saveOwner({...d.store.canonical(id)!,totalAwakenings:30});d.life.promote(id,`learned-${id}`,`旧考试${id}`,'durable_experience',false,[id],NOW);}
 d.life.merge(['a','b'],'a');d.life.synchronizeProjections(d.store.canonical('a')!,NOW);const ctx=await new MemoryRetrieval(d.store).build(makeRetrievalRequest('考试',NOW,'personal_chat'));expect(ctx.learned).toHaveLength(1);expect(d.store.canonical('learned-a')!.id).toBe('a');expect(d.store.canonical('learned-b')!.id).toBe('a');expect(d.store.owner({ownerType:'learned',ownerId:'learned-b'})!.status).toBe('merged');
});
it('a stable understanding retains its multi-event conclusion and exposes current basis; projection changes invalidate a prepared unit',async()=>{
 const d=create(),a=event(d,'a');event(d,'b');d.store.saveOwner({...d.store.canonical('a')!,totalAwakenings:30});d.life.promote('a','stable','多次考试后形成的认识','stable_understanding',true,['a','b'],NOW);const learned=d.store.owner({ownerType:'learned',ownerId:'stable'})!;
 const snapshot=[a,d.store.canonical('a')!,learned],unit=consolidationTask(snapshot,[a.id]).parse({units:[{unitKey:'u',action:'refine',readOwners:[a.id,'a'],ids:[a.id,'a'],content:'旧后台提议',sourceIds:['e']}]})[0];expect(unit.readSet.map(r=>r.ownerId)).toContain('stable');
 d.store.saveJob('memory_maintenance_jobs',{id:'j',cutoff:NOW,createdAt:NOW,status:'ready',snapshot,selectedIds:[a.id],readSet:snapshot,result:[unit],appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});
 d.life.synchronizeProjections({...d.store.canonical('a')!,content:'考试更正依据',revision:2},NOW);const updated=d.store.owner(learned)!;expect(updated.content).toBe('多次考试后形成的认识');expect(updated.projectionBasis?.content).toBe('考试更正依据');const m=new MemoryMaintenance(d.store,d.life,new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:{now:()=>NOW}}),{} as any,{clock:{now:()=>NOW}});expect(m.applyOneReady(NOW)).toBe('stale');expect(d.store.owner(learned)!.projectionBasis?.content).toBe('考试更正依据');await m.stop();
});
it('memory lookup ID permissions survive transport failure and recovery without a second lookup',async()=>{
 const d=setup();closed.push(d.storage);saveInput(d.storage,'i','手机');const store=new MemoryStore(d.storage);store.migrate(NOW);store.saveOwner(store.makeOwner({ownerType:'long',ownerId:'exam'},{content:'考试经历',topics:['考试'],sourceIds:['old'],retainedFrom:NOW,expiresAt:addMs(NOW,90*day)},NOW));const web=new WebSearchService(new WebSearchStore(d.storage),undefined,d.clock);let calls=0;
 const turn={id:'t',at:NOW,frozenResult:{experiences:[],visibleMessageIds:['i'],reconsiderMessageIds:[],nextState:d.storage.character(),taskChanges:[],personal:null}} as unknown as TurnRecord;
 const client=new ModelClient({complete:async()=>++calls===1?{lookupDetails:'考试'}:Promise.reject(Error('temporary model error'))});await expect(organizeMemory({...d,web,models:client},turn)).rejects.toThrow('temporary');let request:any;
 const result=await organizeMemory({...d,web,models:new ModelClient({complete:async r=>{request=r;return {...emptyMemory,longTermChanges:[{action:'awaken',id:'exam',reason:'真实重谈',sourceIds:['i']}]};}})},turn);expect(result.longTermChanges[0].id).toBe('exam');expect(request.tools.lookup).toBe(false);expect(request.lookupResult.resources.owners[0].id).toBe('exam');expect(request.lookupResult.context.memoryWritePermissions).toEqual({shortUpdateIds:[],longAwakenIds:['exam'],existingLongIds:['exam']});expect(web.store.snapshot(web.store.openStage('turn','t','memory','memory').runId).lookupUsed).toBe(true);
});
