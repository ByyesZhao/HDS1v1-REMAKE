import {schoolWeekTextInput} from '../school/calendar';
import {backgroundFor} from './background-views';
import { summaryRepairPair } from '../memory/summary-repair';
import { createHash } from 'node:crypto';
import type { MemoryCandidate,RetrievedContext } from '../memory/types';
import type { PromptStage,StageInputSnapshot,StageModelInput,OwnerViewPurpose,ModelOwnerView,ModelRoles,StageBusinessSnapshot } from './context-types';
import { isStageModelInput } from './context-types';
import { ResourcePool } from './resource-pool';
const unique=(ids:string[])=>[...new Set(ids)];
export function projectOwner(row:MemoryCandidate,purpose:OwnerViewPurpose):ModelOwnerView {
 const ref='owner:'+createHash('sha256').update(JSON.stringify([row.ownerType,row.ownerId,row.revision,row.stateVersion])).digest('hex').slice(0,24);
 const view:ModelOwnerView={ref,id:row.id,kind:row.kind,topics:row.topics,importance:row.importance,happenedAt:row.happenedAt};
 if(row.happenedUntil)view.happenedUntil=row.happenedUntil;
 if(row.kind==='detail'){view.key=row.key;view.value=row.value;view.aliases=row.aliases;view.effectiveAt=row.effectiveAt;if(row.content!==row.value)view.content=row.content;}
 else {view.eventSummary=row.eventSummary;view.feelingSummary=row.feelingSummary;
 const combined=[row.eventSummary,row.feelingSummary].filter(Boolean).join('\n');if(row.kind!=='long'||row.content!==combined)view.content=row.content;
 }
 if(row.kind==='learned'){view.learnedKind=row.learnedKind;view.canonicalMemoryId=row.canonicalMemoryId;view.projectionBasis=row.projectionBasis;view.sourceIds=row.sourceIds;}
 if(purpose==='memory'||purpose==='maintenance'){view.sourceIds=row.sourceIds;if(row.kind==='short')view.linkedLongId=row.linkedLongId;}
 if(purpose==='maintenance'){view.createdAt=row.createdAt;view.summaryQuality=row.summaryQuality;view.evidenceMemoryIds=row.evidenceMemoryIds;view.totalAwakenings=row.totalAwakenings;view.windowAwakenings=row.windowAwakenings;view.summaryRepairBasis=row.summaryRepairBasis;}
 return structuredClone(view);
}
export function purposeFor(stage:PromptStage):OwnerViewPurpose{return stage.startsWith('narrative')?'narrative':stage.startsWith('personal')?'personal':stage==='memory'?'memory':stage.startsWith('memory_')?'maintenance':stage==='expression'?'expression':'narrative';}
export function buildStageModelInput(stage:PromptStage,snapshot:StageInputSnapshot):StageModelInput {
 const input=snapshot.input,pool=new ResourcePool(),roles:ModelRoles={},purpose=purposeFor(stage);
 const {currentActivityMessages,dialogueWindowVersion,recent,visibleMessages,reconsiderMessages,outgoing,tasks,dueTasks,details,retrieved,shortTerm,longTerm,learned,detailHistory,snapshot:owners,history,selfWebReadSources,selfWebReadMaterials,sharedPublicExperience,...context}=input;
 const state=context.state as import('../types').CharacterState|undefined;
 if(context.sharedMeta&&state?.scene.shared){
  const shared=state.scene.shared;context.outline=context.outline??shared.outline;
  context.state={...state,scene:{...state.scene,shared:{title:shared.title,progress:shared.progress,lastPublicNode:shared.lastPublicNode}}};
 }
 const h=(history??{}) as Partial<RetrievedContext>;
 const permitted=(m:import('../types').Message)=>stage!=='narrative'||m.direction==='outgoing'||m.seenTurnId!==null;
 const addMessages=(field:'recentIds'|'visibleIds'|'reconsiderIds'|'currentActivityMessageIds',rows:import('../types').Message[]|undefined)=>{if(rows)roles[field]=unique(rows.filter(permitted).map(m=>pool.message(m)));};
 addMessages('recentIds',(h.recent??recent)?.filter(m=>dialogueWindowVersion!==2||!m.sharedActivityId));if(['narrative_shared','personal_shared','expression','memory'].includes(stage))addMessages('currentActivityMessageIds',currentActivityMessages);if(stage!=='narrative')addMessages('visibleIds',visibleMessages);addMessages('reconsiderIds',reconsiderMessages);
 if(dueTasks)roles.dueTaskIds=unique(dueTasks.map(t=>pool.task(t)));if(tasks)roles.pendingTaskIds=unique(tasks.map(t=>pool.task(t)));
 const ownerGroups:{field:'detailRefs'|'shortRefs'|'longRefs'|'learnedRefs';rows:MemoryCandidate[]}[]=[{field:'detailRefs',rows:[...h.details??[],...details??[]]},{field:'shortRefs',rows:[...h.shortTerm??[],...shortTerm??[]]},{field:'longRefs',rows:[...h.longTerm??[],...longTerm??[]]},{field:'learnedRefs',rows:[...h.learned??[],...learned??[]]}];
 for(const r of [...retrieved??[],...owners??[]])ownerGroups.find(g=>g.field===(r.kind==='detail'?'detailRefs':r.kind==='short'?'shortRefs':r.kind==='long'?'longRefs':'learnedRefs'))!.rows.push(r);
 for(const g of ownerGroups)if(g.rows.length)roles[g.field]=unique(g.rows.map(r=>pool.owner(projectOwner(r,purpose))));
 if(purpose==='maintenance'&&owners){const ids=Array.isArray(input.selectedIds)?input.selectedIds:[];context.summaryRepairPairs=owners.filter(r=>ids.includes(r.id)||r.linkedLongId&&ids.includes(r.linkedLongId)).filter(r=>summaryRepairPair(r,owners.find(l=>l.id===r.linkedLongId)??null)).map(r=>({shortId:r.id,longId:r.linkedLongId}));context.allowedActions=stage==='memory_audit'?['retain','review_detail','review_learned']:['refine','merge','merge_short','discard','promote','retain'];}
 const histories=[...h.detailHistory??[],...detailHistory??[]];if(histories.length)context.detailHistory=structuredClone(histories);
 if(stage==='memory'){
  const experienceIds=Array.isArray(input.experiences)?input.experiences.flatMap(e=>e&&typeof e==='object'&&'id' in e&&typeof e.id==='string'?[e.id]:[]):[];
  const outgoingIds=(outgoing??[]).map(m=>pool.message(m));roles.currentSourceIds=unique([...experienceIds,...roles.visibleIds??[],...outgoingIds,...selfWebReadSources?.map(s=>s.id)??[]]);
  if(sharedPublicExperience){roles.sharedPublicOutgoingIds=outgoingIds;context.sharedPublicExperience={rule:(sharedPublicExperience as {rule?:string}).rule};}
 }
 if(selfWebReadSources)roles.selfReadSources=structuredClone(selfWebReadSources);
 for(const r of selfWebReadMaterials??[])if(r.material)pool.material(r.material);
 return {contextVersion:1,context:structuredClone(context),resources:pool.data,roles};
}
export function stageInput(stage:PromptStage,input:unknown):StageModelInput {
 if(isStageModelInput(input))return input;
 return buildStageModelInput(stage,{stage,input:(input??{}) as StageBusinessSnapshot});
}

