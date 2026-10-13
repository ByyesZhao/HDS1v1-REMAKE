import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,readdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Storage} from '../src/storage';import {MemoryStore} from '../src/memory/store';import {DatabaseSync} from 'node:sqlite';
import {inspectCompletedPayloads,compactMemoryPayloads} from '../src/deployment/memory-payload-compaction';
import {digest} from '../src/environment/digest';
const dirs:string[]=[];afterEach(()=>{for(const d of dirs.splice(0))rmSync(d,{recursive:true,force:true});});
function seed(){const dir=mkdtempSync(join(tmpdir(),'hdsi-payload-'));dirs.push(dir);const path=join(dir,'db.sqlite'),s=new Storage(path);new MemoryStore(s);for(let i=0;i<7;i++)s.prepare('INSERT INTO memory_index_jobs(id,data) VALUES(?,?)').run('i'+i,JSON.stringify({id:'i'+i,status:'done',text:'正文',completionReason:'applied'}));s.close();return {dir,path};}
it('inspect is read-only; apply requires stopped and bounded continuation backs up original payloads',()=>{
 const {path}=seed(),bytes=readFileSync(path);expect(inspectCompletedPayloads(path).indexJobs).toBe(7);expect(readFileSync(path)).toEqual(bytes);expect(()=>compactMemoryPayloads(path,{stopped:false})).toThrow('--stopped');expect(()=>compactMemoryPayloads(path,{stopped:true,batchSize:0})).toThrow('positive');
 const first=compactMemoryPayloads(path,{stopped:true,batchSize:3,maxBatches:2});expect(first).toMatchObject({totalUpdated:6,batches:2,hasMore:true,after:{indexJobs:1}});expect(inspectCompletedPayloads(join(first.backupPath!,readdirSync(first.backupPath!)[0])).indexJobs).toBe(7);
 expect(compactMemoryPayloads(path,{stopped:true,batchSize:3,maxBatches:2})).toMatchObject({totalUpdated:1,hasMore:false});expect(compactMemoryPayloads(path,{stopped:true})).toMatchObject({totalUpdated:0,backupPath:null});
});
it('failed batch rolls back completely and keeps prior committed batch',()=>{
 const {path}=seed(),db=new DatabaseSync(path);db.exec("CREATE TRIGGER fail_payload BEFORE UPDATE ON memory_index_jobs WHEN OLD.id='i2' BEGIN SELECT RAISE(ABORT,'injected batch failure'); END");db.close();expect(()=>compactMemoryPayloads(path,{stopped:true,batchSize:2,maxBatches:5})).toThrow('injected batch failure');expect(inspectCompletedPayloads(path).indexJobs).toBe(5);const read=new DatabaseSync(path,{readOnly:true});try{expect(JSON.parse(String(read.prepare("SELECT data FROM memory_index_jobs WHERE id='i3'").get()!.data)).text).toBe('正文');}finally{read.close();}
});
it('CLI defaults to dry run and never needs a local config',()=>{
 const {path}=seed(),output=execFileSync(process.execPath,['--import','tsx','scripts/compact-memory-payloads.ts',path],{encoding:'utf-8'});expect(JSON.parse(output)).toMatchObject({mode:'dry-run',indexJobs:7});expect(inspectCompletedPayloads(path).indexJobs).toBe(7);
 expect(()=>execFileSync(process.execPath,['--import','tsx','scripts/compact-memory-payloads.ts',path,'--apply'],{encoding:'utf-8',stdio:'pipe'})).toThrow();
});

