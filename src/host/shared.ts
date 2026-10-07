import type { CharacterState, Scene, SharedClock } from '../types';
import { Storage } from '../storage';
import { addMs, milliseconds } from '../time';

export function hasValidSharedScene(state: CharacterState): boolean {
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
