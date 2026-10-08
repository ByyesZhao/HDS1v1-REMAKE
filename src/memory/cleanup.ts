import {addMs,milliseconds} from '../time';
import {MemoryStore} from './store';
import {MemoryCapacity,archiveStart,archiveOrder} from './capacity';
import type {MemoryCandidate} from './types';
import {memoryMetadata,metadataCanonical} from './metadata';
import {summaryRepairPair,summaryRepairBasis} from './summary-repair';
const day=86400000;
export class MemoryCleanup {
  private blocked:string[]=[];
  constructor(private store:MemoryStore,private capacity:MemoryCapacity){}
  private candidates(now:string,metadataOnly=false){
    const rows=metadataOnly?memoryMetadata(this.store.storage):this.store.allOwners(),protect=this.capacity.protectedIds(now,true);
    const canonical=(id:string)=>metadataOnly?metadataCanonical(rows,id):this.store.canonical(id);
    const expiredShort=rows.filter(r=>r.kind==='short'&&r.status==='active'&&!!r.shortExpiresAt&&milliseconds(r.shortExpiresAt)<=milliseconds(now));
    const archived=metadataOnly?rows.filter(r=>!!archiveStart(r,now)):this.store.archivedLongs(now),age=this.capacity.config.archiveRetentionDays;
    const overdue=archived.filter(r=>age!==null&&milliseconds(addMs(archiveStart(r,now)!,age*day))<=milliseconds(now));
    const overflow=this.capacity.config.longArchiveLimit!==null&&archived.length>this.capacity.config.longArchiveLimit;
    const old=rows.filter(r=>(r.kind==='short'||r.kind==='long'||r.kind==='learned')&&(r.status==='merged'||r.status==='discarded'));
    const shortsReady=expiredShort.filter(r=>!!r.linkedLongId&&!!canonical(r.linkedLongId)?.content.trim());
    const missing=expiredShort.filter(r=>!shortsReady.includes(r));
    const repairs=missing.filter(short=>{const long=short.linkedLongId?canonical(short.linkedLongId):null;return summaryRepairPair(short,long)&&short.summaryRepairBasis!==summaryRepairBasis(short,long);});
    this.blocked=[...expiredShort.filter(r=>!shortsReady.includes(r)).map(r=>`${r.id}:missing_summary`),...overdue.filter(r=>protect.has(r.id)).map(r=>`${r.id}:reference`)];
    const unprotectedOverdue=overdue.filter(r=>!protect.has(r.id));
    const longs=(unprotectedOverdue.length?unprotectedOverdue:overflow?archived:[]).filter(r=>!protect.has(r.id)).sort(archiveOrder(this.store));
    if(overflow&&!longs.length)this.blocked.push('archive:protected');
    return {rows,protect,repairs,eligible:[...shortsReady,...old.filter(r=>!protect.has(r.id)&&!rows.some(other=>other.kind==='short'&&other.linkedLongId===r.id||other.kind==='learned'&&other.status==='active'&&(other.canonicalMemoryId===r.id||other.evidenceMemoryIds?.includes(r.id)))),...longs]};
  }
  applyOne(now:string):'applied'|'blocked'|'none' {
    if(this.store.storage.runtime().paused||this.store.storage.unfinishedTurn()||this.store.storage.runtime().openBatch)return 'blocked';
    const {eligible,repairs}=this.candidates(now);const row=eligible[0];
    if(row){this.store.storage.transaction(()=>{this.store.purgeOwner(row,now);this.store.compactCompletedPayloads();});return 'applied';}
    if(repairs.length){this.store.storage.transaction(()=>{const short=repairs[0],long=this.store.canonical(short.linkedLongId!)!,updated={...short,stateVersion:short.stateVersion+1,summaryRepairBasis:''};updated.summaryRepairBasis=summaryRepairBasis(updated,long);this.store.saveOwner(updated);this.store.queueDirty(updated,'expiry',now);});return 'applied';}
    const result=this.store.storage.transaction(()=>this.capacity.normalize(now,[],1));if(result.changedOwners.length)return 'applied';
    return this.blocked.length||result.counts.longOverflow||result.counts.shortOverflow?'blocked':'none';
  }
  nextDeadline(now:string):string|null {
    if(this.store.storage.runtime().paused||this.store.storage.unfinishedTurn()||this.store.storage.runtime().openBatch)return null;
    const {eligible,rows,repairs}=this.candidates(now,true);if(eligible.length||repairs.length)return now;
    const counts=this.capacity.counts(now);if(counts.shortOverflow||counts.longOverflow){
      const protectedIds=this.capacity.protectedIds(now),can=counts.longOverflow>0&&rows.some(r=>r.kind==='long'&&r.status==='active'&&!archiveStart(r,now)&&!protectedIds.has(r.id))||counts.shortOverflow>0&&rows.some(r=>r.kind==='short'&&r.status==='active'&&!r.capacityExitedAt&&!!r.shortExpiresAt&&milliseconds(r.shortExpiresAt)>milliseconds(now)&&!!r.linkedLongId&&!!metadataCanonical(rows,r.linkedLongId)?.content.trim());if(can)return now;
    }
    const deadlines:string[]=[];for(const r of rows){
      if(r.kind==='short'&&r.status==='active'&&r.shortExpiresAt&&r.linkedLongId&&metadataCanonical(rows,r.linkedLongId)?.content.trim())deadlines.push(r.shortExpiresAt);
      if(r.kind==='long'&&r.status==='active'){
        const start=archiveStart(r,now);if(this.capacity.config.archiveRetentionDays!==null){if(start)deadlines.push(addMs(start,this.capacity.config.archiveRetentionDays*day));else if(r.expiresAt)deadlines.push(addMs(r.expiresAt,this.capacity.config.archiveRetentionDays*day));}
      }
    }return deadlines.filter(d=>milliseconds(d)>milliseconds(now)).sort((a,b)=>milliseconds(a)-milliseconds(b))[0]??null;
  }
  status(){return {blockedIds:[...this.blocked],oldestBlock:this.blocked[0]??null};}
}
