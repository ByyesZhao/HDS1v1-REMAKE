import {it,expect} from 'vitest';
import {HdsiApp} from '../src/app';
import {Scheduler} from '../src/host/scheduler';
import {setup,NOW} from './helpers';
it('legacy environment requests require explicit upgrade without creating turns',async()=>{
 const d=setup();await expect(new HdsiApp(d).runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['environment'],environmentKind:'school'})).rejects.toThrow('upgrade');expect(d.storage.all('turns')).toEqual([]);d.storage.close();
});
it('world step runs while sleeping without changing character or autonomy',async()=>{
 const d=setup();d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});
 d.storage.set('character',{...d.storage.character(),sleep:{sleepAt:NOW,wakeAt:'2026-10-07T11:00:00+08:00'},nextAutonomousAt:null});
 const before=d.storage.character();d.generateEnvironment=async()=>({stage:'world',changes:[{action:'create',event:{kind:'world',startsAt:NOW,endsAt:null,description:'晴天',basis:'fiction',sourceUrls:[]}}]});
 const request=(await new Scheduler(d.storage,d.config).collectReady(NOW))!;expect(request.environmentStepId).toBeDefined();await new HdsiApp(d).runTurn(request);expect(d.storage.character()).toEqual(before);expect(d.storage.all('experiences')).toEqual([]);expect(d.storage.all('turns')).toEqual([]);expect(d.storage.all('events')).toHaveLength(1);d.storage.close();
});
