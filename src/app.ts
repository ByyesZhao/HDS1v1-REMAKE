import {assertReplyCurrent,ReplySuperseded,isOrdinaryReplyRequest,hasReplyAttempt} from './host/reply-freshness';
import {withTurnVisualContext} from './input-media/context';
import {assertActiveWindow} from './dialogue/active-consistency';
import { ModelRequestError } from './model/client';
import { DialogueEpisodes } from './dialogue/episodes';
import {selectActivityContext,activityContextMessages,ActivityContextError} from './dialogue/activity-context';
import {ChatEpisodes} from './dialogue/chat-episodes';
import { DialogueStore } from './dialogue/store';
import { runEnvironmentStep } from './environment/runtime';
import type {EnvironmentGenerator} from './environment/types';
import { randomUUID } from 'node:crypto';
import { Storage } from './storage';
import type { EnvironmentStore } from './environment/store';
import type { SchoolStore } from './school/store';
import type { AppConfig } from './config';
import type { Clock, Random, ModelRunner, Sender, TurnRequest, TurnCandidate, OutboxItem, PersonalResult, UtteranceIntent } from './types';
import { canRead, isSleeping, arrangeSleep, autonomousMinutes, maintainTask } from './host/state';
import { runNarrative } from './directors/narrative';
import { runPersonal } from './directors/personal';
import { runExpression } from './output/expression';
import { freezeTurn, sendFrozen, finishPostprocessing, discardUnattempted, waitForReply } from './recovery';
import type { TurnRecord } from './types';
import { ContextBuilder } from './memory/context';
import { makeRetrievalRequest } from './memory/retrieval';
import type { MemoryRetrieval } from './memory/retrieval';
import { sampleOpportunity, stickerCurve, contactCurve } from './host/probability';
import { nextDaily, due } from './time';
import { turnPhaseOptions,replyBusinessStageKeys } from './web/phases';
import { hasValidSharedScene } from './host/shared';
import {narrativeSchoolContext,personalSchoolContext,personalEnvironmentEvents} from './school/context';
import {prepareSchoolCommits} from './school/progress';

