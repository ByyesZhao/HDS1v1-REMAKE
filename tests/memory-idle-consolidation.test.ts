import {expect,it} from 'vitest';
import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {consolidationTask,auditTask} from '../src/model/contracts';
import type {MemoryCandidate} from '../src/memory/types';
function create(){const d=fixture(),life=new MemoryLifecycle(d.store),index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});return {...d,life,maintenance:new MemoryMaintenance(d.store,life,index,d.models,{clock:d.clock})};}
function ready(d:ReturnType<typeof create>,rows:MemoryCandidate[],selected:string[],raw:any,kind:'consolidation'|'audit'='consolidation'){
 const units=(kind==='audit'?auditTask:consolidationTask)(rows,selected).parse(raw);
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
