import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryCapacity} from '../src/memory/capacity';
import {defaultMemoryCapacity} from '../src/memory/types';
import type {MemoryCandidate} from '../src/memory/types';
import {MemoryCleanup} from '../src/memory/cleanup';
import {inspectMemoryCapacity,upgradeMemoryCapacity} from '../src/deployment/memory-capacity-upgrade';
import {at,days} from './memory-capacity-fixture';
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
function file(){const dir=mkdtempSync(join(tmpdir(),'hdsi-cap-upgrade-'));dirs.push(dir);const path=join(dir,'old.sqlite'),s=new Storage(path),store=new MemoryStore(s);store.migrate(at);for(const [id,data] of [['expired',{expiresAt:days(-10)}],['anchored',{archiveEnteredAt:days(-20),expiresAt:days(200)}],['live',{expiresAt:days(90)}]] as const)store.saveOwner(store.makeOwner({ownerType:'long',ownerId:id},{content:'私密旧正文',retainedFrom:days(-100),...data},days(-100)));s.prepare('DROP TABLE memory_dirty_owners').run();s.prepare('DROP TABLE memory_audit_reports').run();s.close();return {dir,path};}
function exitFile(shortData:Partial<MemoryCandidate>,summary:string){
 const dir=mkdtempSync(join(tmpdir(),'hdsi-cap-exit-'));dirs.push(dir);const path=join(dir,'snapshot.sqlite'),s=new Storage(path),store=new MemoryStore(s);
 try{
  store.migrate(at);
  store.saveOwner(store.makeOwner({ownerType:'long',ownerId:'l'},{content:summary,importance:'normal',retainedFrom:at,expiresAt:days(90),sourceIds:['event-l']},at));
  store.saveOwner(store.makeOwner({ownerType:'long',ownerId:'other'},{content:'另一段重要经历',importance:'high',retainedFrom:at,expiresAt:days(90),sourceIds:['event-other']},at));
  store.saveOwner(store.makeOwner({ownerType:'short',ownerId:'s'},{content:'尚未清理的私密详情',linkedLongId:'l',sourceIds:['event-l'],...shortData},days(-8)));
 }finally{s.close();}
 return path;
}
it.each([
 {name:'expired short with missing summary',short:{shortExpiresAt:days(-1)},summary:''},
 {name:'capacity-exited short before expiry',short:{shortExpiresAt:days(1),capacityExitedAt:days(-1),capacityExitReason:'short_capacity' as const},summary:'简要经历'},
])('dry-run permits long active exit but retains deletion protection: $name',({short,summary})=>{
 const path=exitFile(short,summary),config={...defaultMemoryCapacity,longActiveLimit:1,longArchiveLimit:0},before=readFileSync(path);
 const report=inspectMemoryCapacity(path,at,config);expect(readFileSync(path)).toEqual(before);expect(JSON.stringify(report)).not.toContain('尚未清理的私密详情');
 const s=new Storage(path),store=new MemoryStore(s);
 try{
  const exits=new MemoryCapacity(store,config).normalize(at).changedOwners.filter(r=>r.ownerType==='long').map(r=>r.ownerId);
  expect(exits).toEqual(['l']);expect(store.canonical('l')).toMatchObject({capacityExitReason:'long_capacity',archiveEnteredAt:at});
  expect(report.longCapacityExits.map(r=>r.id)).toEqual(['l']);expect(report.longCapacityExits.map(r=>r.id)).toEqual(exits);
 }finally{s.close();}
 const archived=inspectMemoryCapacity(path,at,config);
 expect(archived.counts.archiveOverflow).toBe(1);expect(archived.archive).toEqual([{id:'l',archiveStart:at,deleteAt:days(90),protected:true}]);expect(archived.archiveCapacityDeletes).toEqual([]);
});
it.each(['active short','stable understanding'] as const)('dry-run and normalization preserve active-exit protection from %s',source=>{
 const path=exitFile({shortExpiresAt:source==='active short'?days(1):days(-1)},'简要经历'),config={...defaultMemoryCapacity,longActiveLimit:1};
 if(source==='stable understanding'){
  const s=new Storage(path),store=new MemoryStore(s);try{store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'understanding'},{content:'稳定认识',canonicalMemoryId:'l',evidenceMemoryIds:['l'],learnedKind:'stable_understanding'},at));}finally{s.close();}
 }
 const report=inspectMemoryCapacity(path,at,config);expect(report.longCapacityExits.map(r=>r.id)).toEqual(['other']);
 const s=new Storage(path),store=new MemoryStore(s);try{
  expect(new MemoryCapacity(store,config).normalize(at).changedOwners.filter(r=>r.ownerType==='long').map(r=>r.ownerId)).toEqual(['other']);expect(store.canonical('l')?.archiveEnteredAt).toBeNull();
 }finally{s.close();}
});
it('dry_run_readonly_no_ddl and inspection_matches_runtime_archive_count',()=>{
 const {path}=file(),before=readFileSync(path);const report=inspectMemoryCapacity(path,at,defaultMemoryCapacity);expect(report.counts).toMatchObject({longArchive:2,longOccupied:1});expect(report.archive.map(r=>r.id).sort()).toEqual(['anchored','expired']);expect(JSON.stringify(report)).not.toContain('私密旧正文');expect(readFileSync(path)).toEqual(before);
 const s=new Storage(path),store=new MemoryStore(s);expect(new MemoryCapacity(store,defaultMemoryCapacity).counts(at)).toEqual(report.counts);s.close();
});
it('apply_stopped_and_idempotent and legacy_dates_no_now_refresh',()=>{
 const {path,dir}=file();expect(()=>upgradeMemoryCapacity(path,at,{stopped:false,backupDirectory:dir})).toThrow(/stopped/);
 const report=upgradeMemoryCapacity(path,at,{stopped:true,backupDirectory:join(dir,'backup')});expect(report.version).toBe(1);expect(report.backupPath).toBeTruthy();
 const s=new Storage(path),store=new MemoryStore(s);expect(store.canonical('expired')?.archiveEnteredAt).toBe(days(-10));expect(store.canonical('anchored')?.archiveEnteredAt).toBe(days(-20));const runtime=s.runtime();expect(store.schemaVersion()).toBe(3);const bytes=JSON.stringify(store.allOwners());store.migrateCapacity(days(1));expect(JSON.stringify(store.allOwners())).toBe(bytes);expect(s.runtime()).toEqual(runtime);s.close();
});
it('legacy_evidence_and_done_payload',()=>{
 const {path}=file(),s=new Storage(path),store=new MemoryStore(s);store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'learned'},{content:'稳定认识',sourceIds:['expired','not-an-event'],canonicalMemoryId:'live'},at));
 s.save('turns','old',{id:'old',done:true,completedAt:days(-1)} as any);s.save('post_jobs','old',{turnId:'old',result:{schemaVersion:3,shortTermChanges:[{content:'详细正文'}],longTermChanges:[],detailChanges:[]} as any});
 store.saveJob('memory_maintenance_jobs',{id:'computing',status:'computing',snapshot:[store.canonical('live')!],selectedIds:['live'],readSet:[store.canonical('live')!],result:null,appliedUnitKeys:[],staleUnitKeys:[],createdAt:at,cutoff:at,retryAt:null,lastError:null});
 store.migrateCapacity(at);expect(store.owner({ownerType:'learned',ownerId:'learned'})?.evidenceMemoryIds).toEqual(['live','expired']);expect(s.read('post_jobs','old')?.result).toBeNull();expect(store.job<any>('memory_maintenance_jobs','computing')).toMatchObject({kind:'consolidation',prunedOwnerKeys:[],status:'pending'});expect(s.runtime().memoryIdle?.lastStoryCompletedAt).toBe(days(-1));s.close();
});
it('upgrade refuses an unfinished old story without changing schema or marker',()=>{
 const {path,dir}=file(),s=new Storage(path);s.save('turns','running',{id:'running',done:false} as any);const before=s.runtime().memoryCapacityVersion;s.close();expect(()=>upgradeMemoryCapacity(path,at,{stopped:true,backupDirectory:dir})).toThrow(/unfinished/);const db=new DatabaseSync(path,{readOnly:true});try{expect(JSON.parse(String(db.prepare("SELECT data FROM state WHERE key='runtime'").get()!.data)).memoryCapacityVersion).toBe(before);}finally{db.close();}
});
it('CLI reads only memory settings without a background or key file',()=>{
 const {path,dir}=file(),config=join(dir,'memory only.json');writeFileSync(config,JSON.stringify({memory:{capacity:{longActiveLimit:null,longArchiveLimit:1}}}));
 const run=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/migrate-memory-capacity.ts',path,'--config',config,'--dry-run'],{encoding:'utf8'});
 expect(run.status,run.stderr).toBe(0);const report=JSON.parse(run.stdout);expect(report.config.longActiveLimit).toBeNull();expect(report.archiveCapacityDeletes).toHaveLength(1);expect(report.mode).toBe('dry-run');expect(run.stdout).not.toContain('私密旧正文');
});
it('legacy_short_source_resolves_canonical_evidence_before_cleanup',()=>{
 const {path}=file(),s=new Storage(path),store=new MemoryStore(s);
 try{
  const short=store.makeOwner({ownerType:'short',ownerId:'legacy-short'},{content:'旧短期详情',linkedLongId:'expired',shortExpiresAt:days(-1)},days(-8));store.saveOwner(short);
  store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'u'},{content:'两个事件的稳定认识',canonicalMemoryId:'live',learnedKind:'stable_understanding',sourceIds:['live',short.id,'unknown-source']},at));
  store.migrateCapacity(at);expect(store.owner({ownerType:'learned',ownerId:'u'})?.evidenceMemoryIds).toEqual(['live','expired']);
  const cleanup=new MemoryCleanup(store,new MemoryCapacity(store,defaultMemoryCapacity));while(cleanup.applyOne(days(100))==='applied'){}
  expect(store.owner(short)).toBeNull();expect(store.canonical('expired')).not.toBeNull();expect(store.owner({ownerType:'learned',ownerId:'u'})?.content).toBe('两个事件的稳定认识');
 }finally{s.close();}
});
it('inspection sorts from one policy snapshot and one bounded awakening batch without owner payloads',()=>{
 const path=exitFile({shortExpiresAt:days(7)},'summary'),s=new Storage(path),store=new MemoryStore(s);
 try{
  for(let i=0;i<4;i++)store.saveOwner(store.makeOwner({ownerType:'long',ownerId:`extra-${i}`},{content:'private'.repeat(500),retainedFrom:at,expiresAt:days(90),lastEventUpdateAt:days(-i)},at));
 }finally{s.close();}
 const prepare=DatabaseSync.prototype.prepare,reads:string[]=[];
 const spy=vi.spyOn(DatabaseSync.prototype,'prepare').mockImplementation(function(this:DatabaseSync,sql:string){reads.push(sql);return prepare.call(this,sql);});
 let report:ReturnType<typeof inspectMemoryCapacity>;
 try{report=inspectMemoryCapacity(path,at,{...defaultMemoryCapacity,longActiveLimit:1});}finally{spy.mockRestore();}
 expect(report.longCapacityExits.map(row=>row.id)).toEqual(['extra-3','extra-2','extra-1','extra-0','other']);
 expect(reads.filter(sql=>sql.includes('AS hasContent FROM'))).toHaveLength(3);
 expect(reads.filter(sql=>sql.includes('FROM memory_awakenings'))).toHaveLength(1);
 expect(reads.filter(sql=>/^SELECT data FROM (memories|details|learned_background)\b/.test(sql))).toEqual([]);
 expect(reads.find(sql=>sql.includes('FROM memory_awakenings'))).toMatch(/^SELECT canonicalMemoryId,firstEffectiveAt FROM /);
 expect(JSON.stringify(report)).not.toContain('private');
});
it('inspection of legacy database without awakenings preserves ordered exits and missing references',()=>{
 const path=exitFile({shortExpiresAt:days(7)},'summary'),s=new Storage(path),store=new MemoryStore(s);
 try{
  store.saveOwner(store.makeOwner({ownerType:'short',ownerId:'missing'},{content:'detail',linkedLongId:'unknown',shortExpiresAt:days(7)},at));
  // The inspector intentionally uses the historical metadata mode's later-table winner.
  store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'l'},{content:'detail shadows same ID'},at));
  s.prepare('DROP TABLE memory_awakenings').run();
 }finally{s.close();}
 const before=readFileSync(path),report=inspectMemoryCapacity(path,at,{...defaultMemoryCapacity,shortActiveLimit:0,longActiveLimit:1});
 expect(readFileSync(path)).toEqual(before);expect(report.shortCapacityExits).toEqual([]);expect(report.longCapacityExits).toEqual([{id:'l',reason:'long_capacity'}]);
 expect(report.missingReferences).toEqual([{id:'missing',targetId:'unknown'},{id:'s',targetId:'l'}]);
});
