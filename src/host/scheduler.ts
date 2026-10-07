import { randomUUID } from 'node:crypto';
import { Storage } from '../storage';
import { InputBuffer } from './input';
import { due, milliseconds } from '../time';
import { canRead, isSleeping } from './state';
import type { TurnRequest, TriggerKind } from '../types';

export class Scheduler {
  constructor(private storage: Storage) {}
  async collectReady(now: string): Promise<TurnRequest | null> {
    new InputBuffer(this.storage).closeReady(now);
    if (this.storage.runtime().paused || this.storage.unfinishedTurn()) return null;
    let state = this.storage.character();
    if (isSleeping(state, now)) {
      this.storage.transaction(() => {
        state.nextAutonomousAt = null; this.storage.set('character', state);
        const r = this.storage.runtime(); r.pendingBatchIds = []; this.storage.set('runtime', r);
      });
    }
    const runtime = this.storage.runtime();
    const environmentKind = due(runtime.nextWorldAt, now) ? 'world' : due(runtime.nextSchoolAt, now) ? 'school' : undefined;
    if (environmentKind) return { inputMessageIds: [], taskIds: [], triggerKinds: ['environment'], batchIds: [], environmentKind };
    if (isSleeping(state, now)) return null;
    const wake = !!state.sleep && due(state.sleep.wakeAt, now);
    const autonomous = due(state.nextAutonomousAt, now);
    const pending = this.storage.runtime().pendingBatchIds;
    const hasOther = wake || autonomous || this.storage.all('tasks').some(t => t.status === 'pending' && t.kind !== 'check_messages' && due(t.at, now));
    const tasks = this.storage.all('tasks').filter(t => t.status === 'pending' && due(t.at, now) && (t.kind !== 'check_messages' || canRead(state, now) || hasOther));
    if (pending.length && !canRead(state, now) && !hasOther && tasks.length === 0) {
      this.stashPending(now); return null;
    }
    const check = tasks.some(t => t.kind === 'check_messages');
    const batchIds = wake || check ? [...pending] : pending.slice(0, 1);
    const inputs = this.storage.unreadMessages().filter(m => !pending.includes(m.batchId!) || batchIds.includes(m.batchId!));
    const kinds: TriggerKind[] = [];
    if (batchIds.length) kinds.push('input');
    for (const task of tasks) if (!kinds.includes(task.kind)) kinds.push(task.kind);
    if (autonomous) kinds.push('autonomous');
    if (wake) kinds.push('sleep');
    if (!kinds.length) return null;
    return { inputMessageIds: inputs.map(m => m.id), taskIds: tasks.map(t => t.id), triggerKinds: kinds, batchIds };
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
    const state = this.storage.character();
    const candidates: string[] = [];
    if (runtime.openBatch) candidates.push(runtime.openBatch.readyAt);
    if (runtime.pendingBatchIds.length) candidates.push(now);
    if (state.sleep) {
      if (isSleeping(state, now)) candidates.push(state.sleep.wakeAt);
      else if (due(state.sleep.wakeAt, now)) candidates.push(now);
      else candidates.push(state.sleep.sleepAt);
    }
    if (!isSleeping(state, now)) {
      if (state.nextAutonomousAt) candidates.push(state.nextAutonomousAt);
      for (const task of this.storage.all('tasks').filter(t => t.status === 'pending')) {
        if (task.kind !== 'check_messages' || canRead(state, now)) candidates.push(task.at);
        else if (state.scene.activity?.expectedEndAt) candidates.push(new Date(Math.max(milliseconds(task.at), milliseconds(state.scene.activity.expectedEndAt))).toISOString());
      }
    }
    if (runtime.nextWorldAt) candidates.push(runtime.nextWorldAt);
    if (runtime.nextSchoolAt) candidates.push(runtime.nextSchoolAt);
    return candidates.sort((a, b) => milliseconds(a) - milliseconds(b))[0] ?? null;
  }
}
