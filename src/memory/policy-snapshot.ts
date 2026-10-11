import type {Storage} from '../storage';
import type {MemoryCandidate} from './types';
import {trimWhitespace} from './metadata';

export interface MemoryPolicyRow extends Pick<MemoryCandidate,
 'id'|'ownerId'|'kind'|'ownerType'|'status'|'importance'|'createdAt'|'happenedAt'|'lastEventUpdateAt'|
 'mergedInto'|'shortExpiresAt'|'linkedLongId'|'retainedFrom'|'expiresAt'|'canonicalMemoryId'|
 'totalAwakenings'|'revision'|'stateVersion'|'consolidatedRevision'|'evaluatedEvidenceVersion'|'learnedKind'|'summaryRepairBasis'> {
 table:'memories'|'details'|'learned_background';
 capacityExitedAt:string|null;
 capacityExitReason:'short_capacity'|'long_capacity'|null;
 archiveEnteredAt:string|null;
 evidenceMemoryIds:string[];
 hasContent:boolean;
 hasSources:boolean;
}
export interface MemoryPolicySnapshot {
 rows:MemoryPolicyRow[];
 byOwner:Map<string,MemoryPolicyRow>;
 legacyById:Map<string,MemoryPolicyRow>;
 memoryById:Map<string,MemoryPolicyRow>;
 learnedById:Map<string,MemoryPolicyRow>;
}
const tables=['memories','details','learned_background'] as const;
const fields=['status','mergedInto','importance','createdAt','happenedAt','lastEventUpdateAt','shortExpiresAt','linkedLongId','retainedFrom','expiresAt','capacityExitedAt','capacityExitReason','archiveEnteredAt','canonicalMemoryId','totalAwakenings','revision','stateVersion','consolidatedRevision','evaluatedEvidenceVersion','learnedKind','summaryRepairBasis'] as const;
const ownerKey=(row:Pick<MemoryPolicyRow,'ownerType'|'ownerId'>)=>`${row.ownerType}:${row.ownerId}`;

// A policy row carries predicates, never shortened or placeholder owner text.
export function policyRow(owner:MemoryCandidate,table:MemoryPolicyRow['table']):MemoryPolicyRow {
 return {
  table,id:owner.ownerId,ownerId:owner.ownerId,kind:owner.kind,ownerType:owner.ownerType,
  status:owner.status,importance:owner.importance,createdAt:owner.createdAt,happenedAt:owner.happenedAt,lastEventUpdateAt:owner.lastEventUpdateAt,
  mergedInto:owner.mergedInto,shortExpiresAt:owner.shortExpiresAt,linkedLongId:owner.linkedLongId,retainedFrom:owner.retainedFrom,expiresAt:owner.expiresAt,
  capacityExitedAt:owner.capacityExitedAt??null,capacityExitReason:owner.capacityExitReason??null,archiveEnteredAt:owner.archiveEnteredAt??null,
  canonicalMemoryId:owner.canonicalMemoryId,totalAwakenings:owner.totalAwakenings,revision:owner.revision,stateVersion:owner.stateVersion,
  consolidatedRevision:owner.consolidatedRevision,evaluatedEvidenceVersion:owner.evaluatedEvidenceVersion,learnedKind:owner.learnedKind,summaryRepairBasis:owner.summaryRepairBasis,
  evidenceMemoryIds:[...owner.evidenceMemoryIds??[]],hasContent:(owner.content??owner.value??'').trim().length>0,hasSources:owner.sourceIds.length>0,
 };
}
type SqlPolicyRow=Omit<MemoryPolicyRow,'table'|'ownerId'|'evidenceMemoryIds'|'hasContent'|'hasSources'>&{evidenceMemoryIds:string|null;hasContent:number;hasSources:number};
export function readMemoryPolicySnapshot(db:Pick<Storage,'prepare'>):MemoryPolicySnapshot {
 const available=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
 const rows=tables.filter(table=>available.has(table)).flatMap(table=>{
  const defaultKind=table==='details'?'detail':table==='learned_background'?'learned':'long';
  const columns=fields.map(field=>`json_extract(data,'$.${field}') AS ${field}`).join(',');
  // Text comparison handles embedded NULs, which SQLite length() truncates.
  const result=db.prepare(`SELECT id,COALESCE(json_extract(data,'$.kind'),'${defaultKind}') AS kind,COALESCE(json_extract(data,'$.ownerType'),'${defaultKind}') AS ownerType,${columns},json_extract(data,'$.evidenceMemoryIds') AS evidenceMemoryIds,CASE WHEN json_array_length(data,'$.sourceIds')>0 THEN 1 ELSE 0 END AS hasSources,CASE WHEN trim(COALESCE(json_extract(data,'$.content'),json_extract(data,'$.value'),''),?)<>'' THEN 1 ELSE 0 END AS hasContent FROM ${table} ORDER BY id`).all(trimWhitespace) as unknown as SqlPolicyRow[];
  return result.map(raw=>({
   ...raw,table,id:String(raw.id),ownerId:String(raw.id),
   capacityExitedAt:raw.capacityExitedAt??null,capacityExitReason:raw.capacityExitReason??null,archiveEnteredAt:raw.archiveEnteredAt??null,
   canonicalMemoryId:raw.canonicalMemoryId??undefined,learnedKind:raw.learnedKind??undefined,summaryRepairBasis:raw.summaryRepairBasis??undefined,
   evidenceMemoryIds:raw.evidenceMemoryIds?JSON.parse(raw.evidenceMemoryIds) as string[]:[],hasContent:!!raw.hasContent,hasSources:!!raw.hasSources,
  }));
 });
 return {
  rows,byOwner:new Map(rows.map(row=>[ownerKey(row),row])),legacyById:new Map(rows.map(row=>[row.id,row])),
  memoryById:new Map(rows.filter(row=>row.table==='memories').map(row=>[row.id,row])),
  learnedById:new Map(rows.filter(row=>row.table==='learned_background').map(row=>[row.id,row])),
 };
}
export function replacePolicyRow(snapshot:MemoryPolicySnapshot,owner:MemoryCandidate):void {
 const key=ownerKey(owner),old=snapshot.byOwner.get(key);
 if(!old)throw new Error(`policy snapshot has no owner ${key}`);
 const row=policyRow(owner,old.table);
 snapshot.rows[snapshot.rows.indexOf(old)]=row;snapshot.byOwner.set(key,row);
 if(old.table==='memories')snapshot.memoryById.set(row.id,row);
 if(old.table==='learned_background')snapshot.learnedById.set(row.id,row);
 // Updating an earlier pool must not replace a later pool's same-ID winner.
 if(snapshot.legacyById.get(row.id)===old)snapshot.legacyById.set(row.id,row);
}
export function policyCanonical(snapshot:MemoryPolicySnapshot,id:string,mode:'metadata'|'owner'):MemoryPolicyRow|null {
 const next=mode==='metadata'?snapshot.legacyById:snapshot.memoryById;
 let row=mode==='metadata'?next.get(id):snapshot.memoryById.get(id)??snapshot.learnedById.get(id);
 if(row?.canonicalMemoryId)row=next.get(row.canonicalMemoryId);
 while(row?.mergedInto)row=next.get(row.mergedInto);
 return row?.kind==='long'?row:null;
}
