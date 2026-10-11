import {it,expect} from 'vitest';
import {fixture,long,at} from './memory-capacity-fixture';
import {WebSearchStore} from '../src/web/store';
it('bounded old compaction visits each residual once and keeps recovery bodies',()=>{
 const d=fixture(),web=new WebSearchStore(d.storage);d.storage.save('turns','done',{id:'done',done:true} as any);d.storage.save('turns','pending',{id:'pending',done:false} as any);
 const put=(table:string,id:string,value:any)=>d.storage.prepare('INSERT INTO '+table+'(id,data) VALUES(?,?)').run(id,JSON.stringify(value));
 for(let i=0;i<3;i++){put('memory_index_jobs','i'+i,{id:'i'+i,status:'done',text:'正文',result:[1]});put('memory_maintenance_jobs','m'+i,{id:'m'+i,status:'done',snapshot:[{content:'正文'}],readSet:[],result:[],selectedIds:['keep']});}
 d.storage.save('post_jobs','done',{turnId:'done',result:{body:'正文'} as any});d.storage.save('post_jobs','pending',{turnId:'pending',result:{body:'恢复'} as any});
 const done=web.openStage('turn','done','memory','memory'),pending=web.openStage('turn','pending','memory','memory');const cp={formatVersion:2 as const,input:{body:'恢复'},repairCount:1,lookupUsed:false,pendingOperationId:null,toolResults:[]};web.saveCheckpoint(done.runId,cp);web.saveCheckpoint(pending.runId,cp);
 let total=0;for(let n=0;n<10;n++){const report=d.storage.transaction(()=>d.store.compactCompletedPayloads(3));expect(report.totalUpdated).toBeLessThanOrEqual(3);total+=report.totalUpdated;if(!report.hasMore)break;}
 expect(total).toBe(8);expect(d.store.compactCompletedPayloads(3)).toMatchObject({totalUpdated:0,hasMore:false});expect(d.storage.read('post_jobs','pending')!.result).toEqual({body:'恢复'});expect(web.snapshot(pending.runId).checkpoint).toEqual(cp);expect(web.snapshot(done.runId).counters).toEqual({successReads:0,failures:0});
});
it('owner checkpoint compaction is idempotent; prune last started retry immediately compacts terminal owner',()=>{
 const d=fixture(),web=new WebSearchStore(d.storage),a=long(d.store,'a');d.store.saveJob('memory_maintenance_jobs',{id:'job',kind:'consolidation',startedAt:at,createdAt:at,cutoff:at,status:'pending',snapshot:[a],readSet:[a],selectedIds:['a'],result:null,appliedUnitKeys:[],staleUnitKeys:[],retryAt:at,lastError:null});
 const ref=web.openStage('maintenance','job','prepare','memory_consolidation');web.saveCheckpoint(ref.runId,{formatVersion:2,input:{body:'正文'},repairCount:1,lookupUsed:false,pendingOperationId:null,toolResults:[]});
 d.store.purgeOwner(a,at);expect(d.store.job<any>('memory_maintenance_jobs','job').status).toBe('done');expect(web.snapshot(ref.runId).checkpoint).toBeNull();
 d.storage.prepare('CREATE TABLE updates(n INTEGER)').run();d.storage.prepare('CREATE TRIGGER count_web AFTER UPDATE ON web_sessions BEGIN INSERT INTO updates VALUES(1); END').run();web.compactOwnerCheckpoint('maintenance','job');expect(d.storage.prepare('SELECT count(*) n FROM updates').get()!.n).toBe(0);
});
it('pruning reads only referencing unfinished maintenance jobs',()=>{
 const d=fixture(),a=long(d.store,'a'),b=long(d.store,'b');for(let i=0;i<1000;i++)d.store.saveJob('memory_maintenance_jobs',{id:'done'+i,status:'done',createdAt:at,snapshot:[],readSet:[],result:null});
 for(const [id,row,status] of [['target',a,'pending'],['other',b,'computing']] as const)d.store.saveJob('memory_maintenance_jobs',{id,createdAt:at,cutoff:at,status,snapshot:[row],readSet:[row],selectedIds:[row.id],result:null,appliedUnitKeys:[],staleUnitKeys:[]});
 expect(d.store.activeMaintenanceJobsReferencing(a).map(j=>j.id)).toEqual(['target']);d.store.purgeOwner(a,at);expect(d.store.job<any>('memory_maintenance_jobs','other').snapshot).toEqual([b]);
});
