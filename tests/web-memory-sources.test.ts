import {afterEach,expect,it,vi} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {memoryTask,consolidationTask} from '../src/model/contracts';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {ModelClient} from '../src/model/client';
import {modelTask} from '../src/model/contracts';
import {z} from 'zod';
import {TestClock,NOW,emptyMemory,setup} from './helpers';
import {organizeMemory} from '../src/memory/organize';
import type {TurnRecord} from '../src/types';
import {addMs} from '../src/time';
const dbs:Storage[]=[];afterEach(()=>dbs.splice(0).forEach(d=>d.close()));
it('organize_loads_source_materials_once_per_run',async()=>{
 const d=setup();dbs.push(d.storage);const store=new WebSearchStore(d.storage),web=new WebSearchService(store,{signature:'offline',search:async()=>[],read:async(url)=>({bodyFormat:'text' as const,title:url,body:'body '+url})},d.clock,{enabled:true});
 const session=web.openSession(store.openStage('turn','t','personal','personal_life'));for(const name of ['a','b','unprovided']){const url=`https://example.test/${name}`,op=session.beginOperation({kind:'read',url});await session.readPage(url,{operationId:op.operationId});}
 const rows=session.snapshot().materials;session.markProvided(rows.slice(0,2).map(m=>m.id));const sources=web.selfReadSources('t'),snapshot=vi.spyOn(store,'snapshot'),materials=vi.spyOn(store,'materials');
 const turn={id:'t',at:NOW,frozenResult:{experiences:[],visibleMessageIds:[],reconsiderMessageIds:[],nextState:d.storage.character(),taskChanges:[],personal:null}} as unknown as TurnRecord;
 await organizeMemory({...d,web},turn);const input=d.models.calls.find(c=>c.name==='memory')!.input;
 expect(snapshot).not.toHaveBeenCalled();expect(materials).toHaveBeenCalledTimes(1);expect(materials).toHaveBeenCalledWith(session.id,rows.slice(0,2).map(m=>m.id));expect(input.roles.selfReadSources).toEqual(sources);expect(input.resources.materials.map((m:any)=>({id:m.id,body:m.body}))).toEqual(rows.slice(0,2).map(m=>({id:m.id,body:m.body})));expect(input.roles.currentSourceIds).toEqual(sources.map(s=>s.id));
});
it('only actual life reading can independently support short memory; details and awaken still require ordinary current sources',async()=>{
 const db=new Storage(':memory:');dbs.push(db);const ws=new WebSearchStore(db),web=new WebSearchService(ws,{signature:'fixture',search:async()=>[{url:'https://example.test',title:'snippet'}],read:async()=>({bodyFormat:'text' as const,title:'正文',body:'查阅资料：雨后清新'})},new TestClock(),{enabled:true});
 for(const name of ['narrative','personal_life','memory'] as const){const s=web.openSession(ws.openStage('turn','t',name,name));let n=0;await new ModelClient({complete:async()=>++n===1?{webSearch:{query:'q'}}:{answer:'ok'}}).runModel(modelTask(name,z.object({answer:z.string()})),{}, {web:s,lookup:null});}
 const [source]=web.selfReadSources('t');expect(web.selfReadSources('t')).toHaveLength(1);expect(web.selfReadSources('other')).toEqual([]);const short={action:'create' as const,clientRef:'r',content:'查阅了解到雨后清新，心情舒畅',eventSummary:'查阅了雨后资料',feelingSummary:'舒畅',topics:['雨后'],sourceIds:[source.id],importance:'normal' as const};const result={...emptyMemory,schemaVersion:3 as const,shortTermChanges:[short]};expect(memoryTask([],[],[],[source.id]).parse(result)).toEqual(result);
 expect(()=>memoryTask([],[],[],[]).parse(result)).toThrow('source');expect(()=>memoryTask([],[],[],[source.id]).parse({...emptyMemory,detailChanges:[{action:'create',key:'phone',value:'网页中手机',aliases:[],reason:'资料',sourceIds:[source.id]}]})).toThrow('source');expect(()=>memoryTask([],['long'],[],[source.id]).parse({...emptyMemory,longTermChanges:[{action:'awaken',id:'long',reason:'网页提及',sourceIds:[source.id]}]})).toThrow('source');
 const ms=new MemoryStore(db);ms.migrate(NOW);const lifecycle=new MemoryLifecycle(ms);lifecycle.apply(result,'t',NOW,[],[source.id]);const archived=ms.owner({ownerType:'long',ownerId:'t:short:0:long'})!;expect(archived.content).toContain('查阅');const deadline=archived.expiresAt;
 lifecycle.apply(result,'t',addMs(NOW,1000),[],[source.id]);expect(ms.owner(archived)!.expiresAt).toBe(deadline);expect(ms.maintenanceCandidates(addMs(NOW,7*86400000)).map(r=>r.id)).toContain('t:short:0');const shortRow=ms.owner({ownerType:'short',ownerId:'t:short:0'})!;
 const unit=consolidationTask([shortRow,archived],[shortRow.id]).parse({units:[{unitKey:'read',action:'refine',readOwners:[shortRow.id,archived.id],ids:[shortRow.id,archived.id],content:'查阅雨后资料，感到舒畅',eventSummary:'查阅雨后资料',sourceIds:[source.id]}]})[0];expect(unit.content).toContain('查阅');
});
it('a completed model response marks provided before invalid business JSON is repaired, retaining stable source and first operation',async()=>{
 const db=new Storage(':memory:');dbs.push(db);const store=new WebSearchStore(db),web=new WebSearchService(store,{signature:'fixture',search:async()=>[],read:async()=>({bodyFormat:'text' as const,title:'正文',body:'仅正文'})},new TestClock(),{enabled:true}),s=web.openSession(store.openStage('turn','t','personal','personal_life'));let n=0;await new ModelClient({complete:async()=>++n===1?{webRead:{url:'https://example.test/a'}}:n===2?{wrong:true}:{answer:'ok'}}).runModel(modelTask('personal_life',z.object({answer:z.string()})),{}, {web:s,lookup:null});const first=web.selfReadSources('t')[0];s.markProvided(s.snapshot().materials.map(m=>m.id));expect(web.selfReadSources('t')).toEqual([first]);expect(first.operationId).toBe(s.snapshot().operations[0].operationId);expect(s.snapshot().repairCount).toBe(1);
});

