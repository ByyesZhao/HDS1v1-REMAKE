import {createHash} from 'node:crypto';
import type {Storage} from '../storage';
import type {TurnRequest,ISOTime} from '../types';
import {hasValidSharedScene} from './shared';
import {due} from '../time';
export type WaitingContinuation={kind:'wait';deadline:ISOTime|null}|{kind:'run';request:TurnRequest;scope:'ordinary'|'event'};
export function ordinaryInputRevision(storage:Storage):number{return storage.runtime().ordinaryInputRevision??0;}
export function isOrdinaryReplyRequest(storage:Storage,r:TurnRequest,_now:ISOTime):boolean{
 return storage.character().scene.mode==='chat'&&!hasValidSharedScene(storage.character())&&!r.sharedMeta&&!r.environmentStepId&&!r.environmentKind&&!(r.schoolNoticeRefs?.length)&&r.triggerKinds.length>0&&r.triggerKinds.every(k=>k==='input'||k==='check_messages')&&r.taskIds.every(id=>storage.read('tasks',id)?.kind==='check_messages');
}
export function hasReplyAttempt(storage:Storage,id:string):boolean{return !!storage.read('turns',id)?.replyFreshness?.firstAttemptAt||storage.outbox(id).some(i=>i.status!=='pending');}
export class ReplySuperseded extends Error {constructor(){super('ordinary reply superseded');}}
export function assertReplyCurrent(storage:Storage,id:string,now:ISOTime):void{
 const f=storage.read('turns',id)?.replyFreshness;
 if(!f||f.scope!=='ordinary'||f.state==='sealed'||hasReplyAttempt(storage,id))return;
 const open=storage.runtime().openBatch;
 if(f.inputRevision!==ordinaryInputRevision(storage)||(open&&!due(open.readyAt,now)))throw new ReplySuperseded();
}

// Metadata only: no message, page, background or prompt bodies are copied here.
export function recordReplyTrace(storage:Storage,id:string,at:ISOTime,entry:Pick<import('../types').ReplyTrace,'event'|'stage'|'elapsedMs'>):void {
 const turn=storage.read('turns',id),f=turn?.replyFreshness;if(!turn||!f)return;
 const selection=entry.event==='selected'||entry.event==='waiting'||entry.event==='rebound';
 const trace:import('../types').ReplyTrace={...entry,at,generation:f.generation,scope:f.scope,inputRevision:f.inputRevision,...(selection?{inputMessageIds:turn.inputMessageIds,selectionFingerprint:createHash('sha256').update(JSON.stringify(turn.inputMessageIds)).digest('hex'),quietUntil:f.quietUntil}:{})};
 storage.save('turns',id,{...turn,replyTrace:[...turn.replyTrace??[],trace]});
}
