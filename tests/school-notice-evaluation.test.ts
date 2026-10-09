import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {Scheduler} from '../src/host/scheduler';
import {schoolItem,expand} from './world-school-fixture';
import {releaseSchoolNotices,selectSchoolNotices,createSchoolNoticeEvaluationContext} from '../src/school/notices';
it('one scheduling scan avoids full knowledge reads for many notice snapshots',async()=>{
 const d=setup();for(let i=0;i<15;i++){const item=schoolItem({id:'m'+i,noticePolicy:{announceOnIssue:true,announceOnChange:true,reminders:[{kind:'minutes_before',offset:120,source:'personal_reminder'}]}});d.storage.save('school_plan_items',item.id,item);}expand(d);
 let reads=0;const all=d.storage.all.bind(d.storage);d.storage.all=((table:any)=>{if(table==='school_knowledge')reads++;return all(table);}) as any;
 await new Scheduler(d.storage,d.config).collectReady('2026-10-09T12:00:00+08:00');expect(reads).toBe(0);reads=0;await new Scheduler(d.storage,d.config).nextDeadline('2026-10-09T12:00:00+08:00');expect(reads).toBe(0);d.storage.close();
});
it('shared read-only evaluation sees newly published notices rather than caching status',()=>{
 const d=setup(),item=schoolItem();d.storage.save('school_plan_items',item.id,item);expand(d);
 const context=createSchoolNoticeEvaluationContext(d.storage);expect(selectSchoolNotices(d.storage,NOW,d.config.timezone,context)).toEqual([]);
 releaseSchoolNotices(d.storage,NOW,d.config.timezone,context);const fresh=selectSchoolNotices(d.storage,NOW,d.config.timezone,context);
 expect(fresh.length).toBeGreaterThan(0);expect(fresh).toEqual(selectSchoolNotices(d.storage,NOW,d.config.timezone));d.storage.close();
});
