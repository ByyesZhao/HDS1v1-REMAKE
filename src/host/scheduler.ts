import { defaultConfig,type AppConfig } from '../config';
import {releaseSchoolNotices,selectSchoolNotices,schoolNotificationEligible,schoolNoticeDeadline,createSchoolNoticeEvaluationContext} from '../school/notices';
import {ensureEnvironmentBatch,selectEnvironmentStep,environmentDeadline} from '../environment/scheduler';
import { randomUUID } from 'node:crypto';
import { Storage } from '../storage';
import { InputBuffer } from './input';
import { due, milliseconds } from '../time';
import { canRead, isSleeping } from './state';
import { hasValidSharedScene, refreshSharedStep, selectSharedMeta, sharedDeadline } from './shared';
import type { TurnRequest, TriggerKind } from '../types';

export class Scheduler {
  constructor(private storage: Storage,private config:AppConfig=defaultConfig) {}
  async collectReady(now: string): Promise<TurnRequest | null> {
    new InputBuffer(this.storage).closeReady(now);
    if (this.storage.runtime().paused || this.storage.unfinishedTurn()) return null;
    const noticeContext=createSchoolNoticeEvaluationContext(this.storage);
    this.storage.transaction(()=>releaseSchoolNotices(this.storage,now, this.config.timezone,noticeContext));
    const state = this.storage.character();
    if (isSleeping(state, now)) {
      this.storage.transaction(() => {
        state.nextAutonomousAt = null; this.storage.set('character', state);
        const r = this.storage.runtime(); r.pendingBatchIds = []; this.storage.set('runtime', r);
      });
    }
    const runtime = this.storage.runtime();
    const front = this.foreground(now);
    if (front) return {...front,schoolNoticeRefs:selectSchoolNotices(this.storage,now, this.config.timezone,noticeContext)};
    if(schoolNotificationEligible(this.storage,now, this.config.timezone,noticeContext))return {inputMessageIds:[],taskIds:[],triggerKinds:['school_notification'],batchIds:[],sharedMeta:null,schoolNoticeRefs:selectSchoolNotices(this.storage,now, this.config.timezone,noticeContext)};
    if (!hasValidSharedScene(state) && !isSleeping(state, now) && runtime.pendingBatchIds.length && !canRead(state, now)) this.stashPending(now);
    if(!runtime.openBatch){
      ensureEnvironmentBatch(this.storage,this.config,now);
      const step=selectEnvironmentStep(this.storage,now);
      if(step)return {inputMessageIds:[],taskIds:[],triggerKinds:['environment'],batchIds:[],environmentStepId:step.id,sharedMeta:null};
    }
    if (this.autonomousEligible(now) && due(state.nextAutonomousAt, now)) return {
      inputMessageIds: this.storage.unreadMessages().map(m => m.id), taskIds: [], triggerKinds: ['autonomous'], batchIds: [], sharedMeta: null,schoolNoticeRefs:selectSchoolNotices(this.storage,now, this.config.timezone,noticeContext) };
    return null;
  }

  private foreground(now: string): TurnRequest | null {
    const state = this.storage.character(), runtime = this.storage.runtime();
    const dueTasks = this.storage.all('tasks').filter(t => t.status === 'pending' && due(t.at, now));
    if (hasValidSharedScene(state)) {
      this.storage.transaction(() => refreshSharedStep(this.storage, now));
      const inputs = this.storage.unreadActivityMessages(state.scene.shared!.activityId);
      const tasks = dueTasks.filter(t => t.kind !== 'scene_step');
      const meta = selectSharedMeta(this.storage, now, inputs.map(m => m.id), tasks.map(t => t.id));
      if (!meta) return null;
      return { inputMessageIds: inputs.map(m => m.id), taskIds: [meta.sceneTaskId, ...tasks.map(t => t.id)],
        triggerKinds: ['scene_step', ...new Set(tasks.map(t => t.kind))], batchIds: [], sharedMeta: meta };
    }
    if (isSleeping(state, now)) return null;
    const wake = !!state.sleep && due(state.sleep.wakeAt, now);
    const hasOther = wake || dueTasks.some(t => t.kind !== 'check_messages');
    const tasks = dueTasks.filter(t => t.kind !== 'check_messages' || canRead(state, now) || hasOther);
    const pending = runtime.pendingBatchIds;
    const batchIds = wake || tasks.some(t => t.kind === 'check_messages') ? [...pending] : canRead(state, now) ? pending.slice(0, 1) : [];
    const kinds: TriggerKind[] = [];
    if (batchIds.length) kinds.push('input');
    for (const task of tasks) if (!kinds.includes(task.kind)) kinds.push(task.kind);
    if (wake) kinds.push('sleep');
    if (!kinds.length) return null;
    const inputs = this.storage.unreadMessages().filter(m => !pending.includes(m.batchId!) || batchIds.includes(m.batchId!));
    return { inputMessageIds: inputs.map(m => m.id), taskIds: tasks.map(t => t.id), triggerKinds: kinds, batchIds, sharedMeta: null };
  }

