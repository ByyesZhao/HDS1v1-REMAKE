import type {Storage} from '../storage';
import type {SchoolNotice,SchoolNoticeRef,SchoolPlanItem,SchoolInstance,SchoolEntitySnapshot,SchoolEntityRef} from './types';
import {SchoolStore} from './store';
import {schoolItemOccurrences} from './timing';
import {canRead,isSleeping} from '../host/state';
import {hasValidSharedScene} from '../host/shared';
import {due,milliseconds} from '../time';
const sameTime=(a:string|null,b:string|null)=>a===null||b===null?a===b:milliseconds(a)===milliseconds(b);
export function knownPlanCoversInstance(knownPlan:SchoolPlanItem,target:SchoolInstance,now:string,timezone:string):boolean{
 if(knownPlan.id!==target.sourceItemId||knownPlan.deliveryRevision!==target.deliveryRevision||knownPlan.status!=='open'||target.status!=='active'||target.needsExpansion)return false;
 return schoolItemOccurrences(knownPlan,target.weekStart?[target.weekStart]:[],now,timezone).some(o=>o.occurrenceKey===(target.baseOccurrenceKey??target.occurrenceKey)&&sameTime(o.startsAt,target.startsAt)&&sameTime(o.endsAt,target.endsAt));
}
export interface SchoolNoticeEvaluationContext {noticesById:Map<string,SchoolNotice>;knownByEntity:ReadonlyMap<string,SchoolEntitySnapshot>;itemsById:ReadonlyMap<string,SchoolPlanItem>;instancesById:ReadonlyMap<string,SchoolInstance>}
export function createSchoolNoticeEvaluationContext(storage:Storage):SchoolNoticeEvaluationContext {
 const store=new SchoolStore(storage),notices=store.activeNotices(),itemIds=new Set<string>(),instanceIds=new Set<string>(),refs:SchoolEntityRef[]=[];
 for(const notice of notices){if(notice.kind==='reminder'&&notice.instanceId)instanceIds.add(notice.instanceId);for(const snapshot of notice.payload.snapshots){itemIds.add(snapshot.entityKind==='plan_item'?snapshot.entityId:snapshot.value.sourceItemId);if(notice.channel==='personal_reminder'){refs.push({entityKind:snapshot.entityKind,entityId:snapshot.entityId});if(snapshot.entityKind==='instance')refs.push({entityKind:'plan_item',entityId:snapshot.value.sourceItemId});}}}
 return {noticesById:new Map(notices.map(n=>[n.id,n])),knownByEntity:new Map(store.latestKnownSnapshots(refs).map(s=>[JSON.stringify([s.entityKind,s.entityId]),s])),itemsById:new Map(store.itemsByIds([...itemIds]).map(i=>[i.id,i])),instancesById:new Map(store.instancesByIds([...instanceIds]).map(i=>[i.id,i]))};
}
function legal(context:SchoolNoticeEvaluationContext,n:SchoolNotice,now:string):boolean {
 if(n.payload.snapshots.some(s=>{const item=s.entityKind==='plan_item'?context.itemsById.get(s.entityId):context.itemsById.get(s.value.sourceItemId);return !item||item.deliveryRevision!==s.value.deliveryRevision;}))return false;
 if(n.kind==='reminder'&&n.instanceId){const i=context.instancesById.get(n.instanceId);if(!i||i.status!=='active'||i.needsExpansion||milliseconds(i.startsAt)<milliseconds(now))return false;}
 return true;
}
function personalKnown(context:SchoolNoticeEvaluationContext,n:SchoolNotice,now:string,timezone:string){
 if(n.channel!=='personal_reminder')return true;
 const known=context.knownByEntity;
 return n.payload.snapshots.every(s=>{
  const direct=known.get(JSON.stringify([s.entityKind,s.entityId]));
  if(s.entityKind==='plan_item')return direct?.entityKind==='plan_item'&&direct.value.deliveryRevision===s.value.deliveryRevision;
  if(direct?.entityKind==='instance'&&direct.value.sourceItemId===s.value.sourceItemId&&direct.value.deliveryRevision===s.value.deliveryRevision&&sameTime(direct.value.startsAt,s.value.startsAt)&&sameTime(direct.value.endsAt,s.value.endsAt))return true;
  const plan=known.get(JSON.stringify(['plan_item',s.value.sourceItemId]));
  return plan?.entityKind==='plan_item'&&knownPlanCoversInstance(plan.value,s.value,now,timezone);
 });
}
export function releaseSchoolNotices(storage:Storage,now:string,timezone:string,context:SchoolNoticeEvaluationContext=createSchoolNoticeEvaluationContext(storage)):void {
 for(const n of [...context.noticesById.values()].filter(n=>n.status==='scheduled'||n.status==='available')){
  if(!legal(context,n,now)){const saved:SchoolNotice={...n,status:'invalidated'};storage.save('school_notices',n.id,saved);context.noticesById.set(n.id,saved);continue;}
  if(n.status==='scheduled'&&due(n.publishAt,now)&&personalKnown(context,n,now,timezone)){const saved:SchoolNotice={...n,status:'available',releasedAt:n.releasedAt??now};storage.save('school_notices',n.id,saved);context.noticesById.set(n.id,saved);}
 }
}
export function selectSchoolNotices(storage:Storage,now:string,timezone:string,context:SchoolNoticeEvaluationContext=createSchoolNoticeEvaluationContext(storage)):SchoolNoticeRef[]{
 const state=storage.character();if(!canRead(state,now)||isSleeping(state,now))return [];
 return [...context.noticesById.values()].filter(n=>n.status==='available'&&legal(context,n,now)&&personalKnown(context,n,now,timezone)).map(n=>({noticeId:n.id,deliveryRevision:n.deliveryRevision}));
}
export function schoolNotificationEligible(storage:Storage,now:string,timezone:string,context:SchoolNoticeEvaluationContext=createSchoolNoticeEvaluationContext(storage)):boolean {
 if(hasValidSharedScene(storage.character()))return false;
 return selectSchoolNotices(storage,now,timezone,context).some(ref=>{const n=context.noticesById.get(ref.noticeId)!;return n.nextWakeAt!==null&&due(n.nextWakeAt,now);});
}
export function schoolNoticeDeadline(storage:Storage,now:string,timezone:string,context:SchoolNoticeEvaluationContext=createSchoolNoticeEvaluationContext(storage)):string|null {
 const times:string[]=[],state=storage.character(),shared=hasValidSharedScene(state);
 for(const n of [...context.noticesById.values()].filter(n=>n.status==='scheduled'||n.status==='available')){
  if(!legal(context,n,now)||!personalKnown(context,n,now,timezone))continue;
  if(n.status==='scheduled'){times.push(due(n.publishAt,now)?now:n.publishAt);continue;}
  if(shared||n.nextWakeAt===null)continue;
  if(!isSleeping(state,now)&&canRead(state,now))times.push(due(n.nextWakeAt,now)?now:n.nextWakeAt);
  else{const end=isSleeping(state,now)?state.sleep?.wakeAt:state.scene.activity?.expectedEndAt;if(end&&milliseconds(end)>milliseconds(now))times.push(end);}
 }
 return times.sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??null;
}
