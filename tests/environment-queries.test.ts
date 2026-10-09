import {it,expect} from 'vitest';
import {setup,NOW} from './helpers';
import {ensureEnvironmentBatch,environmentDeadline,selectEnvironmentStepMetadata,selectEnvironmentStep} from '../src/environment/scheduler';
import {EnvironmentStore} from '../src/environment/store';
const {captureQueries,plans}=require('../scripts/query-probe.cjs');
it('metadata selection keeps frozen payloads and stage retry/ready barriers',()=>{
 const d=setup();try{d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const batch=ensureEnvironmentBatch(d.storage,d.config,NOW)!;const store=d.environmentStore,steps=store.steps(batch.id);
 for(const step of steps)store.saveStep({...step,inputSnapshot:{huge:'x'.repeat(10000)} as any,frozenResult:{huge:'y'.repeat(10000)} as any});
 store.saveStep({...store.step(steps[0].id)!,status:'committed'});store.saveStep({...store.step(steps[1].id)!,status:'ready'});
 const result=captureQueries(d.storage,()=>selectEnvironmentStepMetadata(d.storage,NOW));expect(result.value!.stage).toBe('school_campus');expect(Object.keys(result.value!).sort()).toEqual(['batchId','id','retryAt','stage','status']);expect(result.queries.filter((q:any)=>q.sql.includes('FROM environment_steps')).reduce((n:number,q:any)=>n+q.jsonRows,0)).toBe(0);
 const full=captureQueries(d.storage,()=>selectEnvironmentStep(d.storage,NOW));expect(full.value).toEqual(store.step(steps[1].id));expect(full.queries.filter((q:any)=>q.sql==='SELECT data FROM environment_steps WHERE id = ?')).toHaveLength(1);
 const retry='2026-10-07T02:05:00.000Z';store.saveStep({...store.step(steps[1].id)!,status:'pending',retryAt:retry});expect(selectEnvironmentStepMetadata(d.storage,NOW)).toBeNull();expect(environmentDeadline(d.storage,NOW)).toBe(retry);expect(selectEnvironmentStepMetadata(d.storage,retry)!.stage).toBe('school_campus');
 store.saveStep({...store.step(steps[1].id)!,status:'superseded'});expect(selectEnvironmentStepMetadata(d.storage,retry)).toBeNull();
 const p=JSON.stringify(plans(d.storage,result.queries));expect(p).toContain('environment_batch_status');expect(p).toContain('environment_step_batch');
 }finally{d.storage.close();}
});
it('latest batch means last inserted, active/step reads preserve row order',()=>{
 const d=setup();try{const s=new EnvironmentStore(d.storage),base={localDate:'2026-10-07',scheduledAt:NOW,createdAt:NOW,reason:'daily' as const,status:'active' as const,closedAt:null};s.saveBatch({id:'A',timezone:'UTC',...base});s.saveBatch({id:'B',timezone:'Asia/Shanghai',...base});s.saveBatch({...s.batch('A')!,closedAt:NOW});expect(s.latestBatch()!.id).toBe('B');expect(s.firstActiveBatch()!.id).toBe('A');
 d.storage.set('runtime',{...d.storage.runtime(),nextEnvironmentAt:null});const b=ensureEnvironmentBatch(d.storage,d.config,NOW)!;expect(s.steps(b.id)).toEqual(d.storage.all('environment_steps').filter(step=>step.batchId===b.id));
 }finally{d.storage.close();}
});
