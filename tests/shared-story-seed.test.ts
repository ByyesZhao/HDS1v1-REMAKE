import { it, expect } from 'vitest';
import { initialCharacter } from '../src/config';
import { sharedStorySeed } from '../scripts/shared-story-seed';
const now = '2026-10-08T19:00:00+08:00';
it('a sixteen-node continuation already has sixteen elapsed minutes and a coherent activity start', () => {
  const { state, clock } = sharedStorySeed(initialCharacter(now), 'wrap', now);
  expect(state.scene.shared!.completedSteps).toBe(16);
  expect(Date.parse(state.narratedUntil) - Date.parse(clock.startedAt)).toBeGreaterThanOrEqual(16 * 60_000);
  expect(state.scene.activity!.startsAt).toBe(clock.startedAt);
  expect(Date.parse(state.scene.activity!.expectedEndAt!) - Date.parse(now)).toBe(4 * 60_000);
  expect(clock.lastOutputAt).toBe(now);
  expect(state.scene.shared!.lastPublicNode).not.toBe('');
});
it('fresh activities begin at the first node with the current confirmed marker', () => {
  for (const scenario of ['quiet', 'interactive']) {
    const { state, clock } = sharedStorySeed(initialCharacter(now), scenario, now);
    expect(state.scene.shared!.completedSteps).toBe(0);
    expect(clock.startedAt).toBe(now);
    expect(state.scene.shared!.outline).toBeNull();
  }
});
