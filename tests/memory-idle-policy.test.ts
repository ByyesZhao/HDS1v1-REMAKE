import {expect,it} from 'vitest';
import {fixture,at,days} from './memory-capacity-fixture';
import {MemoryIdle,activityChanged} from '../src/memory/idle';
const minute=(n:number)=>new Date(Date.parse(at)+n*60000).toISOString();
it('input_output_story_latest_anchor',()=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,true);idle.record('input',at);idle.record('output',minute(3));idle.record('story',minute(4));
 expect(idle.eligibility(minute(18))).toEqual({allowed:false,readyAt:minute(19),reason:'waiting'});
 idle.record('input',minute(18));expect(idle.nextDeadline(minute(19))).toBe(minute(33));idle.record('input',at);expect(idle.eligibility(minute(33)).allowed).toBe(true);
});
it('silent_shared_blocks_whole_activity and activity_end_full_15_minutes',()=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,true);idle.record('story',at);
 storage.set('runtime',{...storage.runtime(),sharedClock:{activityId:'a',status:'active',startedAt:at,lastInputAt:null,lastOutputAt:null,lastSilentCompletedAt:null,mode:'shared_offline'}});
 expect(idle.eligibility(minute(30)).reason).toBe('shared_activity');expect(idle.nextDeadline(minute(30))).toBeNull();
 storage.set('runtime',{...storage.runtime(),sharedClock:null});idle.record('activity',minute(30));idle.record('story',minute(32));expect(idle.nextDeadline(minute(33))).toBe(minute(47));
});
it('ordinary_activity_not_expected_end and activity_description_not_identity',()=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,true);idle.record('story',at);
 const state=storage.character();state.scene.activity={description:'洗澡',startsAt:at,expectedEndAt:minute(5),phoneAccess:false};storage.set('character',state);
 expect(idle.eligibility(minute(30)).reason).toBe('activity');expect(idle.nextDeadline(minute(30))).toBeNull();
 expect(activityChanged(state,{...state,scene:{...state.scene,activity:{...state.scene.activity,description:'还在洗澡',expectedEndAt:minute(40),phoneAccess:true}}})).toBe(false);
 expect(activityChanged(state,{...state,scene:{...state.scene,activity:null}})).toBe(true);
});
it('sleep_exception_only_sleep',()=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,true);idle.record('story',at);
 const state=storage.character();state.sleep={sleepAt:at,wakeAt:days(1)};storage.set('character',state);
 expect(idle.eligibility(minute(16)).allowed).toBe(true);expect(new MemoryIdle(storage,15,false).eligibility(minute(16)).reason).toBe('activity');
 idle.record('input',minute(16));expect(idle.eligibility(minute(17)).allowed).toBe(false);
 state.scene.activity={description:'另一个明确活动',startsAt:at,expectedEndAt:null,phoneAccess:false};storage.set('character',state);expect(idle.eligibility(minute(40)).reason).toBe('activity');
});