export function buildExpressionView(snapshot:Extract<StageInputSnapshot,{stage:'expression'}>):StageModelInput {
 const input=snapshot.input,state=input.state as import('../types').CharacterState|undefined;
 const expressionState=state?{emotions:state.emotions,energy:state.energy,scene:{mode:state.scene.mode,description:state.scene.description,activity:state.scene.activity?{description:state.scene.activity.description}:null,shared:state.scene.shared?{title:state.scene.shared.title,progress:state.scene.shared.progress,lastPublicNode:state.scene.shared.lastPublicNode}:null}}:undefined;
 return buildStageModelInput('expression',{stage:'expression',input:{currentActivityMessages:input.currentActivityMessages,dialogueWindowVersion:input.dialogueWindowVersion,intent:input.intent,mode:input.mode,state:expressionState,school:input.school,visibleMessages:input.visibleMessages,reconsiderMessages:input.reconsiderMessages,history:input.history,chatExamples:input.chatExamples,style:input.style,background:input.background}});
}

export function buildEnvironmentView(input:import('../environment/types').EnvironmentStepInput):StageModelInput {
 if(input.stage==='school_week')return input.modelContractVersion===1?stageInput(input.stage,{stage:input.stage,batchId:input.batchId,at:input.at,modelContractVersion:1,...schoolWeekTextInput(input.context as import('../school/types').SchoolExpansionInput,(input.context as {timezone?:string}).timezone??'Asia/Shanghai')}):stageInput(input.stage,{...(input.context as Record<string,unknown>),stage:input.stage,batchId:input.batchId,at:input.at,modelContractVersion:0});
 const c=input.context as {background:string;backgroundViews?:import('./background-views').BackgroundViews;timezone:string;worldSetting:string;schoolSetting:string;events:import('../types').EnvironmentEvent[];plans:import('../school/types').SchoolPlan[];items:import('../school/types').SchoolPlanItem[];progress?:import('../school/types').SchoolProgress[];campusTiming?:unknown};
 const common={stage:input.stage,batchId:input.batchId,at:input.at,timezone:c.timezone,background:backgroundFor(c,input.stage)};
 if(input.stage==='world')return stageInput(input.stage,{...common,worldSetting:c.worldSetting,events:c.events?.filter(e=>e.kind==='world')??[]});
 const owner=input.stage==='school_campus'?'campus':'group',items=c.items?.filter(i=>i.owner===owner)??[],plans=c.plans?.filter(p=>p.owner===owner)??[];
 const researchIds=new Set(items.filter(i=>i.kind==='research').map(i=>i.id));
 return stageInput(input.stage,{...common,schoolSetting:c.schoolSetting,plans,items,...(owner==='group'?{campusTiming:c.campusTiming,progress:c.progress?.filter(p=>researchIds.has(p.taskId))??[]}:{})});
}
