import { it, expect } from 'vitest';
import { InputBuffer } from '../src/host/input';
import { setup, NOW } from './helpers';
import { makeSharedFixture } from './shared-v3-fixture';

it('exact_control_is_not_a_message: only the entire trimmed marker is control', async () => {
  const d = setup(); makeSharedFixture(d); const input = new InputBuffer(d.storage);
  expect(await input.acceptInput({ id: 'c', content: '  【推进】  ', receivedAt: NOW, platformMessageIds: ['qq-c'] })).toEqual({ kind: 'advance', systemReply: null });
  expect(d.storage.messages()).toHaveLength(0); expect(d.storage.runtime().openBatch).toBeNull();
  expect(d.storage.read('control_requests', 'c')).toMatchObject({ status: 'pending', activityId: 'activity-a', platformMessageIds: ['qq-c'] });
  for (const content of ['请【推进】故事', '【动作：推进】']) await input.acceptInput({ id: content, content, receivedAt: NOW });
  expect(d.storage.messages().map(m => m.content)).toEqual(['请【推进】故事', '【动作：推进】']);
  expect(d.storage.unreadMessages()).toEqual([]); d.storage.close();
});

it('inactive_control_is_cancelled: fixed feedback without model or message', async () => {
  const d = setup(); const input = new InputBuffer(d.storage);
  expect(await input.acceptInput({ id: 'c', content: '【推进】', receivedAt: NOW })).toEqual({ kind: 'advance', systemReply: '当前没有共同活动' });
  expect(d.storage.read('control_requests', 'c')).toMatchObject({ status: 'cancelled', activityId: null });
  expect(d.storage.messages()).toHaveLength(0); expect(d.models.calls).toHaveLength(0); expect(d.storage.runtime().openBatch).toBeNull(); d.storage.close();
});

it('advance_before_start_confirmation_is_inactive: candidate does not create a visible activity', async () => {
  const d = setup(); const input = new InputBuffer(d.storage);
  d.storage.set('candidate-start', { activityId: 'activity-a', mode: 'shared_online' });
  expect((await input.acceptInput({ id: 'c', content: '【推进】', receivedAt: NOW })).systemReply).toBe('当前没有共同活动');
  await input.acceptInput({ id: 'm', content: '准备好了', receivedAt: NOW });
  expect(d.storage.read('messages', 'm')).toMatchObject({ sharedActivityId: null });
  expect(Date.parse(d.storage.runtime().openBatch!.readyAt)).toBe(Date.parse(NOW) + 15_000);
  expect(d.storage.read('control_requests', 'c')!.status).toBe('cancelled'); d.storage.close();
});

it('shared_input_keeps_action_text: preserves raw offline actions and latest anchor', async () => {
  const d = setup(); makeSharedFixture(d); const r = d.storage.runtime(); r.sharedClock!.mode = 'shared_offline'; d.storage.set('runtime', r);
  const input = new InputBuffer(d.storage); const at = '2026-10-07T10:00:20+08:00';
  await input.acceptInput({ id: 'a', content: '【动作：推门】你好', receivedAt: at, platformMessageIds: ['p1', 'p2'] });
  expect(d.storage.read('messages', 'a')).toMatchObject({ content: '【动作：推门】你好', platformMessageIds: ['p1', 'p2'], batchId: null, sharedActivityId: 'activity-a' });
  expect(d.storage.runtime().openBatch).toBeNull(); expect(d.storage.runtime().sharedClock!.lastInputAt).toBe(at);
  expect(Date.parse(d.storage.character().scene.shared!.nextStepAt!)).toBe(Date.parse(at) + 60_000); d.storage.close();
});

it('published_boundary_routes_before_B: visible clock takes precedence over old formal mode', async () => {
  const d = setup(); makeSharedFixture(d); const input = new InputBuffer(d.storage);
  const state = d.storage.character(); state.scene.mode = 'chat'; state.scene.shared = null; d.storage.set('character', state);
  await input.acceptInput({ id: 'start-c', content: '【推进】', receivedAt: NOW });
  await input.acceptInput({ id: 'start-m', content: '出发', receivedAt: NOW });
  expect(d.storage.read('control_requests', 'start-c')!.activityId).toBe('activity-a');
  expect(d.storage.read('messages', 'start-m')!.sharedActivityId).toBe('activity-a');
  makeSharedFixture(d); const r = d.storage.runtime(); r.sharedClock!.status = 'ended'; d.storage.set('runtime', r);
  await input.acceptInput({ id: 'end-m', content: '晚安', receivedAt: NOW });
  expect(d.storage.read('messages', 'end-m')).toMatchObject({ sharedActivityId: null, batchId: expect.any(String) });
  expect((await input.acceptInput({ id: 'end-c', content: '【推进】', receivedAt: NOW })).systemReply).toBe('当前没有共同活动'); d.storage.close();
});
