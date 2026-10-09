import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {spawnSync} from 'node:child_process';import assert from 'node:assert/strict';
import {Storage} from '../../../../../src/storage';import {ensureEnvironmentBatch} from '../../../../../src/environment/scheduler';import {defaultConfig} from '../../../../../src/config';
const dir=mkdtempSync(join(tmpdir(),'hdsi-env-cli-')),database=join(dir,'synthetic.sqlite'),backup=join(dir,'backups'),records:any[]=[];
const s=new Storage(database);s.set('runtime',{...s.runtime(),environmentPlanningVersion:1,paused:true});ensureEnvironmentBatch(s,defaultConfig,'2026-10-09T06:00:00+08:00');s.close();
function run(args:string[],expected:number){const r=spawnSync(process.execPath,['--import','tsx','scripts/migrate-environment-async.ts','--database',database,...args],{encoding:'utf8'});assert.equal(r.status,expected,r.stderr);const report=JSON.parse(r.stdout);records.push({args,status:r.status,report});return report;}
assert.equal(run(['--check'],0).canUpgrade,true);
const upgraded=run(['--apply','--stopped','--backup-dir',backup],0);assert.equal(upgraded.version,2);assert.ok(upgraded.backupPaths.length>0);
assert.equal(run(['--check','--target-version','1'],1).canUpgrade,false);
const terminal=new Storage(database);for(const row of terminal.all('environment_steps'))terminal.save('environment_steps',row.id,{...row,status:'superseded'});terminal.close();
assert.equal(run(['--apply','--stopped','--backup-dir',backup,'--target-version','1'],0).version,1);
writeFileSync('docs/v0.5/records/environment-async-20261009/evidence/upgrade-cli.json',JSON.stringify({synthetic:true,temporaryDirectory:dir,records},null,2));
console.log('4 CLI scenarios passed; formal database untouched.');
