import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Storage} from '../src/storage';
import {inspectEnvironmentAsyncUpgrade,upgradeEnvironmentAsync} from '../src/deployment/environment-async-upgrade';
import {ensureEnvironmentBatch} from '../src/environment/scheduler';
import {defaultConfig} from '../src/config';
it('new databases opt into async',()=>{const s=new Storage(':memory:');expect(s.runtime().environmentPlanningVersion).toBe(2);s.close();});
it('explicit upgrade preserves frozen states and deadlines; repeated apply inert; downgrade rejects unfinished async',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-env-')),path=join(dir,'test.sqlite');
 try{
 const s=new Storage(path);s.set('runtime',{...s.runtime(),environmentPlanningVersion:1,paused:true});
 const batch=ensureEnvironmentBatch(s,defaultConfig,'2026-10-09T06:00:00+08:00')!;
 const steps=s.all('environment_steps');const states=['ready','running','pending','pending'] as const;
 for(let i=0;i<4;i++)s.save('environment_steps',steps[i].id,{...steps[i],status:states[i],attempt:i===3?0:2,inputSnapshot:i===3?null:{stage:steps[i].stage,batchId:batch.id,at:batch.createdAt,context:{}},frozenResult:i===0?{stage:'world',changes:[]}:null});
 const runtime=s.runtime();s.close();
 expect(inspectEnvironmentAsyncUpgrade(path).canUpgrade).toBe(true);
 const options={stopped:true,backupDir:join(dir,'backups')};
 const report=upgradeEnvironmentAsync(path,options);expect(report.backupPaths.length).toBeGreaterThan(0);
 const after=new Storage(path);expect(after.runtime()).toEqual({...runtime,environmentPlanningVersion:2});
 expect(after.all('environment_steps').map(x=>x.preparationVersion)).toEqual([0,0,0,1]);after.close();
 expect(upgradeEnvironmentAsync(path,options).backupPaths).toEqual([]);
 expect(inspectEnvironmentAsyncUpgrade(path,1).canUpgrade).toBe(false);
 const terminal=new Storage(path);for(const x of terminal.all('environment_steps'))terminal.save('environment_steps',x.id,{...x,status:'superseded'});terminal.close();
 expect(upgradeEnvironmentAsync(path,{...options,targetVersion:1}).version).toBe(1);
 }finally{rmSync(dir,{recursive:true,force:true});}
});

import {readFileSync} from 'node:fs';
import {asyncFixture} from './environment-async-fixture';
import {EnvironmentPreparation} from '../src/environment/preparation';
import {NOW} from './helpers';
import type {EnvironmentStep} from '../src/environment/types';

