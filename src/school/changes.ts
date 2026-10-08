import {randomUUID} from 'node:crypto';
import type {Storage} from '../storage';
import type {EnvironmentModelResult,EnvironmentChangeSet} from '../environment/types';
import type {SchoolPlan,SchoolPlanItem} from './types';
import {milliseconds} from '../time';
import {ModelFormatError} from '../model/client';
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
function publicValue(item:SchoolPlanItem){const {id,revision,deliveryRevision,stageInfo,...value}=item;return value;}
export function resolveSchoolUpstream(storage:Storage,result:Extract<EnvironmentModelResult,{planChanges:unknown}>,now:string):EnvironmentChangeSet {
 const refs=new Map<string,string>(),plans:SchoolPlan[]=[],items:SchoolPlanItem[]=[];
 for(const c of [...result.planChanges,...result.itemChanges])if(c.action==='create'){if(refs.has(c.clientRef))throw new ModelFormatError('duplicate clientRef');refs.set(c.clientRef,randomUUID());}
 for(const c of result.planChanges){if(c.action==='create')plans.push({...c.plan,id:refs.get(c.clientRef)!,revision:1});else{const old=storage.read('school_plans',c.id)!;if(old.revision!==c.expectedRevision)throw new ModelFormatError('plan revision mismatch');const next={...old,...c.plan};if(!same(next,old))plans.push({...next,revision:old.revision+1});}}
 for(const c of result.itemChanges){
  if(c.action==='create'){items.push({...c.item,planId:refs.get(c.item.planId)??c.item.planId,id:refs.get(c.clientRef)!,revision:1,deliveryRevision:1});continue;}
  const old=storage.read('school_plan_items',c.id)!;if(old.revision!==c.expectedRevision)throw new ModelFormatError('item revision mismatch');
  const next={...old,...(c.action==='cancel'?{status:'cancelled' as const}:c.item)};
  if(milliseconds(old.issuedAt)<=milliseconds(now)&&milliseconds(next.issuedAt)>milliseconds(now))throw new ModelFormatError('already issued item cannot be hidden');
  if(same(next,old))continue;
  items.push({...next,revision:old.revision+1,deliveryRevision:old.deliveryRevision+(same(publicValue(old),publicValue(next))?0:1)});
 }
 return {stage:result.stage,plans,items};
}
export function applySchoolChanges(storage:Storage,changes:EnvironmentChangeSet,now:string):void {
 if(changes.stage==='world')throw Error('world is not a school change');
 if(changes.stage==='school_week'){
  changes.instances.forEach(v=>storage.save('school_instances',v.id,v));changes.notices.forEach(v=>storage.save('school_notices',v.id,v));changes.weeks.forEach(v=>storage.save('school_weeks',v.id,v));return;
 }
 changes.plans.forEach(v=>storage.save('school_plans',v.id,v));
 for(const item of changes.items){const old=storage.read('school_plan_items',item.id);
  storage.save('school_plan_items',item.id,item);
  if(old&&old.deliveryRevision!==item.deliveryRevision){
   for(const notice of storage.all('school_notices').filter(n=>(n.sourceItemId===item.id||n.payload.snapshots.some(s=>s.entityKind==='plan_item'?s.entityId===item.id:s.value.sourceItemId===item.id))&&(n.status==='scheduled'||n.status==='available')))storage.save('school_notices',notice.id,{...notice,status:'invalidated'});
   for(const instance of storage.all('school_instances').filter(i=>i.sourceItemId===item.id&&milliseconds(i.startsAt)>milliseconds(now)))storage.save('school_instances',instance.id,{...instance,needsExpansion:true});
  }
 }
}
