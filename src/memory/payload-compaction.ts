import type {StatementSync} from 'node:sqlite';
export interface PayloadConnection {prepare(sql:string):StatementSync}
export interface CompletedPayloadCompactionReport {limit:number;updated:{indexJobs:number;maintenanceJobs:number;postJobs:number;webSessions:number};totalUpdated:number;hasMore:boolean}
const indexResidual="COALESCE(json_extract(data,'$.text'),'')<>'' OR json_extract(data,'$.result') IS NOT NULL";
const maintenanceResidual="COALESCE(json_array_length(data,'$.snapshot'),0)>0 OR COALESCE(json_array_length(data,'$.readSet'),0)>0 OR json_extract(data,'$.result') IS NOT NULL";
export const webCheckpointIndex="CREATE INDEX IF NOT EXISTS web_checkpoint_residual ON web_sessions(json_extract(data,'$.ref.ownerType'),json_extract(data,'$.ref.ownerId'),id) WHERE json_extract(data,'$.checkpoint') IS NOT NULL";
const specs=[
 {table:'memory_index_jobs',key:'indexJobs',where:`json_extract(data,'$.status')='done' AND (${indexResidual})`,set:"json_remove(json_set(data,'$.text',''),'$.result')"},
 {table:'memory_maintenance_jobs',key:'maintenanceJobs',where:`json_extract(data,'$.status')='done' AND (${maintenanceResidual})`,set:"json_set(data,'$.snapshot',json('[]'),'$.readSet',json('[]'),'$.result',NULL)"},
 {table:'post_jobs',key:'postJobs',where:"json_extract(data,'$.result') IS NOT NULL AND EXISTS(SELECT 1 FROM turns WHERE turns.id=post_jobs.id AND json_extract(turns.data,'$.done')=1)",set:"json_set(data,'$.result',NULL)"},
 {table:'web_sessions',key:'webSessions',where:`json_extract(data,'$.checkpoint') IS NOT NULL AND (
 (json_extract(data,'$.ref.ownerType')='turn' AND EXISTS(SELECT 1 FROM turns WHERE turns.id=json_extract(web_sessions.data,'$.ref.ownerId') AND json_extract(turns.data,'$.done')=1)) OR
 (json_extract(data,'$.ref.ownerType')='environment' AND EXISTS(SELECT 1 FROM environment_steps WHERE environment_steps.id=json_extract(web_sessions.data,'$.ref.ownerId') AND json_extract(environment_steps.data,'$.status') IN ('committed','superseded'))) OR
 (json_extract(data,'$.ref.ownerType')='maintenance' AND EXISTS(SELECT 1 FROM memory_maintenance_jobs WHERE memory_maintenance_jobs.id=json_extract(web_sessions.data,'$.ref.ownerId') AND json_extract(memory_maintenance_jobs.data,'$.status')='done'))
 )`,set:"json_set(data,'$.checkpoint',NULL)"},
] as const;
const tables=(db:PayloadConnection)=>new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
export function installPayloadIndexes(db:PayloadConnection):void{
 const present=tables(db);
 for(const s of specs.slice(0,2))if(present.has(s.table))db.prepare(`CREATE INDEX IF NOT EXISTS ${s.table}_residual ON ${s.table}(id) WHERE ${s.where}`).run();
 if(present.has('post_jobs'))db.prepare("CREATE INDEX IF NOT EXISTS post_payload_residual ON post_jobs(id) WHERE json_extract(data,'$.result') IS NOT NULL").run();
 if(present.has('web_sessions'))db.prepare(webCheckpointIndex).run();
}
export function countCompletedPayloads(db:PayloadConnection):CompletedPayloadCompactionReport['updated']{
 const present=tables(db),counts={indexJobs:0,maintenanceJobs:0,postJobs:0,webSessions:0};
 for(const s of specs)if(present.has(s.table))counts[s.key]=Number(db.prepare(`SELECT count(*) n FROM ${s.table} WHERE ${s.where}`).get()!.n);
 return counts;
}
export function compactCompletedPayloads(db:PayloadConnection,limit=50):CompletedPayloadCompactionReport{
 if(!Number.isInteger(limit)||limit<=0)throw Error('payload compaction limit must be a positive integer');
 const present=tables(db),updated={indexJobs:0,maintenanceJobs:0,postJobs:0,webSessions:0};let totalUpdated=0;
 for(const s of specs){if(!present.has(s.table)||totalUpdated===limit)continue;
  const result=db.prepare(`UPDATE ${s.table} SET data=${s.set} WHERE id IN (SELECT id FROM ${s.table} WHERE ${s.where} ORDER BY id LIMIT ?) AND ${s.where}`).run(limit-totalUpdated);
  updated[s.key]=Number(result.changes);totalUpdated+=updated[s.key];
 }
 const hasMore=specs.some(s=>present.has(s.table)&&!!db.prepare(`SELECT 1 FROM ${s.table} WHERE ${s.where} LIMIT 1`).get());
 return {limit,updated,totalUpdated,hasMore};
}
