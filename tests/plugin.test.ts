import { it, expect } from 'vitest';
import { isTargetSession } from '../src/host/input';
it('only accepts the bound bot and user in direct chat', () => {
  const config = { botId: '1000000000', userId: '1000000001' };
  expect(isTargetSession({ isDirect: true, selfId: '1000000000', userId: '1000000001' }, config)).toBe(true);
  expect(isTargetSession({ isDirect: false, selfId: '1000000000', userId: '1000000001' }, config)).toBe(false);
  expect(isTargetSession({ isDirect: true, selfId: 'other', userId: '1000000001' }, config)).toBe(false);
  expect(isTargetSession({ isDirect: true, selfId: '1000000000', userId: 'other' }, config)).toBe(false);
});
