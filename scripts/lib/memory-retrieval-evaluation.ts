import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Storage } from '../../src/storage';
import { initialCharacter } from '../../src/config';
import { ChatEpisodes } from '../../src/dialogue/chat-episodes';
import { DialogueStore } from '../../src/dialogue/store';
import { assertFullWindow } from '../../src/dialogue/active-consistency';
import { MemoryStore, memoryIndexText, type CandidateReadOptions } from '../../src/memory/store';
import { lexicalCoverage } from '../../src/memory/lexical';
import { MemoryIndex } from '../../src/memory/index';
import { ContextBuilder } from '../../src/memory/context';
import { MemoryRetrieval, makeRetrievalRequest, resolveLookupRequest, defaultCalibration, type RetrievalCalibration } from '../../src/memory/retrieval';
import type { MemoryCandidate, RetrievalRequest, RetrievalPermissions } from '../../src/memory/types';
import type { Message, TurnRecord, DetailHistory } from '../../src/types';
import { stageInput } from '../../src/model/context-views';
import type { ModelResourcePool, ModelRoles } from '../../src/model/context-types';
import { createVectorReplayIndex, validateRetrievalVectorPack, retrievalVectorPackHash, IncompleteVectorsError, type RetrievalVectorPack } from './memory-retrieval-vectors';
export { createVectorReplayIndex, validateRetrievalVectorPack, retrievalVectorPackHash, IncompleteVectorsError, prepareRetrievalVectorPack, loadRetrievalVectorPack, retrievalProviderSignature, type RetrievalVectorPack } from './memory-retrieval-vectors';

export type { RetrievalCalibration } from '../../src/memory/retrieval';
export type RetrievalSplit = 'development' | 'calibration' | 'holdout';
export type RetrievalGroup = 'fact' | 'experience';
export type RetrievalOwnerKey = `${MemoryCandidate['ownerType']}:${string}`;
export const retrievalCategories = ['direct','conversational','paraphrase','multi_topic','temporal','negative'] as const;
export type RetrievalCategory = typeof retrievalCategories[number];
export type PersonalStage = 'personal_chat' | 'personal_life' | 'personal_shared';
export interface RetrievalFamilyV2 {
  id:string; split:RetrievalSplit; group:RetrievalGroup;
  owners:Omit<MemoryCandidate,'normalizedVector'>[];
  messages:Message[]; turns:TurnRecord[]; detailHistory:DetailHistory[];
}
export interface RetrievalQueryV2 {
  id:string; familyId:string; text:string; phase:RetrievalRequest['phase']; at:RetrievalRequest['at'];
  candidateOwnerKeys:RetrievalOwnerKey[]; expectedOwnerKeys:RetrievalOwnerKey[];
  /** Explicit labels for owners pulled in only by provenance/canonical/history closure. */
  closureDistractorOwnerKeys?:RetrievalOwnerKey[];
  category:RetrievalCategory; permissions:RetrievalPermissions;
  scope:RetrievalRequest['scope']; includeDetailHistory:RetrievalRequest['includeDetailHistory']; rationale:string;
}
export interface RetrievalDatasetV2 {
  version:2; datasetId:string; at:string; families:RetrievalFamilyV2[]; queries:RetrievalQueryV2[];
}
export interface EvaluationMetrics {
  TP:number; FP:number; FN:number; precision:number|null; recall:number|null; F1:number|null;
  negativeFalseHits:number; queryCount:number; negativeQueryCount:number;
}
export interface RetrievalQueryEvaluation {
  id:string; familyId:string; split:RetrievalSplit; group:RetrievalGroup; category:RetrievalCategory;
  text:string; at:string; rationale:string; request:RetrievalRequest;
  candidateOwnerKeys:RetrievalOwnerKey[]; seededOwnerKeys:RetrievalOwnerKey[];
  closureDistractorOwnerKeys:RetrievalOwnerKey[];
  actualOwnerKeys:RetrievalOwnerKey[]; expectedOwnerKeys:RetrievalOwnerKey[];
  scoredActualOwnerKeys:RetrievalOwnerKey[]; scoredExpectedOwnerKeys:RetrievalOwnerKey[];
  alwaysIncludeOwnerKeys:RetrievalOwnerKey[];
  truePositiveOwnerKeys:RetrievalOwnerKey[]; falsePositiveOwnerKeys:RetrievalOwnerKey[]; falseNegativeOwnerKeys:RetrievalOwnerKey[];
  TP:number; FP:number; FN:number; negativeFalseHit:boolean;
  detailHistoryIds:string[]; sqlCandidates:number; materializedVectorBytes:number; remoteRequests:number;
  semanticSkipReason:string|null;
  personalEvidence:{stage:PersonalStage; ownerKeys:RetrievalOwnerKey[]; resources:Pick<ModelResourcePool,'owners'>; roles:ModelRoles};
}
export interface RetrievalEvaluationReport {
  version:2; datasetId:string; datasetHash:string; datasetHashBasis:'file-sha256'|'json-sha256'; at:string;
  calibration:RetrievalCalibration; splits:RetrievalSplit[];
  queries:RetrievalQueryEvaluation[]; metrics:EvaluationMetrics;
  groups:Record<RetrievalGroup,EvaluationMetrics>;
  byCategory:Record<RetrievalCategory,EvaluationMetrics>;
  bySplit:Partial<Record<RetrievalSplit,EvaluationMetrics>>;
  alwaysInclude:{queryCount:number; injections:number; ownerKeys:RetrievalOwnerKey[]};
  negativeFalseHits:number; materializedVectorBytes:number; remoteRequests:number;
  collectionNetworkRequests:number; replayProviderCalls:number; replayNetworkRequests:0|null; vectorPackHash?:string;
}
export interface FrozenRetrievalCandidate {
  calibration:RetrievalCalibration;
  selection:{datasetHash:string; split:'calibration'; [field:string]:unknown};
  [field:string]:unknown;
}
export interface LexicalSelection {
  datasetHash:string; split:'calibration';
  groups:Record<RetrievalGroup,{
    baseline:EvaluationMetrics;
    candidates:Array<{threshold:number;metrics:EvaluationMetrics;eligible:boolean;reasons:string[]}>;
    selectedThreshold:number;
  }>;
}

