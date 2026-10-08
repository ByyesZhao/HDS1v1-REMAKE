import {Storage} from '../storage';
import type {CharacterState} from '../types';
import type {IdleEligibility,MemoryIdleState} from './types';
import {addMs,milliseconds} from '../time';
import {isSleeping} from '../host/state';
export const activityChanged=(before:CharacterState,after:CharacterState)=>before.scene.activity?.startsAt!==after.scene.activity?.startsAt||before.scene.shared?.activityId!==after.scene.shared?.activityId;
const empty=():MemoryIdleState=>({lastInputAt:null,lastOutputAt:null,lastStoryCompletedAt:null,lastActivityChangedAt:null});
export class MemoryIdle {
  constructor(private storage:Storage,private minutes:number,private duringSleep:boolean){}
  record(kind:'input'|'output'|'story'|'activity',at:string):void {
    const runtime=this.storage.runtime(),state={...empty(),...runtime.memoryIdle};
    const field=({input:'lastInputAt',output:'lastOutputAt',story:'lastStoryCompletedAt',activity:'lastActivityChangedAt'} as const)[kind];
    if(!state[field]||milliseconds(at)>milliseconds(state[field]!))state[field]=at;
    this.storage.set('runtime',{...runtime,memoryIdle:state});
  }
  eligibility(now:string):IdleEligibility {
    const runtime=this.storage.runtime(),state=this.storage.character();
    const times=Object.values(runtime.memoryIdle??empty()).filter((s):s is string=>!!s).sort((a,b)=>milliseconds(b)-milliseconds(a));
    const readyAt=times[0]?addMs(times[0],this.minutes*60000):null;
    let reason:IdleEligibility['reason']='ready';
    if(runtime.paused)reason='paused';else if(this.storage.unfinishedTurn())reason='unfinished';else if(runtime.openBatch)reason='batch';
    else if(runtime.sharedClock?.status==='active'||state?.scene.mode!=='chat'&&!!state?.scene.shared)reason='shared_activity';
    else if(state?.scene.activity&&milliseconds(state.scene.activity.startsAt)<=milliseconds(now)||state&&isSleeping(state,now)&&!this.duringSleep)reason='activity';
    else if(readyAt&&milliseconds(readyAt)>milliseconds(now))reason='waiting';
    return {allowed:reason==='ready',readyAt,reason};
  }
  nextDeadline(now:string):string|null {
    const e=this.eligibility(now);if(e.reason==='waiting')return e.readyAt;
    if(e.reason==='activity'){
      const state=this.storage.character();const end=state.scene.activity?.expectedEndAt??(!this.duringSleep&&isSleeping(state,now)?state.sleep?.wakeAt:null);
      return end&&milliseconds(end)>milliseconds(now)?end:null;
    }return null;
  }
}
