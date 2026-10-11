import {expect,it} from 'vitest';
import {existsSync} from 'node:fs';
import {measureWebPayloads} from '../scripts/measure-web-payloads';
it.each([1,5,10,20])('fresh_tool_loop_parses_each_saved_body_at_most_once pages=%s',async pages=>{
 const report=await measureWebPayloads(pages,process.env.WEB_COST_BASELINE==='1'?'baseline':'current');
 expect(report.snapshotCalls).toBe(0);expect(report.controlBodyParseCharacters).toBe(0);
 expect(report.bodyParseCharacters).toBeLessThanOrEqual(2*pages*100000+pages*4096);
 expect(report.bodyParseCalls).toBe(pages);expect(report.materialReads).toBe(pages+1);
 expect(report.operationBodyFields).toBe(0);expect(report.checkpointBodyFields).toBe(0);
 expect(report.materialLengths).toEqual(Array(pages).fill(100000));expect(report.materialHashes).toHaveLength(pages);expect(new Set(report.materialHashes).size).toBe(pages);
 expect(report.counters).toEqual({successReads:pages,failures:0});expect(report.providerCalls).toBe(pages);expect(report.modelCalls).toBe(pages+1);
 expect(report.recovery.providerCalls).toBe(0);expect(report.recovery.materialReads).toBe(1);expect(report.recovery.bodyParseCharacters).toBeLessThanOrEqual(pages*100000+pages*4096);
},30000);
// The archived baseline is an offline audit artifact, not a runtime dependency of a clean checkout.
it.skipIf(!existsSync('.tmp/comprehensive-remediation-baseline-build/model/client.js')).each([1,20])('full_completion_envelopes_and_materials_match_archived_baseline pages=%s',async pages=>{
 const before=await measureWebPayloads(pages,'baseline'),after=await measureWebPayloads(pages);
 expect(after.envelopeHashes).toEqual(before.envelopeHashes);expect(after.envelopeCharacters).toBe(before.envelopeCharacters);expect(after.materialHashes).toEqual(before.materialHashes);expect(after.counters).toEqual(before.counters);expect(after.providerCalls).toBe(before.providerCalls);expect(after.modelCalls).toBe(before.modelCalls);
},30000);
