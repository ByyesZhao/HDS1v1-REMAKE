import {createHash} from 'node:crypto';
import type {Dependencies} from '../app';
import type {EnvironmentStep,EnvironmentStepInput,EnvironmentStage} from './types';
import type {SchoolReadView} from '../school/read-view';
import type {SchoolPlan,SchoolPlanItem,SchoolInstance,SchoolNotice,SchoolWeek,SchoolKnowledge,SchoolProgress} from '../school/types';
import type {EnvironmentEvent,Message,ScheduledTask} from '../types';
import {environmentInput} from './runtime';
import {MemoryRetrieval,makeRetrievalRequest,resolveLookupRequest,semanticPreflight,type SemanticCapability} from '../memory/retrieval';
import {MemoryStore} from '../memory/store';
import type {MemoryCandidate,LookupRequest,RetrievedContext,RetrievalRequest} from '../memory/types';
import {DialogueStore} from '../dialogue/store';
import {ChatEpisodes} from '../dialogue/chat-episodes';
import {DialogueEpisodes} from '../dialogue/episodes';
import {captureMessageSourceValidity} from '../dialogue/active-consistency';
export interface EnvironmentSchoolRows {school_plans:SchoolPlan[];school_plan_items:SchoolPlanItem[];school_instances:SchoolInstance[];school_notices:SchoolNotice[];school_weeks:SchoolWeek[];school_knowledge:SchoolKnowledge[];school_progress:SchoolProgress[]}
export interface EnvironmentSourcePresence {table:'messages'|'experiences'|'self_web_read_sources';id:string}
export interface EnvironmentLookupBasis {owners:Array<Pick<MemoryCandidate,'ownerType'|'ownerId'|'revision'|'stateVersion'|'status'>>;messageIds:string[];sources:EnvironmentSourcePresence[]}
export interface FrozenEnvironmentRetrieval {request:RetrievalRequest;candidates:Array<Omit<MemoryCandidate,'normalizedVector'>&{normalizedVector?:number[]}>;recent:Message[];sourcePresence:EnvironmentSourcePresence[];invalidSourceIds:string[];signature:string;semanticPolicy?:{version:1;capability:SemanticCapability;vectorsIncluded:boolean}}
export interface EnvironmentPreparationSnapshot {version:1;at:string;timezone:string;input:EnvironmentStepInput;school:EnvironmentSchoolRows;businessBasis:string;retrieval:FrozenEnvironmentRetrieval;usedBasis:EnvironmentLookupBasis|null}
export function digest(value:unknown):string {
 const stable=(v:any):any=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;
 return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}
