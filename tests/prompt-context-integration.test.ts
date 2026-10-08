import {it,expect} from 'vitest';
import {validatePromptContext} from '../src/deployment/prompt-context-acceptance';
it('normal_shared_life_and_empty_memory_full_flow; four_episodes_preserve_source_roles',async()=>{
 const report=await validatePromptContext();expect(report.scenarios.map(s=>s.name)).toEqual(['normal','shared','life','empty']);
 expect(report.embeddingRequests).toBe(0);expect(report.networkRequests).toBe(0);
 const normal=report.scenarios[0];expect(normal.done).toBe(true);expect(normal.calls.find(c=>c.task==='personal_chat')!.recentMessages).toBeGreaterThan(40);expect(normal.calls.every(c=>c.uniqueMessageBodies)).toBe(true);expect(normal.calls.find(c=>c.task==='narrative')!.unreadExposed).toBe(false);
 expect(report.scenarios[1].calls.find(c=>c.task==='narrative_shared')!.allowSimulatedUserActions).toBe(true);expect(report.scenarios[1].done).toBe(true);expect(report.scenarios[2].calls.some(c=>c.task==='personal_life')).toBe(true);expect(report.scenarios[3].calls.map(c=>c.task)).not.toContain('memory');
});
