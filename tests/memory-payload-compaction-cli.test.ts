import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,rmSync,readFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {Storage} from '../src/storage';import {MemoryStore} from '../src/memory/store';import {DatabaseSync} from 'node:sqlite';
import {inspectCompletedPayloads,compactMemoryPayloads} from '../src/deployment/memory-payload-compaction';
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
