import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {DatabaseSync} from 'node:sqlite';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryCapacity} from '../src/memory/capacity';
import {defaultMemoryCapacity} from '../src/memory/types';
import {MemoryCleanup} from '../src/memory/cleanup';
import {inspectMemoryCapacity,upgradeMemoryCapacity} from '../src/deployment/memory-capacity-upgrade';
import {at,days} from './memory-capacity-fixture';
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
function file(){const dir=mkdtempSync(join(tmpdir(),'hdsi-cap-upgrade-'));dirs.push(dir);const path=join(dir,'old.sqlite'),s=new Storage(path),store=new MemoryStore(s);store.migrate(at);for(const [id,data] of [['expired',{expiresAt:days(-10)}],['anchored',{archiveEnteredAt:days(-20),expiresAt:days(200)}],['live',{expiresAt:days(90)}]] as const)store.saveOwner(store.makeOwner({ownerType:'long',ownerId:id},{content:'私密旧正文',retainedFrom:days(-100),...data},days(-100)));s.prepare('DROP TABLE memory_dirty_owners').run();s.prepare('DROP TABLE memory_audit_reports').run();s.close();return {dir,path};}
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
