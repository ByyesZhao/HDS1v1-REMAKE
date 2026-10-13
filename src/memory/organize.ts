import {withTurnVisualContext} from '../input-media/context';
import {isStageModelInput,type StageModelInput} from '../model/context-types';
import type {MemoryWritePermissions} from './types';
import {memoryReferenceRows,extendMemoryWritePermissions,snapshotMemoryWritePermissions} from './references';
import {assertActiveWindow,assertMessageSources} from '../dialogue/active-consistency';
import {activityContextMessages} from '../dialogue/activity-context';
import { stageInput } from '../model/context-views';
import type { ISOTime, MemoryResult, ScheduledTask, TurnRecord, TurnCandidate } from '../types';
import { projectTaskChanges } from '../host/task-projection';
import type { Dependencies } from '../app';
import { memoryTask } from '../model/contracts';
import { ContextBuilder } from './context';
import { MemoryStore } from './store';
import { MemoryLifecycle } from './lifecycle';
import { makeRetrievalRequest } from './retrieval';
import { turnPhaseOptions } from '../web/phases';
import {personalSchoolContext} from '../school/context';

export function currentSelfWebReads(d:Dependencies,turnId:string) {return (d.web?.selfReadSources(turnId)??d.getSelfWebReadSources?.(turnId)??[]).filter(s=>{const f=d.storage.read('turns',turnId)?.replyFreshness;return s.turnId===turnId&&s.phase==='personal_life'&&s.sourceKind==='self_web_read'&&(!f||s.runId===f.personalRunId);});}

function projectMemoryLookupResult(result:unknown,permissions:MemoryWritePermissions):StageModelInput {
  if(!result||typeof result!=='object'||Array.isArray(result))throw Error('memory reference: invalid lookup context');
  memoryReferenceRows(result);
  if(isStageModelInput(result)&&(!result.context||typeof result.context!=='object'||Array.isArray(result.context)||!result.roles||typeof result.roles!=='object'||!['messages','tasks','owners','materials'].every(k=>Array.isArray(result.resources[k as keyof typeof result.resources]))))throw Error('memory reference: invalid projected lookup context');
  const projected=stageInput('memory',structuredClone(result));
  projected.context.memoryWritePermissions=snapshotMemoryWritePermissions(permissions);
  return projected;
}