  private autonomousEligible(now: string): boolean {
    const r = this.storage.runtime(), state = this.storage.character();
    return !hasValidSharedScene(state) && !isSleeping(state, now) && !r.openBatch && !r.pendingBatchIds.length && !this.foreground(now);
  }
  private stashPending(now: string): void {
    this.storage.transaction(() => {
      const r = this.storage.runtime(); r.pendingBatchIds = []; this.storage.set('runtime', r);
      const state = this.storage.character(); const end = state.scene.activity?.expectedEndAt;
      if (!end || milliseconds(end) <= milliseconds(now)) return;
      const old = this.storage.all('tasks').find(t => t.kind === 'check_messages' && t.checkReason === 'unread' && t.status === 'pending');
      const id = old?.id ?? randomUUID();
      this.storage.save('tasks', id, { id, kind: 'check_messages', checkReason: 'unread', at: end, description: '活动预计结束后检查待看消息', messageIds: this.storage.unreadMessages().map(m => m.id), status: 'pending' });
    });
  }
  async nextDeadline(now: string): Promise<string | null> {
    const runtime = this.storage.runtime();
    if (runtime.paused) return runtime.openBatch?.readyAt ?? null;
    if (this.storage.unfinishedTurn()) return null;
    const state = this.storage.character();
    const noticeContext=createSchoolNoticeEvaluationContext(this.storage);
    const candidates: string[] = [];
    if (runtime.openBatch) candidates.push(runtime.openBatch.readyAt);
    if (this.foreground(now)) candidates.push(now);
    const shared = hasValidSharedScene(state);
    if (state.sleep && !shared) {
      if (isSleeping(state, now)) candidates.push(state.sleep.wakeAt);
      else if (due(state.sleep.wakeAt, now)) candidates.push(now);
      else candidates.push(state.sleep.sleepAt);
    }
    if (!isSleeping(state, now)) {
      if (state.nextAutonomousAt && this.autonomousEligible(now)) candidates.push(state.nextAutonomousAt);
      if (shared && state.scene.shared!.completedSteps < state.scene.shared!.maxSteps && runtime.sharedClock?.status === 'active'
        && runtime.sharedClock.activityId === state.scene.shared!.activityId) candidates.push(sharedDeadline(state.scene.shared!, runtime.sharedClock));
      for (const task of this.storage.all('tasks').filter(t => t.status === 'pending')) {
        if (shared && task.kind !== 'appointment') continue;
        if (task.kind !== 'check_messages' || canRead(state, now)) candidates.push(task.at);
        else if (state.scene.activity?.expectedEndAt) candidates.push(new Date(Math.max(milliseconds(task.at), milliseconds(state.scene.activity.expectedEndAt))).toISOString());
      }
    }
    if(!runtime.openBatch){const env=environmentDeadline(this.storage,now);if(env)candidates.push(env);}
    const notice=schoolNoticeDeadline(this.storage,now, this.config.timezone,noticeContext);if(notice)candidates.push(notice);

    return candidates.sort((a, b) => milliseconds(a) - milliseconds(b))[0] ?? null;
  }
}
