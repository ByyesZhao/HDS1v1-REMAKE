import { addMs, milliseconds, localParts } from '../time';
import { MemoryStore,memoryIndexText } from './store';
import {MemoryCapacity,archiveStart,promotionEligible} from './capacity';
import type { AwakeningInput, MemoryCandidate, MemoryResultV3, RetentionGrant } from './types';

const day=86400_000;
const union=(...arrays:string[][])=>[...new Set(arrays.flat())];
const summary=(event:string,feeling:string)=>[event,feeling].filter(Boolean).join('\n');
function eventRange(rows:Array<{happenedAt:string;happenedUntil?:string}>){
  const earliest=rows.map(r=>r.happenedAt).sort((a,b)=>milliseconds(a)-milliseconds(b))[0];
  const latest=rows.flatMap(r=>[r.happenedAt,r.happenedUntil??r.happenedAt]).sort((a,b)=>milliseconds(b)-milliseconds(a))[0];
  return {happenedAt:earliest,happenedUntil:latest};
}
function requireSources(ids:string[],allowed:string[]) {if(!ids.length||ids.some(id=>!allowed.includes(id)))throw new Error('sourceIds: unknown or missing current source');}
export class MemoryLifecycle {
  constructor(public readonly store:MemoryStore,public readonly capacity?:MemoryCapacity){}
  apply(result:MemoryResultV3,turnId:string,at:string,allowedSources:string[],selfReads:string[]=[]):void {
    let createIndex=0;
    for(const change of result.shortTermChanges) {
      if(!change.eventSummary.trim()&&!change.feelingSummary.trim())throw new Error('summary: eventSummary or feelingSummary must be meaningful');
      requireSources(change.sourceIds,union(allowedSources,selfReads));
      if(change.action==='create') {
        const id=`${turnId}:short:${createIndex++}`;
        if(this.store.owner({ownerType:'short',ownerId:id}))continue;
        const existing=change.existingLongId?this.store.canonical(change.existingLongId):null;
        if(change.existingLongId&&(!existing||existing.kind!=='long'))throw new Error('existingLongId: unknown memory');
        const longId=existing?.id??`${id}:long`;
        const short=this.store.makeOwner({ownerType:'short',ownerId:id},{content:change.content,eventSummary:change.eventSummary,feelingSummary:change.feelingSummary,topics:change.topics,sourceIds:change.sourceIds,importance:change.importance,happenedAt:change.happenedAt??at,happenedUntil:change.happenedUntil??change.happenedAt??at,shortExpiresAt:addMs(at,7*day),linkedLongId:longId},at);
        this.store.saveOwner(short);this.store.queueIndex(short,at);this.store.queueDirty(short,'event',at);
        if(!change.existingLongId) {
          const start=change.importance==='high'?at:short.shortExpiresAt!;
          const long=this.store.makeOwner({ownerType:'long',ownerId:longId},{content:summary(change.eventSummary,change.feelingSummary),eventSummary:change.eventSummary,feelingSummary:change.feelingSummary,topics:change.topics,sourceIds:change.sourceIds,...eventRange([short]),importance:change.importance,retainedFrom:start,expiresAt:addMs(start,90*day)},at);
          this.store.saveOwner(long);this.store.queueIndex(long,at);this.grant(long,'initial',start,[]);this.store.queueDirty(long,'event',at);
        } else {
          const content=summary(change.eventSummary,change.feelingSummary),long=existing!;
          const updated={...long,content,eventSummary:change.eventSummary,feelingSummary:change.feelingSummary,topics:change.topics,sourceIds:union(long.sourceIds,change.sourceIds),...eventRange([long,short]),lastEventUpdateAt:at,stateVersion:long.stateVersion+1};
          const changed=memoryIndexText(long)!==memoryIndexText(updated);updated.revision=long.revision+(changed?1:0);
          if(long.retainedFrom&&milliseconds(at)<milliseconds(long.retainedFrom)){updated.retainedFrom=short.shortExpiresAt;updated.expiresAt=addMs(updated.retainedFrom!,90*day);this.store.saveGrant({id:`${long.id}:initial`,canonicalMemoryId:long.id,kind:'initial',anchorAt:updated.retainedFrom!,expiresAt:updated.expiresAt,triggerDates:[]});}
          this.store.saveOwner(updated);if(changed)this.store.queueIndex(updated,at);this.store.queueDirty(updated,'event',at);this.synchronizeProjections(updated,at,true);
        }
      } else {
        const old=this.store.owner({ownerType:'short',ownerId:change.id});if(!old)throw new Error('short update: unknown memory');
        const short={...old,content:change.content,eventSummary:change.eventSummary,feelingSummary:change.feelingSummary,topics:change.topics,sourceIds:union(old.sourceIds,change.sourceIds),...eventRange([old,{happenedAt:change.happenedAt??old.happenedAt,happenedUntil:change.happenedUntil}]),stateVersion:old.stateVersion+1};
        const changed=memoryIndexText(old)!==memoryIndexText(short);short.revision=old.revision+(changed?1:0);
        if(change.hasNewEventProgress){short.lastEventUpdateAt=at;short.shortExpiresAt=addMs(at,7*day);}
        this.store.saveOwner(short);if(changed)this.store.queueIndex(short,at);this.store.queueDirty(short,'event',at);
        const long=old.linkedLongId?this.store.canonical(old.linkedLongId):null;
        if(long) {
          const content=summary(change.eventSummary,change.feelingSummary);
          const updated={...long,content,eventSummary:change.eventSummary,feelingSummary:change.feelingSummary,topics:change.topics,sourceIds:union(long.sourceIds,change.sourceIds),...eventRange([long,short]),lastEventUpdateAt:change.hasNewEventProgress?at:long.lastEventUpdateAt,stateVersion:long.stateVersion+1};
          const textChanged=memoryIndexText(long)!==memoryIndexText(updated);updated.revision=long.revision+(textChanged?1:0);
          if(change.hasNewEventProgress&&long.retainedFrom&&milliseconds(at)<milliseconds(long.retainedFrom)) {
            updated.retainedFrom=short.shortExpiresAt;updated.expiresAt=addMs(updated.retainedFrom!,90*day);
            this.store.saveGrant({id:`${long.id}:initial`,canonicalMemoryId:long.id,kind:'initial',anchorAt:updated.retainedFrom!,expiresAt:updated.expiresAt,triggerDates:[]});
          }
          this.store.saveOwner(updated);if(textChanged)this.store.queueIndex(updated,at);this.store.queueDirty(updated,'event',at);this.synchronizeProjections(updated,at,true);
        }
      }
    }
    for(const change of result.longTermChanges)this.awaken({id:change.id,turnId,at,reason:change.reason,sourceIds:change.sourceIds,allowedIds:[change.id],allowedSourceIds:allowedSources});
    result.detailChanges.forEach((change,i)=>{
      requireSources(change.sourceIds,allowedSources);const prior=this.store.storage.read('details',change.key);if(prior?.value===change.value)return;
      const old=this.store.owner({ownerType:'detail',ownerId:change.key});
      const row=this.store.makeOwner({ownerType:'detail',ownerId:change.key},{content:change.value,key:change.key,value:change.value,aliases:change.aliases.length?change.aliases:prior?.aliases??[],sourceIds:change.sourceIds,effectiveAt:at,revision:(old?.revision??0)+1,stateVersion:(old?.stateVersion??0)+1},old?.createdAt??at);
      const id=`${turnId}:detail:${i}`;this.store.storage.save('detail_history',id,{id,key:change.key,previousValue:prior?.value??null,newValue:change.value,effectiveAt:at,reason:change.reason,sourceIds:change.sourceIds,turnId});
      this.store.saveOwner(row);this.store.queueIndex(row,at);this.store.queueDirty(row,'detail',at);
    });
  }
  private grant(row:MemoryCandidate,kind:RetentionGrant['kind'],anchorAt:string,triggerDates:string[]):void {
    this.store.saveGrant({id:kind==='initial'?`${row.id}:initial`:`${row.id}:${kind}:${triggerDates.join(',')||'initial'}`,canonicalMemoryId:row.id,kind,anchorAt,expiresAt:addMs(anchorAt,90*day),triggerDates});
  }
  awaken(input:AwakeningInput):void {
    requireSources(input.sourceIds,input.allowedSourceIds);if(!input.allowedIds.includes(input.id))throw new Error('awaken: unknown provided memory ID');
    const row=this.store.canonical(input.id);if(!row||row.kind!=='long')throw new Error('awaken: unknown canonical memory');
    this.capacity?.reactivate(row.id,input.at);
    const p=localParts(input.at,'Asia/Shanghai');const date=`${p.year}-${String(p.month).padStart(2,'0')}-${String(p.day).padStart(2,'0')}`;
    const prior=this.store.listAwakenings(row.id).find(a=>a.localDate===date);
    this.store.saveAwakening({canonicalMemoryId:row.id,localDate:date,firstEffectiveAt:input.at,turnId:input.turnId,sourceIds:input.sourceIds});
    if(!this.capacity&&!prior&&row.status!=='durable'&&row.expiresAt&&milliseconds(input.at)>=milliseconds(row.expiresAt))this.grant(row,'reactivate',input.at,[date]);
    this.refresh(row.id);
    this.store.queueDirty(this.store.canonical(row.id)!,'awaken',input.at);
  }
  private refresh(id:string):void {
    const row=this.store.canonical(id)!;const dates=this.store.listAwakenings(id);const grants=this.store.listGrants(id);
    let latest=grants.at(-1);let expiresAt=grants.reduce<string|null>((best,g)=>!best||milliseconds(g.expiresAt)>milliseconds(best)?g.expiresAt:best,row.expiresAt);
    const consumed=new Set(grants.flatMap(g=>g.triggerDates));
    let pending=latest?dates.filter(a=>!consumed.has(a.localDate)&&milliseconds(a.firstEffectiveAt)>=milliseconds(latest!.anchorAt)&&milliseconds(a.firstEffectiveAt)<milliseconds(expiresAt!)):[];
    if(row.status!=='durable')while(pending.length>=3){const group=pending.splice(0,3);const anchor=group[2].firstEffectiveAt;this.grant(row,'renew',anchor,group.map(a=>a.localDate));const deadline=addMs(anchor,90*day);if(!expiresAt||milliseconds(deadline)>milliseconds(expiresAt))expiresAt=deadline;}
    this.store.saveOwner({...row,totalAwakenings:dates.length,windowAwakenings:row.status==='durable'?0:pending.length,expiresAt:row.status==='durable'?null:expiresAt,stateVersion:row.stateVersion+1});
  }
  merge(ids:string[],canonicalId:string,at?:string):void {
    const unique=[...new Map(ids.map(id=>this.store.canonical(id)).filter((r):r is MemoryCandidate=>!!r).map(r=>[r.id,r])).values()];
    if(unique.length<2)return;
    const main=this.store.canonical(canonicalId);if(!main||!unique.some(r=>r.id===main.id))throw new Error('merge canonicalId outside input');
    const ordered=unique.sort((a,b)=>milliseconds(a.createdAt)-milliseconds(b.createdAt)||a.id.localeCompare(b.id));
    const feelings=union(...ordered.map(r=>r.feelingSummary?[r.feelingSummary]:[]));
    let expiry=main.expiresAt;for(const row of unique)if(row.expiresAt&&(!expiry||milliseconds(row.expiresAt)>milliseconds(expiry)))expiry=row.expiresAt;
    const durable=unique.some(r=>r.status==='durable');
    const mergeAt=at??main.createdAt,live=unique.filter(r=>!archiveStart(r,mergeAt)),anchors=unique.map(r=>archiveStart(r,mergeAt)).filter((s):s is string=>!!s).sort((a,b)=>milliseconds(a)-milliseconds(b));
    const merged={...main,sourceIds:union(...unique.map(r=>r.sourceIds)),topics:union(...unique.map(r=>r.topics)),feelingSummary:feelings.join('\n'),...eventRange(ordered),lastEventUpdateAt:ordered.map(r=>r.lastEventUpdateAt).sort((a,b)=>milliseconds(b)-milliseconds(a))[0],expiresAt:durable?null:expiry,status:durable?'durable' as const:main.status,stateVersion:main.stateVersion+1,
      archiveEnteredAt:live.length?null:anchors[0]??null,capacityExitedAt:live.length?null:main.capacityExitedAt??unique.find(r=>r.capacityExitedAt)?.capacityExitedAt??null,capacityExitReason:live.length?null:main.capacityExitReason??unique.find(r=>r.capacityExitReason)?.capacityExitReason??null,
      retainedFrom:live.length?live.map(r=>r.retainedFrom).filter((s):s is string=>!!s).sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??main.retainedFrom:main.retainedFrom};
    const textChanged=memoryIndexText(main)!==memoryIndexText(merged);merged.revision=main.revision+(textChanged?1:0);
    this.store.saveOwner(merged);
    for(const row of unique) {
      if(row.id===main.id)continue;
      for(const a of this.store.listAwakenings(row.id))this.store.saveAwakening({...a,canonicalMemoryId:main.id});
      this.store.storage.prepare('DELETE FROM memory_awakenings WHERE canonicalMemoryId=?').run(row.id);
      for(const g of this.store.listGrants(row.id))this.store.saveGrant({...g,canonicalMemoryId:main.id});
      for(const projection of this.store.projections(row.id)){
        const target=projection.learnedKind==='durable_experience'?this.store.projections(main.id).find(p=>p.learnedKind==='durable_experience'):undefined;
        const updated={...projection,canonicalMemoryId:main.id,stateVersion:projection.stateVersion+1,...(target?{status:'merged' as const,mergedInto:target.id}:{})};
        this.store.saveOwner(updated);
      }
      this.store.pruneOwnerFromJobs(row,mergeAt);
      this.store.storage.prepare('DELETE FROM memory_index WHERE ownerType=? AND ownerId=?').run(row.ownerType,row.id);
      this.store.saveOwner({...row,content:'',eventSummary:'',feelingSummary:'',sourceIds:[],topics:[],status:'merged',mergedInto:main.id,stateVersion:row.stateVersion+1});
    }
    const memberIds=new Set(unique.map(r=>r.id));
    for(const row of this.store.allOwners()){
      if(row.kind==='short'&&row.linkedLongId&&memberIds.has(row.linkedLongId)&&row.linkedLongId!==main.id)this.store.saveOwner({...row,linkedLongId:main.id,stateVersion:row.stateVersion+1});
      if(row.kind==='learned'&&row.status==='active'){
        const evidence=union((row.evidenceMemoryIds??[]).map(id=>memberIds.has(id)?main.id:id));
        if(JSON.stringify(evidence)!==JSON.stringify(row.evidenceMemoryIds??[]))this.store.saveOwner({...row,evidenceMemoryIds:evidence,stateVersion:row.stateVersion+1});
      }
    }
    this.refresh(main.id);const current=this.store.canonical(main.id)!;if(textChanged)this.store.queueIndex(current,at??main.createdAt);this.synchronizeProjections(current,at??main.createdAt);
  }
  promotionCandidates(at:string):MemoryCandidate[]{return this.store.storage.prepare("SELECT data FROM memories WHERE json_extract(data,'$.kind')='long' AND json_extract(data,'$.status')='active' AND json_extract(data,'$.totalAwakenings')>=30 AND (json_extract(data,'$.evaluatedEvidenceVersion') IS NULL OR json_extract(data,'$.evaluatedEvidenceVersion')<json_extract(data,'$.stateVersion'))").all().map(r=>JSON.parse(String(r.data))).filter(r=>promotionEligible(r,at));}
  synchronizeProjections(row:MemoryCandidate,at:string,dirty=false):void {
    for(const projection of this.store.allOwners().filter(p=>p.kind==='learned'&&p.status==='active'&&(p.canonicalMemoryId===row.id||p.evidenceMemoryIds?.includes(row.id)))){
      const basis={content:row.content,sourceIds:row.sourceIds,revision:row.revision};
      const primary=projection.canonicalMemoryId===row.id;
      const evidenceIds=new Set([projection.canonicalMemoryId,...projection.evidenceMemoryIds??[]]);
      const evidenceVersions=[...(projection.evidenceVersions??[]).filter(ref=>ref.ownerId!==row.id&&evidenceIds.has(ref.ownerId)),{ownerType:row.ownerType,ownerId:row.id,revision:row.revision,stateVersion:row.stateVersion}].sort((a,b)=>a.ownerId.localeCompare(b.ownerId));
      const updated={...projection,sourceIds:union(projection.sourceIds,row.sourceIds),topics:union(projection.topics,row.topics),evidenceVersions,...(primary?{projectionBasis:basis}:{})};
      // Single-event experience follows its current summary; a multi-event understanding retains its conclusion and exposes the updated basis explicitly.
      if(primary&&projection.learnedKind==='durable_experience'){updated.content=row.content;updated.eventSummary=row.eventSummary;updated.feelingSummary=row.feelingSummary;Object.assign(updated,eventRange([row]),{lastEventUpdateAt:row.lastEventUpdateAt});}
      if(JSON.stringify(updated)===JSON.stringify(projection))continue;
      const textChanged=memoryIndexText(projection)!==memoryIndexText(updated);updated.revision=projection.revision+(textChanged?1:0);updated.stateVersion=projection.stateVersion+1;
      this.store.saveOwner(updated);if(textChanged)this.store.queueIndex(updated,at);if(dirty)this.store.queueDirty(updated,'learned',at);
    }
  }
  evaluateRetain(id:string):void {const row=this.store.canonical(id)!;this.store.saveOwner({...row,evaluatedEvidenceVersion:row.stateVersion+1,stateVersion:row.stateVersion+1});}
  promote(id:string,learnedId:string,content:string,kind:'durable_experience'|'stable_understanding',alwaysInclude:boolean,evidenceIds:string[],at:string):void {
    const row=this.store.canonical(id);if(!row||!promotionEligible(row,at))throw new Error('promotion requires active unarchived main and 30 effective dates');
    const evidence=union(evidenceIds.flatMap(id=>{const l=this.store.canonicalEvidence(id);return l?[l.id]:[];}));
    if(kind==='stable_understanding'&&evidence.length<2)throw new Error('stable understanding requires distinct events');
    const learned=this.store.makeOwner({ownerType:'learned',ownerId:learnedId},{content,eventSummary:content,sourceIds:union(row.sourceIds,...evidence.map(id=>this.store.canonical(id)!.sourceIds)),evidenceMemoryIds:evidence,canonicalMemoryId:row.id,learnedKind:kind,alwaysInclude:kind==='stable_understanding'&&alwaysInclude,topics:row.topics,...(kind==='durable_experience'?{...eventRange([row]),lastEventUpdateAt:row.lastEventUpdateAt}:{})},at);
    this.store.saveOwner({...row,status:'durable',expiresAt:null,windowAwakenings:0,stateVersion:row.stateVersion+1});this.store.saveOwner(learned);this.store.queueIndex(learned,at);this.store.queueDirty(learned,'learned',at);
  }
  mergeShort(ids:string[],canonicalShortId:string,content:string,eventSummary:string,feelingSummary:string,sourceIds:string[],at:string):MemoryCandidate {
    const shorts=[...new Set(ids)].map(ownerId=>this.store.owner({ownerType:'short',ownerId})).filter((r):r is MemoryCandidate=>!!r&&r.kind==='short'&&r.status==='active'&&!r.mergedInto);
    const main=shorts.find(r=>r.id===canonicalShortId);if(!main||shorts.length<2)throw new Error('merge_short needs live shorts');
    const longs=[...new Map(shorts.map(s=>this.store.canonical(s.linkedLongId!)).filter((r):r is MemoryCandidate=>!!r).map(r=>[r.id,r])).values()];
    const preferred=longs.sort((a,b)=>milliseconds(a.createdAt)-milliseconds(b.createdAt)||(a.id<b.id?-1:1))[0];if(!preferred)throw new Error('merge_short missing long summary');
    if(longs.length>1)this.merge(longs.map(r=>r.id),preferred.id,at);
    const latest=shorts.map(s=>s.lastEventUpdateAt).sort((a,b)=>milliseconds(b)-milliseconds(a))[0],exits=shorts.map(r=>r.capacityExitedAt).filter((s):s is string=>!!s).sort((a,b)=>milliseconds(a)-milliseconds(b));
    const merged={...main,content,eventSummary,feelingSummary:union([feelingSummary],...shorts.map(s=>s.feelingSummary?[s.feelingSummary]:[])).join('\n'),sourceIds:union(sourceIds,...shorts.map(s=>s.sourceIds)),topics:union(...shorts.map(s=>s.topics)),...eventRange(shorts),lastEventUpdateAt:latest,shortExpiresAt:addMs(latest,7*day),linkedLongId:preferred.id,capacityExitedAt:exits[0]??null,capacityExitReason:exits.length?'short_capacity' as const:null,revision:main.revision+1,stateVersion:(this.store.owner(main)?.stateVersion??main.stateVersion)+1};
    this.store.saveOwner(merged);this.store.queueIndex(merged,at);
    for(const s of shorts.filter(s=>s.id!==main.id)){
      this.store.pruneOwnerFromJobs(s,at);this.store.storage.prepare('DELETE FROM memory_index WHERE ownerType=? AND ownerId=?').run('short',s.id);
      this.store.saveOwner({...s,content:'',eventSummary:'',feelingSummary:'',sourceIds:[],topics:[],status:'merged',mergedInto:main.id,stateVersion:s.stateVersion+1});
    }return merged;
  }
}
