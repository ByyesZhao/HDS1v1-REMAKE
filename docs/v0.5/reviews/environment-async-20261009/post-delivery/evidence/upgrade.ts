import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {Storage} from '../../../../../../src/storage';
import {EnvironmentStore} from '../../../../../../src/environment/store';
import {SchoolStore} from '../../../../../../src/school/store';
import {WebSearchStore} from '../../../../../../src/web/store';
import {WebSearchService} from '../../../../../../src/web/service';
import {ensureEnvironmentBatch} from '../../../../../../src/environment/scheduler';
import {environmentInput,runEnvironmentStep} from '../../../../../../src/environment/runtime';
import {inspectEnvironmentAsyncUpgrade,upgradeEnvironmentAsync} from '../../../../../../src/deployment/environment-async-upgrade';
import {setup,NOW} from '../../../../../../tests/helpers';
import type {EnvironmentModelResult} from '../../../../../../src/environment/types';

const dir=resolve('.tmp/review-e-upgrade',randomUUID());mkdirSync(dir,{recursive:true});
const file=join(dir,'fixture.sqlite'),backupDir=join(dir,'backups');
function deps(storage:Storage){
 const base=setup();storage.set('character',base.storage.character());base.storage.close();
 return {...base,storage,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),web:new WebSearchService(new WebSearchStore(storage),undefined,base.clock,{enabled:false})};
}
function raw(path:string){const db=new DatabaseSync(path,{readOnly:true});try{return {runtime:JSON.parse(String(db.prepare("SELECT data FROM state WHERE key='runtime'").get()!.data)),steps:db.prepare('SELECT data FROM environment_steps ORDER BY rowid').all().map(x=>JSON.parse(String(x.data)))};}finally{db.close();}}
async function main(){
 const d=deps(new Storage(file));d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:1,nextEnvironmentAt:null,paused:true,lastError:'preserved'});
 const batch=ensureEnvironmentBatch(d.storage,d.config,NOW)!;const [world,campus,group,week]=d.environmentStore.steps(batch.id);
 d.environmentStore.saveStep({...world,status:'ready',attempt:2,inputSnapshot:environmentInput(d,world),frozenResult:{stage:'world',changes:[]}});
 d.environmentStore.saveStep({...campus,status:'running',attempt:3,inputSnapshot:environmentInput(d,campus)});
 d.environmentStore.saveStep({...group,status:'pending',attempt:1,inputSnapshot:environmentInput(d,group),retryAt:NOW});
 const beforeRuntime=d.storage.runtime(),beforeSteps=d.environmentStore.steps(batch.id);d.storage.close();
 const beforeBytes=readFileSync(file);assert.equal(inspectEnvironmentAsyncUpgrade(file).canUpgrade,true);assert.deepEqual(readFileSync(file),beforeBytes);
 assert.throws(()=>upgradeEnvironmentAsync(file,{stopped:false,backupDir}),/Stop/);
 const up=upgradeEnvironmentAsync(file,{stopped:true,backupDir});assert.equal(up.version,2);assert.ok(up.backupPaths.length>0);
 assert.deepEqual(raw(up.backupPaths[0]),{runtime:beforeRuntime,steps:beforeSteps});
 const migrated=raw(file);assert.deepEqual(migrated.runtime,{...beforeRuntime,environmentPlanningVersion:2});assert.deepEqual(migrated.steps.map(s=>s.preparationVersion),[0,0,0,1]);
 assert.deepEqual(migrated.steps.map(({preparationVersion,...s})=>s),beforeSteps);
 const afterBytes=readFileSync(file);assert.deepEqual(upgradeEnvironmentAsync(file,{stopped:true,backupDir}).backupPaths,[]);assert.deepEqual(readFileSync(file),afterBytes);
 assert.equal(inspectEnvironmentAsyncUpgrade(file,1).canUpgrade,false);
 assert.throws(()=>upgradeEnvironmentAsync(file,{stopped:true,backupDir,targetVersion:1}),/nonterminal/);
 const recovered=deps(new Storage(file));let calls:string[]=[];
 const generate=async(input:any):Promise<EnvironmentModelResult>=>{calls.push(input.stage);assert.deepEqual(input,beforeSteps.find(s=>s.stage===input.stage)!.inputSnapshot);return {stage:input.stage,planChanges:[],itemChanges:[]};};
 for(const step of migrated.steps)await runEnvironmentStep(recovered,step.id,generate);
 assert.deepEqual(calls,['school_campus','school_group']);assert.ok(recovered.environmentStore.steps(batch.id).every(s=>s.status==='committed'));recovered.storage.close();
 const down=upgradeEnvironmentAsync(file,{stopped:true,backupDir,targetVersion:1});assert.equal(down.version,1);
 const contracts=[];
 for(const version of [0,1] as const){
  const wd=deps(new Storage(':memory:'));wd.storage.set('runtime',{...wd.storage.runtime(),environmentPlanningVersion:1,nextEnvironmentAt:null});
  const wb=ensureEnvironmentBatch(wd.storage,wd.config,NOW)!;for(const step of wd.environmentStore.steps(wb.id))if(step.stage!=='school_week')wd.environmentStore.saveStep({...step,status:'committed'});
  const ws=wd.environmentStore.steps(wb.id).find(s=>s.stage==='school_week')!;
  const input={...environmentInput(wd,ws),modelContractVersion:version};wd.environmentStore.saveStep({...ws,status:'running',preparationVersion:0,attempt:4,inputSnapshot:input});
  await runEnvironmentStep(wd,ws.id,async got=>{assert.equal(got.modelContractVersion,version);return {stage:'school_week',instanceChanges:[],noticeCandidates:[],weekChanges:[]};});
  assert.equal(wd.environmentStore.step(ws.id)!.status,'committed');assert.equal(wd.environmentStore.step(ws.id)!.attempt,4);contracts.push(version);wd.storage.close();
 }
 const output={passed:true,checks:['check read-only','stopped required','backup round-trip old runtime and steps','markers 0/0/0/1','runtime preserved','repeated apply inert','unfinished async downgrade rejected','mixed old-ready/running/retry plus new-week completion','terminal downgrade','legacy week model contract 0 and 1'],calls,contracts,dir};
 writeFileSync(join(dir,'result.json'),JSON.stringify(output,null,2));console.log(JSON.stringify(output,null,2));
}
void main();
