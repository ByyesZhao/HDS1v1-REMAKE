import {addMs,milliseconds} from '../time';
import {MemoryStore} from './store';
import {MemoryCapacity,archiveStart,policyProtectedIds} from './capacity';
import {readMemoryPolicySnapshot,policyCanonical,type MemoryPolicySnapshot} from './policy-snapshot';
import {readLatestAwakeningTimes,memoryOrderKeys,archivePolicyOrder} from './policy-order';
import {summaryRepairPolicyPair,summaryRepairBasis} from './summary-repair';
const day=86400000;
export class MemoryCleanup {
  private blocked:string[]=[];
  constructor(private store:MemoryStore,private capacity:MemoryCapacity){}
  private candidates(now:string,snapshot:MemoryPolicySnapshot,ordered:boolean,canonicalMode:'metadata'|'owner'){
    const rows=snapshot.rows,protect=policyProtectedIds(snapshot,now,true);
    const canonical=(id:string)=>policyCanonical(snapshot,id,canonicalMode);
    const expiredShort=rows.filter(r=>r.kind==='short'&&r.status==='active'&&!!r.shortExpiresAt&&milliseconds(r.shortExpiresAt)<=milliseconds(now));
    const archived=rows.filter(r=>!!archiveStart(r,now)),age=this.capacity.config.archiveRetentionDays;
    const overdue=archived.filter(r=>age!==null&&milliseconds(addMs(archiveStart(r,now)!,age*day))<=milliseconds(now));
    const overflow=this.capacity.config.longArchiveLimit!==null&&archived.length>this.capacity.config.longArchiveLimit;
    const old=rows.filter(r=>(r.kind==='short'||r.kind==='long'||r.kind==='learned')&&(r.status==='merged'||r.status==='discarded'));
    const shortsReady=expiredShort.filter(r=>!!r.linkedLongId&&!!canonical(r.linkedLongId)?.hasContent),ready=new Set(shortsReady);
    const missing=expiredShort.filter(r=>!ready.has(r));
    const repairs=missing.filter(short=>{const long=short.linkedLongId?canonical(short.linkedLongId):null;return !!long&&summaryRepairPolicyPair(short,long)&&short.summaryRepairBasis!==summaryRepairBasis(short,long);});
    this.blocked=[...missing.map(r=>`${r.id}:missing_summary`),...overdue.filter(r=>protect.has(r.id)).map(r=>`${r.id}:reference`)];
    const referenced=new Set<string>();for(const row of rows){
      if(row.kind==='short'&&row.linkedLongId)referenced.add(row.linkedLongId);
      if(row.kind==='learned'&&row.status==='active'){if(row.canonicalMemoryId)referenced.add(row.canonicalMemoryId);for(const id of row.evidenceMemoryIds)referenced.add(id);}
    }
    const oldReady=old.filter(r=>!protect.has(r.id)&&!referenced.has(r.id));
    const unprotectedOverdue=overdue.filter(r=>!protect.has(r.id));
    const longs=(unprotectedOverdue.length?unprotectedOverdue:overflow?archived:[]).filter(r=>!protect.has(r.id));
    // Only the call that will actually purge an archive needs to choose its first item.
    if(ordered&&!shortsReady.length&&!oldReady.length&&longs.length){
      const latest=readLatestAwakeningTimes(this.store.storage,longs.map(r=>r.id)),keys=memoryOrderKeys(longs,snapshot,latest,now,canonicalMode);
      longs.sort(archivePolicyOrder(keys));
    }
    if(overflow&&!longs.length)this.blocked.push('archive:protected');
    return {rows,protect,repairs,eligible:[...shortsReady,...oldReady,...longs]};
  }
  applyOne(now:string):'applied'|'blocked'|'none' {
    if(this.store.storage.runtime().paused||this.store.storage.unfinishedTurn()||this.store.storage.runtime().openBatch)return 'blocked';
    const snapshot=readMemoryPolicySnapshot(this.store.storage),{eligible,repairs}=this.candidates(now,snapshot,true,'owner');const row=eligible[0];
    if(row){this.store.storage.transaction(()=>{this.store.purgeOwner(row,now);});return 'applied';}
    if(repairs.length){this.store.storage.transaction(()=>{
      const selected=repairs[0],longRow=policyCanonical(snapshot,selected.linkedLongId!,'owner')!,short=this.store.owner(selected)!,long=this.store.owner(longRow)!;
      const updated={...short,stateVersion:short.stateVersion+1,summaryRepairBasis:''};updated.summaryRepairBasis=summaryRepairBasis(updated,long);
      this.store.saveOwner(updated);this.store.queueDirty(updated,'expiry',now);
    });return 'applied';}
    const result=this.store.storage.transaction(()=>this.capacity.normalize(now,[],1,snapshot));if(result.changedOwners.length)return 'applied';
    return this.blocked.length||result.counts.longOverflow||result.counts.shortOverflow?'blocked':'none';
  }
  nextDeadline(now:string):string|null {
    if(this.store.storage.runtime().paused||this.store.storage.unfinishedTurn()||this.store.storage.runtime().openBatch)return null;
    const snapshot=readMemoryPolicySnapshot(this.store.storage),{eligible,rows,repairs}=this.candidates(now,snapshot,false,'metadata');if(eligible.length||repairs.length)return now;
    const counts=this.capacity.counts(now,snapshot);if(counts.shortOverflow||counts.longOverflow){
      const protectedIds=policyProtectedIds(snapshot,now),can=counts.longOverflow>0&&rows.some(r=>r.kind==='long'&&r.status==='active'&&!archiveStart(r,now)&&!protectedIds.has(r.id))||counts.shortOverflow>0&&rows.some(r=>r.kind==='short'&&r.status==='active'&&!r.capacityExitedAt&&!!r.shortExpiresAt&&milliseconds(r.shortExpiresAt)>milliseconds(now)&&!!r.linkedLongId&&!!policyCanonical(snapshot,r.linkedLongId,'metadata')?.hasContent);if(can)return now;
    }
    const deadlines:string[]=[];for(const r of rows){
      if(r.kind==='short'&&r.status==='active'&&r.shortExpiresAt&&r.linkedLongId&&policyCanonical(snapshot,r.linkedLongId,'metadata')?.hasContent)deadlines.push(r.shortExpiresAt);
      if(r.kind==='long'&&r.status==='active'){
        const start=archiveStart(r,now);if(this.capacity.config.archiveRetentionDays!==null){if(start)deadlines.push(addMs(start,this.capacity.config.archiveRetentionDays*day));else if(r.expiresAt)deadlines.push(addMs(r.expiresAt,this.capacity.config.archiveRetentionDays*day));}
      }
    }let deadline:string|null=null,best=Infinity;const nowMs=milliseconds(now);
    for(const value of deadlines){const time=milliseconds(value);if(time>nowMs&&time<best){deadline=value;best=time;}}return deadline;
  }
  status(){return {blockedIds:[...this.blocked],oldestBlock:this.blocked[0]??null};}
}
