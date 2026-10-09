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
