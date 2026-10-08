import type {Storage} from '../storage';
import type {SchoolNotice,SchoolNoticeRef} from './types';
import {canRead,isSleeping} from '../host/state';
import {hasValidSharedScene} from '../host/shared';
import {due,milliseconds} from '../time';
function legal(storage:Storage,n:SchoolNotice,now:string):boolean {
 if(n.payload.snapshots.some(s=>{const item=s.entityKind==='plan_item'?storage.read('school_plan_items',s.entityId):storage.read('school_plan_items',s.value.sourceItemId);return !item||item.deliveryRevision!==s.value.deliveryRevision;}))return false;
 if(n.kind==='reminder'&&n.instanceId){const i=storage.read('school_instances',n.instanceId);if(!i||i.status!=='active'||milliseconds(i.startsAt)<milliseconds(now))return false;}
 return true;
}
function personalKnown(storage:Storage,n:SchoolNotice){return n.channel!=='personal_reminder'||n.payload.snapshots.every(s=>storage.all('school_knowledge').some(k=>k.entityKind===s.entityKind&&k.entityId===s.entityId&&k.snapshot.value.deliveryRevision===s.value.deliveryRevision));}
export function releaseSchoolNotices(storage:Storage,now:string):void {
 for(const n of storage.all('school_notices').filter(n=>n.status==='scheduled'||n.status==='available')){
  if(!legal(storage,n,now)){storage.save('school_notices',n.id,{...n,status:'invalidated'});continue;}
  if(n.status==='scheduled'&&due(n.publishAt,now)&&personalKnown(storage,n))storage.save('school_notices',n.id,{...n,status:'available',releasedAt:n.releasedAt??now});
 }
}
export function selectSchoolNotices(storage:Storage,now:string):SchoolNoticeRef[]{
 const state=storage.character();if(!canRead(state,now)||isSleeping(state,now))return [];
 return storage.all('school_notices').filter(n=>n.status==='available'&&legal(storage,n,now)&&personalKnown(storage,n)).map(n=>({noticeId:n.id,deliveryRevision:n.deliveryRevision}));
}
export function schoolNotificationEligible(storage:Storage,now:string):boolean {
 if(hasValidSharedScene(storage.character()))return false;
 return selectSchoolNotices(storage,now).some(ref=>{const n=storage.read('school_notices',ref.noticeId)!;return n.nextWakeAt!==null&&due(n.nextWakeAt,now);});
}
export function schoolNoticeDeadline(storage:Storage,now:string):string|null {
 const times:string[]=[],state=storage.character(),shared=hasValidSharedScene(state);
 for(const n of storage.all('school_notices').filter(n=>n.status==='scheduled'||n.status==='available')){
  if(!legal(storage,n,now)||!personalKnown(storage,n))continue;
  if(n.status==='scheduled'){times.push(due(n.publishAt,now)?now:n.publishAt);continue;}
  if(shared||n.nextWakeAt===null)continue;
  if(!isSleeping(state,now)&&canRead(state,now))times.push(due(n.nextWakeAt,now)?now:n.nextWakeAt);
  else{const end=isSleeping(state,now)?state.sleep?.wakeAt:state.scene.activity?.expectedEndAt;if(end&&milliseconds(end)>milliseconds(now))times.push(end);}
 }
 return times.sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??null;
}
