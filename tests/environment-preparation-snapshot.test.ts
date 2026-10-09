import {it,expect} from 'vitest';
import {setup} from './helpers';
import {schoolPlan,schoolItem} from './world-school-fixture';
import {freezeEnvironmentSnapshot,frozenSchoolView,lookupFrozenEnvironment} from '../src/environment/snapshot';
import {schoolCampusTask} from '../src/school/contracts';
import {MemoryRetrieval} from '../src/memory/retrieval';
import {MemoryStore} from '../src/memory/store';
it('school parsing and lookup read frozen data after live rows change, vectors survive JSON',async()=>{
 const d=setup();d.storage.save('school_plans',schoolPlan.id,schoolPlan);const item=schoolItem();d.storage.save('school_plan_items',item.id,item);
 const step={id:'s',batchId:'b',stage:'school_campus',status:'pending',attempt:0} as any;
 const snapshot=freezeEnvironmentSnapshot(d,step,d.clock.now());
 d.storage.save('school_plans',schoolPlan.id,{...schoolPlan,revision:2});
 const task=schoolCampusTask(d,()=>[],frozenSchoolView(snapshot));
 expect(()=>task.parse({stage:'school_campus',planChanges:[{action:'update',id:schoolPlan.id,expectedRevision:1,plan:{summary:'新摘要'}}],itemChanges:[]})).not.toThrow();
 const rebuilt=JSON.parse(JSON.stringify(snapshot));
 const r=await lookupFrozenEnvironment(rebuilt,'课程',new MemoryRetrieval(new MemoryStore(d.storage)));
 expect(r.context.recent).toEqual([]);expect(r.usedBasis.owners).toEqual([]);d.storage.close();
});