export async function organizeMemory(d: Dependencies, turn: TurnRecord): Promise<MemoryResult> {
  const c = turn.frozenResult!;
  assertActiveWindow(d.storage,{requiredMessageIds:[...c.visibleMessageIds,...c.reconsiderMessageIds]});
  const visibleMessages=c.visibleMessageIds.map(id=>d.storage.read('messages',id)!).filter(m=>m.seenTurnId===null||m.seenTurnId===turn.id);
  const reconsiderMessages = c.reconsiderMessageIds.map(id => d.storage.read('messages', id)!);
  const outgoing = d.storage.messagesByTurn(turn.id).filter(m => m.direction === 'outgoing');
  const selfWebReadSources=currentSelfWebReads(d,turn.id);
  if(c.experiences.length===0&&visibleMessages.length===0&&outgoing.length===0&&selfWebReadSources.length===0)return {schemaVersion:3,shortTermChanges:[],longTermChanges:[],detailChanges:[]};
  const sourceIds = [...c.experiences.map(e => e.id), ...visibleMessages.map(m => m.id), ...outgoing.map(m => m.id)];
  const query = [...c.experiences.map(e => e.description), ...visibleMessages.map(m => m.content), ...outgoing.map(m => m.content)].join('\n');
  const builder=new ContextBuilder(d.storage,d.retrieval),base=makeRetrievalRequest(query,turn.at,'memory',d.config.historyBudget,sourceIds);
  base.dialogueWindowVersion=turn.dialogueWindowVersion??1;
  const context = await builder.buildForMemory(base);
  const memories = context.retrieved;
  const permissions:MemoryWritePermissions={shortUpdateIds:[],longAwakenIds:[],existingLongIds:[]};
  const includeReferences=(result:unknown)=>extendMemoryWritePermissions(builder.retrieval.store,permissions,memoryReferenceRows(result));
  includeReferences(stageInput('memory',{retrieved:memories}));
  const initialPermissions=snapshotMemoryWritePermissions(permissions);
  const options=turnPhaseOptions(d.web,turn,'memory','memory',{lookup:async q=>{
    const result={...await builder.lookupForMemory(q,base),school:personalSchoolContext(d.storage,c.schoolObservations??[],typeof q==='string'?q:q.query)};
    includeReferences(result);return projectMemoryLookupResult(result,permissions);
  }});
  const checkpoint=options.web?.checkpoint();
  if(checkpoint&&checkpoint.lookupPending!==true&&checkpoint.privateLookupResult!==undefined&&checkpoint.privateLookupResult!==null){
    includeReferences(checkpoint.privateLookupResult);
    // A confirmed lookup will not call the callback again. Rewrite its active
    // projection as well as parser authority before ModelClient sends it.
    options.web!.saveCheckpoint({...checkpoint,privateLookupResult:projectMemoryLookupResult(checkpoint.privateLookupResult,permissions)});
  }
  const materialIdsByRun=new Map<string,string[]>();
  for(const source of selfWebReadSources){const ids=materialIdsByRun.get(source.runId)??[];ids.push(source.materialId);materialIdsByRun.set(source.runId,ids);}
  const materialsByRun=new Map([...materialIdsByRun].map(([runId,ids])=>[runId,new Map((d.web?.store.materials(runId,ids)??[]).map(material=>[material.id,material]))]));
  return withTurnVisualContext(d.models,d.incomingMedia,turn.id).runModel(memoryTask(sourceIds,permissions.longAwakenIds,permissions.shortUpdateIds,selfWebReadSources.map(s=>s.id),permissions.existingLongIds), stageInput('memory',{
    memoryWritePermissions:initialPermissions,
    dialogueWindowVersion:turn.dialogueWindowVersion??1,currentActivityMessages:turn.dialogueWindowVersion===2?activityContextMessages(d.storage,turn.activityContext,'memory',c.visibleMessageIds):[],at: turn.at, background: d.config.background, experiences: c.experiences, visibleMessages, reconsiderMessages, outgoing,
    school:personalSchoolContext(d.storage,c.schoolObservations??[],query),
    arrangementsAndIntent: { plan: c.nextState.plan, tasks: c.taskChanges, outline: c.narrative && 'outline' in c.narrative ? c.narrative.outline : null },
    ...(c.narrative && 'simulatedUserActions' in c.narrative ? { sharedPublicExperience: {
      publicNarration: c.narrative.publicNarration, simulatedUserActions: c.narrative.simulatedUserActions,
      rule: '仅成功公开内容是共享模拟经历；不推断现实用户稳定属性。不增加独立来源ID，引用实际outgoing或合法本轮经历／输入。未公开代写不能成为事实，outline只在意图区。',
    } } : {}),
    details: context.details, retrieved: memories,
    selfWebReadSources,
    selfWebReadMaterials:selfWebReadSources.map(source=>({sourceId:source.id,material:materialsByRun.get(source.runId)?.get(source.materialId)})),
    ...(selfWebReadSources.length&&c.personal&&'innerThought' in c.personal?{selfWebReadReactions:{innerThought:c.personal.innerThought,emotions:c.personal.emotions}}:{}),
  }),options);
}

// Called only inside the same transaction as the story and turn completion.
export function applyMemory(d: Dependencies, turnId: string, result: MemoryResult, at: string): void {
  const turn=d.storage.read('turns',turnId)!;const candidate=turn.frozenResult!;
  const sources=[...candidate.experiences.map(e=>e.id),...candidate.visibleMessageIds,...d.storage.messagesByTurn(turnId).filter(m=>m.direction==='outgoing').map(m=>m.id)];
  const selfSources=d.storage.read('post_jobs',turnId)?.selfWebReadSources??currentSelfWebReads(d,turnId);
  (d.memoryLifecycle??new MemoryLifecycle(d.memoryStore??new MemoryStore(d.storage))).apply(result,turnId,at,sources,selfSources.map(s=>s.id));
}

export function applyTasks(d: Dependencies, candidate: TurnCandidate, turnAt: ISOTime): void {
  const relatedIds = new Set([...candidate.completedTaskIds, ...candidate.taskChanges.filter(c => c.action !== 'create').map(c => c.id)]);
  const original: ScheduledTask[] = [];
  for (const id of relatedIds) {
    const task = d.storage.read('tasks', id);
    if (task) original.push(task);
  }
  assertMessageSources(d.storage,candidate.taskChanges.flatMap(c=>c.action==='cancel'?[]:c.task.messageIds??[]));
  for (const task of projectTaskChanges(original, candidate.taskChanges, candidate.completedTaskIds, turnAt)) d.storage.save('tasks', task.id, task);
}
