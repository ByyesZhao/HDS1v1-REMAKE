import {createHash} from 'node:crypto';
import type {Storage} from '../storage';
import {addMs,due,localParts,localTime,milliseconds} from '../time';
import {localDate} from '../environment/scheduler';
import type {EnvironmentModelResult,EnvironmentChangeSet} from '../environment/types';
import type {SchoolExpansionInput,SchoolPlanItem,RequiredOccurrence,RequiredNotice,SchoolEntitySnapshot,SchoolInstance,SchoolNotice,SchoolWeek} from './types';
import {ModelFormatError} from '../model/client';
export function stableId(kind:string,tuple:unknown):string{return `${kind}:${createHash('sha256').update(JSON.stringify(tuple)).digest('hex')}`;}
const day=(date:string,offset:number)=>new Date(Date.parse(date+'T12:00:00Z')+offset*86400000).toISOString().slice(0,10);
export function weekStart(at:string,timezone:string){const date=localDate(at,timezone),weekday=new Date(date+'T12:00:00Z').getUTCDay()||7;return day(date,1-weekday);}
function dateClock(date:string,clock:string,timezone:string){const [y,m,d]=date.split('-').map(Number),[h,min]=clock.split(':').map(Number);return localTime(y,m,d,h*60+min,timezone);}
export function knownSchoolSnapshots(storage:Storage):SchoolEntitySnapshot[]{
 const latest=new Map<string,SchoolEntitySnapshot>();
 for(const k of storage.all('school_knowledge').sort((a,b)=>milliseconds(a.acquiredAt)-milliseconds(b.acquiredAt)||a.revision-b.revision))latest.set(JSON.stringify([k.entityKind,k.entityId]),k.snapshot);
 return [...latest.values()];
}
function related(notice:SchoolNotice,itemId:string){return notice.sourceItemId===itemId||notice.payload.snapshots.some(s=>s.entityKind==='plan_item'?s.entityId===itemId:s.value.sourceItemId===itemId);}
function occurrences(item:SchoolPlanItem,weeks:string[],now:string,timezone:string):RequiredOccurrence[]{
 const t=item.timing;if(t.kind==='tentative')return [];
 if(t.kind==='once'||t.kind==='deadline'){
  const start=t.kind==='once'?t.startsAt:t.at;if(!start)return [];const end=t.kind==='once'?t.endsAt:null;
  if(milliseconds(end??start)<milliseconds(now))return [];
  return [{occurrenceKey:JSON.stringify([item.id,t.kind==='once'?'once':'deadline']),sourceItemId:item.id,weekStart:null,startsAt:start,endsAt:end,status:'active'}];
 }
 return weeks.flatMap(week=>t.slots.flatMap(slot=>{
  const date=day(week,slot.weekday-1);if(date<t.startsOn||t.endsOn&&date>t.endsOn)return [];
  const startsAt=dateClock(date,slot.start,timezone),endsAt=dateClock(day(date,slot.end<=slot.start?1:0),slot.end,timezone);
  if(milliseconds(endsAt)<milliseconds(now))return [];
  return [{occurrenceKey:JSON.stringify([item.id,slot.slotKey,week]),sourceItemId:item.id,weekStart:week,startsAt,endsAt,status:'active' as const}];
 }));
}
function anchorOccurrence(o:RequiredOccurrence,existing:SchoolInstance[],now:string):RequiredOccurrence|null {
 const base=o.occurrenceKey,family=existing.filter(i=>(i.baseOccurrenceKey??i.occurrenceKey)===base);
 const future=family.find(i=>i.status==='active'&&milliseconds(i.startsAt)>milliseconds(now));
 if(future)return {...o,baseOccurrenceKey:base,occurrenceKey:future.occurrenceKey};
 const history=family.filter(i=>milliseconds(i.startsAt)<=milliseconds(now)).sort((a,b)=>milliseconds(b.startsAt)-milliseconds(a.startsAt));
 if(!history.length)return {...o,baseOccurrenceKey:base};
 // A new future arrangement can follow an already-started session, but its ID
 // cannot replace the historical session. Further moves keep the successor ID.
 if(milliseconds(o.startsAt)<=milliseconds(now))return null;
 return {...o,baseOccurrenceKey:base,occurrenceKey:JSON.stringify([base,'after',history[0].id])};
}
export function schoolExpansionInput(storage:Storage,now:string,timezone:string):SchoolExpansionInput {
 const current=weekStart(now,timezone),date=localDate(now,timezone),weekday=new Date(date+'T12:00:00Z').getUTCDay()||7;
 const weeks=new Set([current]);if(weekday>=5)weeks.add(day(current,7));
 for(const w of storage.all('school_weeks'))if(w.weekStart===day(current,7))weeks.add(w.weekStart);
 const weekStarts=[...weeks].sort(),sourceItems=storage.all('school_plan_items'),existingInstances=storage.all('school_instances'),existingNotices=storage.all('school_notices'),knownSnapshots=knownSchoolSnapshots(storage);
 const requiredOccurrences:RequiredOccurrence[]=[],allOccurrences:RequiredOccurrence[]=[],requiredNoticeKeys:RequiredNotice[]=[],conflicts:string[]=[];
 const coveredVersions=Object.assign({},...storage.all('school_weeks').filter(w=>weeks.has(w.weekStart)).map(w=>w.sourceVersions));
 const addNotice=(draft:Omit<RequiredNotice,'id'|'entityIds'> & {entityIds?:string[]})=>{
  const id=stableId('school-notice',[draft.sourceItemId,draft.occurrenceKey,draft.weekStart,draft.kind,draft.reminderKey,draft.deliveryRevision]);
  if(!existingNotices.some(n=>n.id===id&&n.status!=='invalidated'))requiredNoticeKeys.push({...draft,id,entityIds:draft.entityIds??(draft.sourceItemId?[draft.sourceItemId]:[])});
 };
 for(const item of sourceItems){
  const policy=item.noticePolicy,relatedNotices=existingNotices.filter(n=>related(n,item.id));
  const known=knownSnapshots.some(s=>s.entityKind==='plan_item'?s.entityId===item.id:s.value.sourceItemId===item.id);
  const windowOpen=due(item.issuedAt,now)||relatedNotices.some(n=>n.releasedAt||n.readAt)||known;
  const previousPublic=relatedNotices.some(n=>(n.releasedAt||n.readAt)&&n.payload.snapshots.some(s=>s.entityKind==='plan_item'?s.entityId===item.id:s.value.sourceItemId===item.id))||known;
  const changed=item.deliveryRevision>1;
  const kind=item.status==='cancelled'?'cancel':changed&&windowOpen?'change':'issue';
  const should=kind==='issue'?item.status==='open'&&policy.announceOnIssue:policy.announceOnChange&&windowOpen;
  if(should&&(item.status!=='closed'||previousPublic))addNotice({sourceItemId:item.id,occurrenceKey:null,weekStart:null,deliveryRevision:item.deliveryRevision,kind,reminderKey:kind,channel:'institution',publishAt:windowOpen?now:item.issuedAt});
  if(item.status!=='open'){
   for(const old of existingInstances.filter(i=>i.sourceItemId===item.id&&i.status==='active'&&milliseconds(i.startsAt)>milliseconds(now)))requiredOccurrences.push({occurrenceKey:old.occurrenceKey,baseOccurrenceKey:old.baseOccurrenceKey??old.occurrenceKey,sourceItemId:item.id,weekStart:old.weekStart,startsAt:old.startsAt,endsAt:old.endsAt,status:'cancelled'});
   continue;
  }
  const expanded=occurrences(item,weekStarts,now,timezone).map(o=>anchorOccurrence(o,existingInstances,now)).filter((o):o is RequiredOccurrence=>o!==null);allOccurrences.push(...expanded);
  for(const old of existingInstances.filter(i=>i.sourceItemId===item.id&&i.status==='active'&&milliseconds(i.startsAt)>milliseconds(now))){
   const base=old.baseOccurrenceKey??old.occurrenceKey;
   const supported=occurrences(item,old.weekStart?[old.weekStart]:[],now,timezone).some(o=>o.occurrenceKey===base);
   if(!supported)requiredOccurrences.push({occurrenceKey:old.occurrenceKey,baseOccurrenceKey:base,sourceItemId:item.id,weekStart:old.weekStart,startsAt:old.startsAt,endsAt:old.endsAt,status:'cancelled'});
  }
  for(const occurrence of expanded){
   const old=existingInstances.find(i=>i.occurrenceKey===occurrence.occurrenceKey);
   if(!old||old.needsExpansion||old.deliveryRevision!==item.deliveryRevision||milliseconds(old.startsAt)!==milliseconds(occurrence.startsAt)||old.endsAt!==occurrence.endsAt)requiredOccurrences.push(occurrence);
   for(const reminder of policy.reminders){
    let at:string;if(reminder.kind==='minutes_before')at=addMs(occurrence.startsAt,-reminder.offset*60000);
    else{const p=localParts(occurrence.startsAt,timezone);at=localTime(p.year,p.month,p.day-reminder.offset,p.hour*60+p.minute,timezone);}
    // Missed reminders are represented by the current issue/correction, not a burst of historical reminders.
    if(milliseconds(at)<milliseconds(now))continue;
    at=milliseconds(at)<milliseconds(item.issuedAt)?item.issuedAt:at;
    if(milliseconds(at)>milliseconds(occurrence.startsAt))continue;
    addNotice({sourceItemId:item.id,occurrenceKey:occurrence.occurrenceKey,weekStart:occurrence.weekStart,deliveryRevision:item.deliveryRevision,kind:'reminder',reminderKey:JSON.stringify([reminder.kind,reminder.offset,reminder.source]),channel:reminder.source,publishAt:at});
   }
  }
 }
 for(const week of weekStarts){
  const items=sourceItems.filter(i=>i.status==='open'&&i.timing.kind==='weekly'&&allOccurrences.some(o=>o.sourceItemId===i.id&&o.weekStart===week)&&(due(i.issuedAt,now)||existingNotices.some(n=>related(n,i.id)&&(n.releasedAt||n.readAt))||knownSnapshots.some(s=>s.entityKind==='plan_item'&&s.entityId===i.id)));if(!items.length)continue;
  const previous=existingNotices.filter(n=>n.kind==='week_digest'&&n.weekStart===week).sort((a,b)=>b.deliveryRevision-a.deliveryRevision)[0];
  const covered=previous&&previous.status!=='invalidated'&&items.every(item=>previous.payload.snapshots.some(s=>s.entityKind==='plan_item'&&s.entityId===item.id&&s.value.deliveryRevision===item.deliveryRevision));
  if(!covered)addNotice({sourceItemId:null,occurrenceKey:null,weekStart:week,deliveryRevision:(previous?.deliveryRevision??0)+1,kind:'week_digest',reminderKey:'week_digest',channel:'institution',publishAt:now,entityIds:items.map(i=>i.id)});
 }
 for(let i=0;i<allOccurrences.length;i++)for(const b of allOccurrences.slice(i+1)){const a=allOccurrences[i];if(milliseconds(a.startsAt)<milliseconds(b.endsAt??b.startsAt)&&milliseconds(b.startsAt)<milliseconds(a.endsAt??a.startsAt))conflicts.push(`${a.occurrenceKey} 与 ${b.occurrenceKey} 时间冲突；角色自行选择`);}
 return {weekStarts,sourceItems,existingInstances,existingNotices,knownSnapshots,coveredVersions,requiredOccurrences,requiredNoticeKeys,conflicts};
}
export function validateWeekCoverage(result:Extract<EnvironmentModelResult,{stage:'school_week'}>,input:SchoolExpansionInput):void {
 for(const o of input.requiredOccurrences){
  const candidate=result.instanceChanges.find(c=>c.occurrenceKey===o.occurrenceKey&&c.sourceItemId===o.sourceItemId);
  if(!candidate)throw new ModelFormatError(`required occurrence missing: ${o.occurrenceKey}`);
  const revision=input.sourceItems.find(i=>i.id===o.sourceItemId)!.revision;
  if(candidate.expectedRevision!==revision)throw new ModelFormatError(`${o.occurrenceKey}: expectedRevision must be ${revision} from current sourceItems, not the old existingInstances revision`);
 }
 for(const n of input.requiredNoticeKeys)if(!result.noticeCandidates.some(c=>c.key===n.id))throw new ModelFormatError(`required notice missing: ${n.id}`);
 for(const c of result.instanceChanges)if(!input.requiredOccurrences.some(o=>o.occurrenceKey===c.occurrenceKey&&o.sourceItemId===c.sourceItemId))throw new ModelFormatError('unknown occurrence candidate');
 for(const c of result.noticeCandidates){const n=input.requiredNoticeKeys.find(n=>n.id===c.key);if(!n)throw new ModelFormatError('unknown notice candidate');if(n.sourceItemId&&!c.entityRefs.some(r=>r.entityKind==='plan_item'&&r.entityId===n.sourceItemId))throw new ModelFormatError('notice must declare its source item');
  for(const id of n.entityIds)if(!c.entityRefs.some(r=>r.entityKind==='plan_item'&&r.entityId===id))throw new ModelFormatError('required declared notice entity missing');
  for(const ref of c.entityRefs)if(ref.entityKind==='plan_item'?!input.sourceItems.some(i=>i.id===ref.entityId):!input.requiredOccurrences.some(o=>o.occurrenceKey===ref.entityId)&&!input.existingInstances.some(i=>i.id===ref.entityId||i.occurrenceKey===ref.entityId))throw new ModelFormatError('unknown notice entity');
  for(const ref of c.entityRefs){const itemId=ref.entityKind==='plan_item'?ref.entityId:input.requiredOccurrences.find(o=>o.occurrenceKey===ref.entityId)?.sourceItemId??input.existingInstances.find(i=>i.id===ref.entityId||i.occurrenceKey===ref.entityId)?.sourceItemId;if(!itemId||!n.entityIds.includes(itemId))throw new ModelFormatError('notice declares unrelated or hidden entity');}
 }
 if(new Set(result.instanceChanges.map(c=>c.occurrenceKey)).size!==result.instanceChanges.length||new Set(result.noticeCandidates.map(c=>c.key)).size!==result.noticeCandidates.length)throw new ModelFormatError('duplicate week candidate');
 if(new Set(result.weekChanges.map(w=>w.weekStart)).size!==result.weekChanges.length)throw new ModelFormatError('duplicate week metadata');
 for(const w of result.weekChanges){if(!input.weekStarts.includes(w.weekStart)||Object.entries(w.sourceVersions).some(([id,v])=>input.sourceItems.find(i=>i.id===id)?.revision!==v))throw new ModelFormatError('wrong week coverage version');}
}
export function resolveSchoolWeek(storage:Storage,result:Extract<EnvironmentModelResult,{stage:'school_week'}>,input:SchoolExpansionInput,now:string):EnvironmentChangeSet {
 validateWeekCoverage(result,input);
 const instances:SchoolInstance[]=result.instanceChanges.map(c=>{
  const o=input.requiredOccurrences.find(o=>o.occurrenceKey===c.occurrenceKey)!,item=input.sourceItems.find(i=>i.id===c.sourceItemId)!,old=input.existingInstances.find(i=>i.occurrenceKey===c.occurrenceKey);
  return {id:old?.id??stableId('school-instance',c.occurrenceKey),sourceItemId:item.id,sourceRevision:item.revision,deliveryRevision:item.deliveryRevision,occurrenceKey:c.occurrenceKey,baseOccurrenceKey:o.baseOccurrenceKey??o.occurrenceKey,weekStart:o.weekStart,startsAt:o.startsAt,endsAt:o.endsAt,sourceSnapshot:item,status:o.status,needsExpansion:false,legacyEventId:old?.legacyEventId??null};
 });
 const notices:SchoolNotice[]=result.noticeCandidates.map(c=>{
  const n=input.requiredNoticeKeys.find(n=>n.id===c.key)!,snapshots:SchoolEntitySnapshot[]=c.entityRefs.map(ref=>{
   if(ref.entityKind==='plan_item'){const value=input.sourceItems.find(i=>i.id===ref.entityId)!;return {entityKind:'plan_item',entityId:value.id,revision:value.revision,value};}
   const value=[...instances,...input.existingInstances].find(i=>i.id===ref.entityId||i.occurrenceKey===ref.entityId)!;return {entityKind:'instance',entityId:value.id,revision:value.sourceRevision,value};
  });
  const instance=n.occurrenceKey?[...instances,...input.existingInstances].find(i=>i.occurrenceKey===n.occurrenceKey):null;
  return {id:n.id,sourceItemId:n.sourceItemId,instanceId:instance?.id??null,weekStart:n.weekStart,deliveryRevision:n.deliveryRevision,kind:n.kind,reminderKey:n.reminderKey,channel:n.channel,publishAt:n.publishAt,releasedAt:null,payload:{text:c.text,snapshots},status:'scheduled',nextWakeAt:n.publishAt,readAt:null,readTurnId:null};
 });
 const sourceVersions=Object.fromEntries(input.sourceItems.map(item=>[item.id,item.revision]));
 const weeks:SchoolWeek[]=input.weekStarts.map(weekStart=>({id:stableId('school-week',weekStart),weekStart,sourceVersions,conflictNotes:result.weekChanges.find(w=>w.weekStart===weekStart)?.conflictNotes??input.conflicts,checkedAt:now,digestRevision:Math.max(0,...[...notices,...input.existingNotices].filter(n=>n.weekStart===weekStart&&n.kind==='week_digest').map(n=>n.deliveryRevision))}));
 return normalizeSchoolWeekChanges(storage,{stage:'school_week',instances,notices,weeks},now);
}