it.each(['ready','running'] as const)('normal version2 %s is async only and inspection leaves bytes unchanged',async status=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-env-count-')),path=join(dir,'test.sqlite');
 const {d,step}=asyncFixture('world',new Storage(path));let finish:()=>void=()=>{};
 d.generateEnvironment=async()=>{if(status==='running')await new Promise<void>(resolve=>finish=resolve);return {stage:'world',changes:[]};};
 const prep=new EnvironmentPreparation(d);
 try{
  expect(prep.startOne(step.id,NOW)).toBe(true);
  if(status==='ready')await prep.wait();
  expect(d.environmentStore.step(step.id)!.status).toBe(status);
  const bytes=readFileSync(path),report=inspectEnvironmentAsyncUpgrade(path);
  expect({legacy:report.legacyUnfinished,async:report.asyncUnfinished,unstarted:report.unstarted}).toEqual({legacy:0,async:4,unstarted:3});
  expect(readFileSync(path)).toEqual(bytes);expect(inspectEnvironmentAsyncUpgrade(path,1).canUpgrade).toBe(false);
 }finally{finish();await prep.stop();d.storage.close();rmSync(dir,{recursive:true,force:true});}
});
const countCases:Array<{name:string;version:0|1|undefined;status:EnvironmentStep['status'];attempt:number;input:boolean;want:[number,number,number]}>= [
 {name:'missing ready',version:undefined,status:'ready',attempt:0,input:false,want:[1,0,0]},
 {name:'missing running',version:undefined,status:'running',attempt:0,input:false,want:[1,0,0]},
 {name:'missing frozen pending',version:undefined,status:'pending',attempt:0,input:true,want:[1,0,0]},
 {name:'missing attempted pending',version:undefined,status:'pending',attempt:2,input:false,want:[1,0,0]},
 {name:'explicit legacy pending',version:0,status:'pending',attempt:0,input:false,want:[1,0,1]},
 {name:'async attempted pending',version:1,status:'pending',attempt:2,input:false,want:[0,1,0]},
 {name:'async running',version:1,status:'running',attempt:1,input:true,want:[0,1,0]},
 {name:'legacy committed',version:0,status:'committed',attempt:1,input:true,want:[0,0,0]},
 {name:'async superseded',version:1,status:'superseded',attempt:1,input:true,want:[0,0,0]},
 {name:'missing untouched pending',version:undefined,status:'pending',attempt:0,input:false,want:[0,0,1]},
];
it.each(countCases)('upgrade inspection classifies $name',({version,status,attempt,input,want})=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-env-boundary-')),path=join(dir,'test.sqlite');
 try{
  const s=new Storage(path);s.set('runtime',{...s.runtime(),environmentPlanningVersion:1});
  ensureEnvironmentBatch(s,defaultConfig,NOW);
  const rows=s.all('environment_steps');
  for(const row of rows)s.save('environment_steps',row.id,{...row,status:'committed'});
  const row=rows[0];s.save('environment_steps',row.id,{...row,preparationVersion:version,status,attempt,inputSnapshot:input?{stage:row.stage,batchId:row.batchId,at:NOW,context:{}}:null});
  s.close();const bytes=readFileSync(path),r=inspectEnvironmentAsyncUpgrade(path);
  expect([r.legacyUnfinished,r.asyncUnfinished,r.unstarted]).toEqual(want);expect(readFileSync(path)).toEqual(bytes);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('mixed unfinished count excludes terminal async and retains explicit legacy',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-env-mixed-')),path=join(dir,'test.sqlite');
 try{
  const s=new Storage(path);s.set('runtime',{...s.runtime(),environmentPlanningVersion:1});ensureEnvironmentBatch(s,defaultConfig,NOW);
  const rows=s.all('environment_steps'),versions=[0,undefined,1,1] as const,statuses=['pending','pending','running','committed'] as const,attempts=[0,2,1,1];
  rows.forEach((row,i)=>s.save('environment_steps',row.id,{...row,preparationVersion:versions[i],status:statuses[i],attempt:attempts[i]}));s.close();
  const r=inspectEnvironmentAsyncUpgrade(path);expect([r.legacyUnfinished,r.asyncUnfinished,r.unstarted]).toEqual([2,1,1]);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
it('untouched missing preparation version upgrades to async and repeated apply is byte-inert',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-env-untouched-')),path=join(dir,'test.sqlite');
 try{
  const s=new Storage(path);s.set('runtime',{...s.runtime(),environmentPlanningVersion:1});ensureEnvironmentBatch(s,defaultConfig,NOW);
  const rows=s.all('environment_steps');for(const row of rows)s.save('environment_steps',row.id,{...row,status:'committed'});
  s.save('environment_steps',rows[0].id,{...rows[0],preparationVersion:undefined});s.close();
  const r=inspectEnvironmentAsyncUpgrade(path);expect([r.legacyUnfinished,r.asyncUnfinished,r.unstarted]).toEqual([0,0,1]);
  const options={stopped:true,backupDir:join(dir,'backups')};upgradeEnvironmentAsync(path,options);
  const upgraded=new Storage(path,{readOnly:true});expect(upgraded.read('environment_steps',rows[0].id)!.preparationVersion).toBe(1);upgraded.close();
  const bytes=readFileSync(path);expect(upgradeEnvironmentAsync(path,options).backupPaths).toEqual([]);expect(readFileSync(path)).toEqual(bytes);
 }finally{rmSync(dir,{recursive:true,force:true});}
});
