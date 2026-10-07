import type { OutboxItem } from '../types';
const segmenter = new Intl.Segmenter('zh', { granularity: 'grapheme' });
export function countVisibleCharacters(content: string): number { return [...segmenter.segment(content.replace(/\s/gu, ''))].length; }
export function delayMs(next: { content: string }): number {
  const n = Math.min(25, Math.max(1, countVisibleCharacters(next.content)));
  return Math.round(3000 + (n - 1) * 7000 / 24);
}
export function displayText(item: { kind: string; payload: string }): string {
  return item.kind === 'narration' ? `【${item.payload}】` : item.kind === 'action' ? `【动作：${item.payload}】` : item.payload;
}
export function renderItem(item: { kind: string; payload: string }): string {
  return displayText(item).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
export function nextItemDelay(items: OutboxItem[], index: number): number {
  const item = items[index];
  if (item.kind !== 'text' && item.kind !== 'action') return 0;
  const previousSpeech = items.slice(0, index).some(i => i.kind === 'text' || i.kind === 'action');
  return previousSpeech ? delayMs({ content: item.payload }) : 0;
}
