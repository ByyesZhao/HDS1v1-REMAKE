import type { CharacterState, Scene, SharedClock, SharedTurnMeta, TurnRecord, OutboxItem } from '../types';
import { randomUUID } from 'node:crypto';
import { Storage } from '../storage';
import { addMs, milliseconds } from '../time';

export function selectSharedMeta(storage: Storage, now: string, inputMessageIds: string[], taskIds: string[]): SharedTurnMeta | null {
  const state = storage.character(); const s = state.scene.shared; const clock = storage.runtime().sharedClock;
  if (!hasValidSharedScene(state) || !s || !clock || clock.status !== 'active' || clock.activityId !== s.activityId || s.completedSteps >= s.maxSteps) return null;
  const controls = storage.all('control_requests').filter(c => c.activityId === s.activityId && c.status === 'pending');
  const appointment = taskIds.some(id => storage.read('tasks', id)?.kind === 'appointment');
  const automatic = milliseconds(sharedDeadline(s, clock)) <= milliseconds(now);
  if (!automatic && !controls.length && !appointment) return null;
  const stepNumber = s.completedSteps + 1, remaining = s.maxSteps - stepNumber;
  return { activityId: s.activityId, stepNumber, maxSteps: s.maxSteps, idleSeconds: s.idleSeconds,
    advanceReason: s.completedSteps === 0 ? 'initial' : controls.length ? 'manual' : appointment ? 'appointment' : 'automatic',
    phase: remaining === 0 ? 'final' : remaining <= 3 ? 'wrap_up' : stepNumber === 1 ? 'opening' : 'ongoing',
    controlRequestIds: controls.map(c => c.id), sceneTaskId: `scene:${s.activityId}`, allowSimulatedUserActions: inputMessageIds.length === 0 };
}

export function hasValidSharedScene(state: CharacterState): boolean {
  // Field-shape gate only; deployment assembly checks the persisted version.
  const s = state.scene.shared;
  return state.scene.mode !== 'chat' && !!s?.activityId && Number.isInteger(s.completedSteps)
    && s.completedSteps >= 0 && s.maxSteps >= 1 && s.maxSteps <= 20 && s.idleSeconds > 0;
}

export function sharedRoutingActivity(storage: Storage): { activityId: string; mode: 'shared_online' | 'shared_offline' } | null {
  const clock = storage.runtime().sharedClock;
  if (clock) return clock.status === 'active' ? { activityId: clock.activityId, mode: clock.mode } : null;
  const state = storage.character();
  return state && hasValidSharedScene(state) ? { activityId: state.scene.shared!.activityId, mode: state.scene.mode as 'shared_online' | 'shared_offline' } : null;
}

export function sharedDeadline(shared: NonNullable<Scene['shared']>, clock: SharedClock): string {
  if (shared.completedSteps === 0) return clock.startedAt;
  const anchors = [clock.startedAt, clock.lastInputAt, clock.lastOutputAt, clock.lastSilentCompletedAt]
    .filter((at): at is string => at !== null);
  const latest = Math.max(...anchors.map(milliseconds));
  return addMs(new Date(latest).toISOString(), shared.idleSeconds * 1000);
}

/** The caller owns the surrounding SQLite transaction. */
export function refreshSharedStep(storage: Storage, _now: string): void {
  // Projection is anchored to confirmed events, never to a status/scheduler read.
  const state = storage.character(); const s = state.scene.shared; const clock = storage.runtime().sharedClock;
  if (!hasValidSharedScene(state) || !s || !clock || clock.status !== 'active' || clock.activityId !== s.activityId) return;
  const id = `scene:${s.activityId}`;
  if (s.completedSteps >= s.maxSteps) {
    s.nextStepAt = null;
    const old = storage.read('tasks', id); if (old) storage.save('tasks', id, { ...old, status: 'cancelled' });
  } else {
    s.nextStepAt = sharedDeadline(s, clock);
    storage.save('tasks', id, { id, kind: 'scene_step', at: s.nextStepAt, description: s.title,
      sharedActivityId: s.activityId, status: 'pending' });
  }
  storage.set('character', state);
}

