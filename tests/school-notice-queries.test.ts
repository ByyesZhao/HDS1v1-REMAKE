import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {schoolItem,expand} from './world-school-fixture';
import {SchoolStore} from '../src/school/store';
import {selectKnownSchoolSnapshots} from '../src/school/knowledge';
import {createSchoolNoticeEvaluationContext,releaseSchoolNotices,selectSchoolNotices,schoolNotificationEligible,schoolNoticeDeadline} from '../src/school/notices';
const {captureQueries,plans}=require('../scripts/query-probe.cjs');
it('no active notices skip related entities and knowledge',()=>{
 const d=setup();try{d.storage.save('school_plan_items','old',schoolItem({id:'old'}));const all=d.storage.all.bind(d.storage);d.storage.all=((table:any)=>{if(['school_notices','school_plan_items','school_instances','school_knowledge'].includes(table))throw Error('full scan '+table);return all(table);}) as any;
 const got=captureQueries(d.storage,()=>createSchoolNoticeEvaluationContext(d.storage));expect(got.value.noticesById.size).toBe(0);expect(got.value.itemsById.size).toBe(0);expect(got.value.instancesById.size).toBe(0);expect(got.value.knownByEntity.size).toBe(0);expect(got.queries).toHaveLength(1);
 }finally{d.storage.close();}
});
it('latest known projection matches public revision, record revision, epoch and stable row insertion',()=>{
 const d=setup();try{const store=new SchoolStore(d.storage),rows=[[2,3,'2026-10-07T09:20:00+08:00'],[1,9,'2026-10-07T09:30:00+08:00'],[2,4,'2026-10-07T09:10:00+08:00'],[2,4,'2026-10-07T09:20:00.1239+08:00'],[2,4,'2026-10-07T01:20:00.123Z']] as const;
 rows.forEach(([deliveryRevision,revision,acquiredAt],i)=>{const value=schoolItem({revision,deliveryRevision,location:'L'+i});d.storage.save('school_knowledge','k'+i,{id:'k'+i,entityKind:'plan_item',entityId:'meeting',revision:999-i,snapshot:{entityKind:'plan_item',entityId:'meeting',revision,value},acquiredAt,experienceId:'e',turnId:'t',via:'notice'});const expected=selectKnownSchoolSnapshots(store.knowledge());expect(store.latestKnownSnapshots([{entityKind:'plan_item',entityId:'meeting'}])).toEqual(expected);});
 d.storage.save('school_knowledge','k3',{...d.storage.read('school_knowledge','k3')!,experienceId:'changed'});expect((store.latestKnownSnapshots([{entityKind:'plan_item',entityId:'missing'},{entityKind:'plan_item',entityId:'meeting'},{entityKind:'plan_item',entityId:'meeting'}])[0].value as any).location).toBe('L4');
 const observed=captureQueries(d.storage,()=>store.latestKnownSnapshots([{entityKind:'plan_item',entityId:'meeting'}]));expect(observed.queries[0].jsonRows).toBe(1);expect(JSON.stringify(plans(d.storage,observed.queries))).toContain('school_knowledge_entity_version');expect(captureQueries(d.storage,()=>store.latestKnownSnapshots([])).queries).toEqual([]);
 }finally{d.storage.close();}
});
it('same evaluation sees release and invalidation without reread or registering knowledge',()=>{
 const d=setup();try{d.storage.save('school_plan_items','meeting',schoolItem());expand(d);const c=createSchoolNoticeEvaluationContext(d.storage);
 const got=captureQueries(d.storage,()=>{expect(selectSchoolNotices(d.storage,NOW,d.config.timezone,c)).toEqual([]);releaseSchoolNotices(d.storage,NOW,d.config.timezone,c);return {refs:selectSchoolNotices(d.storage,NOW,d.config.timezone,c),eligible:schoolNotificationEligible(d.storage,NOW,d.config.timezone,c),deadline:schoolNoticeDeadline(d.storage,NOW,d.config.timezone,c)};});
 expect(got.value.refs.length).toBeGreaterThan(0);expect(got.value.eligible).toBe(true);expect(got.queries.filter((q:any)=>q.method!=='run'&&q.sql.includes('FROM school_'))).toEqual([]);expect(d.schoolStore.knowledge()).toEqual([]);
 d.storage.save('school_plan_items','meeting',{...schoolItem(),deliveryRevision:2});const next=createSchoolNoticeEvaluationContext(d.storage);releaseSchoolNotices(d.storage,NOW,d.config.timezone,next);expect(selectSchoolNotices(d.storage,NOW,d.config.timezone,next)).toEqual([]);
 }finally{d.storage.close();}
});