export interface Dependencies { incomingMedia?:import('./input-media/service').IncomingMediaService; chat?:ChatEpisodes;dialogue?:DialogueEpisodes; generateEnvironment?:EnvironmentGenerator; environmentStore:EnvironmentStore;schoolStore:SchoolStore; storage: Storage; clock: Clock; random: Random; models: ModelRunner; config: AppConfig; sender: Sender; wait(ms: number): Promise<void>; web?:import('./web/service').WebSearchService; memoryStore?:import('./memory/store').MemoryStore; memoryLifecycle?:import('./memory/lifecycle').MemoryLifecycle; memoryCapacity?:import('./memory/capacity').MemoryCapacity;memoryIdle?:import('./memory/idle').MemoryIdle;memoryCleanup?:import('./memory/cleanup').MemoryCleanup;retrieval?:MemoryRetrieval; maintenance?:import('./memory/maintenance').MemoryMaintenance; stickers?: { findSticker(query: string): Promise<string> }; getSelfWebReadSources?(turnId:string):import('./memory/types').SelfWebReadSource[] }
export class HdsiApp {
  private busy = false;
  constructor(public readonly dependencies: Dependencies) { dependencies.dialogue??=new DialogueEpisodes(new DialogueStore(dependencies.storage));dependencies.chat??=new ChatEpisodes(new DialogueStore(dependencies.storage),dependencies.retrieval?.limits.dialogueIdleMinutes??15); }
  async runTurn(request: TurnRequest): Promise<void> {
    if (this.busy || this.dependencies.storage.unfinishedTurn()) throw new Error('finish the previous turn first');
    const d = this.dependencies;
    if(request.environmentKind)throw new Error('legacy environment turn requires explicit upgrade');
    if(request.environmentStepId){
      this.busy=true;
      try{if(!d.generateEnvironment)throw new Error('environment generator not assembled');await runEnvironmentStep(d,request.environmentStepId,d.generateEnvironment);}
      catch(error){d.storage.set('runtime',{...d.storage.runtime(),paused:true,lastError:error instanceof Error?error.message:String(error)});throw error;}
      finally{this.busy=false;}return;
    }
    const turn: TurnRecord = {
      id: randomUUID(), at: d.clock.now(), inputMessageIds: request.inputMessageIds, triggerTaskIds: request.taskIds,
      triggerKinds: request.triggerKinds, batchIds: request.batchIds ?? [], entryMode: d.storage.character().scene.mode,
      completedAt: null, frozenResult: null, outputComplete: false, done: false, environmentKind: request.environmentKind,
      sharedMeta: request.sharedMeta ?? null,
      schoolNoticeRefs:request.schoolNoticeRefs??[],
      ...(request.replyInputRevision!==undefined&&isOrdinaryReplyRequest(d.storage,request,d.clock.now())?{replyFreshness:{version:1 as const,generation:1,scope:'ordinary' as const,inputRevision:request.replyInputRevision,state:'generating' as const,quietUntil:null,firstAttemptAt:null,personalRunId:null}}:{}),
    };
    d.storage.transaction(()=>{turn.dialogueWindowVersion=d.storage.runtime().dialogueContextVersion===2?2:1;if(turn.dialogueWindowVersion===2){turn.chatBinding=d.chat!.bindTurn(turn);turn.activityContext=selectActivityContext(d.storage,turn);}else turn.dialogueBinding=d.dialogue!.bindTurn(turn);d.storage.save('turns',turn.id,turn);assertActiveWindow(d.storage,{requiredMessageIds:turn.inputMessageIds});});
    await this.execute(turn);
  }
  async continueWaitingTurn(turnId:string,request:TurnRequest,scope:'ordinary'|'event'):Promise<void>{
    const d=this.dependencies;
    if(this.busy)throw new Error('turn busy');
    const initial=d.storage.unfinishedTurn();
    if(initial?.id!==turnId||initial.replyFreshness?.state!=='waiting'||hasReplyAttempt(d.storage,turnId))throw new Error('turn is not waiting');
    let turn!:TurnRecord;
    d.storage.transaction(()=>{
      const {dialogueBinding,chatBinding,activityContext,autonomousIntervalMinutes,...previous}=d.storage.read('turns',turnId)!;
      d.web?.store.compactStages('turn',turnId,replyBusinessStageKeys(previous.replyFreshness!.generation));
      turn={...previous,at:d.clock.now(),inputMessageIds:request.inputMessageIds,triggerTaskIds:request.taskIds,triggerKinds:request.triggerKinds,batchIds:request.batchIds??[],entryMode:d.storage.character().scene.mode,sharedMeta:request.sharedMeta??null,schoolNoticeRefs:request.schoolNoticeRefs??[],replyFreshness:{...previous.replyFreshness!,generation:previous.replyFreshness!.generation+1,scope,inputRevision:request.replyInputRevision??previous.replyFreshness!.inputRevision,state:'generating',quietUntil:null,firstAttemptAt:null,personalRunId:null}};
      if(turn.dialogueWindowVersion===2){turn.chatBinding=d.chat!.bindTurn(turn);turn.activityContext=selectActivityContext(d.storage,turn);}else turn.dialogueBinding=d.dialogue!.bindTurn(turn);
      d.storage.save('turns',turnId,turn);assertActiveWindow(d.storage,{requiredMessageIds:turn.inputMessageIds});
    });
    await this.execute(turn);
  }
  async resumeUnfinishedTurn(): Promise<void> {
    if (this.busy) return;
    const d = this.dependencies;
    let turn = d.storage.unfinishedTurn();
    if (!turn || turn.replyFreshness?.state==='waiting') return;
    if (!turn.outputComplete) {
      const items = d.storage.outbox(turn.id);
      if (!hasReplyAttempt(d.storage,turn.id)) {
        try {assertReplyCurrent(d.storage,turn.id,d.clock.now());if(turn.replyFreshness?.scope==='ordinary'&&!canRead(d.storage.character(),d.clock.now()))throw new ReplySuperseded();}
        catch(error){if(error instanceof ReplySuperseded){waitForReply(d,turn.id);return;}throw error;}
        turn = discardUnattempted(d, turn);
      }
      else items.filter(i => i.status === 'sending').forEach(i => d.storage.saveOutbox({ ...i, status: 'retry' }));
    }
    await this.execute(turn);
  }
  private async execute(initialTurn: TurnRecord): Promise<void> {
    const d = this.dependencies;
    this.busy = true;
    let stage: "generation"|"sending"|"postprocessing" = "generation";
    try {
      let turn = initialTurn;
      if (!turn.frozenResult) {
        const generated = await generateTurn(d, { inputMessageIds: turn.inputMessageIds, taskIds: turn.triggerTaskIds, triggerKinds: turn.triggerKinds, batchIds: turn.batchIds, environmentKind: turn.environmentKind, sharedMeta: turn.sharedMeta,schoolNoticeRefs:turn.schoolNoticeRefs??[] }, turn.id, turn.at, turn.autonomousIntervalMinutes);
        turn = freezeTurn(d, turn, generated.candidate, generated.items);
      }
      if (!turn.outputComplete) { stage="sending"; await sendFrozen(d, turn); }
      stage="postprocessing";
      await finishPostprocessing(d, d.storage.read('turns', turn.id)!);
    } catch (error) {
      if(error instanceof ReplySuperseded){waitForReply(d,initialTurn.id);return;}
      const message = error instanceof Error ? error.message : String(error);
      const runtime = d.storage.runtime(); runtime.paused = true; runtime.lastError = message;
      const kind=error instanceof ModelRequestError?error.kind:'error';
      const label={generation:'生成',sending:'发送',postprocessing:'后处理'}[stage];
      const safeSummary=`${label}失败，程序已暂停${kind==='context_limit'?'（接口明确报告上下文超限）':error instanceof ActivityContextError?'（活动原文缺失或身份变化，保留原轮）':''}`;
      runtime.lastFailure={kind,task:error instanceof ModelRequestError?error.taskName:undefined,stage,at:d.clock.now(),safeSummary};
      d.storage.set('runtime', runtime);
      try { await d.sender.sendError(`error：${safeSummary}`); } catch { /* Preserve the failed stage even if the system notice cannot be delivered. */ }
      throw error;
    } finally { this.busy = false; }
  }
}
export async function generateTurn(d: Dependencies, request: TurnRequest, turnId: string, at = d.clock.now(), retainedInterval?: number | null): Promise<{ candidate: TurnCandidate; items: OutboxItem[] }> {
  const check=()=>assertReplyCurrent(d.storage,turnId,d.clock.now());
  check();
  const currentTurn=d.storage.read('turns',turnId);
  if(currentTurn?.replyFreshness){if(currentTurn.replyFreshness.scope==='ordinary'&&!canRead(d.storage.character(),d.clock.now()))throw new ReplySuperseded();d.storage.save('turns',turnId,{...currentTurn,replyFreshness:{...currentTurn.replyFreshness,personalRunId:null}});}
  const phase=(stage:string,task:string,options:import('./memory/types').ModelRunOptions={})=>turnPhaseOptions(d.web,d.storage.read('turns',turnId)??({id:turnId} as TurnRecord),stage,task,options);
  const models=withTurnVisualContext(d.models,d.incomingMedia,turnId);
  const state = structuredClone(d.storage.character());
  const entryMode = state.scene.mode;
  const shared = hasValidSharedScene(state);
  const runtime = d.storage.runtime();
  if (isSleeping(state, at)) {
    state.nextAutonomousAt = null;
    return { items: [], candidate: {
      visibleMessageIds: [], reconsiderMessageIds: [], narrative: null, personal: null, expression: null,
      experiences: [], nextState: state, taskChanges: [], completedTaskIds: [],
      probability: { contactMisses: runtime.contactMisses, stickerMisses: runtime.stickerMisses },
      autonomousIntervalMinutes: null, environmentChanges: [],
    } };
  }
  const savedTurn=d.storage.read('turns',turnId),dialogueWindowVersion=savedTurn?savedTurn.dialogueWindowVersion??1:runtime.dialogueContextVersion===2?2:1;
  const activityContext=dialogueWindowVersion===2?(savedTurn?.activityContext!==undefined?savedTurn.activityContext:selectActivityContext(d.storage,{id:turnId,at,inputMessageIds:request.inputMessageIds,entryMode,sharedMeta:request.sharedMeta} as TurnRecord)):null;
  assertActiveWindow(d.storage,{requiredMessageIds:request.inputMessageIds});
  const messages = request.inputMessageIds.map(id => d.storage.read('messages', id)!);
  const allTasks = d.storage.all('tasks').filter(t => t.status === 'pending');
  const tasks = allTasks.filter(t => request.taskIds.includes(t.id));
  const events = d.storage.all('events').filter(e => e.status === 'active'&&e.kind==='world');
  const schoolTurn={id:turnId,at,schoolNoticeRefs:request.schoolNoticeRefs??[]} as TurnRecord;
  const schoolContext=narrativeSchoolContext(d.storage,state.narratedUntil,at,state.scene);
  schoolContext.noticeSnapshots=schoolContext.noticeSnapshots.filter(n=>schoolTurn.schoolNoticeRefs!.some(ref=>ref.noticeId===n.id&&ref.deliveryRevision===n.deliveryRevision));
  schoolContext.eventIds=[...new Set([...schoolContext.objectiveInstances.flatMap(i=>[i.id,...(i.legacyEventId?[i.legacyEventId]:[])]),...schoolContext.noticeSnapshots.flatMap(n=>n.payload.snapshots.map(s=>s.entityId))])];
  const contextBuilder = new ContextBuilder(d.storage,d.retrieval);
  const narrativeQuery = [state.plan, state.scene.description, ...tasks.map(t => t.description), ...events.map(e => e.description), ...(shared ? messages.map(m => m.content) : [])].join('\n');
  const narrativeRequest=makeRetrievalRequest(narrativeQuery,at,shared?'narrative_shared':'narrative',d.config.historyBudget,shared?messages.map(m=>m.id):[]);
  narrativeRequest.dialogueWindowVersion=dialogueWindowVersion;
  const narrativeHistory = await contextBuilder.build(narrativeRequest);
  check();
  const recent = narrativeHistory.recent;
  const waking = !shared && (request.triggerKinds.includes('sleep') || !!state.sleep && due(state.sleep.wakeAt, at));
  if (waking) state.sleep = null;
  const narrativeInput = { dialogueWindowVersion,currentActivityMessages:activityContextMessages(d.storage,activityContext,shared?'narrative_shared':'narrative',shared?messages.map(m=>m.id):[]),from: state.narratedUntil, at, background: d.config.background, state, waking, events,school:schoolContext, dueTasks: tasks, recent, history: narrativeHistory,
    ...(shared ? { visibleMessages: messages, sharedMeta: request.sharedMeta, remainingSteps: request.sharedMeta ? request.sharedMeta.maxSteps - request.sharedMeta.stepNumber : null } : {}) };
  if(shared)await d.incomingMedia?.prepareForTurn(turnId,messages.map(m=>m.id));
  check();
  const narrative = await runNarrative(models, shared, state.narratedUntil, at, [...events.map(e=>e.id),...schoolContext.eventIds], narrativeInput,phase('narrative',shared?'narrative_shared':'narrative',{lookup:q=>contextBuilder.retrieval.lookup(q,narrativeRequest)}), request.sharedMeta, state.scene.shared?.outline,
    result=>{prepareSchoolCommits(d.storage,schoolTurn,result,result.experiences.map((e,i)=>({...e,id:`draft:${i}`})));});
  check();
  const experiences=narrative.experiences.map(e=>({...e,id:randomUUID()}));
  const schoolCommits=prepareSchoolCommits(d.storage,schoolTurn,narrative,experiences);
  state.narratedUntil = at;
  state.scene.description = narrative.currentScene.description;
  state.scene.activity = narrative.currentScene.activity;
  state.energy = narrative.energy;
  if ('progress' in narrative && state.scene.shared) {
    state.scene.shared.progress = narrative.progress;
    state.scene.shared.outline = narrative.outline;
    if (narrative.publicNarration) state.scene.shared.lastPublicNode = narrative.publicNarration;
  }
  const visible = shared || canRead(state, at) ? messages : [];
  const deferred = tasks.filter(t => t.checkReason === 'deferred_reply' && canRead(state, at));
  const reconsider = [...new Set(deferred.flatMap(t => t.messageIds ?? []))].map(id => d.storage.read('messages', id)!).filter(m => m.seenTurnId !== null);
  if(!shared)await d.incomingMedia?.prepareForTurn(turnId,[...visible,...reconsider].map(m=>m.id));
  check();
  const contactEligible = request.triggerKinds.includes('autonomous') && !shared && visible.length === 0 && !tasks.some(t => t.kind === 'appointment') && canRead(state, at) && !isSleeping(state, at);
  const kind = shared ? 'shared' : visible.length || tasks.some(t => t.kind === 'appointment') || deferred.length > 0 ? 'chat' : 'life';
  const runPerson = shared || visible.length > 0 || tasks.some(t => t.kind === 'appointment') || request.triggerKinds.includes('autonomous') || request.triggerKinds.includes('sleep') || schoolCommits.observations.length>0 || tasks.some(t => t.checkReason === 'deferred_reply' && canRead(state, at));
  let personal: PersonalResult | null = null;
  let intent: UtteranceIntent | null = null;
  let contactMisses = runtime.contactMisses;
  let personalHistory:Awaited<ReturnType<ContextBuilder['build']>>|null=null;
  let personalSchool:ReturnType<typeof personalSchoolContext>|null=null;
  if (runPerson) {
  const personalQuery = [state.scene.description, ...narrative.experiences.map(e => e.description), ...visible.map(m => m.content), ...reconsider.map(m => m.content)].join('\n');
  const personalRequest=makeRetrievalRequest(personalQuery,at,'personal',d.config.historyBudget,[...visible,...reconsider].map(m=>m.id));
  personalRequest.dialogueWindowVersion=dialogueWindowVersion;
  personalHistory = await contextBuilder.build(personalRequest);
  check();
  personalSchool=personalSchoolContext(d.storage,schoolCommits.observations,personalQuery);
  const personalEvents=personalEnvironmentEvents(d.storage,personalSchool.knownSnapshots);

    const personalOptions=phase('personal',`personal_${kind}`,{lookup:async q=>({...await contextBuilder.retrieval.lookup(q,personalRequest),school:personalSchoolContext(d.storage,schoolCommits.observations,typeof q==='string'?q:q.query)})});
    const personalTurn=d.storage.read('turns',turnId);if(personalTurn?.replyFreshness)d.storage.save('turns',turnId,{...personalTurn,replyFreshness:{...personalTurn.replyFreshness,personalRunId:personalOptions.runRef?.runId??null}});
    personal = await runPersonal(models, kind, at, allTasks, entryMode, [...visible, ...reconsider].map(m => m.id), { dialogueWindowVersion,currentActivityMessages:activityContextMessages(d.storage,activityContext,shared?'personal_shared':'personal_chat',visible.map(m=>m.id)),at, background: d.config.background, state, experiences: narrative.experiences,school:personalSchool, visibleMessages: visible, reconsiderMessages: reconsider, dueTasks: tasks.filter(t => t.kind !== 'check_messages' || canRead(state, at)), tasks: allTasks, events:personalEvents, history: personalHistory, contactEligible,
      ...(shared ? { sharedMeta: request.sharedMeta, remainingSteps: request.sharedMeta ? request.sharedMeta.maxSteps - request.sharedMeta.stepNumber : null, outline: state.scene.shared?.outline, publicNarration: 'publicNarration' in narrative ? narrative.publicNarration : null } : {}) },personalOptions, request.sharedMeta, 'publicNarration' in narrative ? narrative.publicNarration : null,{contactEligible});
    check();
    state.emotions = personal.emotions;
    if (typeof personal.nextPlan === 'string') state.plan = personal.nextPlan;
    if ('reply' in personal && personal.reply.decision === 'now') intent = personal.reply;
    if ('contact' in personal && personal.contact.willing && contactEligible) {
      if (sampleOpportunity(contactMisses, contactCurve.p0, contactCurve.step, d.random)) { intent = personal.contact; contactMisses = 0; }
      else contactMisses++;
    }
  }
  const change = personal?.sharedChange;
  const outputMode = change?.action === 'start' ? change.mode : entryMode;
  const expression = intent ? await runExpression(models, { dialogueWindowVersion,currentActivityMessages:activityContextMessages(d.storage,activityContext,'expression',visible.map(m=>m.id)),intent, mode: outputMode, state,school:personalSchool, visibleMessages: visible, reconsiderMessages: reconsider, history: personalHistory, chatExamples: d.config.chatExamples,style:d.config.backgroundViews?.status==='approved'?d.config.backgroundViews.style:undefined },phase('expression','expression',{lookup:null})) : null;
  check();
  const candidate: TurnCandidate = {
    visibleMessageIds: visible.map(m => m.id), reconsiderMessageIds: reconsider.map(m => m.id), narrative, personal, expression,
    experiences,schoolNoticeRefs:request.schoolNoticeRefs??[],schoolObservations:schoolCommits.observations,schoolProgress:schoolCommits.progress,nextState: state,
    taskChanges: (personal?.taskChanges ?? []).map(c => c.action === 'create' ? { ...c, id: randomUUID() } : c), completedTaskIds: tasks.filter(t => t.kind !== 'check_messages' || canRead(state, at)).map(t => t.id),
    probability: { contactMisses, stickerMisses: runtime.stickerMisses },
    autonomousIntervalMinutes: retainedInterval === undefined ? autonomousMinutes(d.random) : retainedInterval, environmentChanges: [],
  };
  const oldUnread = allTasks.find(t => t.kind === 'check_messages' && t.checkReason === 'unread');
  const remainingUnread = messages.filter(m => !candidate.visibleMessageIds.includes(m.id));
  if (remainingUnread.length) {
    const end = state.scene.activity?.expectedEndAt;
    maintainTask(candidate.taskChanges, oldUnread, end ? { kind: 'check_messages', at: end, description: '活动预计结束后检查待看消息', checkReason: 'unread', messageIds: remainingUnread.map(m => m.id) } : null);
  } else if (oldUnread && visible.length) maintainTask(candidate.taskChanges, oldUnread, null);
  for (const task of tasks.filter(t => t.checkReason === 'deferred_reply' && !canRead(state, at))) {
    const end = state.scene.activity?.expectedEndAt;
    if (end) maintainTask(candidate.taskChanges, task, { ...task, at: end });
  }
  if (personal && 'reply' in personal && personal.reply.decision === 'later') {
    const reply = personal.reply;
    maintainTask(candidate.taskChanges, deferred[0], { kind: 'check_messages', at: reply.reconsiderAt, description: reply.intention, checkReason: 'deferred_reply', messageIds: [...new Set([...visible, ...reconsider].map(m => m.id))] });
  }
  if (change?.action === 'start') {
    state.scene.mode = change.mode;
    state.scene.shared = { activityId: randomUUID(), title: change.title, progress: '已确认开始，待首个公开节点', lastPublicNode: '', nextStepAt: at,
      completedSteps: 0, maxSteps: d.config.sharedMaxSteps, idleSeconds: d.config.sharedIdleSeconds, outline: null };
  } else if (change?.action === 'end') {
    state.scene.mode = 'chat'; state.scene.shared = null;
  }
  const changesMorningAppointment = candidate.taskChanges.some(c => c.action === 'create' ? c.task.kind === 'appointment' : c.action === 'update' && allTasks.some(t => t.id === c.id && t.kind === 'appointment'));
  const expiredSharedSleep = shared && change?.action === 'end' && !!state.sleep && due(state.sleep.wakeAt, at);
  if (expiredSharedSleep) state.sleep = null;
  if (waking || personal?.sleepPreference || changesMorningAppointment || (!shared && !state.sleep)) {
    // Apply task changes in the workspace before considering next-morning appointments.
    const plannedTasks = allTasks.filter(t => !candidate.completedTaskIds.includes(t.id)).map(t => structuredClone(t));
    for (const c of candidate.taskChanges) {
      if (c.action === 'create') plannedTasks.push({ ...c.task, id: c.id!, status: 'pending' });
      else {
        const old = plannedTasks.find(t => t.id === c.id) ?? allTasks.find(t => t.id === c.id);
        if (old && c.action === 'update') { const i = plannedTasks.findIndex(t => t.id === c.id); if (i >= 0) plannedTasks[i] = { ...old, ...c.task }; else plannedTasks.push({ ...old, ...c.task }); }
        if (old && c.action === 'cancel') { const i = plannedTasks.findIndex(t => t.id === c.id); if (i >= 0) plannedTasks.splice(i, 1); }
      }
    }
    state.sleep = arrangeSleep(state, at, d.config, d.random, plannedTasks, personal?.sleepPreference, waking);
  }
  const payloads: Array<{ kind: OutboxItem['kind']; content: string }> = [];
  if (change?.action === 'start') payloads.push({ kind: 'narration', content: '共同活动开始' });
  if ('publicNarration' in narrative && narrative.publicNarration) payloads.push({ kind: 'narration', content: narrative.publicNarration });
  for (const part of (expression?.parts ?? []).filter(p => p.content.trim())) {
    payloads.push(part);
    if (part.kind === 'text' && outputMode !== 'shared_offline' && d.config.stickersEnabled) {
      const n = candidate.probability.stickerMisses;
      if (sampleOpportunity(n, stickerCurve.p0, stickerCurve.step, d.random)) {
        const query = [part.content, personal?.stickerIntent].filter(Boolean).join('\n');
        const id = await d.stickers!.findSticker(query);
        check();
        payloads.push({ kind: 'sticker', content: id }); candidate.probability.stickerMisses = 0;
      } else candidate.probability.stickerMisses++;
    }
  }
  if (change?.action === 'end') payloads.push({ kind: 'narration', content: '共同活动结束' });
  const items = payloads.map((p, seq): OutboxItem => ({
    turnId, seq, kind: p.kind, payload: p.content, status: 'pending', confirmedAt: null, platformMessageIds: [], notBefore: null,
  }));
  check();
  return { candidate, items };
}
