import {it,expect} from 'vitest';
import {fixture,long,at,days} from '../../../../tests/memory-capacity-fixture';
import {MemoryLifecycle} from '../../../../src/memory/lifecycle';
import {MemoryIndex} from '../../../../src/memory/index';
import {MemoryMaintenance} from '../../../../src/memory/maintenance';
import {MemoryIdle} from '../../../../src/memory/idle';
import {MemoryRetrieval,makeRetrievalRequest} from '../../../../src/memory/retrieval';

it('audit: promoting stable understanding removes recall route for primary event, including after basis sync',async()=>{
 const d=fixture(),life=new MemoryLifecycle(d.store),retrieval=new MemoryRetrieval(d.store);
 long(d.store,'exam-one',{content:'考试结束后在北门捡到蓝色钢笔',eventSummary:'考试结束后在北门捡到蓝色钢笔',topics:['考试']});
 long(d.store,'exam-two',{content:'第二次考试后认真整理文具',topics:['考试']});
 for(let i=0;i<30;i++)life.awaken({id:'exam-one',turnId:`repeat-${i}`,at:days(i),sourceIds:['fresh'],allowedIds:['exam-one'],allowedSourceIds:['fresh'],reason:'重谈'});
 const request=()=>makeRetrievalRequest('还记得蓝色钢笔',days(30),'personal_chat');
 expect((await retrieval.build(request())).longTerm.map(r=>r.id)).toEqual(['exam-one']);
 life.promote('exam-one','understanding','每次考试后都会仔细整理文具','stable_understanding',false,['exam-one','exam-two'],days(30));
 const promoted=d.store.owner({ownerType:'learned',ownerId:'understanding'})!;
 expect(promoted.projectionBasis).toBeUndefined();
 expect((await retrieval.build(request())).longTerm).toEqual([]);
 expect((await retrieval.build(request())).learned).toEqual([]);
 life.synchronizeProjections(d.store.canonical('exam-one')!,days(30));
 expect(d.store.owner(promoted)!.projectionBasis?.content).toContain('蓝色钢笔');
 expect((await retrieval.build(request())).learned).toEqual([]);
 expect(d.store.canonical('exam-one')!.content).toContain('蓝色钢笔');
});

it('audit: model request receives a snapshot already stale before preparation starts',async()=>{
 const d=fixture(),life=new MemoryLifecycle(d.store),idle=new MemoryIdle(d.storage,15,true);
 const row=long(d.store,'event',{content:'考试第一阶段'});d.store.queueDirty(row,'event',at);idle.record('story',at);
 d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:null});
 const index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});
 d.models.outputs.memory_consolidation=(input:any)=>({units:[{unitKey:'retain',action:'retain',ids:input.selectedIds,readOwners:input.snapshot.map((r:any)=>r.id),sourceIds:[]}]});
 const maintenance=new MemoryMaintenance(d.store,life,index,d.models,{clock:d.clock,idle});
 try {
  expect(maintenance.startOne(at)).toBe(false);
  expect(d.store.jobs<any>('memory_maintenance_jobs')).toHaveLength(1);
  d.clock.advance(5*60_000);
  const updated={...row,content:'考试第二阶段',eventSummary:'考试第二阶段',revision:2,stateVersion:2};d.store.saveOwner(updated);d.store.queueDirty(updated,'event',d.clock.now());idle.record('story',d.clock.now());
  d.clock.advance(15*60_000);
  expect(maintenance.startOne(d.clock.now())).toBe(true);
  for(let i=0;i<40;i++)await Promise.resolve();
  expect(d.models.calls[0].input.resources.owners[0].eventSummary).toBe('考试第一阶段');
  expect(maintenance.applyOneReady(d.clock.now())).toBe('stale');
  expect(maintenance.startOne(d.clock.now())).toBe(true);
  for(let i=0;i<40;i++)await Promise.resolve();
  expect(maintenance.applyOneReady(d.clock.now())).toBe('applied');
  expect(d.models.calls).toHaveLength(2);
  expect(d.models.calls[1].input.resources.owners[0].eventSummary).toBe('考试第二阶段');
 } finally {await maintenance.stop();}
});

it('audit: superseded index revisions are embedded before stale check',async()=>{
 const d=fixture(),life=new MemoryLifecycle(d.store),texts:string[]=[];
 const index=new MemoryIndex(d.store,{model:'offline',embed:async text=>{texts.push(text);return [1,0];}},{clock:d.clock});
 const old=long(d.store,'event',{content:'旧的考试摘要'});d.store.queueIndex(old,at);
 const current={...old,content:'新的考试摘要',revision:2,stateVersion:2};d.store.saveOwner(current);d.store.queueIndex(current,at);
 d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:null});
 const maintenance=new MemoryMaintenance(d.store,life,index,d.models,{clock:d.clock});
 try {
  expect(maintenance.startOne(at)).toBe(true);for(let i=0;i<40;i++)await Promise.resolve();
  expect(texts[0]).toContain('旧的考试摘要');expect(maintenance.applyOneReady(at)).toBe('stale');
  expect(maintenance.startOne(at)).toBe(true);for(let i=0;i<40;i++)await Promise.resolve();
  expect(texts[1]).toContain('新的考试摘要');expect(maintenance.applyOneReady(at)).toBe('applied');
  expect(texts).toHaveLength(2);
 } finally {await maintenance.stop();}
});

