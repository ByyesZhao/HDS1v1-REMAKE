import type {Storage} from '../storage';
import type {Scene,EnvironmentEvent} from '../types';
import type {SchoolEntitySnapshot,SchoolObservationCommit,NarrativeSchoolContext,PersonalSchoolContext} from './types';
import {knownSchoolSnapshots} from './calendar';
import {milliseconds} from '../time';
import {queryTerms} from '../memory/lexical';
export function narrativeSchoolContext(storage:Storage,from:string,at:string,scene:Scene):NarrativeSchoolContext {
 const objectiveInstances=storage.all('school_instances').filter(i=>!i.needsExpansion&&i.status!=='cancelled'&&(!i.cancelledAt||milliseconds(from)<milliseconds(i.cancelledAt)&&milliseconds(i.startsAt)<milliseconds(i.cancelledAt))&&(
  milliseconds(i.startsAt)<=milliseconds(at)&&milliseconds(i.endsAt??i.startsAt)>=milliseconds(from)
  ||!!i.sourceSnapshot.location&&scene.description.includes(i.sourceSnapshot.location))).map(i=>i.cancelledAt&&milliseconds(i.cancelledAt)<milliseconds(i.endsAt??i.startsAt)?{...i,endsAt:i.cancelledAt}:i);
 const noticeSnapshots=storage.all('school_notices').filter(n=>n.status==='available'&&n.releasedAt!==null&&milliseconds(n.releasedAt)<=milliseconds(at));
 return {objectiveInstances,noticeSnapshots,knownSnapshots:knownSchoolSnapshots(storage),eventIds:[...new Set([...objectiveInstances.flatMap(i=>[i.id,...(i.legacyEventId?[i.legacyEventId]:[])]),...noticeSnapshots.flatMap(n=>n.payload.snapshots.map(s=>s.entityId))])]};
}
export function personalSchoolContext(storage:Storage,observations:SchoolObservationCommit[],query:string):PersonalSchoolContext {
 const latest=new Map<string,SchoolEntitySnapshot>();
 for(const s of knownSchoolSnapshots(storage))latest.set(JSON.stringify([s.entityKind,s.entityId]),s);
 const observed=new Set<string>();for(const o of [...observations].sort((a,b)=>milliseconds(a.happenedAt)-milliseconds(b.happenedAt)))for(const s of o.snapshots){const key=JSON.stringify([s.entityKind,s.entityId]);latest.set(key,s);observed.add(key);}
 const terms=queryTerms(query),low=query.toLowerCase();
 return {knownSnapshots:[...latest.entries()].filter(([key,s])=>{
  if(observed.has(key)||!query.trim())return true;
  const value=s.entityKind==='plan_item'?s.value:s.value.sourceSnapshot,text=JSON.stringify(s).toLowerCase();
  return low.includes(s.entityId.toLowerCase())||low.includes(value.title.toLowerCase())||terms.some(term=>text.includes(term.toLowerCase()));
 }).map(([,s])=>s)};
}
export function personalEnvironmentEvents(storage:Storage,known:SchoolEntitySnapshot[]):EnvironmentEvent[]{
 const world=storage.all('events').filter(e=>e.kind==='world'&&e.status==='active'),school:EnvironmentEvent[]=[];
 for(const snapshot of known){if(snapshot.entityKind!=='instance'||!snapshot.value.legacyEventId)continue;const i=snapshot.value;school.push({id:i.legacyEventId!,kind:'school',startsAt:i.startsAt,endsAt:i.endsAt,description:i.sourceSnapshot.description,basis:i.sourceSnapshot.basis,sourceUrls:i.sourceSnapshot.sourceUrls,status:i.status==='cancelled'?'cancelled':'active'});}
 return [...world,...school];
}
