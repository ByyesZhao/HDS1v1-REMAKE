import type {MemoryCandidate,MemoryWritePermissions} from './types';
import type {MemoryStore} from './store';
import {isStageModelInput} from '../model/context-types';

export type MemoryReferenceRow = Pick<MemoryCandidate,'id'|'kind'> & Partial<Pick<MemoryCandidate,'linkedLongId'|'canonicalMemoryId'>>;
const object=(value:unknown):value is Record<string,unknown>=>!!value&&typeof value==='object'&&!Array.isArray(value);
const validId=(value:unknown):value is string=>typeof value==='string'&&!!value.trim();
function decodeRow(value:unknown):MemoryReferenceRow|null {
 if(!object(value))throw Error('memory reference: invalid owner row');
 if(value.kind==='detail')return null;
 if(!['short','long','learned'].includes(String(value.kind))||!validId(value.id))throw Error('memory reference: invalid owner identity');
 if(value.linkedLongId!==undefined&&value.linkedLongId!==null&&typeof value.linkedLongId!=='string')throw Error('memory reference: invalid linkedLongId');
 if(value.canonicalMemoryId!==undefined&&value.canonicalMemoryId!==null&&typeof value.canonicalMemoryId!=='string')throw Error('memory reference: invalid canonicalMemoryId');
 return {id:value.id,kind:value.kind as MemoryReferenceRow['kind'],...(value.kind==='short'&&value.linkedLongId!==undefined?{linkedLongId:value.linkedLongId as string|null}:{}),...(value.kind==='learned'&&typeof value.canonicalMemoryId==='string'?{canonicalMemoryId:value.canonicalMemoryId}:{})};
}
export function memoryReferenceRows(input:unknown):MemoryReferenceRow[] {
 if(!object(input))throw Error('memory reference: invalid context');
 let rows:unknown;
 if(isStageModelInput(input))rows=input.resources?.owners;
 else if('retrieved' in input)rows=input.retrieved;
 else return [];
 if(!Array.isArray(rows))throw Error('memory reference: invalid owner container');
 return rows.map(decodeRow).filter((row):row is MemoryReferenceRow=>row!==null);
}
export function extendMemoryWritePermissions(store:Pick<MemoryStore,'canonical'>,permissions:MemoryWritePermissions,rows:readonly MemoryReferenceRow[]):void {
 const next:MemoryWritePermissions={shortUpdateIds:[],longAwakenIds:[],existingLongIds:[]};
 for(const value of rows){
  const row=decodeRow(value);if(!row)continue;
  if(row.kind==='short')next.shortUpdateIds.push(row.id);else next.longAwakenIds.push(row.id);
  const link=row.kind==='short'?row.linkedLongId:row.id;
  if(!link)continue;
  const target=store.canonical(link);
  if(!target||target.kind!=='long'||target.status==='discarded')throw Error('memory reference: existingLongId target missing, invalid or discarded');
  next.existingLongIds.push(link);
 }
 // Validate the entire batch before publishing any authority; preserve array identities.
 for(const field of ['shortUpdateIds','longAwakenIds','existingLongIds'] as const)for(const id of next[field])if(!permissions[field].includes(id))permissions[field].push(id);
}
export function snapshotMemoryWritePermissions(permissions:MemoryWritePermissions):MemoryWritePermissions {
 return {shortUpdateIds:[...permissions.shortUpdateIds],longAwakenIds:[...permissions.longAwakenIds],existingLongIds:[...permissions.existingLongIds]};
}
