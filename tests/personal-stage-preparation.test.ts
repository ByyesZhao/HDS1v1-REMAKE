import {it,expect,vi} from 'vitest';
import {setup,NOW,saveInput,narrative} from './helpers';
import {generateTurn,HdsiApp} from '../src/app';
import {ContextBuilder} from '../src/memory/context';
import * as school from '../src/school/context';
import {makeSharedFixture,configureSharedModels} from './shared-v3-fixture';
import {schoolItem,expand} from './world-school-fixture';
import {Scheduler} from '../src/host/scheduler';
it('personal preparation is skipped after narrative extends unread activity',async()=>{
 const d=setup();try{saveInput(d.storage,'hidden','在吗');d.storage.save('tasks','unread',{id:'unread',kind:'check_messages',at:NOW,description:'查看',status:'pending',checkReason:'unread',messageIds:['hidden']});
 const end='2026-10-07T12:00:00+08:00';d.models.outputs.narrative={...narrative,currentScene:{description:'在洗澡',activity:{description:'洗澡',startsAt:NOW,phoneAccess:false,expectedEndAt:end}}};
 const build=vi.spyOn(ContextBuilder.prototype,'build'),schools=vi.spyOn(school,'personalSchoolContext'),events=vi.spyOn(school,'personalEnvironmentEvents');
 try{const {candidate}=await generateTurn(d,{inputMessageIds:['hidden'],taskIds:['unread'],triggerKinds:['check_messages']},'t');
 expect(build.mock.calls.filter(([q])=>q.phase==='personal')).toHaveLength(0);expect(schools.mock.calls.filter(([, ,q])=>q!=='')).toHaveLength(0);expect(events).not.toHaveBeenCalled();expect(d.models.calls.map(c=>c.name)).toEqual(['narrative']);expect(candidate.personal).toBeNull();expect(candidate.expression).toBeNull();expect(candidate.visibleMessageIds).toEqual([]);expect(candidate.taskChanges).toContainEqual(expect.objectContaining({id:'unread',task:expect.objectContaining({at:end})}));expect(d.storage.read('messages','hidden')!.seenTurnId).toBeNull();
 }finally{build.mockRestore();schools.mockRestore();events.mockRestore();}
 }finally{d.storage.close();}
});
it.each(['visible','appointment','autonomous','sleep','deferred','shared','school'])('personal preparation still runs for %s',async trigger=>{
 const d=setup();try{
 let request:any={inputMessageIds:[],taskIds:[],triggerKinds:['check_messages']};
 if(trigger==='visible'){saveInput(d.storage,'m','你好');request.inputMessageIds=['m'];}
 if(trigger==='appointment'||trigger==='deferred'){if(trigger==='deferred'){saveInput(d.storage,'m','你好');d.storage.save('messages','m',{...d.storage.read('messages','m')!,seenTurnId:'prior'});}d.storage.save('tasks','task',{id:'task',kind:trigger==='appointment'?'appointment':'check_messages',at:NOW,description:'安排',status:'pending',...(trigger==='deferred'?{checkReason:'deferred_reply',messageIds:['m']}: {})});request.taskIds=['task'];}
 if(trigger==='autonomous'||trigger==='sleep')request.triggerKinds=[trigger];
 if(trigger==='shared'){makeSharedFixture(d);configureSharedModels(d);d.clock.advance(60000);request=(await new Scheduler(d.storage,d.config).collectReady(d.clock.now()))!;}
 if(trigger==='school'){d.storage.save('school_plan_items','meeting',schoolItem());expand(d);request=(await new Scheduler(d.storage,d.config).collectReady(NOW))!;const notice=d.schoolStore.notices().find(n=>n.kind==='issue')!;d.models.outputs.narrative={...narrative,experiences:[{happenedAt:NOW,description:'读通知',relatedEventIds:['meeting']}],schoolObservations:[{via:'notice',sourceId:notice.id,experienceIndex:0}]};}
 const build=vi.spyOn(ContextBuilder.prototype,'build');try{const {candidate}=await generateTurn(d,request,'t');expect(build.mock.calls.filter(([q])=>q.phase==='personal')).toHaveLength(1);expect(candidate.personal).not.toBeNull();}finally{build.mockRestore();}
 }finally{d.storage.close();}
});
it('no personal stage still commits narrative experiences and memory postprocessing',async()=>{
 const d=setup();try{d.models.outputs.narrative={...narrative,experiences:[{happenedAt:NOW,description:'继续生活',relatedEventIds:[]}]};await new HdsiApp(d).runTurn({inputMessageIds:[],taskIds:[],triggerKinds:['check_messages']});
 expect(d.storage.all('turns')[0].done).toBe(true);expect(d.storage.character().narratedUntil).toBe(NOW);expect(d.storage.all('experiences')).toHaveLength(1);expect(d.models.calls.map(c=>c.name)).toEqual(['narrative','memory']);
 }finally{d.storage.close();}
});
