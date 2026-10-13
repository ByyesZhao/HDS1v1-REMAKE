import {createHash,randomUUID} from 'node:crypto';
import type {Storage} from '../storage';
import type {Clock} from '../types';
import type {ModelRunRef,WebModelCheckpoint,WebOwnerRef} from '../web/types';
export type CheckpointArchiveReason='completed'|'superseded'|'cancelled'|'compacted';
interface RecordBase {
 id:string;type:'failure'|'checkpoint';runId:string;taskName:string;stageKey?:string;
 ownerType?:ModelRunRef['ownerType'];ownerId?:string;occurredAt:string;
 retryCycle?:number;attemptId?:string;checkpoint?:WebModelCheckpoint;
}
export type ModelRunRecord=RecordBase&({type:'failure';invocationId:string;responseSequence:number;stage:string;category:string;error:string;rawResponse?:unknown}|{type:'checkpoint';reason:CheckpointArchiveReason;checkpoint:WebModelCheckpoint});
export type ModelRunFailure=Omit<Extract<ModelRunRecord,{type:'failure'}>,'id'|'occurredAt'|'type'>;
export class ModelRunHistory {
 constructor(private storage:Pick<Storage,'prepare'>,private clock:Clock){}
 append(record:ModelRunRecord):void {
  // Records are immutable. A retried write with the same identity is harmless.
  this.storage.prepare('INSERT INTO model_run_records(id,data) VALUES(?,?) ON CONFLICT(id) DO NOTHING').run(record.id,JSON.stringify(record));
 }
 recordFailure(record:ModelRunFailure):void {
  this.append({...record,type:'failure',id:`failure:${record.invocationId}:${record.responseSequence}:${record.category}`,occurredAt:this.clock.now()});
 }
 archiveCheckpoint(ref:ModelRunRef,checkpoint:WebModelCheckpoint,reason:CheckpointArchiveReason):void {
  const digest=createHash('sha256').update(JSON.stringify(checkpoint)).digest('hex');
  this.append({id:`checkpoint:${ref.runId}:${digest}:${reason}`,type:'checkpoint',runId:ref.runId,ownerType:ref.ownerType,ownerId:ref.ownerId,stageKey:ref.stageKey,taskName:ref.taskName,occurredAt:this.clock.now(),...checkpoint.executionAttempt,reason,checkpoint});
 }
 list(owner:WebOwnerRef):ModelRunRecord[] {
  if(!this.storage.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='model_run_records'").get())return [];
  return this.storage.prepare("SELECT data FROM model_run_records WHERE json_extract(data,'$.ownerType')=? AND json_extract(data,'$.ownerId')=? ORDER BY rowid").all(owner.ownerType,owner.ownerId).map(row=>JSON.parse(String(row.data)) as ModelRunRecord);
 }
}
/** SAVEPOINT works both inside an executor transaction and as an independent transaction. */
export function withModelHistorySavepoint<T>(storage:Pick<Storage,'prepare'>,fn:()=>T):T {
 const name='model_history_'+randomUUID().replaceAll('-','');storage.prepare(`SAVEPOINT ${name}`).run();
 try{const result=fn();storage.prepare(`RELEASE SAVEPOINT ${name}`).run();return result;}
 catch(error){storage.prepare(`ROLLBACK TO SAVEPOINT ${name}`).run();storage.prepare(`RELEASE SAVEPOINT ${name}`).run();throw error;}
}
/** Selection, archival and clearing share a transaction; legacy raw snapshots remain intact. */
export function archiveAndClearCheckpoints(storage:Pick<Storage,'prepare'>,history:ModelRunHistory,where:string,args:readonly (string|number)[],reason:CheckpointArchiveReason,limit?:number):number {
 return withModelHistorySavepoint(storage,()=>{
  const rows=storage.prepare(`SELECT id,json_extract(data,'$.ref') ref,json_extract(data,'$.checkpoint') checkpoint FROM web_sessions WHERE json_extract(data,'$.checkpoint') IS NOT NULL AND (${where}) ORDER BY id${limit===undefined?'':' LIMIT ?'}`).all(...args,...(limit===undefined?[]:[limit]));
  for(const row of rows){history.archiveCheckpoint(JSON.parse(String(row.ref)),JSON.parse(String(row.checkpoint)),reason);storage.prepare("UPDATE web_sessions SET data=json_set(data,'$.checkpoint',NULL) WHERE id=?").run(String(row.id));}
  return rows.length;
 });
}
