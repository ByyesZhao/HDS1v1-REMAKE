import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {EnvironmentStep} from '../environment/types';
export interface EnvironmentAsyncUpgradeReport {version:number|null;targetVersion:1|2;legacyUnfinished:number;unstarted:number;asyncUnfinished:number;canUpgrade:boolean;reasons:string[];backupPaths:string[]}
function hasStartedPreparation(step:EnvironmentStep):boolean{return !!step.inputSnapshot||step.status==='running'||step.status==='ready'||step.attempt>0;}
export function inspectEnvironmentAsyncUpgrade(path:string,targetVersion:1|2=2):EnvironmentAsyncUpgradeReport{
 const db=new DatabaseSync(path,{readOnly:true});
 try{
 const row=db.prepare("SELECT data FROM state WHERE key='runtime'").get(),runtime=row?JSON.parse(String(row.data)):null;
 const version=runtime?.environmentPlanningVersion??null;
 const exists=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='environment_steps'").get();
 const steps=(exists?db.prepare('SELECT data FROM environment_steps').all():[]).map(r=>JSON.parse(String(r.data)) as EnvironmentStep);
 const unfinished=steps.filter(s=>s.status!=='committed'&&s.status!=='superseded');
 const asyncUnfinished=unfinished.filter(s=>s.preparationVersion===1).length;
 const reasons:string[]=[];
 if(version!==1&&version!==2)reasons.push('requires environment version 1 or 2; run the legacy environment migration first');
 if(targetVersion===1&&version===2&&asyncUnfinished)reasons.push('nonterminal asynchronous steps must complete or be superseded before downgrade');
 return {version,targetVersion,legacyUnfinished:unfinished.filter(s=>s.preparationVersion===0||s.preparationVersion===undefined&&hasStartedPreparation(s)).length,unstarted:unfinished.filter(s=>s.status==='pending'&&!s.inputSnapshot&&!s.attempt).length,asyncUnfinished,canUpgrade:!reasons.length,reasons,backupPaths:[]};
 }finally{db.close();}
}
export function upgradeEnvironmentAsync(path:string,options:{stopped:boolean;backupDir:string;targetVersion?:1|2}):EnvironmentAsyncUpgradeReport{
 if(!options.stopped)throw Error('Stop HDSI and supply --stopped before migration');
 const target=options.targetVersion??2,before=inspectEnvironmentAsyncUpgrade(path,target);
 if(!before.canUpgrade)throw Error(before.reasons.join('; '));
 if(before.version===target)return before;
 const backup=join(options.backupDir,'environment-async-'+randomUUID());mkdirSync(backup,{recursive:true});
 const backupPaths:string[]=[];for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix)){const to=join(backup,basename(path)+suffix);copyFileSync(path+suffix,to);backupPaths.push(to);}
 const db=new DatabaseSync(path);
 try{db.exec('BEGIN IMMEDIATE');try{
 if(target===2)for(const row of db.prepare('SELECT id,data FROM environment_steps').all()){
 const s=JSON.parse(String(row.data)) as EnvironmentStep;if(s.status==='committed'||s.status==='superseded')continue;
 const legacy=hasStartedPreparation(s);
 db.prepare('UPDATE environment_steps SET data=? WHERE id=?').run(JSON.stringify({...s,preparationVersion:legacy?0:1}),String(row.id));
 }
 const row=db.prepare("SELECT data FROM state WHERE key='runtime'").get()!,runtime=JSON.parse(String(row.data));
 db.prepare("UPDATE state SET data=? WHERE key='runtime'").run(JSON.stringify({...runtime,environmentPlanningVersion:target}));
 db.exec('COMMIT');
 }catch(e){db.exec('ROLLBACK');throw e;}}finally{db.close();}
 return {...inspectEnvironmentAsyncUpgrade(path,target),backupPaths};
}
