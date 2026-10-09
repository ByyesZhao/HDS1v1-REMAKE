import {it,expect} from 'vitest';
import {knownPlanCoversInstance} from '../src/school/notices';
import {schoolItem} from './world-school-fixture';
import type {SchoolInstance,SchoolPlanItem} from '../src/school/types';
const now='2026-10-09T00:00:00Z';
function instance(item:SchoolPlanItem,patch:Partial<SchoolInstance>={}):SchoolInstance{return {id:'i',sourceItemId:item.id,sourceRevision:item.revision,deliveryRevision:item.deliveryRevision,occurrenceKey:JSON.stringify([item.id,'once']),weekStart:null,startsAt:'2026-10-09T14:00:00+08:00',endsAt:'2026-10-09T15:00:00+08:00',sourceSnapshot:item,status:'active',needsExpansion:false,legacyEventId:null,...patch};}
it('matches public timing rather than internal revision or offset spelling',()=>{
 const plan=schoolItem(),target=instance(plan,{sourceRevision:5,startsAt:'2026-10-09T06:00:00Z',endsAt:'2026-10-09T07:00:00Z'});
 expect(knownPlanCoversInstance(plan,target,now,'Asia/Shanghai')).toBe(true);
 for(const patch of [{deliveryRevision:2},{needsExpansion:true},{status:'cancelled' as const},{startsAt:'2026-10-09T06:01:00Z'},{endsAt:null}]){
 expect(knownPlanCoversInstance(plan,{...target,...patch},now,'Asia/Shanghai')).toBe(false);}
 expect(knownPlanCoversInstance({...plan,status:'cancelled'},target,now,'Asia/Shanghai')).toBe(false);
});
it('derives weekly successor with configured timezone and midnight end',()=>{
 const plan=schoolItem({timing:{kind:'weekly',startsOn:'2026-10-01',endsOn:'2026-10-10',slots:[{slotKey:'fri',weekday:5,start:'23:30',end:'00:30'}]}});
 const key=JSON.stringify([plan.id,'fri','2026-10-05']);
 const target=instance(plan,{occurrenceKey:'successor',baseOccurrenceKey:key,weekStart:'2026-10-05',startsAt:'2026-10-10T03:30:00Z',endsAt:'2026-10-10T04:30:00Z'});
 expect(knownPlanCoversInstance(plan,target,now,'America/New_York')).toBe(true);
 expect(knownPlanCoversInstance(plan,target,now,'Asia/Shanghai')).toBe(false);
 expect(knownPlanCoversInstance({...plan,timing:{...plan.timing as any,endsOn:'2026-10-08'}},target,now,'America/New_York')).toBe(false);
 expect(knownPlanCoversInstance(plan,{...target,baseOccurrenceKey:'another'},now,'America/New_York')).toBe(false);
});
it('requires a concrete deadline and preserves exact start boundary',()=>{
 const plan=schoolItem({timing:{kind:'deadline',at:'2026-10-09T14:00:00+08:00',date:null,note:''}});
 const target=instance(plan,{occurrenceKey:JSON.stringify([plan.id,'deadline']),endsAt:null});
 expect(knownPlanCoversInstance(plan,target,target.startsAt,'Asia/Shanghai')).toBe(true);
 expect(knownPlanCoversInstance({...plan,timing:{kind:'deadline',at:null,date:'2026-10-09',note:''}},target,now,'Asia/Shanghai')).toBe(false);
 expect(knownPlanCoversInstance({...plan,timing:{kind:'tentative',startsOn:'2026-10-09',endsOn:null,note:''}},target,now,'Asia/Shanghai')).toBe(false);
 expect(knownPlanCoversInstance(plan,target,'2026-10-09T14:00:01+08:00','Asia/Shanghai')).toBe(false);
});
