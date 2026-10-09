import {createHash} from 'node:crypto';
import type {Dependencies} from '../app';
import type {EnvironmentStep,EnvironmentStepInput,EnvironmentStage} from './types';
import type {SchoolReadView} from '../school/read-view';
import type {SchoolPlan,SchoolPlanItem,SchoolInstance,SchoolNotice,SchoolWeek,SchoolKnowledge,SchoolProgress} from '../school/types';
import type {EnvironmentEvent,Message,ScheduledTask} from '../types';
import {environmentInput} from './runtime';
import {MemoryRetrieval,makeRetrievalRequest,resolveLookupRequest} from '../memory/retrieval';
import {MemoryStore} from '../memory/store';
import type {MemoryCandidate,LookupRequest,RetrievedContext,RetrievalRequest} from '../memory/types';
import {DialogueStore} from '../dialogue/store';
import {ChatEpisodes} from '../dialogue/chat-episodes';
import {DialogueEpisodes} from '../dialogue/episodes';
import {assertMessageSources} from '../dialogue/active-consistency';
export interface EnvironmentSchoolRows {school_plans:SchoolPlan[];school_plan_items:SchoolPlanItem[];school_instances:SchoolInstance[];school_notices:SchoolNotice[];school_weeks:SchoolWeek[];school_knowledge:SchoolKnowledge[];school_progress:SchoolProgress[]}
export interface EnvironmentLookupBasis {owners:Array<Pick<MemoryCandidate,'ownerType'|'ownerId'|'revision'|'stateVersion'|'status'>>;messageIds:string[]}
export interface FrozenEnvironmentRetrieval {request:RetrievalRequest;candidates:Array<Omit<MemoryCandidate,'normalizedVector'>&{normalizedVector?:number[]}>;recent:Message[];sourceMessages:Message[];invalidSourceIds:string[];signature:string}
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
 known:sorted(d.storage.all('school_knowledge')),appointments:sorted(d.storage.all('tasks').filter(t=>t.kind==='appointment'&&t.status==='pending')),
 notices:sorted(d.schoolStore.notices()).map(noticeBasis)
 }:{plans:sorted(d.schoolStore.plans().filter(p=>p.owner===owner)),items:sorted(d.schoolStore.items().filter(i=>i.owner===owner)),...(stage==='school_group'?{progress:sorted(d.schoolStore.progress()),campusTiming:sorted(d.schoolStore.items().filter(i=>i.owner==='campus')).map(i=>({id:i.id,title:i.title,timing:i.timing}))}:{})};
 return digest({events:stage==='school_week'?undefined:sorted(events),school,background:d.config.background,backgroundViews:d.config.backgroundViews,worldSetting:d.config.worldSetting,schoolSetting:d.config.schoolSetting,timezone:d.config.timezone});
}
export function retrievalFor(d:Dependencies):MemoryRetrieval{return d.retrieval??new MemoryRetrieval(d.memoryStore??new MemoryStore(d.storage));}
export function freezeEnvironmentRetrieval(d:Dependencies,stage:EnvironmentStage,at:string):FrozenEnvironmentRetrieval{
 const retrieval=retrievalFor(d),query=stage==='world'?d.config.worldSetting:d.config.schoolSetting,request=makeRetrievalRequest(query,at,stage,d.config.historyBudget);
 const candidates=retrieval.store.selectCandidates(request);
 const recent=new (d.storage.runtime().dialogueContextVersion===2?ChatEpisodes:DialogueEpisodes)(new DialogueStore(d.storage),retrieval.limits.dialogueIdleMinutes).recent(stage,at,retrieval.limits.recentDialogueSegments,[]).messages;
 const sourceMessages=d.storage.messagesByIds([...new Set([...candidates.flatMap(c=>c.sourceIds),...recent.map(m=>m.id)])]);
 const invalidSourceIds:string[]=[];
 for(const m of sourceMessages)try{assertMessageSources(d.storage,[m.id]);}catch{invalidSourceIds.push(m.id);}
 return {request,candidates:candidates.map(({normalizedVector,...row})=>({...row,...(normalizedVector?{normalizedVector:Array.from(normalizedVector)}:{})})),recent,sourceMessages,invalidSourceIds,signature:digest(retrieval.configuration())};
}
export function freezeEnvironmentSnapshot(d:Dependencies,step:EnvironmentStep,at:string):EnvironmentPreparationSnapshot{
 const school:EnvironmentSchoolRows={school_plans:d.schoolStore.plans(),school_plan_items:d.schoolStore.items(),school_instances:d.schoolStore.instances(),school_notices:d.schoolStore.notices(),school_weeks:d.storage.all('school_weeks'),school_knowledge:d.storage.all('school_knowledge'),school_progress:d.schoolStore.progress()};
 return structuredClone({version:1 as const,at,timezone:d.config.timezone,input:environmentInput({...d,clock:{now:()=>at}},step),school,businessBasis:environmentBusinessBasis(d,step.stage),retrieval:freezeEnvironmentRetrieval(d,step.stage,at),usedBasis:null});
}
export async function lookupFrozenEnvironment(snapshot:EnvironmentPreparationSnapshot,query:LookupRequest,retrieval:MemoryRetrieval):Promise<{context:RetrievedContext;usedBasis:EnvironmentLookupBasis}>{
 if(digest(retrieval.configuration())!==snapshot.retrieval.signature)throw Error('frozen retrieval configuration changed');
 const frozen=snapshot.retrieval;
 const candidates=frozen.candidates.map(({normalizedVector,...row})=>({...row,...(normalizedVector?{normalizedVector:Float32Array.from(normalizedVector)}:{})}));
 const context=retrieval.budget(await retrieval.buildFrozen(resolveLookupRequest(query,frozen.request),candidates,structuredClone(frozen.recent),ids=>{if(ids.some(id=>frozen.invalidSourceIds.includes(id)))throw Error('frozen message source consistency failed');}),frozen.request.budget??retrieval.limits.historyBudget);
 const owners=[...context.details,...context.shortTerm,...context.longTerm,...context.learned];
 const returned=new Set([...context.recent.map(m=>m.id),...owners.flatMap(o=>o.sourceIds)]);
 return {context,usedBasis:{owners:owners.map(({ownerType,ownerId,revision,stateVersion,status})=>({ownerType,ownerId,revision,stateVersion,status})),messageIds:frozen.sourceMessages.filter(m=>returned.has(m.id)).map(m=>m.id)}};
}
export function lookupBasisCurrent(d:Dependencies,snapshot:EnvironmentPreparationSnapshot):boolean{
 if(digest(retrievalFor(d).configuration())!==snapshot.retrieval.signature)return false;
 const basis=snapshot.usedBasis;if(!basis)return true;
 const store=d.memoryStore??retrievalFor(d).store;
 return basis.owners.every(ref=>{const row=store.owner(ref);return row&&row.revision===ref.revision&&row.stateVersion===ref.stateVersion&&row.status===ref.status;})&&d.storage.messagesByIds(basis.messageIds).length===basis.messageIds.length;
}
