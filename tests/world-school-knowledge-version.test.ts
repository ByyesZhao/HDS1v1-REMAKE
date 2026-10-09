import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolItem} from './world-school-fixture';
import {schoolExpansionInput,resolveSchoolWeekText} from '../src/school/calendar';
import {applySchoolChanges} from '../src/school/changes';
import {releaseSchoolNotices,selectSchoolNotices,schoolNoticeDeadline,schoolNotificationEligible} from '../src/school/notices';
import {prepareSchoolCommits,applySchoolCommits} from '../src/school/progress';
import {personalSchoolContext} from '../src/school/context';
import {narrative} from './helpers';
import {ensureEnvironmentBatch,selectEnvironmentStep} from '../src/environment/scheduler';
import {runEnvironmentStep} from '../src/environment/runtime';


 it('actual correction and onsite commits preserve versions',async()=>{
 const d=setup(),early='2026-10-07T08:00:00+08:00',correctionAt='2026-10-07T09:15:00+08:00',readAt='2026-10-07T09:20:00+08:00',onsiteAt='2026-10-07T09:30:00+08:00';
 const item=schoolItem({issuedAt:early,kind:'course',timing:{kind:'weekly',startsOn:'2026-10-01',endsOn:null,slots:[{slotKey:'wed',weekday:3,start:'09:00',end:'11:00'}]}});
 const expandAt=(at:string)=>{const input=schoolExpansionInput(d.storage,at,d.config.timezone);applySchoolChanges(d.storage,resolveSchoolWeekText(d.storage,{stage:'school_week',noticeTexts:input.requiredNoticeKeys.map(n=>({key:n.id,text:'课程安排'})),weekNotes:[]},input,at),at);};
 d.storage.save('school_plan_items',item.id,item);expandAt(early);
 const ongoing=d.schoolStore.instances()[0];
 applySchoolChanges(d.storage,{stage:'school_campus',plans:[],items:[{...item,revision:2,deliveryRevision:2,location:'下次起用新教室'}]},correctionAt);expandAt(correctionAt);releaseSchoolNotices(d.storage,readAt);
 const notice=d.schoolStore.notices().find(n=>n.kind==='change')!;
 d.storage.set('character',{...d.storage.character(),narratedUntil:correctionAt});
 const readExperience={id:'read-e',happenedAt:readAt,description:'读到课程更正，今后用新教室',relatedEventIds:[]};
 const readResult=prepareSchoolCommits(d.storage,{id:'read',at:readAt,schoolNoticeRefs:[{noticeId:notice.id,deliveryRevision:2}]} as any,{...narrative,experiences:[readExperience],schoolObservations:[{via:'notice',sourceId:notice.id,experienceIndex:0}]},[readExperience]);
 applySchoolCommits(d.storage,{schoolObservations:readResult.observations,schoolProgress:[],experiences:[readExperience]} as any,'read');
 expect(personalSchoolContext(d.storage,[],'').knownSnapshots.find(s=>s.entityKind==='plan_item')?.revision).toBe(2);
 d.storage.set('character',{...d.storage.character(),narratedUntil:readAt});
 const onsiteExperience={id:'onsite-e',happenedAt:onsiteAt,description:'在原教室参与今天已经开始的课次',relatedEventIds:[ongoing.id]};
 const onsiteResult=prepareSchoolCommits(d.storage,{id:'onsite',at:onsiteAt,schoolNoticeRefs:[]} as any,{...narrative,experiences:[onsiteExperience],schoolObservations:[{via:'onsite',sourceId:ongoing.id,experienceIndex:0}]},[onsiteExperience]);
 expect(onsiteResult.visibleSnapshots.find(s=>s.entityKind==='plan_item')?.revision).toBe(2);
 expect(onsiteResult.visibleSnapshots.find(s=>s.entityKind==='instance')?.revision).toBe(1);
 applySchoolCommits(d.storage,{schoolObservations:onsiteResult.observations,schoolProgress:[],experiences:[onsiteExperience]} as any,'onsite');
 expect(personalSchoolContext(d.storage,[],'').knownSnapshots.find(s=>s.entityKind==='plan_item')).toMatchObject({revision:2,value:{location:'下次起用新教室'}});
 const count=d.schoolStore.knowledge().length;applySchoolCommits(d.storage,{schoolObservations:onsiteResult.observations,schoolProgress:[],experiences:[onsiteExperience]} as any,'onsite');expect(d.schoolStore.knowledge()).toHaveLength(count);
 await checkActualInputs(d,onsiteAt);
 d.storage.close();
});

