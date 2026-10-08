import {it,expect,vi} from 'vitest';
import {setup,NOW,narrative,saveInput} from './helpers';
import {schoolItem,expand} from './world-school-fixture';
import {Scheduler} from '../src/host/scheduler';
import {HdsiApp} from '../src/app';
import {personalSchoolContext} from '../src/school/context';
import {makeSharedFixture,configureSharedModels} from './shared-v3-fixture';
import {finishPostprocessing} from '../src/recovery';
function fixture(){const d=setup();d.storage.save('school_plan_items','meeting',schoolItem());expand(d);return d;}
it('pure_notice_life_no_contact_draw_notified_requirement_can_be_refused',async()=>{
 const d=fixture(),scheduler=new Scheduler(d.storage,d.config),request=(await scheduler.collectReady(NOW))!,n=d.schoolStore.notices().find(n=>n.kind==='issue')!;
 d.models.outputs.narrative={...narrative,experiences:[{happenedAt:NOW,description:'读到班会必到通知',relatedEventIds:['meeting']}],schoolObservations:[{via:'notice',sourceId:n.id,experienceIndex:0}]};
 d.models.outputs.personal_life={innerThought:'我可以选择不参加',emotions:[],contact:{willing:false},nextPlan:'不参加班会'};
 await new HdsiApp(d).runTurn(request);const personal=d.models.calls.find(c=>c.name==='personal_life')!.input;expect(personal.context.contactEligible).toBe(false);expect(personal.context.school.knownSnapshots).toHaveLength(1);expect(d.storage.read('school_notices',n.id)?.status).toBe('read');expect(d.schoolStore.knowledge()).toHaveLength(1);expect(d.schoolStore.progress()).toEqual([]);expect(d.sender.sent).toEqual([]);expect(Date.parse(d.storage.character().nextAutonomousAt!)).toBe(Date.parse(NOW)+180*60000);d.storage.close();
});
it('unread_not_forced_personal_declined_notice_no_immediate_rewake',async()=>{
 const d=fixture(),scheduler=new Scheduler(d.storage,d.config);const request=(await scheduler.collectReady(NOW))!;await new HdsiApp(d).runTurn(request);expect(d.models.calls.map(c=>c.name)).toEqual(['narrative']);expect(d.schoolStore.knowledge()).toEqual([]);expect(await scheduler.collectReady(NOW)).toBeNull();expect(Date.parse((await scheduler.nextDeadline(NOW))!)).toBeGreaterThan(Date.parse(NOW));d.storage.close();
});
it('read_and_experience_commit_atomically_recovery_no_double_read',async()=>{
 const d=fixture(),scheduler=new Scheduler(d.storage,d.config),request=(await scheduler.collectReady(NOW))!,n=d.schoolStore.notices().find(n=>n.kind==='issue')!;
 d.models.outputs.narrative={...narrative,experiences:[{happenedAt:NOW,description:'查看班会通知',relatedEventIds:[]}],schoolObservations:[{via:'notice',sourceId:n.id,experienceIndex:0}]};
 const original=d.storage.save.bind(d.storage);let fail=true;d.storage.save=((table:any,id:string,value:any)=>{if(table==='school_knowledge'&&fail)throw Error('injected DB error');return original(table,id,value);}) as typeof d.storage.save;
 await expect(new HdsiApp(d).runTurn(request)).rejects.toThrow('injected DB error');expect(d.storage.read('school_notices',n.id)?.status).toBe('available');expect(d.storage.all('experiences')).toEqual([]);expect(d.schoolStore.knowledge()).toEqual([]);fail=false;
 await new HdsiApp(d).resumeUnfinishedTurn();const turn=d.storage.all('turns')[0];await finishPostprocessing(d,turn);expect(d.schoolStore.knowledge()).toHaveLength(1);expect(d.storage.all('experiences')).toHaveLength(1);expect(d.storage.read('school_notices',n.id)?.status).toBe('read');d.storage.close();
});
it('shared_notice_waits_legal_step_and_does_not_disable_simulated_actions',async()=>{
 const d=fixture();makeSharedFixture(d);configureSharedModels(d);const scheduler=new Scheduler(d.storage,d.config);expect(await scheduler.collectReady(NOW)).toBeNull();d.clock.advance(60000);const request=(await scheduler.collectReady(d.clock.now()))!;expect(request.sharedMeta?.allowSimulatedUserActions).toBe(true);expect(request.schoolNoticeRefs?.length).toBe(1);expect(request.sharedMeta?.stepNumber).toBe(2);d.storage.close();
});
it('lookup_and_expression_no_hidden_plan_publication_does_not_update_known_revision',async()=>{
 const d=fixture(),item=schoolItem();d.storage.save('events','hidden',{id:'hidden',kind:'school',startsAt:NOW,endsAt:null,description:'隐藏学校客观描述',basis:'fiction',sourceUrls:[],status:'active'});
 d.storage.save('school_knowledge','k',{id:'k',entityKind:'plan_item',entityId:item.id,revision:1,snapshot:{entityKind:'plan_item',entityId:item.id,revision:1,value:item},acquiredAt:NOW,experienceId:'old-e',turnId:'old',via:'notice'});
 d.storage.save('school_plan_items',item.id,{...item,revision:2,deliveryRevision:2,location:'最新秘密教室'});expand(d);await new Scheduler(d.storage,d.config).collectReady(NOW);
 saveInput(d.storage,'input','大班会在哪里');d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'按已知回答',draft:'学院'},taskChanges:[]};d.models.outputs.expression={parts:[{kind:'text',content:'学院'}]};
 await new HdsiApp(d).runTurn({inputMessageIds:['input'],taskIds:[],triggerKinds:['input']});
 const personal=d.models.calls.find(c=>c.name==='personal_chat')!,expression=d.models.calls.find(c=>c.name==='expression')!,memory=d.models.calls.find(c=>c.name==='memory')!;
 for(const call of [personal,expression,memory]){expect(JSON.stringify(call.input)).not.toContain('最新秘密教室');expect(JSON.stringify(call.input)).not.toContain('隐藏学校客观描述');}
 const lookup:any=await personal.options!.lookup!('meeting');expect(lookup.school.knownSnapshots[0].value.location).toBe('学院');expect(personalSchoolContext(d.storage,[],'meeting').knownSnapshots[0].revision).toBe(1);d.storage.close();
});