// Candidate validation belongs to the frozen input. Historical protection belongs
// to the actual application time, including ready results restored after restart.
export function normalizeSchoolWeekChanges(storage:Storage,changes:Extract<EnvironmentChangeSet,{stage:'school_week'}>,now:string):Extract<EnvironmentChangeSet,{stage:'school_week'}> {
 const aliases=new Map<string,SchoolInstance|null>();
 const instances=changes.instances.flatMap(value=>{
  const old=storage.read('school_instances',value.id);
  if(!old||milliseconds(old.startsAt)>milliseconds(now)||JSON.stringify(old)===JSON.stringify(value))return [value];
  if(value.status==='cancelled'){aliases.set(value.id,null);return [];}
  const base=value.baseOccurrenceKey??old.baseOccurrenceKey??value.occurrenceKey,occurrenceKey=JSON.stringify([base,'after',old.id]);
  const next={...value,id:stableId('school-instance',occurrenceKey),occurrenceKey,baseOccurrenceKey:base,legacyEventId:null};
  aliases.set(value.id,next);return [next];
 });
 const notices=changes.notices.flatMap(notice=>{
  const replacement=notice.instanceId?aliases.get(notice.instanceId):undefined;
  if(replacement===null&&notice.kind==='reminder')return [];
  const instance=replacement??(notice.instanceId?instances.find(i=>i.id===notice.instanceId)??storage.read('school_instances',notice.instanceId):null);
  if(notice.kind==='reminder'&&instance&&milliseconds(instance.startsAt)<milliseconds(now))return [];
  const snapshots=notice.payload.snapshots.flatMap(snapshot=>{
   if(snapshot.entityKind!=='instance'||!aliases.has(snapshot.entityId))return [snapshot];
   const next=aliases.get(snapshot.entityId);return next?[{entityKind:'instance' as const,entityId:next.id,revision:next.sourceRevision,value:next}]:[];
  });
  const instanceId=replacement===null?null:replacement?.id??notice.instanceId;
  const id=replacement?stableId('school-notice',[notice.sourceItemId,replacement.occurrenceKey,notice.weekStart,notice.kind,notice.reminderKey,notice.deliveryRevision]):notice.id;
  return [{...notice,id,instanceId,payload:{...notice.payload,snapshots}}];
 });
 return {...changes,instances,notices};
}