import {knownSchoolSnapshots} from '../src/school/calendar';
import {selectKnownSchoolSnapshots} from '../src/school/knowledge';
import {HdsiApp} from '../src/app';
import {InputBuffer} from '../src/host/input';
async function checkActualInputs(d:ReturnType<typeof setup>,at:string){
 d.clock.time=at;
 await new InputBuffer(d.storage).acceptInput({id:'question',content:'meeting 课程在哪',receivedAt:at});
 d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回答已知安排',draft:'未来课次在新教室'},taskChanges:[]};
 d.models.outputs.expression={parts:[{kind:'text',content:'未来课次在新教室'}]};
 await new HdsiApp(d).runTurn({inputMessageIds:['question'],taskIds:[],triggerKinds:['input']});
 for(const name of ['personal_chat','expression']){
  const call=d.models.calls.find(c=>c.name===name)!;
  expect(call.input.context.school.knownSnapshots.find((s:any)=>s.entityKind==='plan_item')).toMatchObject({revision:2,value:{location:'下次起用新教室'}});
 }
 const call=d.models.calls.find(c=>c.name==='personal_chat')!;
 const lookup:any=await call.options!.lookup!('meeting');expect(lookup.school.knownSnapshots.find((s:any)=>s.entityKind==='plan_item')?.revision).toBe(2);
}
it('unread objective correction does not override known plan',()=>{
 const d=setup(),item=schoolItem();try{
  d.storage.save('school_plan_items',item.id,{...item,revision:3,deliveryRevision:3,location:'未读秘密'});
  d.storage.save('school_knowledge','old',{id:'old',entityKind:'plan_item',entityId:item.id,revision:1,snapshot:{entityKind:'plan_item',entityId:item.id,revision:1,value:item},acquiredAt:NOW,experienceId:'e',turnId:'old',via:'notice'});
  expect(personalSchoolContext(d.storage,[],'').knownSnapshots).toEqual([{entityKind:'plan_item',entityId:item.id,revision:1,value:item}]);
 }finally{d.storage.close();}
});
it.each([false,true])('same-turn ordering preserves public revision and matches committed projection: %s',reverse=>{
 const d=setup(),item=schoolItem(),snapshot=(revision:number,deliveryRevision:number)=>({entityKind:'plan_item' as const,entityId:item.id,revision,value:{...item,revision,deliveryRevision,location:'版本'+revision}});
 const newer={snapshot:snapshot(3,2),acquiredAt:'2026-10-07T09:20:00+08:00'},older={snapshot:snapshot(9,1),acquiredAt:'2026-10-07T09:30:00+08:00'},samePublic={snapshot:snapshot(4,2),acquiredAt:'2026-10-07T09:10:00+08:00'};
 const candidates=reverse?[older,samePublic,newer]:[newer,samePublic,older];
 try{
  const observations=candidates.map((c,i)=>({via:'onsite' as const,sourceId:'source'+i,snapshots:[c.snapshot],happenedAt:c.acquiredAt,experienceId:'e'+i}));
  const immediate=personalSchoolContext(d.storage,observations,'').knownSnapshots;
  expect(immediate).toEqual([samePublic.snapshot]);
  candidates.forEach((c,i)=>d.storage.save('school_knowledge','k'+i,{id:'k'+i,entityKind:'plan_item',entityId:item.id,revision:c.snapshot.revision,snapshot:c.snapshot,acquiredAt:c.acquiredAt,experienceId:'e'+i,turnId:'t',via:'onsite'}));
  expect(knownSchoolSnapshots(d.storage)).toEqual(immediate);
 }finally{d.storage.close();}
});
it('historical instance identities remain distinct and equal-key ties use stable order',()=>{
 const item=schoolItem(),plan={entityKind:'plan_item' as const,entityId:item.id,revision:1,value:item};
 const instance=(id:string)=>({entityKind:'instance' as const,entityId:id,revision:1,value:{id,sourceItemId:item.id,sourceRevision:1,deliveryRevision:1,occurrenceKey:id,weekStart:null,startsAt:NOW,endsAt:null,sourceSnapshot:item,status:'active' as const,needsExpansion:false,legacyEventId:null}});
 const first={...plan,value:{...item,location:'先'}},last={...plan,value:{...item,location:'后'}};
 const result=selectKnownSchoolSnapshots([first,instance('a'),instance('b'),last].map(snapshot=>({snapshot,acquiredAt:NOW})));
 expect(result.map(s=>s.entityId)).toEqual([item.id,'a','b']);expect(result[0].value).toMatchObject({location:'后'});
});
