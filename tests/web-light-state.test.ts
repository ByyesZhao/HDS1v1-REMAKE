import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Storage} from '../src/storage';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import type {WebMaterial,WebModelCheckpoint} from '../src/web/types';
import {NOW,TestClock} from './helpers';

const dbs:Storage[]=[],dirs:string[]=[];
afterEach(()=>{vi.restoreAllMocks();dbs.splice(0).forEach(db=>db.close());dirs.splice(0).forEach(dir=>rmSync(dir,{recursive:true,force:true}));});
function material(id:string):WebMaterial {const marker=`BODY_ONLY_${id}_`;const tail='中文🙂 <nav> List<T> x < y\n重复段落\n重复段落';return {id,url:`https://example.test/${id}`,title:id,body:marker+'x'.repeat(100000-marker.length-tail.length)+tail,readAt:NOW,bodyCharacters:100000,selectionMode:'full_body',sourceKind:'external_reference'};}
function fixture(path=':memory:'){const db=new Storage(path);dbs.push(db);const store=new WebSearchStore(db),ref=store.openStage('turn','t','personal','personal_life');return {db,store,ref};}

it('control_reads_parse_zero_body_characters',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-web-light-'));dirs.push(dir);const path=join(dir,'web.sqlite');let d=fixture(path);
 for(let i=0;i<20;i++){const m=material(`m${i}`),op=d.store.beginOperation(d.ref.runId,{kind:'read',url:m.url});d.store.commitStep(d.ref.runId,{operationId:op.operationId,stepIndex:0,nextCandidateIndex:1,material:m});}
 const checkpoint:WebModelCheckpoint={input:{large:'CHECKPOINT_ONLY_'+'c'.repeat(100000)},repairCount:1,lookupUsed:true,pendingOperationId:null,toolResults:[{materials:[material('checkpoint')],counters:{successReads:20,failures:0},stopReason:'quota'}]};
 d.store.saveCheckpoint(d.ref.runId,checkpoint);d.db.close();dbs.splice(dbs.indexOf(d.db),1);d=fixture(path);
 const provider={signature:'offline',search:vi.fn(async()=>[]),read:vi.fn(async()=>({bodyFormat:'text' as const,title:'',body:'unused'}))},service=new WebSearchService(d.store,provider,new TestClock(),{enabled:true});
 const parse=JSON.parse;let parsedBodyCharacters=0;const parseSpy=vi.spyOn(JSON,'parse').mockImplementation((value,...args)=>{if(typeof value==='string'&&(value.includes('BODY_ONLY_')||value.includes('CHECKPOINT_ONLY_')))parsedBodyCharacters+=value.length;return parse(value,...args);});
 const snapshot=vi.spyOn(d.store,'snapshot');
 try{
  expect(d.store.state(d.ref.runId).counters).toEqual({successReads:20,failures:0});
  expect(d.store.materialMetadata(d.ref.runId)).toHaveLength(20);expect(d.store.materialMetadata(d.ref.runId,'https://example.test/m3')[0].id).toBe('m3');
  d.store.markProvided(d.ref.runId,['m0','m1']);expect(service.providedUrls(d.ref.runId)).toEqual(['https://example.test/m0','https://example.test/m1']);expect(service.selfReadSources('t')).toHaveLength(2);
  expect(d.store.openStage('turn','t','personal','renamed').runId).toBe(d.ref.runId);d.store.incrementMetric(d.ref.runId,'cacheHits');d.store.saveCheckpoint(d.ref.runId,checkpoint);
  const session=service.openSession(d.ref),op=session.beginOperation({kind:'read',url:'https://example.test/new'});expect((await session.readPage('https://example.test/new',{operationId:op.operationId})).stopReason).toBe('quota');
  const failures=d.store.openStage('turn','failures','personal','personal_life');d.db.prepare("UPDATE web_sessions SET data=json_set(data,'$.counters.failures',40) WHERE id=?").run(failures.runId);
  const failed=service.openSession(failures),failureOp=failed.beginOperation({kind:'read',url:'https://example.test/new'});expect((await failed.readPage('https://example.test/new',{operationId:failureOp.operationId})).counters).toEqual({successReads:0,failures:40});
  expect(d.store.state(d.ref.runId).metrics.cacheHits).toBe(1);expect(parsedBodyCharacters).toBe(0);expect(snapshot).not.toHaveBeenCalled();expect(provider.read).not.toHaveBeenCalled();expect(provider.search).not.toHaveBeenCalled();
 }finally{parseSpy.mockRestore();}
 expect(d.store.checkpoint(d.ref.runId)).toEqual(checkpoint);expect(d.store.materials(d.ref.runId,['m0'])[0].body).toBe(material('m0').body);
});

it('materials select only the requested run and IDs in persistent insertion order',()=>{
 const d=fixture(),a=material('a'),b=material('b');for(const m of [a,b]){const op=d.store.beginOperation(d.ref.runId,{kind:'read',url:m.url});d.store.commitStep(d.ref.runId,{operationId:op.operationId,stepIndex:0,nextCandidateIndex:1,material:m});}
 const other=d.store.openStage('turn','other','personal','personal_life'),op=d.store.beginOperation(other.runId,{kind:'read',url:a.url});d.store.commitStep(other.runId,{operationId:op.operationId,stepIndex:0,nextCandidateIndex:1,material:{...a,body:'other'}});
 expect(d.store.materials(d.ref.runId)).toEqual([a,b]);expect(d.store.materials(d.ref.runId,['b','a'])).toEqual([a,b]);expect(d.store.materials(d.ref.runId,[])).toEqual([]);expect(d.store.materials(d.ref.runId,['missing'])).toEqual([]);
 expect(d.store.materialMetadata(d.ref.runId).map(m=>({id:m.id,hasBody:'body' in m,provided:m.provided,firstOperationId:m.firstOperationId}))).toEqual([{id:'a',hasBody:false,provided:false,firstOperationId:`${d.ref.runId}:op:0`},{id:'b',hasBody:false,provided:false,firstOperationId:`${d.ref.runId}:op:1`}]);
 expect(()=>d.store.state('missing')).toThrow('unknown web session');expect(d.store.checkpoint(d.ref.runId)).toBeNull();
});

it('mark_provided_updates_only_flags_and_source_metadata',()=>{
 const d=fixture(),m=material('a'),op=d.store.beginOperation(d.ref.runId,{kind:'read',url:m.url});d.store.commitStep(d.ref.runId,{operationId:op.operationId,stepIndex:0,nextCandidateIndex:1,material:m});
 const row=()=>JSON.parse(String(d.db.prepare('SELECT data FROM web_materials WHERE id=?').get(`${d.ref.runId}:a`)!.data));const before=row();
 expect(()=>d.store.markProvided(d.ref.runId,['a','unknown'])).toThrow('unknown provided web material');expect(row()).toEqual(before);expect(d.store.selfReadSources('t')).toEqual([]);
 d.store.markProvided(d.ref.runId,['a']);d.store.markProvided(d.ref.runId,['a']);expect(row()).toEqual({...before,provided:true});expect(d.store.selfReadSources('t')).toEqual([{id:`${d.ref.runId}:self-read:a`,turnId:'t',runId:d.ref.runId,operationId:op.operationId,materialId:'a',url:m.url,readAt:NOW,sourceKind:'self_web_read',phase:'personal_life'}]);
});
