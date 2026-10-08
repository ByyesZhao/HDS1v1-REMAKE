import {addMs,milliseconds,localParts} from '../time';
import {MemoryStore} from './store';
import {memoryMetadata,metadataCanonical} from './metadata';
import type {CapacityResult,MemoryCandidate,MemoryCapacityConfig,MemoryCapacityCounts} from './types';
const day=86400000;
export function archiveStart(row:MemoryCandidate,now:string):string|null {
  if(row.kind!=='long'||row.status!=='active'||row.mergedInto)return null;
  return row.archiveEnteredAt??row.capacityExitedAt??(row.expiresAt&&milliseconds(row.expiresAt)<=milliseconds(now)?row.expiresAt:null);
}
export const isArchivedLong=(row:MemoryCandidate,now:string)=>archiveStart(row,now)!==null;
export const activeShort=(r:MemoryCandidate,now:string)=>r.kind==='short'&&r.status==='active'&&!r.mergedInto&&!r.capacityExitedAt&&!!r.shortExpiresAt&&milliseconds(r.shortExpiresAt)>milliseconds(now);
export const ordinaryLong=(r:MemoryCandidate)=>r.kind==='long'&&r.status==='active'&&!r.mergedInto;
export function protectedCanonicalIds(rows:MemoryCandidate[],now:string,includeRetainedShorts=false):Set<string> {
  const ids=new Set<string>();for(const r of rows){
    if(r.kind==='short'&&(activeShort(r,now)||includeRetainedShorts&&r.status==='active'&&!!r.shortExpiresAt&&milliseconds(r.shortExpiresAt)>milliseconds(now))&&r.linkedLongId){const l=metadataCanonical(rows,r.linkedLongId);if(l)ids.add(l.id);}
    if(r.kind==='learned'&&r.status==='active')for(const id of [r.canonicalMemoryId,...r.evidenceMemoryIds??[]]){if(id){const l=metadataCanonical(rows,id);if(l)ids.add(l.id);}}
  }return ids;
}
export function capacityCounts(rows:MemoryCandidate[],now:string,config:MemoryCapacityConfig):MemoryCapacityCounts {
  const occupied=rows.filter(r=>ordinaryLong(r)&&!isArchivedLong(r,now)),preview=occupied.filter(r=>!!r.retainedFrom&&milliseconds(r.retainedFrom)>milliseconds(now)).length;
  const shortActive=rows.filter(r=>activeShort(r,now)).length,longArchive=rows.filter(r=>isArchivedLong(r,now)).length,over=(n:number,limit:number|null)=>limit===null?0:Math.max(0,n-limit);
  return {shortActive,longOccupied:occupied.length,longPreview:preview,longVisible:occupied.length-preview,longArchive,protectedLong:protectedCanonicalIds(rows,now).size,shortOverflow:over(shortActive,config.shortActiveLimit),longOverflow:over(occupied.length,config.longActiveLimit),archiveOverflow:over(longArchive,config.longArchiveLimit)};
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
  protectedIds(now:string,includeRetainedShorts=false):Set<string> {
    return protectedCanonicalIds(memoryMetadata(this.store.storage),now,includeRetainedShorts);
  }
  counts(now:string):MemoryCapacityCounts {
    return capacityCounts(memoryMetadata(this.store.storage),now,this.config);
  }
  // A finite budget is used only for startup/backlog cleanup; story segment B normalizes its small delta.
  normalize(now:string,protectedLongIds:string[]=[],changeBudget=Infinity):CapacityResult {
    const changedOwners:MemoryCandidate[]=[],temporary=new Set(protectedLongIds),rows=this.store.allOwners();
    const shorts=rows.filter(r=>activeShort(r,now)).sort(activeOrder(this.store,now));
    let shortExcess=this.config.shortActiveLimit===null?0:Math.max(0,shorts.length-this.config.shortActiveLimit);
    for(const short of shorts){if(shortExcess<=0||changedOwners.length>=changeBudget)break;
      const long=short.linkedLongId?this.store.canonical(short.linkedLongId):null;if(!long||long.kind!=='long'||!long.content.trim())continue;
      const exited={...short,capacityExitedAt:now,capacityExitReason:'short_capacity' as const,stateVersion:short.stateVersion+1};this.store.saveOwner(exited);this.store.queueDirty(exited,'capacity',now);changedOwners.push(exited);shortExcess--;
      if(long.status==='active'&&!isArchivedLong(long,now)&&long.retainedFrom&&milliseconds(long.retainedFrom)>milliseconds(now)){
        const initial=this.store.listGrants(long.id).find(g=>g.kind==='initial');
        const others=this.store.listGrants(long.id).filter(g=>g.kind!=='initial');
        const expiry=[addMs(now,90*day),...others.map(g=>g.expiresAt)].sort((a,b)=>milliseconds(b)-milliseconds(a))[0];
        const promoted={...long,retainedFrom:now,expiresAt:expiry,stateVersion:long.stateVersion+1};this.store.saveOwner(promoted);this.store.queueDirty(promoted,'capacity',now);
        this.store.saveGrant({id:initial?.id??`${long.id}:initial`,canonicalMemoryId:long.id,kind:'initial',anchorAt:now,expiresAt:addMs(now,90*day),triggerDates:initial?.triggerDates??[]});changedOwners.push(promoted);
      }
      temporary.add(long.id);
    }
    const protectedIds=this.protectedIds(now);for(const id of temporary)protectedIds.add(id);
    const occupied=this.store.allOwners().filter(r=>ordinaryLong(r)&&!isArchivedLong(r,now));let longExcess=this.config.longActiveLimit===null?0:Math.max(0,occupied.length-this.config.longActiveLimit);
    for(const r of occupied.filter(r=>!protectedIds.has(r.id)).sort(activeOrder(this.store,now))){if(longExcess<=0||changedOwners.length>=changeBudget)break;
      const exited={...r,capacityExitedAt:now,capacityExitReason:'long_capacity' as const,archiveEnteredAt:now,stateVersion:r.stateVersion+1};this.store.saveOwner(exited);this.store.queueDirty(exited,'capacity',now);changedOwners.push(exited);longExcess--;
    }
    return {changedOwners:changedOwners.map(({ownerType,ownerId,revision,stateVersion})=>({ownerType,ownerId,revision,stateVersion})),temporaryProtectedIds:[...temporary],counts:this.counts(now)};
  }
  reactivate(id:string,at:string):void {
    const r=this.store.canonical(id);if(!r||!isArchivedLong(r,at))return;
    const parts=localParts(at,'Asia/Shanghai'),p=`${parts.year}-${String(parts.month).padStart(2,'0')}-${String(parts.day).padStart(2,'0')}`;
    const expiresAt=addMs(at,90*day);this.store.saveGrant({id:`${r.id}:reactivate:${p}`,canonicalMemoryId:r.id,kind:'reactivate',anchorAt:at,expiresAt,triggerDates:[p]});
    const updated={...r,capacityExitedAt:null,capacityExitReason:null,archiveEnteredAt:null,retainedFrom:r.retainedFrom&&milliseconds(r.retainedFrom)<milliseconds(at)?r.retainedFrom:at,expiresAt:r.expiresAt&&milliseconds(r.expiresAt)>milliseconds(expiresAt)?r.expiresAt:expiresAt,stateVersion:r.stateVersion+1};
    this.store.saveOwner(updated);this.store.queueDirty(updated,'awaken',at);
  }
}
