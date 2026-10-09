import type {Storage} from '../storage';
import type {SchoolNotice,SchoolNoticeRef,SchoolPlanItem,SchoolInstance,SchoolEntitySnapshot} from './types';
import {knownSchoolSnapshots} from './calendar';
import {schoolItemOccurrences} from './timing';
import {canRead,isSleeping} from '../host/state';
import {hasValidSharedScene} from '../host/shared';
import {due,milliseconds} from '../time';
const sameTime=(a:string|null,b:string|null)=>a===null||b===null?a===b:milliseconds(a)===milliseconds(b);
export function knownPlanCoversInstance(knownPlan:SchoolPlanItem,target:SchoolInstance,now:string,timezone:string):boolean{
 if(knownPlan.id!==target.sourceItemId||knownPlan.deliveryRevision!==target.deliveryRevision||knownPlan.status!=='open'||target.status!=='active'||target.needsExpansion)return false;
 return schoolItemOccurrences(knownPlan,target.weekStart?[target.weekStart]:[],now,timezone).some(o=>o.occurrenceKey===(target.baseOccurrenceKey??target.occurrenceKey)&&sameTime(o.startsAt,target.startsAt)&&sameTime(o.endsAt,target.endsAt));
}
function legal(storage:Storage,n:SchoolNotice,now:string):boolean {
 if(n.payload.snapshots.some(s=>{const item=s.entityKind==='plan_item'?storage.read('school_plan_items',s.entityId):storage.read('school_plan_items',s.value.sourceItemId);return !item||item.deliveryRevision!==s.value.deliveryRevision;}))return false;
 if(n.kind==='reminder'&&n.instanceId){const i=storage.read('school_instances',n.instanceId);if(!i||i.status!=='active'||i.needsExpansion||milliseconds(i.startsAt)<milliseconds(now))return false;}
 return true;
}
function personalKnown(storage:Storage,n:SchoolNotice,now:string,timezone:string){
 if(n.channel!=='personal_reminder')return true;
 const known=new Map(knownSchoolSnapshots(storage).map(s=>[JSON.stringify([s.entityKind,s.entityId]),s]));
 return n.payload.snapshots.every(s=>{
  const direct=known.get(JSON.stringify([s.entityKind,s.entityId]));
  if(s.entityKind==='plan_item')return direct?.entityKind==='plan_item'&&direct.value.deliveryRevision===s.value.deliveryRevision;
  if(direct?.entityKind==='instance'&&direct.value.sourceItemId===s.value.sourceItemId&&direct.value.deliveryRevision===s.value.deliveryRevision&&sameTime(direct.value.startsAt,s.value.startsAt)&&sameTime(direct.value.endsAt,s.value.endsAt))return true;
  const plan=known.get(JSON.stringify(['plan_item',s.value.sourceItemId]));
  return plan?.entityKind==='plan_item'&&knownPlanCoversInstance(plan.value,s.value,now,timezone);
 });
}
export function releaseSchoolNotices(storage:Storage,now:string,timezone:string):void {
 for(const n of storage.all('school_notices').filter(n=>n.status==='scheduled'||n.status==='available')){
  if(!legal(storage,n,now)){storage.save('school_notices',n.id,{...n,status:'invalidated'});continue;}
  if(n.status==='scheduled'&&due(n.publishAt,now)&&personalKnown(storage,n,now,timezone))storage.save('school_notices',n.id,{...n,status:'available',releasedAt:n.releasedAt??now});
 }
}
export function selectSchoolNotices(storage:Storage,now:string,timezone:string):SchoolNoticeRef[]{
 const state=storage.character();if(!canRead(state,now)||isSleeping(state,now))return [];
 return storage.all('school_notices').filter(n=>n.status==='available'&&legal(storage,n,now)&&personalKnown(storage,n,now,timezone)).map(n=>({noticeId:n.id,deliveryRevision:n.deliveryRevision}));
}
export function schoolNotificationEligible(storage:Storage,now:string,timezone:string):boolean {
 if(hasValidSharedScene(storage.character()))return false;
 return selectSchoolNotices(storage,now,timezone).some(ref=>{const n=storage.read('school_notices',ref.noticeId)!;return n.nextWakeAt!==null&&due(n.nextWakeAt,now);});
}
export function schoolNoticeDeadline(storage:Storage,now:string,timezone:string):string|null {
 const times:string[]=[],state=storage.character(),shared=hasValidSharedScene(state);
 for(const n of storage.all('school_notices').filter(n=>n.status==='scheduled'||n.status==='available')){
  if(!legal(storage,n,now)||!personalKnown(storage,n,now,timezone))continue;
  if(n.status==='scheduled'){times.push(due(n.publishAt,now)?now:n.publishAt);continue;}
  if(shared||n.nextWakeAt===null)continue;
  if(!isSleeping(state,now)&&canRead(state,now))times.push(due(n.nextWakeAt,now)?now:n.nextWakeAt);
  else{const end=isSleeping(state,now)?state.sleep?.wakeAt:state.scene.activity?.expectedEndAt;if(end&&milliseconds(end)>milliseconds(now))times.push(end);}
 }
 return times.sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??null;
}