/** Called only after a real send confirmation, within its transaction. */
export function recordSharedOutput(storage: Storage, turn: TurnRecord, item: OutboxItem, confirmedAt: string): void {
  const candidate = turn.frozenResult!, change = candidate.personal?.sharedChange;
  const runtime = storage.runtime();
  const starting = change?.action === 'start' && item.seq === 0 && item.kind === 'narration';
  const activityId = starting ? candidate.nextState.scene.shared!.activityId : turn.sharedMeta?.activityId;
  if (!activityId) return;
  if (starting) runtime.sharedClock = { activityId, mode: candidate.nextState.scene.mode as SharedClock['mode'], status: 'active',
    startedAt: confirmedAt, lastInputAt: null, lastOutputAt: null, lastSilentCompletedAt: null };
  const clock = runtime.sharedClock;
  if (!clock || clock.activityId !== activityId) return;
  clock.lastOutputAt = confirmedAt;
  if (change?.action === 'end' && item.kind === 'narration' && item.seq === storage.outbox(turn.id).length - 1) clock.status = 'ended';
  storage.set('runtime', runtime);
  refreshSharedStep(storage, confirmedAt);
}

/** Applies only activity-owned data; caller already saved the candidate and marked visible inputs. */
export function finishSharedTurn(storage: Storage, turn: TurnRecord, completedAt: string): void {
  const candidate = turn.frozenResult!, change = candidate.personal?.sharedChange, meta = turn.sharedMeta;
  if (!meta && change?.action !== 'start') return;
  const state = storage.character(), runtime = storage.runtime();
  const activityId = meta?.activityId ?? state.scene.shared!.activityId;
  if (meta) {
    if (state.scene.shared?.activityId === activityId) state.scene.shared.completedSteps = meta.stepNumber;
    for (const id of meta.controlRequestIds) {
      const c = storage.read('control_requests', id);
      if (c?.activityId === activityId && c.status === 'pending') storage.save('control_requests', id, { ...c, status: 'consumed', consumedTurnId: turn.id });
    }
    if (!storage.outbox(turn.id).length && runtime.sharedClock?.activityId === activityId) runtime.sharedClock.lastSilentCompletedAt = completedAt;
  }
  if (change?.action === 'start') {
    const transferred = storage.messages().filter(m => m.direction === 'incoming' && m.seenTurnId === null && m.batchId !== null);
    const batches = new Set(transferred.map(m => m.batchId!));
    transferred.forEach(m => storage.save('messages', m.id, { ...m, sharedActivityId: activityId, batchId: null }));
    runtime.pendingBatchIds = runtime.pendingBatchIds.filter(id => !batches.has(id));
    if (runtime.openBatch && batches.has(runtime.openBatch.id)) runtime.openBatch = null;
    const clock = runtime.sharedClock;
    if (clock?.activityId === activityId && transferred.length) {
      const anchors = [...transferred.map(m => m.receivedAt), ...(clock.lastInputAt ? [clock.lastInputAt] : [])];
      clock.lastInputAt = anchors.sort((a, b) => milliseconds(b) - milliseconds(a))[0];
    }
  }
  if (change?.action === 'end') {
    for (const t of storage.all('tasks').filter(t => t.kind === 'scene_step' && (t.id === `scene:${activityId}` || t.sharedActivityId === activityId))) storage.save('tasks', t.id, { ...t, status: 'cancelled' });
    for (const c of storage.all('control_requests').filter(c => c.activityId === activityId && c.status === 'pending')) storage.save('control_requests', c.id, { ...c, status: 'cancelled' });
    const transferred = storage.messages().filter(m => m.direction === 'incoming' && m.seenTurnId === null && m.sharedActivityId === activityId && m.batchId === null);
    if (transferred.length) {
      const batchId = runtime.openBatch?.id ?? randomUUID();
      // Ordinary batching is fixed at 15s: readyAt - 15s recovers its latest input anchor.
      const anchor = Math.max(milliseconds(completedAt), ...transferred.map(m => milliseconds(m.receivedAt)), runtime.openBatch ? milliseconds(runtime.openBatch.readyAt) - 15_000 : 0);
      transferred.forEach(m => storage.save('messages', m.id, { ...m, batchId }));
      runtime.openBatch = { id: batchId, readyAt: addMs(new Date(anchor).toISOString(), 15_000) };
    }
    if (runtime.sharedClock?.activityId === activityId) runtime.sharedClock = null;
    if (state.sleep && milliseconds(state.sleep.wakeAt) <= milliseconds(completedAt)) state.sleep = null;
  }
  storage.set('character', state); storage.set('runtime', runtime);
  if (change?.action !== 'end') refreshSharedStep(storage, completedAt);
}
