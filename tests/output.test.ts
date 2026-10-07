import { it, expect } from 'vitest';
import { countVisibleCharacters, delayMs, renderItem } from '../src/output/qq';
it('counts visible graphemes and times the next bare speech part', () => {
  expect(countVisibleCharacters(' 👩‍👩‍👧‍👦 👍🏽\n 笑 ')).toBe(3);
  expect(delayMs({ content: '笑' })).toBe(3000);
  expect(delayMs({ content: '哈'.repeat(13) })).toBe(6500);
  expect(delayMs({ content: '哈'.repeat(26) })).toBe(10000);
  expect(renderItem({ kind: 'action', payload: '笑' })).toBe('【动作：笑】');
  expect(renderItem({ kind: 'narration', payload: '走到门口' })).toBe('【走到门口】');
  expect(renderItem({ kind: 'text', payload: '<image src="x"/>' })).toBe('&lt;image src="x"/&gt;');
});
