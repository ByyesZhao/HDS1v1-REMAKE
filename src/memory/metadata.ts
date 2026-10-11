import type {Storage} from '../storage';
import {memoryOwnerData,type MemoryCandidate} from './types';
// ECMAScript String.trim whitespace, also used by the full owner/contract checks.
export const trimWhitespace=String.fromCodePoint(9,10,11,12,13,32,160,5760,...Array.from({length:11},(_,i)=>8192+i),8232,8233,8239,8287,12288,65279);
// Counts, scheduling and inspection must not hydrate memory text or historical model inputs.
export function memoryMetadata(db:Pick<Storage,'prepare'>):MemoryCandidate[] {
  const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
  const fields=['status','mergedInto','importance','createdAt','happenedAt','lastEventUpdateAt','shortExpiresAt','linkedLongId','retainedFrom','expiresAt','capacityExitedAt','capacityExitReason','archiveEnteredAt','canonicalMemoryId','totalAwakenings','revision','stateVersion','consolidatedRevision','evaluatedEvidenceVersion','learnedKind','summaryRepairBasis'];
  return ['memories','details','learned_background'].filter(t=>tables.has(t)).flatMap(table=>{
    const defaultKind=table==='details'?'detail':table==='learned_background'?'learned':'long';
    const columns=fields.map(f=>`json_extract(data,'$.${f}') AS ${f}`).join(',');
    return db.prepare(`SELECT id,COALESCE(json_extract(data,'$.kind'),'${defaultKind}') AS kind,COALESCE(json_extract(data,'$.ownerType'),'${defaultKind}') AS ownerType,${columns},json_extract(data,'$.evidenceMemoryIds') AS evidenceMemoryIds,json_array_length(data,'$.sourceIds') AS sourceCount,CASE WHEN length(trim(COALESCE(json_extract(data,'$.content'),json_extract(data,'$.value'),''),?))>0 THEN 1 ELSE 0 END AS hasContent FROM ${table} ORDER BY id`).all(trimWhitespace).map(raw=>memoryOwnerData({...raw,id:String(raw.id),ownerId:String(raw.id),content:raw.hasContent?'present':'',sourceIds:raw.sourceCount?['present']:[],topics:[],eventSummary:'',feelingSummary:'',evidenceMemoryIds:raw.evidenceMemoryIds?JSON.parse(String(raw.evidenceMemoryIds)):[]} as unknown as MemoryCandidate));
  });
}
export function metadataCanonical(rows:MemoryCandidate[],id:string):MemoryCandidate|null {
  const byId=new Map(rows.map(r=>[r.id,r]));let row=byId.get(id);
  if(row?.canonicalMemoryId)row=byId.get(row.canonicalMemoryId);
  while(row?.mergedInto)row=byId.get(row.mergedInto);
  return row?.kind==='long'?row:null;
}