const splits:RetrievalSplit[]=['development','calibration','holdout'];
const groups:RetrievalGroup[]=['fact','experience'];
const sha256=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const provenance=new WeakMap<RetrievalDatasetV2,{json:string;fileHash:string}>();
const ownerKey=(owner:Pick<MemoryCandidate,'ownerType'|'ownerId'>):RetrievalOwnerKey=>`${owner.ownerType}:${owner.ownerId}`;
const unique=<T>(items:T[])=>[...new Set(items)];
function check(condition:unknown,message:string):asserts condition {if(!condition)throw new Error(message);}
function text(value:unknown,label:string):asserts value is string {check(typeof value==='string'&&value.trim().length>0,`${label} must be nonempty text`);}
function date(value:unknown,label:string):void {text(value,label);check(Number.isFinite(Date.parse(value)),`${label} must be a date`);}
function list(value:unknown,label:string):asserts value is unknown[] {check(Array.isArray(value),`${label} must be an array`);}
function strings(value:unknown,label:string):void {list(value,label);for(const item of value)text(item,label);}
function noDuplicates(values:string[],label:string):void {check(unique(values).length===values.length,`duplicate ${label}`);}

/** Exact input-file bytes when unchanged; edits receive a new deterministic JSON hash. */
export function retrievalDatasetHash(dataset:RetrievalDatasetV2):string {
  const json=JSON.stringify(dataset),source=provenance.get(dataset);
  return source?.json===json?source.fileHash:sha256(json);
}
export function loadRetrievalDataset(path:string):RetrievalDatasetV2 {
  const bytes=readFileSync(path),dataset:unknown=JSON.parse(bytes.toString('utf8'));
  validateRetrievalDataset(dataset);
  provenance.set(dataset,{json:JSON.stringify(dataset),fileHash:sha256(bytes)});
  return dataset;
}
export function validateCalibration(value:unknown):asserts value is RetrievalCalibration {
  check(!!value&&typeof value==='object','calibration must be an object');
  const c=value as RetrievalCalibration;
  check(!!c.lexical&&groups.every(g=>Number.isFinite(c.lexical[g])&&c.lexical[g]>=0&&c.lexical[g]<=1),'invalid lexical calibration');
  if(c.semantic!=null)check(groups.every(g=>Number.isFinite(c.semantic![g])&&c.semantic![g]>=-1&&c.semantic![g]<=1)&&typeof c.semantic.configSignature==='string'&&c.semantic.configSignature.length>0,'invalid semantic calibration');
}
export function validateFrozenCandidate(bytes:string|Buffer,expectedHash:string,datasetHash:string):FrozenRetrievalCandidate {
  check(/^[a-f0-9]{64}$/.test(expectedHash)&&sha256(bytes)===expectedHash,'frozen candidate hash mismatch');
  const candidate:unknown=JSON.parse(bytes.toString());
  check(!!candidate&&typeof candidate==='object','invalid frozen candidate');
  const result=candidate as FrozenRetrievalCandidate;
  validateCalibration(result.calibration);
  check(result.selection?.split==='calibration','candidate must be selected on calibration');
  check(result.selection.datasetHash===datasetHash,'frozen candidate dataset hash mismatch');
  return result;
}

/** Permissions always originate in the original query; the label cannot grant more. */
export function buildEvaluationRequest(query:RetrievalQueryV2):RetrievalRequest {
  const base=makeRetrievalRequest(query.text,query.at,query.phase,null,query.permissions.visibleSourceIds);
  check(base.permissions.allowArchive===query.permissions.allowArchive&&base.permissions.allowDetailHistory===query.permissions.allowDetailHistory,`query ${query.id}: permission labels do not match original request`);
  return resolveLookupRequest({query:query.text,scope:query.scope,includeDetailHistory:query.includeDetailHistory},base);
}