export function frozenSchoolView(snapshot:Pick<EnvironmentPreparationSnapshot,'school'>):SchoolReadView {
 const rows=snapshot.school;
 return {all:(table: keyof EnvironmentSchoolRows)=>{if(!(table in rows))throw Error('unfrozen school table '+table);return structuredClone(rows[table]);},read:(table:keyof EnvironmentSchoolRows,id:string)=>{if(!(table in rows))throw Error('unfrozen school table '+table);return structuredClone(rows[table].find(r=>r.id===id)??null);}} as SchoolReadView;
}
function sorted<T extends {id:string}>(rows:T[]):T[]{return [...rows].sort((a,b)=>a.id.localeCompare(b.id));}
function noticeBasis(n:SchoolNotice){const {releasedAt,readAt,readTurnId,nextWakeAt,status,...business}=n;return {...business,invalidated:status==='invalidated'};}
export function environmentBusinessBasis(d:Dependencies,stage:EnvironmentStage):string{
 const events=d.storage.all('events').filter(e=>e.status==='active'&&e.kind==='world');
 const owner=stage==='school_campus'?'campus':'group';
 const school=stage==='world'?{}:stage==='school_week'?{
 items:sorted(d.schoolStore.items()),instances:sorted(d.schoolStore.instances()),weeks:sorted(d.storage.all('school_weeks')),
 known:sorted(d.storage.all('school_knowledge')),appointments:sorted(d.storage.pendingTasks().filter(t=>t.kind==='appointment')),
 notices:sorted(d.schoolStore.notices()).map(noticeBasis)
 }:{plans:sorted(d.schoolStore.plans().filter(p=>p.owner===owner)),items:sorted(d.schoolStore.items().filter(i=>i.owner===owner)),...(stage==='school_group'?{progress:sorted(d.schoolStore.progress()),campusTiming:sorted(d.schoolStore.items().filter(i=>i.owner==='campus')).map(i=>({id:i.id,title:i.title,timing:i.timing}))}:{})};
 return digest({events:stage==='school_week'?undefined:sorted(events),school,background:d.config.background,backgroundViews:d.config.backgroundViews,worldSetting:d.config.worldSetting,schoolSetting:d.config.schoolSetting,timezone:d.config.timezone});
}
export function retrievalFor(d:Dependencies):MemoryRetrieval{return d.retrieval??new MemoryRetrieval(d.memoryStore??new MemoryStore(d.storage));}
function captureSourcePresence(d:Dependencies,ids:readonly string[]):EnvironmentSourcePresence[]{
 const unique=[...new Set(ids)].sort(),result:EnvironmentSourcePresence[]=[];
 for(const table of ['messages','experiences','self_web_read_sources'] as const)for(let i=0;i<unique.length;i+=500){
 const chunk=unique.slice(i,i+500);
 const rows=d.storage.prepare('SELECT id FROM '+table+' WHERE id IN ('+chunk.map(()=>'?').join(',')+') ORDER BY id').all(...chunk);
 for(const row of rows)result.push({table,id:String(row.id)});
 }
 return result;
}
export function freezeEnvironmentRetrieval(d:Dependencies,stage:EnvironmentStage,at:string):FrozenEnvironmentRetrieval{
 const retrieval=retrievalFor(d),query=stage==='world'?d.config.worldSetting:d.config.schoolSetting,request=makeRetrievalRequest(query,at,stage,d.config.historyBudget);
 const capability=retrieval.semanticCapability(),vectorsIncluded=capability.reason===null;
 const candidates=retrieval.store.selectCandidates(request,{includeVectors:vectorsIncluded});
 const recent=new (d.storage.runtime().dialogueContextVersion===2?ChatEpisodes:DialogueEpisodes)(new DialogueStore(d.storage),retrieval.limits.dialogueIdleMinutes).recent(stage,at,retrieval.limits.recentDialogueSegments,[]).messages;
 const ids=[...new Set([...candidates.flatMap(c=>c.sourceIds),...recent.map(m=>m.id)])];
 const sourcePresence=captureSourcePresence(d,ids),invalidSourceIds=captureMessageSourceValidity(d.storage,ids);
 return {request,candidates:candidates.map(({normalizedVector,...row})=>({...row,...(normalizedVector?{normalizedVector:Array.from(normalizedVector)}:{})})),recent,sourcePresence,invalidSourceIds,signature:digest(retrieval.configuration()),semanticPolicy:{version:1,capability,vectorsIncluded}};
}
export function freezeEnvironmentSnapshot(d:Dependencies,step:EnvironmentStep,at:string):EnvironmentPreparationSnapshot{
 const owner=step.stage==='school_campus'?'campus':'group',week=step.stage==='school_week',upstream=step.stage==='school_campus'||step.stage==='school_group';
 const school:EnvironmentSchoolRows={
 school_plans:upstream?d.schoolStore.plans().filter(p=>p.owner===owner):[],
 school_plan_items:week?d.schoolStore.items():upstream?d.schoolStore.items().filter(i=>i.owner===owner):[],
 school_instances:week?d.schoolStore.instances():[],school_notices:week?d.schoolStore.notices():[],
 school_weeks:week?d.storage.all('school_weeks'):[],school_knowledge:week?d.storage.all('school_knowledge'):[],
 school_progress:step.stage==='school_group'?d.schoolStore.progress():[]};
 return structuredClone({version:1 as const,at,timezone:d.config.timezone,input:environmentInput({...d,clock:{now:()=>at}},step),school,businessBasis:environmentBusinessBasis(d,step.stage),retrieval:freezeEnvironmentRetrieval(d,step.stage,at),usedBasis:null});
}
export async function lookupFrozenEnvironment(snapshot:EnvironmentPreparationSnapshot,query:LookupRequest,retrieval:MemoryRetrieval,signal?:AbortSignal):Promise<{context:RetrievedContext;usedBasis:EnvironmentLookupBasis}>{
 if(digest(retrieval.configuration())!==snapshot.retrieval.signature)throw Error('frozen retrieval configuration changed');
 const frozen=snapshot.retrieval;
 const currentCapability=retrieval.semanticCapability(),capability=frozen.semanticPolicy?.capability??currentCapability;
 if(frozen.semanticPolicy&&(capability.indexSignature!==currentCapability.indexSignature||capability.dimensions!==currentCapability.dimensions))throw Error('frozen retrieval configuration changed');
 const request=resolveLookupRequest(query,frozen.request),includeVectors=semanticPreflight(request.query,capability)===null;
 const candidates=frozen.candidates.map(({normalizedVector,...row})=>({...row,...(includeVectors&&normalizedVector?{normalizedVector:Float32Array.from(normalizedVector)}:{})}));
 const context=retrieval.budget(await retrieval.buildFrozen(request,candidates,structuredClone(frozen.recent),ids=>{if(ids.some(id=>frozen.invalidSourceIds.includes(id)))throw Error('frozen message source consistency failed');},[],signal,capability),frozen.request.budget??retrieval.limits.historyBudget);
 const owners=[...context.details,...context.shortTerm,...context.longTerm,...context.learned];
 const returned=new Set([...context.recent.map(m=>m.id),...owners.flatMap(o=>o.sourceIds)]);
 return {context,usedBasis:{owners:owners.map(({ownerType,ownerId,revision,stateVersion,status})=>({ownerType,ownerId,revision,stateVersion,status})),messageIds:frozen.sourcePresence.filter(s=>s.table==='messages'&&returned.has(s.id)).map(s=>s.id),sources:frozen.sourcePresence.filter(s=>returned.has(s.id))}};
}
export function lookupBasisCurrent(d:Dependencies,snapshot:EnvironmentPreparationSnapshot):boolean{
 if(digest(retrievalFor(d).configuration())!==snapshot.retrieval.signature)return false;
 const basis=snapshot.usedBasis;if(!basis)return true;
 const store=d.memoryStore??retrievalFor(d).store;
 return basis.owners.every(ref=>{const row=store.owner(ref);return row&&row.revision===ref.revision&&row.stateVersion===ref.stateVersion&&row.status===ref.status;})&&digest(captureSourcePresence(d,[...new Set(basis.sources.map(s=>s.id))]))===digest(basis.sources);
}
