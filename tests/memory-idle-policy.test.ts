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
it('ordinary activity does not block idle maintenance or change its identity on description edits',()=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,true);idle.record('story',at);
 const state=storage.character();state.scene.activity={description:'洗澡',startsAt:at,expectedEndAt:minute(5),phoneAccess:false};storage.set('character',state);
 expect(idle.eligibility(minute(30)).reason).toBe('ready');expect(idle.nextDeadline(minute(30))).toBeNull();
 expect(activityChanged(state,{...state,scene:{...state.scene,activity:{...state.scene.activity,description:'还在洗澡',expectedEndAt:minute(40),phoneAccess:true}}})).toBe(false);
 expect(activityChanged(state,{...state,scene:{...state.scene,activity:null}})).toBe(true);
});
it('sleep_exception_only_sleep',()=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,true);idle.record('story',at);
 const state=storage.character();state.sleep={sleepAt:at,wakeAt:days(1)};storage.set('character',state);
 expect(idle.eligibility(minute(16)).allowed).toBe(true);expect(new MemoryIdle(storage,15,false).eligibility(minute(16)).reason).toBe('activity');
 idle.record('input',minute(16));expect(idle.eligibility(minute(17)).allowed).toBe(false);
 state.scene.activity={description:'另一个明确活动',startsAt:at,expectedEndAt:null,phoneAccess:false};storage.set('character',state);expect(idle.eligibility(minute(40)).reason).toBe('ready');
});

it.each([true,false])('ordinary activity preserves the full quiet wait with phoneAccess=%s',phoneAccess=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,true);idle.record('story',at);
 storage.set('character',{...storage.character(),scene:{...storage.character().scene,activity:{description:'普通生活',startsAt:at,expectedEndAt:null,phoneAccess}}});
 expect(idle.eligibility(minute(14))).toEqual({allowed:false,readyAt:minute(15),reason:'waiting'});
 expect(idle.nextDeadline(minute(14))).toBe(minute(15));
 expect(idle.eligibility(minute(15)).allowed).toBe(true);
});

it('disabled sleep maintenance wakes at wakeAt even if an ordinary activity has an earlier expected end',()=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,false);idle.record('story',at);
 storage.set('character',{...storage.character(),sleep:{sleepAt:at,wakeAt:minute(60)},scene:{...storage.character().scene,activity:{description:'遗留普通活动',startsAt:at,expectedEndAt:minute(3),phoneAccess:true}}});
 expect(idle.eligibility(minute(16)).reason).toBe('activity');
 expect(idle.nextDeadline(minute(16))).toBe(minute(60));
 expect(idle.eligibility(minute(60)).allowed).toBe(true);
});

it.each(['pause','unfinished','batch','shared_clock','shared_scene'] as const)('ordinary activity never bypasses the %s gate',gate=>{
 const {storage}=fixture(),idle=new MemoryIdle(storage,15,true);idle.record('story',at);
 storage.set('character',{...storage.character(),scene:{...storage.character().scene,activity:{description:'普通生活',startsAt:at,expectedEndAt:null,phoneAccess:true}}});
 if(gate==='pause')storage.set('runtime',{...storage.runtime(),paused:true});
 if(gate==='unfinished')storage.save('turns','unfinished',{id:'unfinished',at,inputMessageIds:[],triggerTaskIds:[],triggerKinds:['input'],batchIds:[],entryMode:'chat',completedAt:null,frozenResult:null,outputComplete:false,done:false});
 if(gate==='batch')storage.set('runtime',{...storage.runtime(),openBatch:{id:'batch',openedAt:at,readyAt:minute(30)}} as any);
 if(gate==='shared_clock')storage.set('runtime',{...storage.runtime(),sharedClock:{activityId:'shared',status:'active',startedAt:at,lastInputAt:null,lastOutputAt:null,lastSilentCompletedAt:null,mode:'shared_online'}});
 if(gate==='shared_scene')storage.set('character',{...storage.character(),scene:{...storage.character().scene,mode:'shared_offline',shared:{activityId:'shared'} as any}});
 const reason={pause:'paused',unfinished:'unfinished',batch:'batch',shared_clock:'shared_activity',shared_scene:'shared_activity'}[gate];
 expect(idle.eligibility(minute(30))).toMatchObject({allowed:false,reason});
 expect(idle.nextDeadline(minute(30))).toBeNull();
});