function references(owner:MemoryCandidate,family:RetrievalFamilyV2):RetrievalOwnerKey[] {
  const refs:RetrievalOwnerKey[]=[];
  if(owner.linkedLongId)refs.push(`long:${owner.linkedLongId}`);
  if(owner.canonicalMemoryId)refs.push(`long:${owner.canonicalMemoryId}`);
  if(owner.mergedInto)refs.push(`${owner.ownerType}:${owner.mergedInto}`);
  for(const id of owner.evidenceMemoryIds??[])refs.push(`long:${id}`);
  for(const ref of owner.evidenceVersions??[])refs.push(ownerKey(ref));
  const historySources=owner.ownerType==='detail'?family.detailHistory.filter(h=>h.key===owner.key).flatMap(h=>h.sourceIds):[];
  for(const id of [...owner.sourceIds,...owner.projectionBasis?.sourceIds??[],...historySources])
    for(const match of family.owners.filter(o=>o.ownerId===id))refs.push(ownerKey(match));
  return unique(refs);
}
function ownerClosure(family:RetrievalFamilyV2,declared:RetrievalOwnerKey[]):MemoryCandidate[] {
  const owners=new Map(family.owners.map(o=>[ownerKey(o),o])),included=new Map<RetrievalOwnerKey,MemoryCandidate>();
  const pending=[...declared];
  while(pending.length){
    const key=pending.shift()!;if(included.has(key))continue;
    const owner=owners.get(key);check(owner,`candidate/canonical owner missing: ${key}`);
    included.set(key,owner);pending.push(...references(owner,family));
  }
  return [...included.values()];
}

