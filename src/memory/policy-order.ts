import type {Storage} from '../storage';
import {milliseconds} from '../time';
import {policyCanonical,type MemoryPolicyRow,type MemoryPolicySnapshot} from './policy-snapshot';

export function readLatestAwakeningTimes(db:Pick<Storage,'prepare'>,canonicalIds:readonly string[]):Map<string,number> {
 const ids=[...new Set(canonicalIds)],latest=new Map<string,number>();
 for(let offset=0;offset<ids.length;offset+=500){
  const batch=ids.slice(offset,offset+500);
  const rows=db.prepare(`SELECT canonicalMemoryId,firstEffectiveAt FROM memory_awakenings WHERE canonicalMemoryId IN (${batch.map(()=>'?').join(',')})`).all(...batch);
  for(const row of rows){const id=String(row.canonicalMemoryId),time=milliseconds(String(row.firstEffectiveAt));if(!latest.has(id)||time>latest.get(id)!)latest.set(id,time);}
 }
 return latest;
}
export interface MemoryOrderKey {importance:number;awakeningCount:number;decay:number;meaningfulMs:number;happenedMs:number;createdMs:number;id:string}
const ownerKey=(row:MemoryPolicyRow)=>`${row.ownerType}:${row.ownerId}`;
export function memoryOrderKeys(rows:readonly MemoryPolicyRow[],snapshot:MemoryPolicySnapshot,latest:ReadonlyMap<string,number>,now:string,canonicalMode:'metadata'|'owner'):Map<string,MemoryOrderKey> {
 const keys=new Map<string,MemoryOrderKey>(),nowMs=milliseconds(now);
 for(const row of rows){
  const canonical=row.kind==='short'?(row.linkedLongId?policyCanonical(snapshot,row.linkedLongId,canonicalMode):null):row;
  const meaningfulMs=Math.max(milliseconds(row.lastEventUpdateAt),canonical?latest.get(canonical.id)??-Infinity:-Infinity);
  keys.set(ownerKey(row),{importance:Number(row.importance==='high'),awakeningCount:row.kind==='short'?canonical?.totalAwakenings??0:row.totalAwakenings,
   decay:Math.max(0,Math.min(1,(nowMs-meaningfulMs)/((row.kind==='short'?7:90)*86400000))),meaningfulMs,happenedMs:milliseconds(row.happenedAt),createdMs:milliseconds(row.createdAt),id:row.id});
 }
 return keys;
}
const tie=(a:MemoryOrderKey,b:MemoryOrderKey)=>a.happenedMs-b.happenedMs||a.createdMs-b.createdMs||(a.id<b.id?-1:a.id>b.id?1:0);
export function activePolicyOrder(keys:ReadonlyMap<string,MemoryOrderKey>):(a:MemoryPolicyRow,b:MemoryPolicyRow)=>number {
 return (a,b)=>{const ka=keys.get(ownerKey(a))!,kb=keys.get(ownerKey(b))!;return ka.importance-kb.importance||ka.awakeningCount-kb.awakeningCount||kb.decay-ka.decay||ka.meaningfulMs-kb.meaningfulMs||tie(ka,kb);};
}
export function archivePolicyOrder(keys:ReadonlyMap<string,MemoryOrderKey>):(a:MemoryPolicyRow,b:MemoryPolicyRow)=>number {
 return (a,b)=>{const ka=keys.get(ownerKey(a))!,kb=keys.get(ownerKey(b))!;return ka.awakeningCount-kb.awakeningCount||ka.meaningfulMs-kb.meaningfulMs||ka.importance-kb.importance||tie(ka,kb);};
}
