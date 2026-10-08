import type {MemoryCandidate} from './types';
export function summaryRepairPair(short:MemoryCandidate,long:MemoryCandidate|null):long is MemoryCandidate {
  return short.kind==='short'&&short.status==='active'&&!short.mergedInto&&!!short.content.trim()&&!!long&&long.kind==='long'&&['active','durable'].includes(long.status)&&!long.content.trim()&&(short.sourceIds.length>0||long.sourceIds.length>0);
}
export const summaryRepairBasis=(short:MemoryCandidate,long:MemoryCandidate)=>JSON.stringify([short.revision,short.stateVersion,long.revision,long.stateVersion]);
