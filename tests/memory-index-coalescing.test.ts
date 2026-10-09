import {it,expect} from 'vitest';
import {fixture,long,at} from './memory-capacity-fixture';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {MemoryIndex} from '../src/memory/index';
import {MemoryMaintenance} from '../src/memory/maintenance';
const min=(n:number)=>new Date(Date.parse(at)+n*60000).toISOString();
const flush=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
function setup(){const d=fixture(),calls:string[]=[];const index=new MemoryIndex(d.store,{model:'offline',embed:async text=>{calls.push(text);return [1,0];}},{clock:d.clock});const maintenance=new MemoryMaintenance(d.store,new MemoryLifecycle(d.store),index,d.models,{clock:d.clock});return {...d,index,maintenance,calls};}
it('coalesces r1-r3, preserves unserved priority, state-only change uses one embedding',async()=>{
 const d=setup(),a=long(d.store,'a');d.store.queueIndex(a,at,d.index.configSignature);
 const b=long(d.store,'b');d.store.queueIndex(b,min(1),d.index.configSignature);
 for(const revision of [2,3]){const row={...a,content:'a'+revision,revision,stateVersion:revision};d.store.saveOwner(row);d.store.queueIndex(row,min(revision),d.index.configSignature);}
 expect(d.store.jobs<any>('memory_index_jobs',['pending'])).toHaveLength(2);
 const row=d.store.owner(a)!;d.store.saveOwner({...row,stateVersion:4});d.maintenance.startOne(min(4));await flush();expect(d.calls).toHaveLength(1);expect(d.calls[0]).toContain('a3');expect(d.maintenance.applyOneReady(min(4))).toBe('applied');
 const newer={...row,revision:4,content:'a4'};d.store.saveOwner(newer);d.store.queueIndex(newer,min(5),d.index.configSignature);d.maintenance.startOne(min(5));await flush();expect(d.calls[1]).toContain('经历-b');await d.maintenance.stop();
});
it('started and unknown legacy pending retain original text and queue slot',async()=>{
 const d=setup(),a=long(d.store,'a');d.store.queueIndex(a,at,d.index.configSignature);
 const job=d.store.jobs<any>('memory_index_jobs')[0];delete job.startedAt;d.store.saveJob('memory_index_jobs',job);
 const newer={...a,revision:2,content:'new'};d.store.saveOwner(newer);d.store.queueIndex(newer,min(1),d.index.configSignature);
 expect(d.store.jobs<any>('memory_index_jobs',['pending'])).toHaveLength(2);d.maintenance.startOne(min(2));await flush();expect(d.calls[0]).toContain('经历-a');expect(d.maintenance.applyOneReady(min(2))).toBe('stale');await d.maintenance.stop();
});
it('preflight cleans only twenty stale jobs and provides immediate continuation',async()=>{
 const d=setup();
 for(let i=0;i<25;i++){const row=long(d.store,'x'+i);d.store.queueIndex(row,at,d.index.configSignature);d.store.saveOwner({...row,status:'discarded'});}
 expect(d.maintenance.startOne(at)).toBe(false);expect(d.calls).toHaveLength(0);expect(d.store.jobs<any>('memory_index_jobs',['pending'])).toHaveLength(5);expect(d.maintenance.nextDeadline(at)).toBe(at);
 expect(d.maintenance.startOne(at)).toBe(false);expect(d.store.jobs<any>('memory_index_jobs',['pending'])).toHaveLength(0);expect(d.maintenance.status().backendRequests).toBe(0);await d.maintenance.stop();
});
