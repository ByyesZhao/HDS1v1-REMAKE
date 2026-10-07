import {afterEach,expect,it,vi} from 'vitest';
import {setImmediate as yieldImmediate} from 'node:timers/promises';
import {setup,NOW} from './helpers';
import {HdsiApp} from '../src/app';
import {SerialHost} from '../src/host/runtime';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {ModelClient} from '../src/model/client';
const dispose:Array<()=>Promise<void>>=[];afterEach(async()=>{for(const f of dispose.splice(0))await f();});
async function fixture(){const d=setup(),store=new MemoryStore(d.storage);store.migrate(NOW);store.saveOwner(store.makeOwner({ownerType:'short',ownerId:'short'},{content:'详细',sourceIds:['s'],shortExpiresAt:NOW,linkedLongId:'a'},NOW));const row=store.makeOwner({ownerType:'long',ownerId:'a'},{content:'原记忆',sourceIds:['s'],retainedFrom:NOW,expiresAt:NOW},NOW);store.saveOwner(row);let finish!:(r:any)=>void;const pending=new Promise<any>(r=>finish=r);let signal:AbortSignal|undefined;
 const provider={signature:'fixture',search:vi.fn(async()=>[{url:'https://example.test',title:''}]),read:vi.fn(async(_u:string,s?:AbortSignal)=>{signal=s;return pending;})},web=new WebSearchService(new WebSearchStore(d.storage),provider,d.clock,{enabled:true});let backendCalls=0;
 const models=new ModelClient({complete:async r=>r.task.name==='memory_consolidation'?++backendCalls===1?{webSearch:{query:'后台私有查询'}}:{units:[{unitKey:'u',action:'refine',readOwners:['short','a'],ids:['short','a'],content:'精炼',sourceIds:['s']}]}:d.models.outputs[r.task.name]});
 let host:SerialHost;const maintenance=new MemoryMaintenance(store,new MemoryLifecycle(store),new MemoryIndex(store,{model:'test',embed:async()=>[1,0]},{clock:d.clock}),models,{clock:d.clock,web,onReady:()=>void host.wake()});host=new SerialHost(new HdsiApp({...d,models,web,maintenance}),{timers:false});dispose.push(async()=>{finish({title:'late',body:'晚到正文'});await host.stop();d.storage.close();});d.storage.set('runtime',{...d.storage.runtime(),nextMaintenanceAt:NOW});await host.start();await vi.waitFor(()=>expect(provider.read).toHaveBeenCalledTimes(1));return {d,store,maintenance,host,web,finish,getSignal:()=>signal};}
it('real input completes a 15-second batch while backend is awaiting web; pause preserves ready, status exposes counters only',async()=>{
 const f=await fixture();f.d.models.outputs.personal_chat={emotions:[],reply:{decision:'now',intention:'回应',draft:'收到'},taskChanges:[]};f.d.models.outputs.expression={parts:[{kind:'text',content:'收到'}]};await f.host.acceptInput({id:'i',content:'真实私聊',receivedAt:NOW,platformMessageIds:[]});expect(f.d.storage.read('messages','i')).not.toBeNull();f.d.clock.advance(15000);await f.host.wake();expect(f.d.sender.sent).toHaveLength(1);expect(f.maintenance.inFlight).toBe(true);expect(f.d.storage.unfinishedTurn()).toBeNull();
 await f.host.pause();f.finish({title:'public',body:'公开正文'});await vi.waitFor(()=>expect(f.maintenance.status().ready).toBe(1));expect(f.store.owner({ownerType:'long',ownerId:'a'})!.content).toBe('原记忆');const status=await f.host.status();expect(status).toContain('网页');expect(status).not.toContain('后台私有查询');expect(status).not.toContain('公开正文');expect(status).not.toContain('真实私聊');await f.host.resume();expect(f.store.owner({ownerType:'long',ownerId:'a'})!.content).toBe('精炼');
});
it('stop aborts provider signal immediately, suppresses late persistence and finishes before database closes',async()=>{const f=await fixture();await f.host.stop();expect(f.getSignal()?.aborted).toBe(true);f.finish({title:'late',body:'晚到正文'});await yieldImmediate();expect(f.maintenance.status().ready).toBe(0);const s=f.web.store.storage.prepare('SELECT id FROM web_sessions').all();expect(f.web.store.snapshot(String(s[0].id)).counters.successReads).toBe(0);});
