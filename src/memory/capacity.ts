import {addMs,milliseconds,localParts} from '../time';
import {MemoryStore} from './store';
import {metadataCanonical} from './metadata';
import {readMemoryPolicySnapshot,policyCanonical,replacePolicyRow,type MemoryPolicyRow,type MemoryPolicySnapshot} from './policy-snapshot';
import {readLatestAwakeningTimes,memoryOrderKeys,activePolicyOrder} from './policy-order';
import type {CapacityResult,MemoryCandidate,MemoryCapacityConfig,MemoryCapacityCounts} from './types';
const day=86400000;
export type CapacityPolicyRow=Pick<MemoryCandidate,'kind'|'status'|'mergedInto'|'capacityExitedAt'|'archiveEnteredAt'|'expiresAt'|'shortExpiresAt'|'totalAwakenings'>;
export function archiveStart(row:CapacityPolicyRow,now:string):string|null {
  if(row.kind!=='long'||row.status!=='active'||row.mergedInto)return null;
  return row.archiveEnteredAt??row.capacityExitedAt??(row.expiresAt&&milliseconds(row.expiresAt)<=milliseconds(now)?row.expiresAt:null);
}
export const isArchivedLong=(row:CapacityPolicyRow,now:string)=>archiveStart(row,now)!==null;
export const activeShort=(r:CapacityPolicyRow,now:string)=>r.kind==='short'&&r.status==='active'&&!r.mergedInto&&!r.capacityExitedAt&&!!r.shortExpiresAt&&milliseconds(r.shortExpiresAt)>milliseconds(now);
export const ordinaryLong=(r:CapacityPolicyRow)=>r.kind==='long'&&r.status==='active'&&!r.mergedInto;
export const promotionEligible=(row:CapacityPolicyRow,at:string)=>ordinaryLong(row)&&row.totalAwakenings>=30&&!isArchivedLong(row,at);
export function protectedCanonicalIds(rows:MemoryCandidate[],now:string,includeRetainedShorts=false):Set<string> {
  const ids=new Set<string>();for(const r of rows){
    if(r.kind==='short'&&r.status==='active'&&!r.mergedInto&&r.linkedLongId){const l=metadataCanonical(rows,r.linkedLongId);if(l&&(activeShort(r,now)||includeRetainedShorts&&(!l.content.trim()||!!r.shortExpiresAt&&milliseconds(r.shortExpiresAt)>milliseconds(now))))ids.add(l.id);}
    if(r.kind==='learned'&&r.status==='active')for(const id of [r.canonicalMemoryId,...r.evidenceMemoryIds??[]]){if(id){const l=metadataCanonical(rows,id);if(l)ids.add(l.id);}}
  }return ids;
}
export function capacityCounts(rows:MemoryCandidate[],now:string,config:MemoryCapacityConfig):MemoryCapacityCounts {
  const occupied=rows.filter(r=>ordinaryLong(r)&&!isArchivedLong(r,now)),preview=occupied.filter(r=>!!r.retainedFrom&&milliseconds(r.retainedFrom)>milliseconds(now)).length;
  const shortActive=rows.filter(r=>activeShort(r,now)).length,longArchive=rows.filter(r=>isArchivedLong(r,now)).length,over=(n:number,limit:number|null)=>limit===null?0:Math.max(0,n-limit);
  return {shortActive,longOccupied:occupied.length,longPreview:preview,longVisible:occupied.length-preview,longArchive,protectedLong:protectedCanonicalIds(rows,now).size,shortOverflow:over(shortActive,config.shortActiveLimit),longOverflow:over(occupied.length,config.longActiveLimit),archiveOverflow:over(longArchive,config.longArchiveLimit)};
}
export function policyProtectedIds(snapshot:MemoryPolicySnapshot,now:string,includeRetainedShorts=false):Set<string> {
  const ids=new Set<string>();for(const row of snapshot.rows){
    if(row.kind==='short'&&row.status==='active'&&!row.mergedInto&&row.linkedLongId){const long=policyCanonical(snapshot,row.linkedLongId,'metadata');if(long&&(activeShort(row,now)||includeRetainedShorts&&(!long.hasContent||!!row.shortExpiresAt&&milliseconds(row.shortExpiresAt)>milliseconds(now))))ids.add(long.id);}
    if(row.kind==='learned'&&row.status==='active')for(const id of [row.canonicalMemoryId,...row.evidenceMemoryIds]){if(id){const long=policyCanonical(snapshot,id,'metadata');if(long)ids.add(long.id);}}
  }return ids;
}
export function policyCapacityCounts(snapshot:MemoryPolicySnapshot,now:string,config:MemoryCapacityConfig):MemoryCapacityCounts {
  const occupied=snapshot.rows.filter(row=>ordinaryLong(row)&&!isArchivedLong(row,now)),preview=occupied.filter(row=>!!row.retainedFrom&&milliseconds(row.retainedFrom)>milliseconds(now)).length;
  const shortActive=snapshot.rows.filter(row=>activeShort(row,now)).length,longArchive=snapshot.rows.filter(row=>isArchivedLong(row,now)).length,over=(n:number,limit:number|null)=>limit===null?0:Math.max(0,n-limit);
  return {shortActive,longOccupied:occupied.length,longPreview:preview,longVisible:occupied.length-preview,longArchive,protectedLong:policyProtectedIds(snapshot,now).size,shortOverflow:over(shortActive,config.shortActiveLimit),longOverflow:over(occupied.length,config.longActiveLimit),archiveOverflow:over(longArchive,config.longArchiveLimit)};
}
type PolicyReads=Pick<MemoryStore,'canonical'|'listAwakenings'>;
export function meaningfulAt(store:PolicyReads,r:MemoryCandidate):string {
  const long=r.kind==='short'&&r.linkedLongId?store.canonical(r.linkedLongId):r;
  return [r.lastEventUpdateAt,...(long?store.listAwakenings(long.id).map(a=>a.firstEffectiveAt):[])].sort((a,b)=>milliseconds(b)-milliseconds(a))[0];
}
export const awakeningCount=(store:PolicyReads,r:MemoryCandidate)=>r.kind==='short'?(r.linkedLongId?store.canonical(r.linkedLongId)?.totalAwakenings??0:0):r.totalAwakenings;
const tie=(a:MemoryCandidate,b:MemoryCandidate)=>milliseconds(a.happenedAt)-milliseconds(b.happenedAt)||milliseconds(a.createdAt)-milliseconds(b.createdAt)||(a.id<b.id?-1:a.id>b.id?1:0);
export function activeOrder(store:PolicyReads,now:string) {
  const decay=(r:MemoryCandidate)=>Math.max(0,Math.min(1,(milliseconds(now)-milliseconds(meaningfulAt(store,r)))/((r.kind==='short'?7:90)*day)));
  return (a:MemoryCandidate,b:MemoryCandidate)=>Number(a.importance==='high')-Number(b.importance==='high')||awakeningCount(store,a)-awakeningCount(store,b)||decay(b)-decay(a)||milliseconds(meaningfulAt(store,a))-milliseconds(meaningfulAt(store,b))||tie(a,b);
}
export const archiveOrder=(store:PolicyReads)=>(a:MemoryCandidate,b:MemoryCandidate)=>awakeningCount(store,a)-awakeningCount(store,b)||milliseconds(meaningfulAt(store,a))-milliseconds(meaningfulAt(store,b))||Number(a.importance==='high')-Number(b.importance==='high')||tie(a,b);
export class MemoryCapacity {
  constructor(public readonly store:MemoryStore,public readonly config:MemoryCapacityConfig){}
  protectedIds(now:string,includeRetainedShorts=false,snapshot?:MemoryPolicySnapshot):Set<string> {
    return policyProtectedIds(snapshot??readMemoryPolicySnapshot(this.store.storage),now,includeRetainedShorts);
  }
  counts(now:string,snapshot?:MemoryPolicySnapshot):MemoryCapacityCounts {
    return policyCapacityCounts(snapshot??readMemoryPolicySnapshot(this.store.storage),now,this.config);
  }
  // A finite budget is used only for startup/backlog cleanup; story segment B normalizes its small delta.
  normalize(now:string,protectedLongIds:string[]=[],changeBudget=Infinity,snapshot?:MemoryPolicySnapshot):CapacityResult {
    snapshot??=readMemoryPolicySnapshot(this.store.storage);
    const changedOwners:MemoryCandidate[]=[],temporary=new Set(protectedLongIds),hydrated=new Map<string,MemoryCandidate>();
    let counts=this.counts(now,snapshot);
    const result=():CapacityResult=>({changedOwners:changedOwners.map(({ownerType,ownerId,revision,stateVersion})=>({ownerType,ownerId,revision,stateVersion})),temporaryProtectedIds:[...temporary],counts});
    if((!counts.shortOverflow&&!counts.longOverflow)||changeBudget<=0)return result();
    const hydrate=(row:MemoryPolicyRow)=>{const key=`${row.ownerType}:${row.ownerId}`;let owner=hydrated.get(key);if(!owner){owner=this.store.owner(row)!;hydrated.set(key,owner);}return owner;};
    const save=(owner:MemoryCandidate)=>{this.store.saveOwner(owner);this.store.queueDirty(owner,'capacity',now);replacePolicyRow(snapshot!,owner);hydrated.set(`${owner.ownerType}:${owner.ownerId}`,owner);changedOwners.push(owner);};
    const order=(rows:MemoryPolicyRow[])=>{
      const ids=rows.flatMap(row=>row.kind==='short'?(row.linkedLongId?[policyCanonical(snapshot!,row.linkedLongId,'owner')?.id].filter((id):id is string=>!!id):[]):[row.id]);
      const latest=readLatestAwakeningTimes(this.store.storage,ids),keys=memoryOrderKeys(rows,snapshot!,latest,now,'owner');return rows.sort(activePolicyOrder(keys));
    };
    let shortExcess=counts.shortOverflow;
    if(shortExcess>0){
      const shorts=snapshot.rows.filter(row=>activeShort(row,now)&&!!row.linkedLongId&&!!policyCanonical(snapshot!,row.linkedLongId,'owner')?.hasContent);
      for(const row of order(shorts)){if(shortExcess<=0||changedOwners.length>=changeBudget)break;
        const longRow=policyCanonical(snapshot,row.linkedLongId!,'owner')!,short=hydrate(row);
        save({...short,capacityExitedAt:now,capacityExitReason:'short_capacity',stateVersion:short.stateVersion+1});shortExcess--;
        if(longRow.status==='active'&&!isArchivedLong(longRow,now)&&longRow.retainedFrom&&milliseconds(longRow.retainedFrom)>milliseconds(now)){
          const long=hydrate(longRow),grants=this.store.listGrants(long.id),initial=grants.find(grant=>grant.kind==='initial'),others=grants.filter(grant=>grant.kind!=='initial');
          const expiry=[addMs(now,90*day),...others.map(grant=>grant.expiresAt)].sort((a,b)=>milliseconds(b)-milliseconds(a))[0];
          save({...long,retainedFrom:now,expiresAt:expiry,stateVersion:long.stateVersion+1});
          this.store.saveGrant({id:initial?.id??`${long.id}:initial`,canonicalMemoryId:long.id,kind:'initial',anchorAt:now,expiresAt:addMs(now,90*day),triggerDates:initial?.triggerDates??[]});
        }
        temporary.add(longRow.id);
      }
      counts=this.counts(now,snapshot);
    }
    if(counts.longOverflow>0&&changedOwners.length<changeBudget){
      const protectedIds=this.protectedIds(now,false,snapshot);for(const id of temporary)protectedIds.add(id);
      const occupied=snapshot.rows.filter(row=>ordinaryLong(row)&&!isArchivedLong(row,now)&&!protectedIds.has(row.id));let longExcess=counts.longOverflow;
      for(const row of order(occupied)){if(longExcess<=0||changedOwners.length>=changeBudget)break;
        const owner=hydrate(row);save({...owner,capacityExitedAt:now,capacityExitReason:'long_capacity',archiveEnteredAt:now,stateVersion:owner.stateVersion+1});longExcess--;
      }
      counts=this.counts(now,snapshot);
    }
    return result();
  }
  reactivate(id:string,at:string):void {
    const r=this.store.canonical(id);if(!r||!isArchivedLong(r,at))return;
    const parts=localParts(at,'Asia/Shanghai'),p=`${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`;
    const expiresAt=addMs(at,90*day);this.store.saveGrant({id:`${r.id}:reactivate:${p}`,canonicalMemoryId:r.id,kind:'reactivate',anchorAt:at,expiresAt,triggerDates:[p]});
    const updated={...r,capacityExitedAt:null,capacityExitReason:null,archiveEnteredAt:null,retainedFrom:r.retainedFrom&&milliseconds(r.retainedFrom)<milliseconds(at)?r.retainedFrom:at,expiresAt:r.expiresAt&&milliseconds(r.expiresAt)>milliseconds(expiresAt)?r.expiresAt:expiresAt,stateVersion:r.stateVersion+1};
    this.store.saveOwner(updated);this.store.queueDirty(updated,'awaken',at);
  }
}
