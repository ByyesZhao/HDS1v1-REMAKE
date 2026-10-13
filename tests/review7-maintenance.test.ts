import {afterEach,expect,it,vi} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {consolidationTask} from '../src/model/contracts';
import {ModelRunHistory} from '../src/model/run-history';
import {SerialHost} from '../src/host/runtime';
import {HdsiApp} from '../src/app';
import {NOW,setup} from './helpers';
import {addMs} from '../src/time';
const opened:Storage[]=[],hosts:SerialHost[]=[];
afterEach(async()=>{for(const host of hosts.splice(0))await host.stop();vi.restoreAllMocks();vi.useRealTimers();opened.splice(0).forEach(s=>s.close());});
function create(storage=new Storage(':memory:'),clock={now:()=>NOW}){opened.push(storage);const store=new MemoryStore(storage);store.migrate(NOW);const index=new MemoryIndex(store,{model:'offline',embed:async()=>[1,0]},{clock});const maintenance=new MemoryMaintenance(store,new MemoryLifecycle(store),index,{} as any,{clock});return {storage,store,index,maintenance};}
function ready(d:ReturnType<typeof create>,id='a'){
 const row=d.store.makeOwner({ownerType:'long',ownerId:id},{content:'旧手机记录',sourceIds:['e'],retainedFrom:NOW,expiresAt:addMs(NOW,90*86400000)},NOW);d.store.saveOwner(row);
 const unit=consolidationTask([row],[id]).parse({units:[{unitKey:'u',action:'refine',readOwners:[id],ids:[id],content:'新手机记录',sourceIds:['e']}]})[0];
 d.store.saveJob('memory_maintenance_jobs',{id,cutoff:NOW,createdAt:NOW,status:'ready',snapshot:[row],selectedIds:[id],readSet:[row],result:[unit],appliedUnitKeys:[],staleUnitKeys:[],retryAt:null,lastError:null});return row;
}
it('rolls back a partially written unit, preserves it for delayed application and allows another ready job meanwhile',async()=>{
 const d=create(),a=ready(d),b=ready(d,'b'),save=d.store.saveOwner.bind(d.store);let fail=true;vi.spyOn(d.store,'saveOwner').mockImplementation(row=>{save(row);if(row.id==='a'&&fail)throw Error('synthetic apply failure');});
 expect(d.maintenance.applyOneReady(NOW)).toBe('none');expect(d.store.owner(a)!.content).toBe('旧手机记录');const job=d.store.job<any>('memory_maintenance_jobs','a');expect(job.status).toBe('ready');expect(job.appliedUnitKeys).toEqual([]);expect(job.staleUnitKeys).toEqual([]);expect(job.retryAt).toBe(addMs(NOW,300000));expect(job.lastError).toBe('记忆整合执行失败，等待重试');
 expect(d.maintenance.applyOneReady(NOW)).toBe('applied');expect(d.store.owner(b)!.content).toBe('新手机记录');expect(d.maintenance.startOne(NOW)).toBe(true);await new Promise<void>(resolve=>setImmediate(resolve));expect(d.maintenance.applyOneReady(NOW)).toBe('applied');expect(d.maintenance.nextDeadline(NOW)).toBe(addMs(NOW,300000));fail=false;expect(d.maintenance.applyOneReady(addMs(NOW,299999))).toBe('none');expect(d.maintenance.applyOneReady(addMs(NOW,300000))).toBe('applied');expect(d.store.owner(a)!.content).toBe('新手机记录');expect(d.store.job<any>('memory_maintenance_jobs','a').lastError).toBeNull();
 const failures=new ModelRunHistory(d.storage,{now:()=>NOW}).list({ownerType:'maintenance',ownerId:'a'}).filter(record=>record.type==='failure'&&record.stage==='maintenance');expect(failures).toEqual([expect.objectContaining({category:'apply',error:expect.stringContaining('synthetic apply failure')})]);
});
it('an index-application failure rolls back its vector and waits rather than recomputing the prepared embedding',()=>{
 const d=create(),row=d.store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'手机型号',key:'phone',value:'A'},NOW);d.store.saveOwner(row);d.store.queueIndex(row,NOW,d.index.configSignature);const job=d.store.jobs<any>('memory_index_jobs')[0];d.store.saveJob('memory_index_jobs',{...job,status:'ready',result:[1,0]});const save=d.store.saveJob.bind(d.store);let fail=true;vi.spyOn(d.store,'saveJob').mockImplementation((table,value:any)=>{if(fail&&value.status==='done')throw Error('synthetic done failure');save(table,value);});
 expect(d.maintenance.applyOneReady(NOW)).toBe('none');expect(d.storage.prepare('SELECT count(*) AS n FROM memory_index').get()!.n).toBe(0);expect(d.maintenance.nextDeadline(NOW)).toBe(addMs(NOW,300000));expect(d.maintenance.startOne(NOW)).toBe(false);fail=false;expect(d.maintenance.applyOneReady(addMs(NOW,300000))).toBe('applied');expect(d.storage.prepare('SELECT count(*) AS n FROM memory_index').get()!.n).toBe(1);
});
it('failed application does not arm an immediate loop and a real input story finishes during its retry wait',async()=>{
 vi.useFakeTimers();const dependencies=setup(),d=create(dependencies.storage,dependencies.clock);ready(d);const save=d.store.saveOwner.bind(d.store);vi.spyOn(d.store,'saveOwner').mockImplementation(row=>{save(row);if(row.id==='a')throw Error('synthetic apply failure');});const host=new SerialHost(new HdsiApp({...dependencies,maintenance:d.maintenance}),{timers:true});hosts.push(host);await host.start();const wake=vi.spyOn(host,'wake');dependencies.clock.advance(1000);await vi.advanceTimersByTimeAsync(1000);expect(wake).not.toHaveBeenCalled();
 dependencies.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回应',draft:'收到'},taskChanges:[]};dependencies.models.outputs.expression={parts:[{kind:'text',content:'收到'}]};await host.acceptInput({id:'input',content:'你好',receivedAt:dependencies.clock.now(),platformMessageIds:[]});dependencies.clock.advance(15000);await host.wake();expect(dependencies.sender.sent[0].payload).toBe('收到');expect(dependencies.storage.unfinishedTurn()).toBeNull();expect(dependencies.storage.runtime().paused).toBe(false);expect(d.store.owner({ownerType:'long',ownerId:'a'})!.content).toBe('旧手机记录');
});
