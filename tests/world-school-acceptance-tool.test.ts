import {it,expect} from 'vitest';
import {acceptancePaths,withRequestTimeout,isolatedResumePath} from '../scripts/world-school-acceptance-safety';
import type {CompletionRequest} from '../src/model/client';
it('acceptance_database_is_fixed_isolated_and_rejects_escape',()=>{
 const p=acceptancePaths('D:/HDSI-remake','case-1');
 expect(p.database).toMatch(/world-school-acceptance[\\/]case-1[\\/]story.sqlite$/);
 expect(()=>acceptancePaths('D:/HDSI-remake','../hdsi-remake')).toThrow();
 expect(()=>acceptancePaths('D:/HDSI-remake','')).toThrow();
 expect(isolatedResumePath('D:/HDSI-remake',p.database)).toBe(p.database);
 expect(()=>isolatedResumePath('D:/HDSI-remake','D:/HDSI-remake/runtime/data/hdsi-remake.sqlite')).toThrow();
 expect(()=>isolatedResumePath('D:/HDSI-remake','D:/HDSI-remake/runtime/data/world-school-acceptance/../../../story.sqlite')).toThrow();
});
it('tool_timeout_aborts_underlying_request_without_late_completion',async()=>{
 let aborted=false,completed=false;
 const transport=withRequestTimeout({complete:(_r,o)=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{completed=true;resolve({});},100);
  o!.signal!.addEventListener('abort',()=>{aborted=true;clearTimeout(timer);reject(o!.signal!.reason);},{once:true});
 })},10);
 await expect(transport.complete({} as CompletionRequest)).rejects.toThrow();
 expect(aborted).toBe(true);expect(completed).toBe(false);
});
