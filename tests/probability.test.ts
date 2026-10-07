import { it, expect } from 'vitest';
import { sampleOpportunity, probability, expectedRate } from '../src/host/probability';
import { generateTurn } from '../src/app';
import { setup, SequenceRandom } from './helpers';
const STICKER = { p0: 0.025, step: 0.00177786838251657 };
const CONTACT = { p0: 0.075, step: 0.0183782066846511 };
it('guarantees a hit at the documented caps', () => {
  expect(probability(548, STICKER.p0, STICKER.step)).toBeLessThan(1);
  expect(sampleOpportunity(549, STICKER.p0, STICKER.step, new SequenceRandom([0.999999]))).toBe(true);
  expect(probability(50, CONTACT.p0, CONTACT.step)).toBeLessThan(1);
  expect(sampleOpportunity(51, CONTACT.p0, CONTACT.step, new SequenceRandom([0.999999]))).toBe(true);
});
it.each([{ ...STICKER, target: 0.05 }, { ...CONTACT, target: 0.15 }])('calibrates expected and million-opportunity rates to $target', ({ p0, step, target }) => {
  expect(expectedRate(p0, step)).toBeCloseTo(target, 10);
  let seed = 123456789, hits = 0, misses = 0;
  const random = { next: () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; } };
  for (let i = 0; i < 1_000_000; i++) { if (sampleOpportunity(misses, p0, step, random)) { hits++; misses = 0; } else misses++; }
  expect(Math.abs(hits / 1_000_000 - target)).toBeLessThan(0.002);
});
it('contacts only during eligible autonomous life turns and expresses only a hit', async () => {
  const d = setup(); d.random = new SequenceRandom([0.01, 0.5]);
  d.models.outputs.personal_life = { emotions: [], innerThought: '想分享', contact: { willing: true, intention: '分享', draft: '今天好开心' } };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '今天好开心' }] };
  const hit = await generateTurn(d, { inputMessageIds: [], taskIds: [], triggerKinds: ['autonomous'] }, 'a');
  expect(hit.items.map(i => i.payload)).toEqual(['今天好开心']);
  d.random = new SequenceRandom([0.999]);
  const miss = await generateTurn(d, { inputMessageIds: [], taskIds: [], triggerKinds: ['autonomous'] }, 'b');
  expect(miss.items).toEqual([]); expect(miss.candidate.probability.contactMisses).toBe(1);
  const ineligible = await generateTurn(d, { inputMessageIds: [], taskIds: [], triggerKinds: ['activity'] }, 'c');
  expect(ineligible.candidate.probability.contactMisses).toBe(0); expect(ineligible.items).toEqual([]);
  d.storage.close();
});