/** Production/CLI validation is strict. Only small contract fixtures use benchmarkShape:false. */
export function validateRetrievalDataset(value:unknown,options:{benchmarkShape?:boolean}={}):asserts value is RetrievalDatasetV2 {
  check(!!value&&typeof value==='object','dataset must be an object');
  const d=value as RetrievalDatasetV2;
  check(d.version===2,'dataset version must be 2');text(d.datasetId,'datasetId');date(d.at,'dataset at');
  list(d.families,'families');list(d.queries,'queries');
  noDuplicates(d.families.map(f=>f.id),'family id');noDuplicates(d.queries.map(q=>q.id),'query id');
  const globalOwners=new Set<string>(),globalSources=new Set<string>();
  for(const f of d.families){
    text(f.id,'family id');check(splits.includes(f.split),'invalid family split');check(groups.includes(f.group),'invalid family group');
    list(f.owners,'owners');list(f.messages,'messages');list(f.turns,'turns');list(f.detailHistory,'detailHistory');
    noDuplicates(f.owners.map(ownerKey),'owner key');noDuplicates(f.messages.map(m=>m.id),'message id');noDuplicates(f.turns.map(t=>t.id),'turn id');
    // MemoryStore stores short and long owners together under a table-level id primary key.
    const physicalOwners=new Set<string>();
    for(const owner of f.owners){
      const table=owner.ownerType==='detail'?'details':owner.ownerType==='learned'?'learned_background':'memories';
      const physicalKey=JSON.stringify([table,owner.ownerId]);
      check(!physicalOwners.has(physicalKey),`physical owner collision in ${table}: ${owner.ownerId}`);physicalOwners.add(physicalKey);
    }
    const sourceIds=new Set([...f.messages.map(m=>m.id),...f.turns.flatMap(t=>t.frozenResult?.experiences.map(e=>e.id)??[]),...f.owners.map(o=>o.ownerId)]);
    const assertSources=(ids:string[])=>{strings(ids,'sourceIds');for(const id of ids)check(sourceIds.has(id),`family ${f.id}: source missing: ${id}`);};
    for(const m of f.messages){
      text(m.id,'message id');text(m.content,'message content');date(m.receivedAt,'message receivedAt');strings(m.platformMessageIds,'platformMessageIds');
      check(m.direction==='incoming'||m.direction==='outgoing','invalid message direction');
      for(const field of ['batchId','seenTurnId','turnId'] as const)check(m[field]===null||typeof m[field]==='string',`missing message ${field}`);
      check(m.outboxSeq===null||Number.isInteger(m.outboxSeq),'missing message outboxSeq');
      check(!m.sharedActivityId,'activity message seeds require an activity snapshot');
      check(m.chatEpisodeId==null&&!m.dialogueEpisodeId,'seed messages must be indexed through ChatEpisodes');
      for(const id of [m.turnId,m.seenTurnId])if(id)check(f.turns.some(t=>t.id===id),`message turn missing: ${id}`);
      check(!globalSources.has(m.id),`source shared across families: ${m.id}`);globalSources.add(m.id);
    }
    for(const t of f.turns){
      text(t.id,'turn id');date(t.at,'turn at');check(t.done&&t.outputComplete,'seed turns must be completed');
      date(t.completedAt,'turn completedAt');strings(t.inputMessageIds,'inputMessageIds');strings(t.triggerTaskIds,'triggerTaskIds');strings(t.triggerKinds,'triggerKinds');strings(t.batchIds,'batchIds');text(t.entryMode,'turn entryMode');
      check(t.frozenResult===null||typeof t.frozenResult==='object','missing frozenResult');
      for(const id of t.inputMessageIds)check(f.messages.some(m=>m.id===id),`turn source missing: ${id}`);
    }
    for(const o of f.owners){
      const key=ownerKey(o);check(!globalOwners.has(key),`owner shared across families: ${key}`);globalOwners.add(key);
      check(['short','long','detail','learned'].includes(o.ownerType)&&o.kind===o.ownerType&&o.id===o.ownerId,'invalid owner identity');
      text(o.ownerId,'ownerId');text(o.content,'owner content');strings(o.topics,'topics');
      check(Number.isInteger(o.revision)&&o.revision>=1&&Number.isInteger(o.stateVersion)&&o.stateVersion>=1,'invalid owner version');
      check(['active','merged','durable','discarded'].includes(o.status),'invalid owner status');
      check(o.importance==='normal'||o.importance==='high','invalid owner importance');
      check(o.summaryQuality==='preview'||o.summaryQuality==='refined','invalid summaryQuality');
      for(const field of ['createdAt','happenedAt','lastEventUpdateAt'] as const)date(o[field],field);
      for(const field of ['retainedFrom','expiresAt','shortExpiresAt'] as const){check(o[field]===null||typeof o[field]==='string',`missing ${field}`);if(o[field]!==null)date(o[field],field);}
      for(const field of ['eventSummary','feelingSummary'] as const)check(typeof o[field]==='string',`missing ${field}`);
      for(const field of ['totalAwakenings','windowAwakenings','legacyMentions'] as const)check(Number.isInteger(o[field])&&o[field]>=0,`invalid ${field}`);
      for(const field of ['mergedInto','linkedLongId'] as const)check(o[field]===null||typeof o[field]==='string',`missing ${field}`);
      for(const field of ['evaluatedEvidenceVersion','consolidatedRevision'] as const)check(o[field]===null||Number.isInteger(o[field]),`missing ${field}`);
      check(!('normalizedVector' in o),'dataset owner vectors must be supplied by an indexFactory');
      if(o.ownerType==='detail'){text(o.key,'detail key');text(o.value,'detail value');strings(o.aliases,'detail aliases');date(o.effectiveAt,'detail effectiveAt');}
      assertSources(o.sourceIds);if(o.projectionBasis)assertSources(o.projectionBasis.sourceIds);
      ownerClosure(f,[key]);
    }
    for(const h of f.detailHistory){text(h.id,'history id');text(h.key,'history key');text(h.newValue,'history newValue');text(h.reason,'history reason');check(h.previousValue===null||typeof h.previousValue==='string','invalid history previousValue');date(h.effectiveAt,'history effectiveAt');assertSources(h.sourceIds);check(f.turns.some(t=>t.id===h.turnId),'history turn missing');check(f.owners.some(o=>o.ownerType==='detail'&&o.key===h.key),'history detail missing');}
  }
  const queryFamilies=new Map<string,string>();
  for(const q of d.queries){
    text(q.id,'query id');text(q.text,'query text');text(q.rationale,'query rationale');text(q.phase,'phase');date(q.at,'query at');
    check(retrievalCategories.includes(q.category),'invalid query category');
    const f=d.families.find(f=>f.id===q.familyId);check(f,`query family missing: ${q.familyId}`);
    const previousFamily=queryFamilies.get(q.text.trim());
    check(!previousFamily||previousFamily===f.id,'query text shared across families');queryFamilies.set(q.text.trim(),f.id);
    strings(q.candidateOwnerKeys,'candidateOwnerKeys');strings(q.expectedOwnerKeys,'expectedOwnerKeys');
    noDuplicates(q.candidateOwnerKeys,'candidate owner key');noDuplicates(q.expectedOwnerKeys,'expected owner key');
    const closure=ownerClosure(f,q.candidateOwnerKeys),keys=new Set(closure.map(ownerKey));
    for(const key of q.expectedOwnerKeys)check(keys.has(key),`expected owner missing from seeded closure: ${key}`);
    const closureLabels=q.closureDistractorOwnerKeys??[];strings(closureLabels,'closureDistractorOwnerKeys');noDuplicates(closureLabels,'closure distractor key');
    for(const key of closureLabels)check(keys.has(key)&&!q.expectedOwnerKeys.includes(key)&&!q.candidateOwnerKeys.includes(key),`invalid closure distractor label: ${key}`);
    for(const key of keys)check(q.candidateOwnerKeys.includes(key)||q.expectedOwnerKeys.includes(key)||closureLabels.includes(key),`closure owner requires expected or distractor label: ${key}`);
    check(!!q.permissions&&typeof q.permissions.allowArchive==='boolean'&&typeof q.permissions.allowDetailHistory==='boolean','permissions required');strings(q.permissions.visibleSourceIds,'visibleSourceIds');
    for(const id of q.permissions.visibleSourceIds)check(f.messages.some(m=>m.id===id),`visible source missing: ${id}`);
    check(q.scope==='current'||q.scope==='archive','invalid scope');check(typeof q.includeDetailHistory==='boolean','invalid includeDetailHistory');
    buildEvaluationRequest(q);
    if(q.category==='negative')check(q.expectedOwnerKeys.length===0,'negative query expectation must be empty');
    else if(options.benchmarkShape!==false){
      check(q.expectedOwnerKeys.length>0,'positive query requires expectation');
      check([...keys].filter(k=>!q.expectedOwnerKeys.includes(k)).length>=3,'positive query requires three distractors');
    }
  }
  if(options.benchmarkShape!==false){
    check(d.families.length===60&&d.queries.length===360,'benchmark requires 60 families and 360 queries');
    for(const f of d.families){const categories=d.queries.filter(q=>q.familyId===f.id).map(q=>q.category);check(categories.length===6&&unique(categories).length===6,'six distinct categories required per family');}
    for(const group of groups)for(const split of splits){const expected=split==='development'?16:split==='calibration'?8:6;check(d.families.filter(f=>f.group===group&&f.split===split).length===expected,`stratification mismatch: ${group}/${split}`);}
  }
}

