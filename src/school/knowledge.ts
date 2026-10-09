import type {SchoolEntitySnapshot} from './types';
import {milliseconds} from '../time';
export interface SchoolKnowledgeCandidate {snapshot:SchoolEntitySnapshot;acquiredAt:string}
export function selectKnownSchoolSnapshots(candidates:readonly SchoolKnowledgeCandidate[]):SchoolEntitySnapshot[]{
 const latest=new Map<string,SchoolKnowledgeCandidate>();
 for(const candidate of candidates){
  const key=JSON.stringify([candidate.snapshot.entityKind,candidate.snapshot.entityId]),old=latest.get(key);
  const compare=old?candidate.snapshot.value.deliveryRevision-old.snapshot.value.deliveryRevision||candidate.snapshot.revision-old.snapshot.revision||milliseconds(candidate.acquiredAt)-milliseconds(old.acquiredAt):1;
  if(compare>=0)latest.set(key,candidate);
 }
 return [...latest.values()].map(c=>c.snapshot);
}
