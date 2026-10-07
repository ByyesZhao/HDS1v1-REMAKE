import type { Random } from '../types';
export const stickerCurve = { p0: 0.025, step: 0.00177786838251657 };
export const contactCurve = { p0: 0.075, step: 0.0183782066846511 };
export function probability(misses: number, p0: number, step: number): number { return Math.min(1, p0 + step * misses); }
export function sampleOpportunity(misses: number, p0: number, step: number, random: Random): boolean { return random.next() < probability(misses, p0, step); }
export function expectedRate(p0: number, step: number): number {
  let survival = 1, expected = 1;
  for (let n = 0; survival > 0; n++) { survival *= 1 - probability(n, p0, step); expected += survival; }
  return 1 / expected;
}
