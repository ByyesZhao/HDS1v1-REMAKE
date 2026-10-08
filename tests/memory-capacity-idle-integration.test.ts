import {afterEach,expect,it} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {runMemoryCapacityAcceptance} from '../scripts/memory-capacity-acceptance';
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
it('mixed_capacity_idle_and_recovery',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-memory-acceptance-'));dirs.push(dir);
 const report=await runMemoryCapacityAcceptance(join(dir,'isolated.sqlite'));
 expect(report.storyTurns).toBe(3);expect(report.sharedEnded).toBe(true);expect(report.idleBlockedBefore15).toBe(true);expect(report.deepCalls).toBeGreaterThan(0);
 expect(report.counts).toMatchObject({shortActive:100,longOccupied:1000,longArchive:500});expect(report.reopenedCounts).toEqual(report.counts);expect(report.rawSourcePreserved).toBe(true);
},30000);
it('pruned_snapshots_all_surfaces and old_library_batch_cleanup_front_priority',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-memory-acceptance-'));dirs.push(dir);
 const report=await runMemoryCapacityAcceptance(join(dir,'isolated.sqlite'));
 expect(report.leakedPayloads).toEqual([]);expect(report.frontBeforeSecondCleanup).toBe(true);expect(report.protectedArchiveSurvived).toBe(true);expect(report.archiveRemovedAfterUnreference).toBe(true);
},30000);
