import {expect,it} from 'vitest';
import {z} from 'zod';
import {consolidationTask,auditTask} from '../src/model/contracts';
import {fixture,long,at} from './memory-capacity-fixture';
function setup(){
 const {store}=fixture(),a=long(store,'l',{totalAwakenings:30}),b=long(store,'other');
 const shorts=['s1','s2'].map(ownerId=>store.makeOwner({ownerType:'short',ownerId},{content:'详细经历',sourceIds:['source-l'],linkedLongId:'l'},at));
 const snapshot=[a,b,...shorts];
 const common={unitKey:'unit',ids:['l'],readOwners:['l'],sourceIds:['source-l']};
 return {store,snapshot,common};
}
const summary={eventSummary:'事件简要',feelingSummary:'阶段感受'};
const validBodies=[
 {action:'refine',content:'长期简要正文',...summary},
 {action:'merge',ids:['l','other'],readOwners:['l','other'],canonicalId:'l',content:'同一事件长期简要',...summary},
 {action:'merge_short',ids:['s1','s2'],readOwners:['s1','s2','l'],content:'合并后的详细经历',...summary},
 {action:'promote',content:'稳定认识正文',learnedKind:'durable_experience'},
];
it.each(validBodies)('advertises mandatory content for $action and accepts its valid historical sources',body=>{
 const d=setup(),unit={...d.common,...body},task=consolidationTask(d.snapshot,unit.ids,'consolidation',at);
 const advertised=z.fromJSONSchema(task.schema as any),{content:omitted,...missing}=unit;
 // The model-visible contract must reject the same missing body as the real parser.
 expect(advertised.safeParse({units:[missing]}).success).toBe(false);
 expect(()=>task.parse({units:[missing]})).toThrow(/content/);
 expect(advertised.safeParse({units:[unit]}).success).toBe(true);expect(task.parse({units:[unit]})[0].content).toBe(body.content);
 for(const content of ['', ' \n\t ']){
  const invalid={units:[{...unit,content}]};expect(advertised.safeParse(invalid).success).toBe(false);expect(()=>task.parse(invalid)).toThrow(/content/);
 }
 const noSources={units:[{...unit,sourceIds:[]}]};expect(advertised.safeParse(noSources).success).toBe(false);expect(()=>task.parse(noSources)).toThrow(/sourceIds/);
});
it('rejects the observed refine shape with summaries but no content in the advertised schema',()=>{
 const d=setup(),task=consolidationTask(d.snapshot,['l']);
 const raw={units:[{...d.common,action:'refine',...summary}]};
 expect(z.fromJSONSchema(task.schema as any).safeParse(raw).success).toBe(false);
 expect(()=>task.parse(raw)).toThrow(/content/);
});
it('still permits retain, discard and retaining a fixed-information review without content',()=>{
 const d=setup();for(const action of ['retain','discard']){
  const task=consolidationTask([d.snapshot[1]],['other']),raw={units:[{...d.common,action,ids:['other'],readOwners:['other'],sourceIds:[]}]};
  expect(z.fromJSONSchema(task.schema as any).safeParse(raw).success).toBe(true);expect(task.parse(raw)).toHaveLength(1);
 }
 const detail=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'已有固定信息'},at),task=auditTask([detail],['phone']);
 const raw={units:[{unitKey:'review',action:'review_detail',ids:['phone'],readOwners:['phone'],targetId:'phone',decision:'retain',sourceIds:[]}]};
 expect(z.fromJSONSchema(task.schema as any).safeParse(raw).success).toBe(true);expect(task.parse(raw)).toHaveLength(1);
});
