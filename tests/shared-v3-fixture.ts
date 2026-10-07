import type { Scene, SharedClock } from '../src/types';
import { setup, NOW } from './helpers';

export function makeSharedFixture(d: ReturnType<typeof setup>, overrides: Partial<NonNullable<Scene['shared']>> = {}): void {
  const shared: NonNullable<Scene['shared']> = {
    activityId: 'activity-a', title: '一起游戏', progress: '开始游戏', lastPublicNode: '',
    completedSteps: 1, maxSteps: 20, idleSeconds: 60, outline: null, nextStepAt: null, ...overrides,
  };
  const clock: SharedClock = { activityId: shared.activityId, mode: 'shared_online', status: 'active', startedAt: NOW,
    lastInputAt: null, lastOutputAt: NOW, lastSilentCompletedAt: null };
  const state = d.storage.character();
  state.scene.mode = 'shared_online'; state.scene.shared = shared; state.sleep = null;
  d.storage.set('character', state);
  d.storage.set('runtime', { ...d.storage.runtime(), sharedActivityVersion: 1, sharedClock: clock,
    nextWorldAt: '2026-10-08T06:00:00+08:00', nextSchoolAt: '2026-10-08T06:10:00+08:00' });
}
