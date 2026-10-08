import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {environmentTables,type Storage} from '../storage';
import type {Runtime,TurnRecord,EnvironmentEvent} from '../types';
import type {SchoolPlan,SchoolPlanItem,SchoolInstance} from '../school/types';
import {batchIdentity,localDate,nextEnvironmentDate} from '../environment/scheduler';
import {environmentStages,type EnvironmentBatch,type EnvironmentStep} from '../environment/types';
import {localParts,localTime,milliseconds} from '../time';
export interface EnvironmentUpgradeReport {
 version:number|null;legacySchoolEventCount:number;
 legacyEnvironmentTurns:{id:string;kind:string;frozen:boolean;outputComplete:boolean}[];
 unexpectedEnvironmentOutbox:{turnId:string;seq:number;status:string}[];
 unfinishedForegroundTurnIds:string[];paused:boolean;canUpgrade:boolean;reasons:string[];backupPaths:string[];
}
export interface EnvironmentUpgradeOptions {stopped:boolean;backupDir:string;timezone:string;environmentDailyAt:string;now:string}
export function inspectEnvironmentUpgrade(databasePath:string):EnvironmentUpgradeReport {
 const db=new DatabaseSync(databasePath,{readOnly:true});
 try{
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
  const rows=<T>(table:string):T[]=>tables.has(table)?db.prepare(`SELECT data FROM ${table} ORDER BY rowid`).all().map(r=>JSON.parse(String(r.data))):[];
  const row=tables.has('state')?db.prepare("SELECT data FROM state WHERE key='runtime'").get():null,runtime=row?JSON.parse(String(row.data)) as Runtime:null;
  const version=runtime?.environmentPlanningVersion??null,turns=rows<TurnRecord>('turns'),legacy=turns.filter(t=>!t.done&&t.environmentKind&&t.legacyDisposition!=='superseded');
  const unexpectedEnvironmentOutbox=rows<{turnId:string;seq:number;status:string}>('outbox').filter(o=>legacy.some(t=>t.id===o.turnId)).map(o=>({turnId:o.turnId,seq:o.seq,status:o.status}));
  const reasons:string[]=[];if(!runtime)reasons.push('missing runtime');if(version!==null&&version!==1)reasons.push(`unsupported version ${version}`);if(unexpectedEnvironmentOutbox.length)reasons.push('unexpected legacy environment outbox requires investigation');
  return {version,legacySchoolEventCount:rows<EnvironmentEvent>('events').filter(e=>e.kind==='school').length,legacyEnvironmentTurns:legacy.map(t=>({id:t.id,kind:t.environmentKind!,frozen:!!t.frozenResult,outputComplete:t.outputComplete})),unexpectedEnvironmentOutbox,unfinishedForegroundTurnIds:turns.filter(t=>!t.done&&!t.environmentKind&&t.legacyDisposition!=='superseded').map(t=>t.id),paused:runtime?.paused??false,canUpgrade:version===null&&!reasons.length,reasons,backupPaths:[]};
 }finally{db.close();}
}
export function legacySchoolRecords(events:EnvironmentEvent[],now:string,timezone:string):{plans:SchoolPlan[];items:SchoolPlanItem[];instances:SchoolInstance[]} {
 const school=events.filter(e=>e.kind==='school');if(!school.length)return {plans:[],items:[],instances:[]};
 const plan:SchoolPlan={id:'legacy-school',owner:'campus',kind:'semester',title:'既有学校记录',startsOn:school.map(e=>localDate(e.startsAt,timezone)).sort()[0],endsOn:null,summary:'已提交旧学校事件导入，保留引用与历史；不证明角色已知。',revision:1,status:'active'};
 const items:SchoolPlanItem[]=school.map(e=>{const past=milliseconds(e.endsAt??e.startsAt)<milliseconds(now);return {id:`legacy-item:${e.id}`,planId:plan.id,owner:'campus',kind:'legacy',title:e.description,description:e.description,location:'',requirement:'optional',issuedAt:now,timing:{kind:'once',startsAt:e.startsAt,endsAt:e.endsAt},noticePolicy:{announceOnIssue:!past&&e.status==='active',announceOnChange:!past&&e.status==='active',reminders:[]},revision:1,deliveryRevision:1,status:e.status==='cancelled'?'cancelled':past?'closed':'open',basis:e.basis,sourceUrls:e.sourceUrls};});
 const instances:SchoolInstance[]=school.map((e,index)=>({id:e.id,sourceItemId:items[index].id,sourceRevision:1,deliveryRevision:1,occurrenceKey:JSON.stringify([items[index].id,'once']),weekStart:null,startsAt:e.startsAt,endsAt:e.endsAt,sourceSnapshot:items[index],status:e.status==='cancelled'?'cancelled':milliseconds(e.endsAt??e.startsAt)<milliseconds(now)?'archived':'active',needsExpansion:false,legacyEventId:e.id}));
 return {plans:[plan],items,instances};
}
export function importLegacySchoolEvents(storage:Storage,now:string,timezone:string):void {
 const records=legacySchoolRecords(storage.all('events'),now,timezone);
 for(const p of records.plans)if(!storage.read('school_plans',p.id))storage.save('school_plans',p.id,p);
 for(const i of records.items)if(!storage.read('school_plan_items',i.id))storage.save('school_plan_items',i.id,i);
 for(const i of records.instances)if(!storage.read('school_instances',i.id))storage.save('school_instances',i.id,i);
}
export function upgradeEnvironment(databasePath:string,options:EnvironmentUpgradeOptions):EnvironmentUpgradeReport {
 if(!options.stopped)throw Error('Stop HDSI and supply --stopped before environment upgrade');
 const before=inspectEnvironmentUpgrade(databasePath);if(before.version===1)return before;if(!before.canUpgrade)throw Error(before.reasons.join('; '));
 const backup=join(options.backupDir,`environment-${options.now.replace(/[^\d]/g,'')}-${randomUUID()}`);mkdirSync(backup,{recursive:true});const backupPaths:string[]=[];
 for(const suffix of ['','-wal','-shm'])if(existsSync(databasePath+suffix)){const target=join(backup,basename(databasePath)+suffix);copyFileSync(databasePath+suffix,target);backupPaths.push(target);}
 const db=new DatabaseSync(databasePath);
 try{db.exec('BEGIN IMMEDIATE');try{
  for(const table of environmentTables)db.exec(`CREATE TABLE IF NOT EXISTS ${table}(id TEXT PRIMARY KEY,data TEXT NOT NULL)`);
  const save=(table:string,id:string,data:unknown)=>db.prepare(`INSERT INTO ${table}(id,data) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data`).run(id,JSON.stringify(data));
  const records=legacySchoolRecords(db.prepare('SELECT data FROM events ORDER BY rowid').all().map(r=>JSON.parse(String(r.data))),options.now,options.timezone);
  records.plans.forEach(r=>save('school_plans',r.id,r));records.items.forEach(r=>save('school_plan_items',r.id,r));records.instances.forEach(r=>save('school_instances',r.id,r));
  const date=localDate(options.now,options.timezone),id=batchIdentity(date,options.timezone),p=localParts(options.now,options.timezone),[h,m]=options.environmentDailyAt.split(':').map(Number);
  const previous=db.prepare('SELECT data FROM environment_batches WHERE id=?').get(id);
  if(!previous){const batch:EnvironmentBatch={id,localDate:date,timezone:options.timezone,scheduledAt:localTime(p.year,p.month,p.day,h*60+m,options.timezone),createdAt:options.now,reason:'upgrade',status:'active',closedAt:null};save('environment_batches',id,batch);
   for(const stage of environmentStages){const step:EnvironmentStep={id:JSON.stringify([id,stage]),batchId:id,stage,status:'pending',attempt:0,startedAt:null,completedAt:null,retryAt:null,lastError:null,inputSnapshot:null,frozenResult:null};save('environment_steps',step.id,step);}}
  for(const row of db.prepare('SELECT data FROM turns ORDER BY rowid').all()){const t=JSON.parse(String(row.data)) as TurnRecord;if(!t.done&&t.environmentKind&&t.legacyDisposition!=='superseded')save('turns',t.id,{...t,legacyDisposition:'superseded',closedAt:options.now,replacementBatchId:id});}
  const row=db.prepare("SELECT data FROM state WHERE key='runtime'").get()!,runtime=JSON.parse(String(row.data));db.prepare("UPDATE state SET data=? WHERE key='runtime'").run(JSON.stringify({...runtime,environmentPlanningVersion:1,nextEnvironmentAt:nextEnvironmentDate(options.now,options.timezone,options.environmentDailyAt),nextWorldAt:null,nextSchoolAt:null}));
  db.exec('COMMIT');
 }catch(error){db.exec('ROLLBACK');throw error;}}finally{db.close();}
 return {...inspectEnvironmentUpgrade(databasePath),backupPaths};
}
