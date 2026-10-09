import {defaultMemoryCapacity} from '../src/memory/types';
import {it,expect} from 'vitest';
import {fixture,long,at} from './memory-capacity-fixture';
import {MemoryCapacity} from '../src/memory/capacity';
import {MemoryCleanup} from '../src/memory/cleanup';
import {WebSearchStore} from '../src/web/store';
const {captureQueries,plans}=require('../scripts/query-probe.cjs');
it.each([0,1000,5000])('cleanup K=10 never rewrites H=%s already compacted terminal rows',H=>{
 const d=fixture();new WebSearchStore(d.storage);d.storage.prepare('CREATE TABLE audit(tableName TEXT)').run();
 for(const table of ['memory_index_jobs','memory_maintenance_jobs','post_jobs','web_sessions'])d.storage.prepare('CREATE TRIGGER audit_'+table+' AFTER UPDATE ON '+table+' BEGIN INSERT INTO audit VALUES('+"'"+table+"'"+'); END').run();
 d.storage.transaction(()=>{for(let i=0;i<H;i++){d.store.saveJob('memory_index_jobs',{id:'i'+i,status:'done',text:'',createdAt:at});d.store.saveJob('memory_maintenance_jobs',{id:'m'+i,status:'done',snapshot:[],readSet:[],result:null,createdAt:at});d.storage.save('turns','t'+i,{id:'t'+i,done:true} as any);d.storage.save('post_jobs','t'+i,{turnId:'t'+i,result:null});d.storage.prepare('INSERT INTO web_sessions(id,data) VALUES(?,?)').run('w'+i,JSON.stringify({ref:{ownerType:'turn',ownerId:'t'+i},checkpoint:null}));}for(let i=0;i<10;i++)long(d.store,'delete'+i,{status:'discarded'});});
 const cleanup=new MemoryCleanup(d.store,new MemoryCapacity(d.store,defaultMemoryCapacity));for(let i=0;i<10;i++)expect(cleanup.applyOne(at)).toBe('applied');expect(d.storage.prepare('SELECT count(*) n FROM audit').get()!.n).toBe(0);expect(d.store.allOwners()).toEqual([]);
});
it.each([0,1000,5000])('prune only decodes matching active payloads at H=%s',H=>{
 const d=fixture(),a=long(d.store,'a'),b=long(d.store,'b');for(let i=0;i<H;i++)d.store.saveJob('memory_maintenance_jobs',{id:'done'+i,status:'done',createdAt:at});
 for(const [id,row] of [['target',a],['other',b]] as const)d.store.saveJob('memory_maintenance_jobs',{id,status:'pending',createdAt:at,snapshot:[row],readSet:[row]});
 const got=captureQueries(d.storage,()=>d.store.activeMaintenanceJobsReferencing(a));expect(got.value.map((r:any)=>r.id)).toEqual(['target']);expect(got.queries[0].jsonRows).toBe(1);expect(JSON.stringify(plans(d.storage,got.queries))).toContain('memory_maintenance_jobs_due');
});
