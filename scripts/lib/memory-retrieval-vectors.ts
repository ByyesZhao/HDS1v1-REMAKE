import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Storage } from '../../src/storage';
import { MemoryStore, memoryIndexText } from '../../src/memory/store';
import { MemoryIndex, normalizeVector } from '../../src/memory/index';
import type { EmbeddingProvider } from '../../src/embedding';
import { retrievalDatasetHash, type RetrievalDatasetV2 } from './memory-retrieval-evaluation';

export interface RetrievalVectorEntry { textHash:string; vector?:number[]; revision?:number }
export interface RetrievalVectorPack {
  version:1; datasetHash:string; configSignature:string; status:'complete'|'incomplete';
  owners:Record<string,RetrievalVectorEntry>; queries:Record<string,RetrievalVectorEntry>;
  collectionNetworkRequests:number; plannedRequests:number; failures:Array<{textHash:string;reason:'embedding_failed'}>;
}
export class IncompleteVectorsError extends Error {
  readonly status='incomplete';
  constructor(public readonly issues:string[]){super(`incomplete vector pack: ${issues.join(', ')}`);}
}
const hash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
const provenance=new WeakMap<RetrievalVectorPack,{json:string;hash:string}>();
export function retrievalVectorPackHash(pack:RetrievalVectorPack):string {
  const json=JSON.stringify(pack),source=provenance.get(pack);return source?.json===json?source.hash:hash(json);
}
export function loadRetrievalVectorPack(path:string):RetrievalVectorPack {
  let bytes:Buffer,pack:RetrievalVectorPack;
  try {bytes=readFileSync(path);pack=JSON.parse(bytes.toString('utf8')) as RetrievalVectorPack;}
  catch {throw new IncompleteVectorsError(['vector_pack_unreadable_or_invalid_json']);}
  if(!pack||typeof pack!=='object')throw new IncompleteVectorsError(['invalid_pack']);
  provenance.set(pack,{json:JSON.stringify(pack),hash:hash(bytes)});return pack;
}
function signatureMetadata(signature:string):{endpoint:string;model:string;dimensions:number|null;template:string} {
  try {
    const s=JSON.parse(signature);
    if(typeof s.endpoint!=='string'||typeof s.model!=='string'||!s.model||s.template!=='memory-v3-text-2'||!(s.dimensions===null||Number.isInteger(s.dimensions)&&s.dimensions>0))throw Error();
    const url=new URL(s.endpoint);if(!['https:','http:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error();
    if(signature!==JSON.stringify({endpoint:s.endpoint,model:s.model,dimensions:s.dimensions,template:s.template}))throw Error();
    return s;
  } catch {throw new IncompleteVectorsError(['invalid_config_signature']);}
}
/** Construct the signature with the real runtime class, without calling a provider or opening a database file. */
export function retrievalProviderSignature(provider:EmbeddingProvider):string {
  const storage=new Storage(':memory:');
  try {const signature=new MemoryIndex(new MemoryStore(storage),provider).configSignature;signatureMetadata(signature);return signature;}
  finally {storage.close();}
}
function sources(dataset:RetrievalDatasetV2){
  return [
    ...dataset.families.flatMap(f=>f.owners.map(o=>({kind:'owners' as const,id:`${o.ownerType}:${o.ownerId}`,revision:o.revision,text:memoryIndexText(o)}))),
    ...dataset.queries.map(q=>({kind:'queries' as const,id:q.id,revision:undefined,text:q.text})),
  ].map(s=>({...s,textHash:hash(s.text)}));
}
function validVector(value:unknown,dimensions:number|null):value is number[] {
  return Array.isArray(value)&&value.length>0&&(dimensions===null||value.length===dimensions)&&value.every(v=>typeof v==='number'&&Number.isFinite(v))&&Number.isFinite(Math.hypot(...value))&&Math.hypot(...value)>0;
}
/** Validates every source, even those skipped at runtime; an incomplete pack never supplies quality metrics. */
export function validateRetrievalVectorPack(dataset:RetrievalDatasetV2,pack:RetrievalVectorPack,signature?:string,allowIncomplete=false):void {
  const issues:string[]=[];
  if(!pack||pack.version!==1)throw new IncompleteVectorsError(['invalid_pack_version']);
  const metadata=signatureMetadata(pack.configSignature);
  if(pack.datasetHash!==retrievalDatasetHash(dataset))issues.push('dataset_hash_mismatch');
  if(signature!==undefined&&signature!==pack.configSignature)issues.push('signature_mismatch');
  if(!['complete','incomplete'].includes(pack.status))issues.push('invalid_status');
  if(!Number.isSafeInteger(pack.collectionNetworkRequests)||pack.collectionNetworkRequests<0)issues.push('invalid_collection_count');
  if(!Number.isSafeInteger(pack.plannedRequests)||pack.plannedRequests<0)issues.push('invalid_planned_count');
  if(!Array.isArray(pack.failures)||pack.failures.some(f=>!f||f.reason!=='embedding_failed'||typeof f.textHash!=='string'||!/^[a-f0-9]{64}$/.test(f.textHash)))issues.push('invalid_failure_history');
  if(!allowIncomplete&&pack.status!=='complete')issues.push('collection_incomplete');
  const expected=sources(dataset),expectedIds={owners:new Set(expected.filter(s=>s.kind==='owners').map(s=>s.id)),queries:new Set(expected.filter(s=>s.kind==='queries').map(s=>s.id))};
  const vectorsByHash=new Map<string,string>();let dimensions=metadata.dimensions;
  for(const s of expected){
    const prefix=`${s.kind==='queries'?'query':'owner'}:${s.id}`,entry=pack[s.kind]?.[s.id];
    if(!entry){if(!allowIncomplete)issues.push(`${prefix}:missing`);continue;}
    if(entry.textHash!==s.textHash)issues.push(`${prefix}:text_hash_mismatch`);
    if(s.kind==='owners'&&entry.revision!==s.revision)issues.push(`${prefix}:revision_mismatch`);
    if(entry.vector===undefined&&allowIncomplete)continue;
    if(!validVector(entry.vector,dimensions)){issues.push(`${prefix}:invalid_vector`);continue;}
    dimensions??=entry.vector.length;
    const json=JSON.stringify(entry.vector),previous=vectorsByHash.get(s.textHash);
    if(previous&&previous!==json)issues.push(`${prefix}:conflicting_duplicate_vector`);vectorsByHash.set(s.textHash,json);
  }
  for(const kind of ['owners','queries'] as const)for(const id of Object.keys(pack[kind]??{}))if(!expectedIds[kind].has(id))issues.push(`${kind}:${id}:unexpected`);
  if(issues.length)throw new IncompleteVectorsError(issues);
}
export async function prepareRetrievalVectorPack(dataset:RetrievalDatasetV2,provider:EmbeddingProvider,options:{online:boolean;previous?:RetrievalVectorPack;checkpoint?:(pack:RetrievalVectorPack)=>void;timeoutMs?:number}):Promise<RetrievalVectorPack> {
  const configSignature=retrievalProviderSignature(provider),metadata=signatureMetadata(configSignature),items=sources(dataset);
  if(options.previous)validateRetrievalVectorPack(dataset,options.previous,configSignature,true);
  const pack:RetrievalVectorPack={version:1,datasetHash:retrievalDatasetHash(dataset),configSignature,status:'incomplete',owners:Object.create(null),queries:Object.create(null),collectionNetworkRequests:options.previous?.collectionNetworkRequests??0,plannedRequests:0,failures:structuredClone(options.previous?.failures??[])};
  const cached=new Map<string,number[]>();
  for(const s of items){const old=options.previous?.[s.kind]?.[s.id];if(old?.vector)cached.set(s.textHash,old.vector);}
  const unique=new Map(items.map(s=>[s.textHash,s.text]));
  pack.plannedRequests=[...unique.keys()].filter(key=>!cached.has(key)).length;
  const refresh=()=>{
    for(const s of items)pack[s.kind][s.id]={textHash:s.textHash,...s.revision===undefined?{}:{revision:s.revision},...cached.has(s.textHash)?{vector:cached.get(s.textHash)!}:{}};
    pack.status=items.every(s=>cached.has(s.textHash))?'complete':'incomplete';
  };
  refresh();
  if(options.online){
    for(const [textHash,text] of unique){
      if(cached.has(textHash))continue;
      pack.collectionNetworkRequests++;
      // A stopped process may already have sent the request. Save the attempt before awaiting it.
      options.checkpoint?.(pack);
      try {
        const vector=await provider.embed(text,{signal:AbortSignal.timeout(options.timeoutMs??120000)});
        const dimensions=metadata.dimensions??cached.values().next().value?.length??null;
        if(!validVector(vector,dimensions))throw Error('invalid vector');
        cached.set(textHash,vector);
      } catch {pack.failures.push({textHash,reason:'embedding_failed'});}
      refresh();options.checkpoint?.(pack);
    }
  }
  refresh();return pack;
}
/** Pack validation must precede this adapter. Replay owns no network capability. */
export function createVectorReplayIndex(store:MemoryStore,pack:RetrievalVectorPack):MemoryIndex {
  const metadata=signatureMetadata(pack.configSignature),byTextHash=new Map(Object.values(pack.queries).map(q=>[q.textHash,q.vector]));
  const index=new MemoryIndex(store,{baseUrl:metadata.endpoint,model:metadata.model,dimensions:metadata.dimensions??undefined,async embed(text){
    const vector=byTextHash.get(hash(text));if(!vector)throw new IncompleteVectorsError(['query_vector_missing_at_replay']);return vector;
  }});
  if(index.configSignature!==pack.configSignature)throw new IncompleteVectorsError(['signature_mismatch']);
  for(const owner of store.allOwners()){
    const entry=pack.owners[`${owner.ownerType}:${owner.ownerId}`];
    if(!entry?.vector||entry.revision!==owner.revision||entry.textHash!==hash(memoryIndexText(owner)))throw new IncompleteVectorsError(['owner_mismatch_at_replay']);
    store.saveVector(owner,pack.configSignature,normalizeVector(entry.vector));
  }
  return index;
}
