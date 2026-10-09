import {it,expect} from 'vitest';import {validateLocalWeb} from '../scripts/validate-local-web';
it('default offline validation executes shared extraction/provider and never starts browser/network',async()=>{
 const report=await validateLocalWeb({});expect(report.passed).toBe(true);expect(report.mode).toBe('offline');expect(report.realNetworkRequests).toBe(0);expect(report.candidateCount).toBeGreaterThan(0);expect(report.bodyCharacters).toBeGreaterThan(0);expect(report.drained).toBe(true);expect(report.versions.extractor).toBe('dom-v1/readability-0.6.0');expect(report.english.bodyCharacters).toBeGreaterThan(0);expect(report.dynamic.passed).toBe(true);expect(report.unreadable.rejected).toBe(true);
});
