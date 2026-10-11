import type {MemoryCandidate,OwnerVersion} from './types';
import type {MemoryPolicyRow} from './policy-snapshot';
export function summaryRepairPair(short:MemoryCandidate,long:MemoryCandidate|null):long is MemoryCandidate {
  return short.kind==='short'&&short.status==='active'&&!short.mergedInto&&!!short.content.trim()&&!!long&&long.kind==='long'&&['active','durable'].includes(long.status)&&!long.content.trim()&&(short.sourceIds.length>0||long.sourceIds.length>0);
}
export function summaryRepairPolicyPair(short:MemoryPolicyRow,long:MemoryPolicyRow|null):boolean {
  return short.kind==='short'&&short.status==='active'&&!short.mergedInto&&short.hasContent&&!!long&&long.kind==='long'&&['active','durable'].includes(long.status)&&!long.hasContent&&(short.hasSources||long.hasSources);
}
export const summaryRepairBasis=(short:Pick<OwnerVersion,'revision'|'stateVersion'>,long:Pick<OwnerVersion,'revision'|'stateVersion'>)=>JSON.stringify([short.revision,short.stateVersion,long.revision,long.stateVersion]);