class EvaluationMemoryStore extends MemoryStore {
  materializedVectorBytes=0;
  override selectCandidates(request:RetrievalRequest,options:CandidateReadOptions={}):MemoryCandidate[] {
    const rows=super.selectCandidates(request,options);
    this.materializedVectorBytes+=rows.reduce((sum,row)=>sum+(row.normalizedVector?.byteLength??0),0);
    return rows;
  }
}
function seedFamily(storage:Storage,store:MemoryStore,family:RetrievalFamilyV2,query:RetrievalQueryV2):void {
  store.migrate(query.at);
  storage.set('character',initialCharacter(query.at));
  const dialogue=new ChatEpisodes(new DialogueStore(storage));
  for(const turn of family.turns)storage.save('turns',turn.id,structuredClone(turn));
  for(const message of [...family.messages].sort((a,b)=>Date.parse(a.receivedAt)-Date.parse(b.receivedAt)||a.id.localeCompare(b.id)))dialogue.acceptMessage(structuredClone(message));
  assertFullWindow(storage);
  for(const owner of ownerClosure(family,query.candidateOwnerKeys))store.saveOwner(structuredClone(owner));
  for(const history of family.detailHistory)storage.save('detail_history',history.id,structuredClone(history));
}
export function evaluationMetrics(rows:RetrievalQueryEvaluation[]):EvaluationMetrics {
  const TP=rows.reduce((n,r)=>n+r.TP,0),FP=rows.reduce((n,r)=>n+r.FP,0),FN=rows.reduce((n,r)=>n+r.FN,0);
  const precision=TP+FP?TP/(TP+FP):null,recall=TP+FN?TP/(TP+FN):null;
  const F1=precision===null||recall===null?null:precision+recall?2*precision*recall/(precision+recall):0;
  return {TP,FP,FN,precision,recall,F1,negativeFalseHits:rows.filter(r=>r.negativeFalseHit).length,queryCount:rows.length,negativeQueryCount:rows.filter(r=>r.scoredExpectedOwnerKeys.length===0).length};
}

/** Offline by default. A caller-supplied indexFactory is the sole embedding capability. */
export async function evaluateRetrievalDataset(dataset:RetrievalDatasetV2,calibration:RetrievalCalibration,options:{splits:RetrievalSplit[];indexFactory?:(store:MemoryStore)=>MemoryIndex;vectors?:RetrievalVectorPack}):Promise<RetrievalEvaluationReport> {
  validateRetrievalDataset(dataset,{benchmarkShape:false});validateCalibration(calibration);
  if(options.vectors){check(!options.indexFactory,'vectors and indexFactory are mutually exclusive');validateRetrievalVectorPack(dataset,options.vectors,calibration.semantic?.configSignature);}
  else if(calibration.semantic&&!options.indexFactory)throw new IncompleteVectorsError(['vectors_required']);
  check(options.splits.length>0&&options.splits.every(s=>splits.includes(s)),'at least one valid split is required');noDuplicates(options.splits,'split');
  const results:RetrievalQueryEvaluation[]=[];
  for(const query of dataset.queries){
    const family=dataset.families.find(f=>f.id===query.familyId)!;if(!options.splits.includes(family.split))continue;
    const storage=new Storage(':memory:');
    try {
      const store=new EvaluationMemoryStore(storage);seedFamily(storage,store,family,query);
      const index=options.vectors?createVectorReplayIndex(store,options.vectors):options.indexFactory?.(store),request=buildEvaluationRequest(query);
      const seeded=store.allOwners(),seededOwnerKeys=seeded.map(ownerKey).sort();
      const retrieval=new MemoryRetrieval(store,index,{},calibration);
      const remoteBefore=index?.stats.remoteRequests??0;
      const context=await new ContextBuilder(storage,retrieval).build(request);
      const selected=[...context.details,...context.shortTerm,...context.longTerm,...context.learned];
      const actualOwnerKeys=selected.map(ownerKey);
      const unconditional=new Set(seeded.filter(o=>o.ownerType==='learned'&&o.alwaysInclude).map(ownerKey));
      const alwaysIncludeOwnerKeys=actualOwnerKeys.filter(k=>unconditional.has(k));
      const scoredActualOwnerKeys=actualOwnerKeys.filter(k=>!unconditional.has(k));
      const scoredExpectedOwnerKeys=query.expectedOwnerKeys.filter(k=>!unconditional.has(k));
      const truePositiveOwnerKeys=scoredActualOwnerKeys.filter(k=>scoredExpectedOwnerKeys.includes(k));
      const falsePositiveOwnerKeys=scoredActualOwnerKeys.filter(k=>!scoredExpectedOwnerKeys.includes(k));
      const falseNegativeOwnerKeys=scoredExpectedOwnerKeys.filter(k=>!scoredActualOwnerKeys.includes(k));
      const stage:PersonalStage=query.phase==='personal_life'?'personal_life':query.phase==='personal_shared'?'personal_shared':'personal_chat';
      const input=stageInput(stage,{history:context,at:query.at,state:initialCharacter(query.at),dialogueWindowVersion:2,visibleMessages:family.messages.filter(m=>query.permissions.visibleSourceIds.includes(m.id)),tasks:[],dueTasks:[],background:'合成离线评估场景',chatExamples:''});
      const evidenceKeys=input.resources.owners.map(o=>`${o.kind}:${o.id}` as RetrievalOwnerKey);
      check(JSON.stringify([...evidenceKeys].sort())===JSON.stringify([...actualOwnerKeys].sort()),'personal evidence owner mismatch');
      const refs=[...input.roles.detailRefs??[],...input.roles.shortRefs??[],...input.roles.longRefs??[],...input.roles.learnedRefs??[]];
      check(refs.length===input.resources.owners.length&&refs.every(ref=>input.resources.owners.some(o=>o.ref===ref)),'personal evidence role mismatch');
      results.push({id:query.id,familyId:family.id,split:family.split,group:family.group,category:query.category,text:query.text,at:query.at,rationale:query.rationale,request,
        candidateOwnerKeys:[...query.candidateOwnerKeys],seededOwnerKeys,closureDistractorOwnerKeys:seededOwnerKeys.filter(k=>!query.candidateOwnerKeys.includes(k)&&!query.expectedOwnerKeys.includes(k)),
        actualOwnerKeys,expectedOwnerKeys:[...query.expectedOwnerKeys],scoredActualOwnerKeys,scoredExpectedOwnerKeys,alwaysIncludeOwnerKeys,truePositiveOwnerKeys,falsePositiveOwnerKeys,falseNegativeOwnerKeys,
        TP:truePositiveOwnerKeys.length,FP:falsePositiveOwnerKeys.length,FN:falseNegativeOwnerKeys.length,negativeFalseHit:scoredExpectedOwnerKeys.length===0&&falsePositiveOwnerKeys.length>0,
        detailHistoryIds:context.detailHistory.map(h=>h.id),sqlCandidates:retrieval.metrics.candidates,materializedVectorBytes:store.materializedVectorBytes,remoteRequests:(index?.stats.remoteRequests??0)-remoteBefore,semanticSkipReason:retrieval.metrics.semanticSkipReason,
        personalEvidence:{stage,ownerKeys:evidenceKeys,resources:{owners:input.resources.owners},roles:input.roles}});
    } finally {storage.close();}
  }
  const metrics=evaluationMetrics(results),source=provenance.get(dataset);
  return {version:2,datasetId:dataset.datasetId,datasetHash:retrievalDatasetHash(dataset),datasetHashBasis:source?.json===JSON.stringify(dataset)?'file-sha256':'json-sha256',at:dataset.at,calibration:structuredClone(calibration),splits:[...options.splits],queries:results,metrics,
    groups:{fact:evaluationMetrics(results.filter(r=>r.group==='fact')),experience:evaluationMetrics(results.filter(r=>r.group==='experience'))},
    byCategory:Object.fromEntries(retrievalCategories.map(c=>[c,evaluationMetrics(results.filter(r=>r.category===c))])) as Record<RetrievalCategory,EvaluationMetrics>,
    bySplit:Object.fromEntries(options.splits.map(s=>[s,evaluationMetrics(results.filter(r=>r.split===s))])),
    alwaysInclude:{queryCount:results.filter(r=>r.alwaysIncludeOwnerKeys.length>0).length,injections:results.reduce((n,r)=>n+r.alwaysIncludeOwnerKeys.length,0),ownerKeys:unique(results.flatMap(r=>r.alwaysIncludeOwnerKeys)).sort()},
    negativeFalseHits:metrics.negativeFalseHits,materializedVectorBytes:results.reduce((n,r)=>n+r.materializedVectorBytes,0),remoteRequests:results.reduce((n,r)=>n+r.remoteRequests,0),
    collectionNetworkRequests:options.vectors?.collectionNetworkRequests??0,replayProviderCalls:options.vectors?results.reduce((n,r)=>n+r.remoteRequests,0):0,replayNetworkRequests:options.indexFactory?null:0,...options.vectors?{vectorPackHash:retrievalVectorPackHash(options.vectors)}:{}};
}

