import {it,expect,afterEach,vi} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {inspectEnvironmentUpgrade,upgradeEnvironment} from '../src/deployment/environment-upgrade';
import {Storage} from '../src/storage';import {initialCharacter} from '../src/config';import {NOW} from './helpers';
import {apply} from '../src/index';
vi.mock('koishi',async()=>(await import('node:module')).createRequire(`${process.cwd()}/package.json`)('koishi'));
const dirs:string[]=[];afterEach(()=>{vi.unstubAllEnvs();dirs.splice(0).forEach(p=>rmSync(p,{recursive:true,force:true}));});
function legacy(){const root=mkdtempSync(join(tmpdir(),'world-school-upgrade-'));dirs.push(root);const path=join(root,'old.sqlite'),db=new DatabaseSync(path);
 for(const table of ['state','turns','events','outbox','post_jobs','messages','tasks','experiences','details','memories','detail_history','stickers','control_requests'])db.exec(`CREATE TABLE ${table}(${table==='state'?'key':'id'} TEXT PRIMARY KEY,data TEXT NOT NULL)`);
 db.prepare('INSERT INTO state VALUES(?,?)').run('runtime',JSON.stringify({paused:true,pendingBatchIds:[],openBatch:null,nextWorldAt:NOW,nextSchoolAt:NOW,nextMaintenanceAt:null,contactMisses:0,stickerMisses:0,lastError:'preserve',sharedActivityVersion:1,sharedClock:null}));
 db.prepare('INSERT INTO state VALUES(?,?)').run('character',JSON.stringify(initialCharacter(NOW)));
 const save=(table:string,id:string,value:any)=>db.prepare(`INSERT INTO ${table} VALUES(?,?)`).run(id,JSON.stringify(value));
 save('turns','old-env',{id:'old-env',done:false,environmentKind:'school',entryMode:'chat',triggerKinds:['environment'],frozenResult:{environmentChanges:[{action:'create',id:'must-not-apply',event:{kind:'school',description:'未提交'}}]},outputComplete:true});
 save('turns','front',{id:'front',done:false,entryMode:'chat',triggerKinds:['input']});save('turns','shared',{id:'shared',done:false,entryMode:'shared_online',triggerKinds:['scene_step']});save('turns','success',{id:'success',done:true,environmentKind:'school',triggerKinds:['environment']});
 save('events','exam',{id:'exam',kind:'school',startsAt:'2026-10-09T09:00:00+08:00',endsAt:null,description:'已提交考试',basis:'fiction',sourceUrls:[],status:'active'});db.close();return {root,path};
}
const options=(root:string)=>({stopped:true,backupDir:join(root,'backups'),timezone:'Asia/Shanghai',environmentDailyAt:'06:00',now:NOW});
it('readonly_check_no_writes_reports_unfinished_without_blocking_front',()=>{
 const {path}=legacy(),before=readFileSync(path);const r=inspectEnvironmentUpgrade(path);expect(r).toMatchObject({version:null,paused:true,canUpgrade:true,legacySchoolEventCount:1,unfinishedForegroundTurnIds:['front','shared']});expect(r.legacyEnvironmentTurns.map(t=>t.id)).toEqual(['old-env']);expect(readFileSync(path)).toEqual(before);
});
it('old_frozen_not_applied_success_preserved_front_still_blocks_and_backup_before_apply',()=>{
 const {path,root}=legacy(),before=readFileSync(path),report=upgradeEnvironment(path,options(root));expect(report.version).toBe(1);expect(readFileSync(report.backupPaths[0])).toEqual(before);
 const db=new Storage(path);expect(db.read('events','must-not-apply')).toBeNull();expect(db.read('turns','old-env')).toMatchObject({done:false,legacyDisposition:'superseded',closedAt:NOW,frozenResult:{environmentChanges:expect.any(Array)}});expect(db.read('turns','success')?.done).toBe(true);expect(db.unfinishedTurn()?.id).toBe('front');expect(db.read('turns','shared')?.legacyDisposition).toBeUndefined();expect(db.runtime()).toMatchObject({paused:true,lastError:'preserve',nextWorldAt:null,nextSchoolAt:null,environmentPlanningVersion:1,nextEnvironmentAt:'2026-10-07T22:00:00.000Z'});expect(db.all('school_instances')[0]).toMatchObject({id:'exam',legacyEventId:'exam'});expect(db.all('school_knowledge')).toEqual([]);expect(db.all('environment_batches')).toHaveLength(1);db.close();
});
it('repeat_upgrade_same_batch_and_closed_at',()=>{
 const {path,root}=legacy();upgradeEnvironment(path,options(root));const second=upgradeEnvironment(path,{...options(root),now:'2026-10-08T10:00:00+08:00'});expect(second.backupPaths).toEqual([]);const db=new Storage(path);expect(db.read('turns','old-env')?.closedAt).toBe(NOW);expect(db.all('environment_batches')).toHaveLength(1);db.close();
});
it('unexpected_environment_outbox_reported_not_auto_closed',()=>{
 const {path,root}=legacy(),db=new DatabaseSync(path);db.prepare('INSERT INTO outbox VALUES(?,?)').run('out',JSON.stringify({turnId:'old-env',seq:0,status:'pending'}));db.close();expect(inspectEnvironmentUpgrade(path)).toMatchObject({canUpgrade:false,unexpectedEnvironmentOutbox:[{turnId:'old-env',seq:0,status:'pending'}]});expect(()=>upgradeEnvironment(path,options(root))).toThrow(/outbox/);expect(existsSync(join(root,'backups'))).toBe(false);
});
it('config_compat_does_not_bypass_db_gate',()=>{
 const {path,root}=legacy(),sample=JSON.parse(readFileSync('examples/story.sample.json','utf8'));writeFileSync(join(root,'story.json'),JSON.stringify(sample));vi.stubEnv('DEEPSEEK_API_KEY','fixture-only');const before=readFileSync(path);
 expect(()=>apply({baseDir:root} as any,{botId:'b',userId:'u',databasePath:path,storyConfigPath:join(root,'story.json')})).toThrow(/migrate:environment/);expect(readFileSync(path)).toEqual(before);
});
it('old_ungenerated_environment_superseded_without_marking_success',()=>{
 const {path,root}=legacy(),raw=new DatabaseSync(path);raw.prepare("UPDATE turns SET data=? WHERE id='old-env'").run(JSON.stringify({id:'old-env',done:false,environmentKind:'world',entryMode:'chat',triggerKinds:['environment'],frozenResult:null,outputComplete:false}));raw.close();
 upgradeEnvironment(path,options(root));const db=new Storage(path);expect(db.read('turns','old-env')).toMatchObject({done:false,frozenResult:null,legacyDisposition:'superseded'});db.close();
});
