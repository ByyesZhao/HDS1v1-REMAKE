import type {Storage} from '../storage';
import type {TurnRecord,NarrativeResult,Experience,TurnCandidate,CharacterState} from '../types';
import type {PreparedSchoolCommits,SchoolObservationCommit,SchoolProgressCommit,SchoolEntitySnapshot} from './types';
import {narrativeSchoolContext,personalSchoolContext} from './context';
import {stableId} from './calendar';
import {canRead,isSleeping} from '../host/state';
import {milliseconds} from '../time';
function readable(state:CharacterState,narrative:NarrativeResult,happenedAt:string,at:string):boolean {
 if(canRead(state,happenedAt))return true;
 const after={...state,scene:{...state.scene,...narrative.currentScene},sleep:state.sleep&&milliseconds(state.sleep.wakeAt)<=milliseconds(at)?null:state.sleep};
 if(milliseconds(happenedAt)===milliseconds(at))return canRead(after,happenedAt);
 const next=narrative.currentScene.activity;
 return !isSleeping(state,happenedAt)&&!!next&&next.phoneAccess&&milliseconds(next.startsAt)<=milliseconds(happenedAt)&&(!state.scene.activity||milliseconds(next.startsAt)>milliseconds(state.scene.activity.startsAt));
}
export function prepareSchoolCommits(storage:Storage,turn:TurnRecord,narrative:NarrativeResult,experiences:Experience[]):PreparedSchoolCommits {
 const state=storage.character(),context=narrativeSchoolContext(storage,state.narratedUntil,turn.at,state.scene),observations:SchoolObservationCommit[]=[],progress:SchoolProgressCommit[]=[],seen=new Set<string>();
 const experience=(index:number)=>{const e=experiences[index];if(!e||milliseconds(e.happenedAt)<milliseconds(state.narratedUntil)||milliseconds(e.happenedAt)>milliseconds(turn.at))throw Error('school observation/progress requires actual experience');return e;};
 for(const draft of narrative.schoolObservations??[]){
  const e=experience(draft.experienceIndex),identity=JSON.stringify([draft.via,draft.sourceId]);if(seen.has(identity))throw Error('duplicate school observation');seen.add(identity);let snapshots:SchoolEntitySnapshot[];
  if(draft.via==='notice'){
   const ref=turn.schoolNoticeRefs?.find(r=>r.noticeId===draft.sourceId),notice=storage.read('school_notices',draft.sourceId);
   if(!ref||!notice||notice.deliveryRevision!==ref.deliveryRevision||notice.status!=='available')throw Error('school notice not in frozen readable refs');
   if(!notice.releasedAt||milliseconds(notice.releasedAt)>milliseconds(e.happenedAt)||milliseconds(notice.publishAt)>milliseconds(e.happenedAt))throw Error('school notice not published at experience time');
   if(!readable(state,narrative,e.happenedAt,turn.at))throw Error('school notice not readable at experience time');snapshots=notice.payload.snapshots;
  }else{
   const instance=context.objectiveInstances.find(i=>i.id===draft.sourceId||i.legacyEventId===draft.sourceId);
   if(!instance||milliseconds(instance.startsAt)>milliseconds(e.happenedAt)||!e.relatedEventIds.some(id=>id===instance.id||id===instance.legacyEventId)||isSleeping(state,e.happenedAt))throw Error('onsite observation requires perceptible actual instance experience');
   snapshots=[{entityKind:'instance',entityId:instance.id,revision:instance.sourceRevision,value:instance},{entityKind:'plan_item',entityId:instance.sourceItemId,revision:instance.sourceSnapshot.revision,value:instance.sourceSnapshot}];
  }
  observations.push({via:draft.via,sourceId:draft.sourceId,snapshots,happenedAt:e.happenedAt,experienceId:e.id});
 }
 const visibleSnapshots=personalSchoolContext(storage,observations,'').knownSnapshots;
 for(const draft of narrative.researchProgress??[]){const e=experience(draft.experienceIndex),atTime=personalSchoolContext(storage,observations.filter(o=>milliseconds(o.happenedAt)<=milliseconds(e.happenedAt)),'').knownSnapshots,task=atTime.find(s=>s.entityKind==='plan_item'&&s.entityId===draft.taskId&&s.value.kind==='research');if(!task)throw Error('research progress requires known research task');
  if(progress.some(p=>p.taskId===draft.taskId&&p.experienceId===e.id&&p.kind===draft.kind))throw Error('duplicate research progress');
  progress.push({taskId:draft.taskId,kind:draft.kind,summary:draft.summary,happenedAt:e.happenedAt,experienceId:e.id});
 }
 return {observations,progress,visibleSnapshots};
}
// Called in the existing story B transaction, after actual experiences are saved.
export function applySchoolCommits(storage:Storage,candidate:TurnCandidate,turnId:string):void {
 const experiences=new Set(candidate.experiences.map(e=>e.id)),read=new Set<string>();
 for(const observation of candidate.schoolObservations??[]){if(!experiences.has(observation.experienceId))throw Error('school knowledge has no committed experience');
  if(observation.via==='notice'){
   const n=storage.read('school_notices',observation.sourceId);if(!n||n.status==='invalidated'||n.status==='scheduled'||n.status==='read'&&n.readTurnId!==turnId)throw Error('frozen school notice no longer readable');
   if(candidate.schoolNoticeRefs&&!candidate.schoolNoticeRefs.some(ref=>ref.noticeId===n.id&&ref.deliveryRevision===n.deliveryRevision))throw Error('school notice version changed');
   storage.save('school_notices',n.id,{...n,status:'read',readAt:observation.happenedAt,readTurnId:turnId,nextWakeAt:null});read.add(n.id);
  }
  for(const snapshot of observation.snapshots){const id=stableId('school-knowledge',[turnId,observation.via,observation.sourceId,snapshot.entityKind,snapshot.entityId,snapshot.revision]);if(!storage.read('school_knowledge',id))storage.save('school_knowledge',id,{id,entityKind:snapshot.entityKind,entityId:snapshot.entityId,revision:snapshot.revision,snapshot,acquiredAt:observation.happenedAt,experienceId:observation.experienceId,turnId,via:observation.via});}
 }
 for(const p of candidate.schoolProgress??[]){if(!experiences.has(p.experienceId))throw Error('school research has no committed experience');const id=stableId('school-progress',[turnId,p.experienceId,p.taskId,p.kind]);if(!storage.read('school_progress',id))storage.save('school_progress',id,{id,...p,turnId});}
 for(const ref of candidate.schoolNoticeRefs??[]){if(read.has(ref.noticeId))continue;const n=storage.read('school_notices',ref.noticeId);if(!n||n.status!=='available'||n.deliveryRevision!==ref.deliveryRevision)continue;
  const end=candidate.nextState.scene.activity?.expectedEndAt,at=storage.read('turns',turnId)?.at??candidate.nextState.narratedUntil;
  storage.save('school_notices',n.id,{...n,nextWakeAt:end&&milliseconds(end)>milliseconds(at)?end:null});
 }
}
