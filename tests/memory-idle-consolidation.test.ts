import {expect,it} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {consolidationTask,auditTask} from '../src/model/contracts';
import type {MemoryCandidate} from '../src/memory/types';
function create(){const d=fixture(),life=new MemoryLifecycle(d.store),index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});return {...d,life,maintenance:new MemoryMaintenance(d.store,life,index,d.models,{clock:d.clock})};}
function ready(d:ReturnType<typeof create>,rows:MemoryCandidate[],selected:string[],raw:any,kind:'consolidation'|'audit'='consolidation'){
 const units=consolidationTask(rows,selected,kind,at).parse(raw);
 for(const row of rows){d.store.saveOwner(row);d.store.queueDirty(row,row.kind==='detail'?'detail':'event',at);}
 d.store.saveJob('memory_maintenance_jobs',{id:'job',kind,cutoff:at,createdAt:at,status:'ready',snapshot:rows,selectedIds:selected,readSet:rows,result:units,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});
}
it.each([false,true])('merge_short_same_event_one_or_two_longs %s',different=>{
 const d=create(),a=long(d.store,'l-a'),b=different?long(d.store,'l-b'):a;
 const shorts=['s-a','s-b'].map((id,i)=>d.store.makeOwner({ownerType:'short',ownerId:id},{content:`细节${id}`,sourceIds:[`e${i}`],linkedLongId:i?b.id:a.id,lastEventUpdateAt:days(i),shortExpiresAt:days(i+7),capacityExitedAt:i?days(1):null},at));
 ready(d,[...new Set([a,b]),...shorts],shorts.map(r=>r.id),{units:[{unitKey:'m',action:'merge_short',ids:shorts.map(r=>r.id),readOwners:[...new Set([a.id,b.id,...shorts.map(r=>r.id)])],canonicalShortId:'s-a',content:'细节合并正文',eventSummary:'简要事件',feelingSummary:'开心和疲惫',sourceIds:['e0']}]});
 expect(d.maintenance.applyOneReady(days(2))).toBe('applied');const s=d.store.owner(shorts[0])!;
 expect(s).toMatchObject({content:'细节合并正文',shortExpiresAt:days(8),capacityExitedAt:days(1),sourceIds:['e0','e1']});expect(d.store.canonical(s.linkedLongId!)?.totalAwakenings).toBe(0);
 expect(d.store.owner(shorts[1])?.content).toBe('');
 const summary=d.store.canonical(s.linkedLongId!)!;
 expect(summary.content).toContain('简要事件');expect(summary.content).toContain('开心和疲惫');expect(summary.content).not.toContain('细节合并正文');
});
it('refine_targets_long_summary and own_apply_no_dirty_loop',()=>{
 const d=create(),l=long(d.store,'l'),s=d.store.makeOwner({ownerType:'short',ownerId:'s'},{content:'原详细记录',sourceIds:['e'],linkedLongId:'l'},at);
 ready(d,[s,l],['s'],{units:[{unitKey:'r',action:'refine',ids:['s','l'],readOwners:['s','l'],content:'新简要摘要',sourceIds:['e']}]});
 expect(d.maintenance.applyOneReady(at)).toBe('applied');expect(d.store.owner(s)?.content).toBe('原详细记录');expect(d.store.canonical('l')?.content).toBe('新简要摘要');expect(d.store.dirtyOwners()).toEqual([]);
 d.store.queueDirty(d.store.canonical('l')!,'expiry',at);expect(d.store.dirtyOwners()).toEqual([]);
});
it('merge_does_not_awaken_or_restore_archive',()=>{
 const d=create();long(d.store,'a',{expiresAt:days(90)});long(d.store,'b',{expiresAt:days(100)});
 d.life.merge(['a','b'],'a',days(110));expect(d.store.canonical('a')).toMatchObject({archiveEnteredAt:days(90),expiresAt:days(100),totalAwakenings:0});
 long(d.store,'c',{expiresAt:days(150),retainedFrom:at});d.life.merge(['a','c'],'a',days(110));expect(d.store.canonical('a')).toMatchObject({archiveEnteredAt:null,expiresAt:days(150),totalAwakenings:0});expect(d.store.listGrants('a').filter(g=>g.kind==='reactivate')).toEqual([]);
});
it('detail_audit_reports_no_fact_rollback and learned_review_no_core_rewrite',()=>{
 const d=create(),detail=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'新手机',key:'phone',value:'新手机',sourceIds:['e']},at),learned=d.store.makeOwner({ownerType:'learned',ownerId:'understanding'},{content:'稳定认识',sourceIds:['e']},at);
 d.storage.set('background','作者固定背景');
 ready(d,[detail,learned],['phone','understanding'],{units:[{unitKey:'d',action:'review_detail',targetId:'phone',decision:'report_conflict',ids:['phone'],readOwners:['phone'],sourceIds:['e'],reason:'与已有记录冲突'},{unitKey:'l',action:'review_learned',targetId:'understanding',decision:'suggest_withdrawal',ids:['understanding'],readOwners:['understanding'],sourceIds:['e'],reason:'依据不足'}]},'audit');
 d.maintenance.applyOneReady(at);d.maintenance.applyOneReady(at);expect(d.store.owner(detail)?.value).toBe('新手机');expect(d.store.owner(learned)?.status).toBe('active');expect(d.storage.get('background')).toBe('作者固定背景');expect(d.storage.prepare('SELECT count(*) n FROM memory_audit_reports').get()!.n).toBe(2);expect(d.store.dirtyOwners()).toEqual([]);
});
it('secondary_canonical_evidence_change_requeues_understanding_once',()=>{
 const d=create(),a=long(d.store,'a'),b=long(d.store,'b');
 const learned=d.store.makeOwner({ownerType:'learned',ownerId:'understanding'},{content:'已有稳定认识',canonicalMemoryId:a.id,evidenceMemoryIds:[a.id,b.id],learnedKind:'stable_understanding',sourceIds:a.sourceIds},at);
 d.store.saveOwner(learned);d.store.queueDirty(learned,'learned',at);d.store.completeDirty(learned,learned);
 d.life.apply({schemaVersion:3,shortTermChanges:[{action:'create',clientRef:'s',existingLongId:b.id,content:'事件B真实新进展详细内容',eventSummary:'B的新摘要',feelingSummary:'有些困惑',topics:[],importance:'normal',sourceIds:['fresh']}],longTermChanges:[],detailChanges:[]},'new-turn',days(1),['fresh']);
 const current=d.store.owner(learned)!;expect(current.content).toBe('已有稳定认识');expect(current.stateVersion).toBeGreaterThan(learned.stateVersion);expect(d.store.dirtyOwners().find(r=>r.ownerId===learned.id)?.status).toBe('pending');
 d.store.completeDirty(current,current);d.life.synchronizeProjections(d.store.canonical(b.id)!,days(1),true);expect(d.store.dirtyOwners().some(r=>r.ownerId===learned.id)).toBe(false);
});
it('audit_does_not_consume_unselected_event_dirty',()=>{
 const d=create(),a=long(d.store,'a'),learned=d.store.makeOwner({ownerType:'learned',ownerId:'u'},{content:'结论',canonicalMemoryId:a.id,evidenceMemoryIds:[a.id],learnedKind:'stable_understanding',sourceIds:a.sourceIds},at);
 ready(d,[learned,a],[learned.id],{units:[{unitKey:'audit',action:'review_learned',targetId:learned.id,ids:[learned.id],readOwners:[learned.id,a.id],sourceIds:[],decision:'retain'}]},'audit');
 expect(d.maintenance.applyOneReady(at)).toBe('applied');expect(d.store.dirtyOwners().map(r=>r.ownerId)).toEqual([a.id]);
});
it('promotion_resolves_short_evidence_and_reads_its_canonical_version',()=>{
 const d=create(),a=long(d.store,'a',{totalAwakenings:30}),b=long(d.store,'b'),s=d.store.makeOwner({ownerType:'short',ownerId:'short-b'},{linkedLongId:b.id,content:'另一个事件详情',sourceIds:b.sourceIds},at);
 ready(d,[a,b,s],[a.id],{units:[{unitKey:'p',action:'promote',ids:[a.id],readOwners:[a.id,s.id],sourceIds:a.sourceIds,content:'两个事件支持的稳定认识',learnedKind:'stable_understanding'}]});
 const readOwners=d.store.job<any>('memory_maintenance_jobs','job')!.result[0].readSet.map((r:any)=>r.ownerId);
 expect(d.maintenance.applyOneReady(at)).toBe('applied');expect(readOwners).toContain(b.id);expect(d.store.allOwners().find(r=>r.kind==='learned')?.evidenceMemoryIds).toEqual([a.id,b.id]);
});