function environmentSeed(){
 const seeded=seed(),db=new DatabaseSync(seeded.path);db.exec("DELETE FROM memory_index_jobs WHERE id NOT IN ('i0','i1')");
 const at='2026-10-11T00:00:00.000Z',raw=new Map<string,string>();
 for(const [id,status,version] of [
  ...Array.from({length:7},(_,i)=>[`terminal-${i}`,i%2?'superseded':'committed',1]),
  ['legacy','committed',0],['missing','superseded',undefined],['pending','pending',1],['running','running',1],['ready','ready',1],
 ]){
  const input={stage:'world',batchId:'batch',at,modelContractVersion:1,context:{background:'原始业务正文'}},data=JSON.stringify({id,batchId:'batch',stage:'world',status,preparationVersion:version,attempt:2,startedAt:at,completedAt:at,retryAt:null,lastError:'保留原因',inputSnapshot:input,
   preparationSnapshot:{version:1,at,timezone:'Asia/Shanghai',input,school:{school_plans:[],school_plan_items:[],school_instances:[],school_notices:[],school_weeks:[],school_knowledge:[],school_progress:[]},businessBasis:'frozen-business',retrieval:{request:{query:'',at,phase:'world',scope:'current',includeDetailHistory:false,budget:null,permissions:{allowArchive:false,allowDetailHistory:false,visibleSourceIds:[]}},candidates:[],recent:[],sourcePresence:[],invalidSourceIds:[],signature:'frozen-config'},usedBasis:null},frozenResult:{stage:'world',changes:[]}});
  db.prepare('INSERT INTO environment_steps VALUES(?,?)').run(String(id),data);raw.set(String(id),data);
 }
 for(const table of ['events','school_instances','tasks','messages'])db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run('business-'+table,JSON.stringify({id:'business-'+table,evidence:'本工具不得修改的业务原行'}));
 db.close();return {...seeded,raw};
}
const businessRows=(db:DatabaseSync)=>Object.fromEntries(['events','school_instances','tasks','messages'].map(table=>[table,db.prepare(`SELECT id,data FROM ${table} ORDER BY id`).all()]));
it('environment CLI opt-in is read-only by default and resumes within a shared limit',()=>{
 const {path,dir,raw}=environmentSeed(),bytes=readFileSync(path);
 const invoke=(args:string[])=>JSON.parse(execFileSync(process.execPath,['--import','tsx','scripts/compact-memory-payloads.ts',path,...args],{encoding:'utf8'}));
 expect(invoke([])).toMatchObject({mode:'dry-run',indexJobs:2,environmentSteps:0});
 expect(invoke(['--dry-run','--include-environment'])).toMatchObject({mode:'dry-run',environmentSteps:7});expect(readFileSync(path)).toEqual(bytes);
 const beforeDb=new DatabaseSync(path,{readOnly:true});let business:ReturnType<typeof businessRows>;try{business=businessRows(beforeDb);expect(beforeDb.prepare("SELECT name FROM sqlite_master WHERE name='environment_payload_residual'").get()).toBeUndefined();}finally{beforeDb.close();}
 expect(()=>invoke(['--apply','--include-environment'])).toThrow();
 const first=invoke(['--apply','--stopped','--include-environment','--batch-size','3','--max-batches','2','--backup-dir',join(dir,'backups')]);
 expect(first).toMatchObject({totalUpdated:6,batches:2,hasMore:true,after:{indexJobs:0,environmentSteps:3}});
 const backup=new DatabaseSync(join(first.backupPath,'db.sqlite'),{readOnly:true});try{expect(backup.prepare('SELECT data FROM environment_steps WHERE id=?').get('terminal-0')!.data).toBe(raw.get('terminal-0'));expect(businessRows(backup)).toEqual(business!);}finally{backup.close();}
 const second=invoke(['--apply','--stopped','--include-environment']);expect(second).toMatchObject({totalUpdated:3,hasMore:false,after:{environmentSteps:0}});
 const backupEntries=readdirSync(join(dir,'backups'));expect(invoke(['--apply','--stopped','--include-environment'])).toMatchObject({totalUpdated:0,backupPath:null,hasMore:false});expect(readdirSync(join(dir,'backups'))).toEqual(backupEntries);
 const check=new DatabaseSync(path,{readOnly:true});try{
  expect(businessRows(check)).toEqual(business!);for(const [id,data] of raw){const saved=String(check.prepare('SELECT data FROM environment_steps WHERE id=?').get(id)!.data);
   if(!id.startsWith('terminal'))expect(saved).toBe(data);else{const row=JSON.parse(saved),old=JSON.parse(data);expect(row.terminalAudit.basis).toMatchObject({inputDigest:digest(old.inputSnapshot),preparationDigest:digest(old.preparationSnapshot),resultDigest:digest(old.frozenResult)});}
  }
  const times=check.prepare("SELECT DISTINCT json_extract(data,'$.terminalAudit.compactedAt') at FROM environment_steps WHERE id IN ('terminal-0','terminal-1','terminal-2','terminal-3')").all();expect(times).toHaveLength(1);
 }finally{check.close();}
},20000);