export interface SemanticCandidateEvaluation {
  semantic:RetrievalCalibration['semantic']; metrics:EvaluationMetrics; groups:Record<RetrievalGroup,EvaluationMetrics>;
  eligible:boolean; reasons:string[]; replayProviderCalls:number;
}
export interface SemanticSelection {
  datasetHash:string; vectorPackHash:string; configSignature:string; split:'calibration';
  thresholdGrid:number[]; candidates:SemanticCandidateEvaluation[]; selectedSemantic:RetrievalCalibration['semantic'];
  baseline:SemanticCandidateEvaluation; selected:SemanticCandidateEvaluation;
  comparison:ReturnType<typeof recommendLexicalCandidate>;
  collectionNetworkRequests:number; replayProviderCalls:number; replayNetworkRequests:0;
}
/** Fixed before any evaluation. Both groups use the full Cartesian product, plus a genuinely disabled baseline. */
export const semanticThresholdGrid=Object.freeze([-1,0,0.5,0.75,0.9,1]);
export async function selectSemanticCalibration(dataset:RetrievalDatasetV2,vectors:RetrievalVectorPack):Promise<{calibration:RetrievalCalibration;selection:SemanticSelection}> {
  if(!vectors)throw new IncompleteVectorsError(['vectors_required']);
  validateRetrievalVectorPack(dataset,vectors);
  const families=dataset.families.filter(f=>f.split==='calibration'),ids=new Set(families.map(f=>f.id));
  const subset={...dataset,families,queries:dataset.queries.filter(q=>ids.has(q.familyId))};
  validateRetrievalDataset(subset,{benchmarkShape:false});
  const ownerIds=new Set(families.flatMap(f=>f.owners.map(ownerKey))),queryIds=new Set(subset.queries.map(q=>q.id));
  const subsetVectors:RetrievalVectorPack={...vectors,datasetHash:retrievalDatasetHash(subset),owners:Object.fromEntries(Object.entries(vectors.owners).filter(([id])=>ownerIds.has(id as RetrievalOwnerKey))),queries:Object.fromEntries(Object.entries(vectors.queries).filter(([id])=>queryIds.has(id)))};
  const baselineReport=await evaluateRetrievalDataset(subset,defaultCalibration,{splits:['calibration'],vectors:subsetVectors});
  function trial(report:RetrievalEvaluationReport):SemanticCandidateEvaluation {
    const reasons:string[]=[];
    for(const group of groups){
      const m=report.groups[group];
      if(m.precision===null||m.recall===null||m.F1===null)reasons.push(`${group}:undefined_candidate_metrics`);
      if(m.precision!==null&&m.precision<0.95)reasons.push(`${group}:precision_below_0.95`);
      if(m.negativeFalseHits>baselineReport.groups[group].negativeFalseHits)reasons.push(`${group}:negative_false_hits_increased`);
    }
    if(report.metrics.precision===null||report.metrics.recall===null||report.metrics.F1===null)reasons.push('undefined_candidate_metrics');
    return {semantic:report.calibration.semantic??null,metrics:report.metrics,groups:report.groups,eligible:reasons.length===0,reasons,replayProviderCalls:report.replayProviderCalls};
  }
  const baseline=trial(baselineReport),candidates:SemanticCandidateEvaluation[]=[baseline];
  for(const fact of semanticThresholdGrid)for(const experience of semanticThresholdGrid){
    const calibration={lexical:{fact:1,experience:1},semantic:{fact,experience,configSignature:vectors.configSignature}};
    candidates.push(trial(await evaluateRetrievalDataset(subset,calibration,{splits:['calibration'],vectors:subsetVectors})));
  }
  const eligible=candidates.filter(c=>c.eligible).sort((a,b)=>b.metrics.F1!-a.metrics.F1!||b.metrics.precision!-a.metrics.precision!||(b.semantic?.fact??-Infinity)-(a.semantic?.fact??-Infinity)||(b.semantic?.experience??-Infinity)-(a.semantic?.experience??-Infinity));
  const selected=eligible[0]??baseline,calibration={lexical:{fact:1,experience:1},semantic:selected.semantic??null};
  return {calibration,selection:{datasetHash:retrievalDatasetHash(dataset),vectorPackHash:retrievalVectorPackHash(vectors),configSignature:vectors.configSignature,split:'calibration',thresholdGrid:[...semanticThresholdGrid],candidates,selectedSemantic:calibration.semantic,baseline,selected,comparison:recommendLexicalCandidate(baseline,selected),collectionNetworkRequests:vectors.collectionNetworkRequests,replayProviderCalls:candidates.reduce((n,c)=>n+c.replayProviderCalls,0),replayNetworkRequests:0}};
}

