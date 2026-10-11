import {isDeepStrictEqual} from 'node:util';
import type {PayloadConnection} from '../memory/payload-compaction';
import type {LegacyWebModelCheckpoint,LegacyWebOperationRecord,WebModelCheckpoint,WebOperationState,WebMaterial,WebSearchResponse,WebToolResultRef} from './types';
import {decodeCheckpoint,decodeOperation} from './persistence';

const residualCheckpoint="json_extract(data,'$.checkpoint') IS NOT NULL AND json_extract(data,'$.checkpoint.formatVersion') IS NULL";
const residualOperation="json_extract(data,'$.formatVersion') IS NULL";
function tables(db:PayloadConnection){return new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));}
function residualRuns(db:PayloadConnection,limit:number):string[]{
 const present=tables(db),queries:string[]=[];
 if(present.has('web_sessions'))queries.push(`SELECT id runId FROM web_sessions WHERE ${residualCheckpoint}`);
 if(present.has('web_operations'))queries.push(`SELECT json_extract(data,'$.runId') runId FROM web_operations WHERE ${residualOperation}`);
 return queries.length?db.prepare(queries.join(' UNION ')+' ORDER BY runId LIMIT ?').all(limit).map(r=>String(r.runId)):[];
}
function readRun(db:PayloadConnection,runId:string){
 const present=tables(db);
 const session=present.has('web_sessions')?db.prepare('SELECT data FROM web_sessions WHERE id=?').get(runId):undefined;
 const checkpoint=session?(JSON.parse(String(session.data)) as {checkpoint:LegacyWebModelCheckpoint|WebModelCheckpoint|null}).checkpoint:null;
 const operations=present.has('web_operations')?db.prepare("SELECT id,data FROM web_operations WHERE json_extract(data,'$.runId')=? ORDER BY rowid").all(runId).map(row=>({id:String(row.id),value:JSON.parse(String(row.data)) as LegacyWebOperationRecord|WebOperationState})):[];
 const materials=new Map<string,WebMaterial>();
 if(present.has('web_materials'))for(const row of db.prepare("SELECT json_extract(data,'$.material') material FROM web_materials WHERE json_extract(data,'$.runId')=?").all(runId)){const m=JSON.parse(String(row.material)) as WebMaterial;materials.set(m.id,m);}
 return {checkpoint,operations,materials};
}
function referenceIds(result:WebSearchResponse|WebToolResultRef):string[]{return 'materials' in result?result.materials.map(m=>m.id):result.materialIds;}
function results(run:ReturnType<typeof readRun>){return [...run.operations.flatMap(op=>op.value.response?[op.value.response]:[]),...run.checkpoint?.toolResults??[]];}
function missing(run:ReturnType<typeof readRun>):string[]{return [...new Set([...run.operations.flatMap(op=>op.value.materialIds),...results(run).flatMap(referenceIds)].filter(id=>!run.materials.has(id)))];}

/** Read-only preflight. Does not install indexes or rewrite legacy rows. */
export function inspectWebPayloads(db:PayloadConnection):{legacySessions:number;legacyOperations:number;invalidReferences:Array<{runId:string;materialId:string}>}{
 const present=tables(db),invalidReferences:Array<{runId:string;materialId:string}>=[];
 const legacySessions=present.has('web_sessions')?Number(db.prepare(`SELECT count(*) n FROM web_sessions WHERE ${residualCheckpoint}`).get()!.n):0;
 const legacyOperations=present.has('web_operations')?Number(db.prepare(`SELECT count(*) n FROM web_operations WHERE ${residualOperation}`).get()!.n):0;
 const runs=new Set<string>();
 if(present.has('web_sessions'))for(const row of db.prepare('SELECT id FROM web_sessions').all())runs.add(String(row.id));
 if(present.has('web_operations'))for(const row of db.prepare("SELECT DISTINCT json_extract(data,'$.runId') runId FROM web_operations").all())runs.add(String(row.runId));
 for(const runId of runs)for(const materialId of missing(readRun(db,runId)))invalidReferences.push({runId,materialId});
 return {legacySessions,legacyOperations,invalidReferences};
}

/** Caller owns the batch transaction so a failed run rolls back the entire batch. */
export function migrateWebPayloadBatch(db:PayloadConnection,limit=50):{sessionsVisited:number;operationsUpdated:number;checkpointsUpdated:number;hasMore:boolean}{
 if(!Number.isInteger(limit)||limit<=0||limit>50)throw Error('web migration limit must be a positive integer at most 50');
 const ids=residualRuns(db,limit);let operationsUpdated=0,checkpointsUpdated=0;
 for(const runId of ids){
  const run=readRun(db,runId),absent=missing(run);
  if(absent.length)throw Error(`web run ${runId}: missing material ${absent.join(', ')}`);
  for(const result of results(run))if('materials' in result)for(const material of result.materials)if(!isDeepStrictEqual(material,run.materials.get(material.id)))throw Error(`web run ${runId}: embedded material mismatch ${material.id}`);
  for(const {id,value} of run.operations){const decoded=decodeOperation(value);if(!('formatVersion' in value)){db.prepare('UPDATE web_operations SET data=? WHERE id=?').run(JSON.stringify(decoded),id);operationsUpdated++;}}
  if(run.checkpoint){const decoded=decodeCheckpoint(run.checkpoint);if(!('formatVersion' in run.checkpoint)){db.prepare("UPDATE web_sessions SET data=json_set(data,'$.checkpoint',json(?)) WHERE id=?").run(JSON.stringify(decoded),runId);checkpointsUpdated++;}}
 }
 return {sessionsVisited:ids.length,operationsUpdated,checkpointsUpdated,hasMore:residualRuns(db,1).length>0};
}
