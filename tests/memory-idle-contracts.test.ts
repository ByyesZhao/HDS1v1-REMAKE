import {expect,it} from 'vitest';
import {fixture,long,at} from './memory-capacity-fixture';
import {consolidationTask,auditTask} from '../src/model/contracts';
function input(){const {store}=fixture(),l=long(store,'l');const shorts=['s-b','s-a'].map(id=>store.makeOwner({ownerType:'short',ownerId:id},{content:id,sourceIds:['historical'],linkedLongId:'l'},at));return [l,...shorts];}
const merge={unitKey:'m',action:'merge_short',ids:['s-a','s-b'],readOwners:['s-a','s-b','l'],canonicalShortId:'s-a',content:'完整同一事件经历',eventSummary:'事件概要',feelingSummary:'开心',sourceIds:['historical']};
it('merge_short_tied_created_at_stable_id',()=>{
 const rows=input();for(const snapshot of [rows,[...rows].reverse()]){
  expect(consolidationTask(snapshot,['s-a','s-b']).parse({units:[merge]})[0].canonicalShortId).toBe('s-a');
  expect(()=>consolidationTask(snapshot,['s-a','s-b']).parse({units:[{...merge,canonicalShortId:'s-b'}]})).toThrow(/canonicalShortId/);
 }
});
it('merge_short_sources_required_and_allowed',()=>{
 const task=consolidationTask(input(),['s-a','s-b']);for(const sourceIds of [[],['unknown']])expect(()=>task.parse({units:[{...merge,sourceIds}]})).toThrow(/sourceIds/);
 expect(task.parse({units:[merge]})).toHaveLength(1);expect(()=>task.parse({units:[{...merge,content:' '}]})).toThrow(/content/);
});
it('selected_covered_sources_required and write/read closure',()=>{
 const task=consolidationTask(input(),['s-a','s-b']);expect(()=>task.parse({units:[]})).toThrow(/selected/);expect(()=>task.parse({units:[{...merge,readOwners:['s-a','l']}]})).toThrow(/readOwners/);
});
it('distinct_canonical_evidence excludes duplicate shorts and details',()=>{
 const rows=input(),row=rows[0];row.totalAwakenings=30;
 const value={unitKey:'p',action:'promote',ids:['l'],readOwners:['l','s-a','s-b'],content:'稳定认识',sourceIds:['historical'],learnedKind:'stable_understanding'};
 expect(()=>consolidationTask(rows,['l'],'consolidation',at).parse({units:[value]})).toThrow(/distinct/);
});
it('audit targets match owner kind and read set',()=>{
 const {store}=fixture(),detail=store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'A',sourceIds:['e']},at),task=auditTask([detail],['phone']);
 expect(task.parse({units:[{unitKey:'r',action:'review_detail',targetId:'phone',ids:['phone'],readOwners:['phone'],decision:'retain',sourceIds:[],reason:'一致'}]})).toHaveLength(1);
 expect(()=>task.parse({units:[{unitKey:'r',action:'review_learned',targetId:'phone',ids:['phone'],readOwners:['phone'],decision:'retain',sourceIds:[]}]})).toThrow();
});
it('audit_units_can_share_read_only_evidence_without_duplicate_targets',()=>{
 const {store}=fixture(),a=store.makeOwner({ownerType:'detail',ownerId:'d-a'},{content:'A',sourceIds:['e']},at),b=store.makeOwner({ownerType:'detail',ownerId:'d-b'},{content:'B',sourceIds:['e']},at),e=store.makeOwner({ownerType:'long',ownerId:'e'},{content:'两项事实的同一来源',sourceIds:['e']},at);
 const task=auditTask([a,b,e],[a.id,b.id]),units=[a,b].map(r=>({unitKey:r.id,action:'review_detail',targetId:r.id,ids:[r.id],readOwners:[r.id,e.id],decision:'report_conflict',sourceIds:['e'],reason:'需要核对，仅报告'}));
 expect(task.parse({units})).toHaveLength(2);expect(()=>task.parse({units:[units[0],{...units[0],unitKey:'duplicate'}]})).toThrow(/overlapping/);
});