/** Hash binds the complete frozen dataset; selection reads labels from calibration only. */
export async function selectLexicalCalibration(dataset:RetrievalDatasetV2):Promise<{calibration:RetrievalCalibration;selection:LexicalSelection}> {
  const families=dataset.families.filter(f=>f.split==='calibration'),ids=new Set(families.map(f=>f.id));
  const subset={...dataset,families,queries:dataset.queries.filter(q=>ids.has(q.familyId))};
  validateRetrievalDataset(subset,{benchmarkShape:false});
  const calibration:RetrievalCalibration={lexical:{fact:1,experience:1},semantic:null};
  const selection:LexicalSelection={datasetHash:retrievalDatasetHash(dataset),split:'calibration',groups:{} as LexicalSelection['groups']};
  for(const group of groups){
    const groupFamilies=families.filter(f=>f.group===group),groupIds=new Set(groupFamilies.map(f=>f.id));
    const samples={...subset,families:groupFamilies,queries:subset.queries.filter(q=>groupIds.has(q.familyId))};
    const baseline=(await evaluateRetrievalDataset(samples,defaultCalibration,{splits:['calibration']})).metrics;
    const thresholds=new Set([1]);
    for(const query of samples.queries){
      const family=groupFamilies.find(f=>f.id===query.familyId)!;
      for(const row of ownerClosure(family,query.candidateOwnerKeys)){
        if((row.ownerType==='detail'?'fact':'experience')!==group)continue;
        const content=row.kind==='learned'?memoryIndexText(row):`${row.content} ${row.topics.join(' ')} ${row.feelingSummary} ${row.key??''} ${row.aliases?.join(' ')??''}`;
        const score=lexicalCoverage(query.text,content);if(score>0)thresholds.add(score);
      }
    }
    const candidates:LexicalSelection['groups']['fact']['candidates']=[];
    for(const threshold of [...thresholds].sort((a,b)=>b-a)){
      const trial:RetrievalCalibration={lexical:{fact:1,experience:1,[group]:threshold},semantic:null};
      const metrics=threshold===1?baseline:(await evaluateRetrievalDataset(samples,trial,{splits:['calibration']})).metrics;
      const reasons:string[]=[];
      if(metrics.precision===null||metrics.recall===null||metrics.F1===null)reasons.push('undefined_candidate_metrics');
      if(metrics.precision!==null&&metrics.precision<0.95)reasons.push('precision_below_0.95');
      if(metrics.negativeFalseHits>baseline.negativeFalseHits)reasons.push('negative_false_hits_increased');
      candidates.push({threshold,metrics,eligible:reasons.length===0,reasons});
    }
    const eligible=candidates.filter(c=>c.eligible).sort((a,b)=>b.metrics.F1!-a.metrics.F1!||b.metrics.precision!-a.metrics.precision!||b.threshold-a.threshold);
    calibration.lexical[group]=eligible[0]?.threshold??1;
    selection.groups[group]={baseline,candidates,selectedThreshold:calibration.lexical[group]};
  }
  return {calibration,selection};
}