it('environment second-batch failure rolls back and later resume preserves prior audit time',()=>{
 const {path}=environmentSeed(),db=new DatabaseSync(path);db.exec("DELETE FROM memory_index_jobs; CREATE TRIGGER fail_environment BEFORE UPDATE ON environment_steps WHEN OLD.id='terminal-2' BEGIN SELECT RAISE(ABORT,'injected environment failure'); END");db.close();
 expect(()=>compactMemoryPayloads(path,{stopped:true,includeEnvironment:true,batchSize:2,maxBatches:5})).toThrow('injected environment failure');
 expect(inspectCompletedPayloads(path,{includeEnvironment:true}).environmentSteps).toBe(5);
 const edit=new DatabaseSync(path);let first:string;try{first=String(edit.prepare("SELECT data FROM environment_steps WHERE id='terminal-0'").get()!.data);expect(JSON.parse(String(edit.prepare("SELECT data FROM environment_steps WHERE id='terminal-3'").get()!.data)).inputSnapshot).not.toBeNull();edit.exec('DROP TRIGGER fail_environment');}finally{edit.close();}
 expect(compactMemoryPayloads(path,{stopped:true,includeEnvironment:true,batchSize:2})).toMatchObject({totalUpdated:5,hasMore:false});const read=new DatabaseSync(path,{readOnly:true});try{expect(read.prepare("SELECT data FROM environment_steps WHERE id='terminal-0'").get()!.data).toBe(first!);}finally{read.close();}
});

it('environment backup contains existing WAL and SHM and reopens original payloads',()=>{
 const {path,raw}=environmentSeed(),db=new DatabaseSync(path);try{
  db.exec('PRAGMA journal_mode=WAL');db.prepare("INSERT INTO events VALUES('wal-business',?)").run(JSON.stringify({id:'wal-business',evidence:'WAL中已提交业务'}));
  expect(existsSync(path+'-wal')).toBe(true);expect(existsSync(path+'-shm')).toBe(true);const business=businessRows(db);
  const result=compactMemoryPayloads(path,{stopped:true,includeEnvironment:true,batchSize:3,maxBatches:1});for(const suffix of ['','-wal','-shm'])expect(existsSync(join(result.backupPath!,'db.sqlite'+suffix))).toBe(true);
  const backup=new DatabaseSync(join(result.backupPath!,'db.sqlite'),{readOnly:true});try{expect(backup.prepare("SELECT data FROM environment_steps WHERE id='terminal-0'").get()!.data).toBe(raw.get('terminal-0'));expect(businessRows(backup)).toEqual(business);}finally{backup.close();}
 }finally{db.close();}
});
it('legacy CLI dry-run preserves missing history; apply archives before checkpoint deletion',()=>{
 const {path}=seed(),db=new DatabaseSync(path);db.exec('DROP TABLE model_run_records; CREATE TABLE web_sessions(id TEXT PRIMARY KEY,data TEXT NOT NULL)');
 const checkpoint={formatVersion:2,input:{body:'legacy private evidence'},repairCount:2,lookupUsed:false,pendingOperationId:null,toolResults:[],repair:{original:'last saved repair',errors:'invalid'}};
 db.prepare('INSERT INTO turns VALUES(?,?)').run('done-turn',JSON.stringify({id:'done-turn',done:true}));db.prepare('INSERT INTO web_sessions VALUES(?,?)').run('legacy-run',JSON.stringify({ref:{runId:'legacy-run',ownerType:'turn',ownerId:'done-turn',stageKey:'narrative',taskName:'narrative',ordinal:1},checkpoint}));db.close();const bytes=readFileSync(path);
 const output=execFileSync(process.execPath,['--import','tsx','scripts/compact-memory-payloads.ts',path],{encoding:'utf8'});expect(JSON.parse(output)).toMatchObject({mode:'dry-run',webSessions:1});expect(readFileSync(path)).toEqual(bytes);
 const readonly=new Storage(path,{readOnly:true});expect(readonly.hasTable('model_run_records')).toBe(false);readonly.close();
 const result=compactMemoryPayloads(path,{stopped:true});expect(result).toMatchObject({totalUpdated:8,after:{webSessions:0}});
 const read=new Storage(path,{readOnly:true});try{expect(JSON.parse(String(read.prepare('SELECT data FROM model_run_records').get()!.data))).toMatchObject({type:'checkpoint',reason:'compacted',checkpoint});expect(JSON.parse(String(read.prepare('SELECT data FROM web_sessions').get()!.data)).checkpoint).toBeNull();}finally{read.close();}
});
