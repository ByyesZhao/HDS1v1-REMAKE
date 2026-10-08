import {it,expect} from 'vitest';import {fixture,long,at,days} from './memory-capacity-fixture';
import {MemoryLifecycle} from '../src/memory/lifecycle';import {MemoryCapacity} from '../src/memory/capacity';import {MemoryIndex} from '../src/memory/index';import {MemoryMaintenance} from '../src/memory/maintenance';
import {consolidationTask,auditTask} from '../src/model/contracts';import {defaultMemoryCapacity} from '../src/memory/types';
function create(){const d=fixture(),cap=new MemoryCapacity(d.store,defaultMemoryCapacity),life=new MemoryLifecycle(d.store,cap),index=new MemoryIndex(d.store,{model:'offline',embed:async()=>[1,0]},{clock:d.clock});return {...d,cap,life,m:new MemoryMaintenance(d.store,life,index,d.models,{clock:d.clock})};}
const promote=(id:string)=>({unitKey:id,action:'promote',ids:[id],readOwners:[id],content:'常驻经历',learnedKind:'durable_experience',sourceIds:[`source-${id}`]});
it.each([{archiveEnteredAt:at,capacityExitedAt:at},{expiresAt:days(1)}])('archived main cannot promote without real reactivation: %o',fields=>{
 const d=create(),l=long(d.store,'l',{totalAwakenings:30,...fields});
 expect(d.life.promotionCandidates(days(2))).toHaveLength(0);
 expect(()=>consolidationTask([l],['l'],'consolidation',days(2)).parse({units:[promote('l')]})).toThrow(/active|archive/);
 expect(()=>d.life.promote('l','learned','经验','durable_experience',false,['l'],days(2))).toThrow(/active|archive/);expect(d.cap.counts(days(2)).longArchive).toBe(1);
});
it('frozen promotion expiring before apply becomes stale and other unit proceeds',()=>{
 const d=create(),l=long(d.store,'l',{totalAwakenings:30,expiresAt:days(1)}),other=long(d.store,'other');
 const units=consolidationTask([l,other],['l','other'],'consolidation',at).parse({units:[promote('l'),{unitKey:'other',action:'refine',ids:['other'],readOwners:['other'],sourceIds:other.sourceIds,content:'另一件事整理'}]});
 d.store.saveJob('memory_maintenance_jobs',{id:'j',createdAt:at,cutoff:at,status:'ready',snapshot:[l,other],selectedIds:['l','other'],readSet:[l,other],result:units,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});
 expect(d.m.applyOneReady(days(2))).toBe('stale');expect(d.store.job<any>('memory_maintenance_jobs','j')).toMatchObject({staleUnitKeys:['l'],retryAt:null,lastError:null});
 expect(d.m.applyOneReady(days(2))).toBe('applied');expect(d.store.canonical('other')?.content).toBe('另一件事整理');expect(d.store.canonical('l')?.status).toBe('active');expect(d.store.allOwners().filter(r=>r.kind==='learned')).toHaveLength(0);
});
it('actual sourced awakening restores archived main before promotion',()=>{
 const d=create();long(d.store,'l',{totalAwakenings:30,archiveEnteredAt:at});
 for(let i=0;i<30;i++)d.store.saveAwakening({canonicalMemoryId:'l',localDate:`2026-09-${String(i+1).padStart(2,'0')}`,firstEffectiveAt:days(i-40),turnId:`old-${i}`,sourceIds:['old']});
 d.life.awaken({id:'l',at:days(1),turnId:'new',sourceIds:['fresh'],allowedIds:['l'],allowedSourceIds:['fresh'],reason:'真实重谈'});
 expect(d.life.promotionCandidates(days(1))).toHaveLength(1);d.life.promote('l','learned','经历','durable_experience',false,['l'],days(1));expect(d.store.canonical('l')?.status).toBe('durable');
});
it.each([['phone_brand','phoneXbrand'],['phone%brand','phoneOtherbrand']])('audit literal target %s preserves %s',(id,neighbor)=>{
 const d=create(),target=d.store.makeOwner({ownerType:'detail',ownerId:id},{content:'B',sourceIds:['e']},at);d.store.saveOwner(target);
 for(const key of [id,neighbor])d.store.saveAudit({id:`detail:${key}:report_conflict`,kind:'detail_conflict',at,readSet:[{...target,ownerId:key}],sourceIds:['e'],reason:'旧报告'});
 const units=auditTask([target],[id]).parse({units:[{unitKey:'a',action:'review_detail',targetId:id,ids:[id],readOwners:[id],decision:'retain',sourceIds:[]}]});
 d.store.saveJob('memory_maintenance_jobs',{id:'j',kind:'audit',createdAt:at,cutoff:at,status:'ready',snapshot:[target],selectedIds:[id],readSet:[target],result:units,appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});
 expect(d.m.applyOneReady(at)).toBe('applied');expect(d.storage.prepare('SELECT id FROM memory_audit_reports').all().map(r=>r.id)).toEqual([`detail:${neighbor}:report_conflict`]);
});