type RecommendationInput=Pick<RetrievalEvaluationReport,'metrics'|'groups'>;
export function recommendLexicalCandidate(baseline:RecommendationInput,candidate:RecommendationInput):{recommendation:'recommend_candidate'|'keep_current';reasons:string[];recallGain:number|null} {
  const reasons:string[]=[];
  for(const group of groups){
    const b=baseline.groups[group],c=candidate.groups[group];
    if(c.precision===null||c.recall===null||c.F1===null)reasons.push(`${group}:undefined_candidate_metrics`);
    if(c.precision!==null&&c.precision<0.95)reasons.push(`${group}:precision_below_0.95`);
    if(b.precision!==null&&c.precision!==null&&c.precision<b.precision)reasons.push(`${group}:precision_regressed`);
    if(c.negativeFalseHits>b.negativeFalseHits)reasons.push(`${group}:negative_false_hits_increased`);
  }
  if(candidate.metrics.precision===null||candidate.metrics.recall===null||candidate.metrics.F1===null)reasons.push('undefined_candidate_metrics');
  if(candidate.metrics.negativeFalseHits>baseline.metrics.negativeFalseHits)reasons.push('negative_false_hits_increased');
  const recallGain=baseline.metrics.recall===null||candidate.metrics.recall===null?null:candidate.metrics.recall-baseline.metrics.recall;
  if(recallGain===null)reasons.push('undefined_recall_gain');
  else if(recallGain+1e-12<0.10)reasons.push('recall_gain_below_0.10');
  return {recommendation:reasons.length?'keep_current':'recommend_candidate',reasons,recallGain};
}

/** Caller must persist the frozen candidate and claim holdout use before entering this function. */
export async function evaluatePairedHoldout(dataset:RetrievalDatasetV2,bytes:string|Buffer,candidateHash:string,vectors?:RetrievalVectorPack) {
  const datasetHash=retrievalDatasetHash(dataset),frozen=validateFrozenCandidate(bytes,candidateHash,datasetHash);
  if(vectors)validateSemanticFrozenCandidate(frozen,dataset,vectors);
  else {check(!frozen.selection.vectorPackHash,'semantic candidate requires vectors');check(frozen.calibration.semantic===null,'lexical candidate semantic must be null');}
  const baseline=await evaluateRetrievalDataset(dataset,defaultCalibration,{splits:['holdout'],vectors});
  const candidate=await evaluateRetrievalDataset(dataset,frozen.calibration,{splits:['holdout'],vectors});
  const queryDifferences=baseline.queries.map((before,i)=>{
    const after=candidate.queries[i];
    check(before.id===after.id&&JSON.stringify(before.request)===JSON.stringify(after.request)&&JSON.stringify(before.seededOwnerKeys)===JSON.stringify(after.seededOwnerKeys),'paired evaluation seed/request mismatch');
    check(JSON.stringify(before.alwaysIncludeOwnerKeys)===JSON.stringify(after.alwaysIncludeOwnerKeys),'paired alwaysInclude mismatch');
    return {id:before.id,familyId:before.familyId,group:before.group,
      addedOwnerKeys:after.actualOwnerKeys.filter(k=>!before.actualOwnerKeys.includes(k)),removedOwnerKeys:before.actualOwnerKeys.filter(k=>!after.actualOwnerKeys.includes(k)),
      baseline:{TP:before.TP,FP:before.FP,FN:before.FN,negativeFalseHit:before.negativeFalseHit},candidate:{TP:after.TP,FP:after.FP,FN:after.FN,negativeFalseHit:after.negativeFalseHit}};
  });
  return {version:2,datasetHash,candidateHash,splits:['holdout'] as const,calibration:frozen.calibration,selection:frozen.selection,
    lexicalDifference:{fact:frozen.calibration.lexical.fact-1,experience:frozen.calibration.lexical.experience-1},
    baseline,candidate,queryDifferences,...vectors?{vectorPackHash:retrievalVectorPackHash(vectors),collectionNetworkRequests:vectors.collectionNetworkRequests,replayProviderCalls:baseline.replayProviderCalls+candidate.replayProviderCalls,replayNetworkRequests:0}:{},...recommendLexicalCandidate(baseline,candidate)};
}

export function validateSemanticFrozenCandidate(frozen:FrozenRetrievalCandidate,dataset:RetrievalDatasetV2,vectors:RetrievalVectorPack):void {
  validateRetrievalVectorPack(dataset,vectors,frozen.calibration.semantic?.configSignature);
  if(frozen.selection.vectorPackHash!==retrievalVectorPackHash(vectors))throw new IncompleteVectorsError(['frozen_candidate_vector_pack_hash_mismatch']);
  if(frozen.selection.configSignature!==vectors.configSignature)throw new IncompleteVectorsError(['frozen_candidate_signature_mismatch']);
  check(frozen.calibration.lexical.fact===1&&frozen.calibration.lexical.experience===1,'semantic candidate lexical thresholds must remain 1');
}
