import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Storage} from '../src/storage';
import {MemoryStore,memoryIndexText} from '../src/memory/store';
import {MemoryIndex} from '../src/memory/index';
import {MemoryRetrieval,makeRetrievalRequest,defaultCalibration,semanticPreflight,type RetrievalCalibration} from '../src/memory/retrieval';
import {memoryOwnerData,type MemoryCandidate,type IndexJob} from '../src/memory/types';
import {assembleMemory} from '../src/deployment/memory-runtime';
import {loadSettings} from '../src/settings';
import {NOW,setup} from './helpers';

const stores:Storage[]=[],dirs:string[]=[];
afterEach(()=>{vi.restoreAllMocks();stores.splice(0).forEach(s=>s.close());dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true}));});
const request=(query='手机')=>makeRetrievalRequest(query,NOW,'personal_chat');
function fixture(count=1000){
  const storage=new Storage(':memory:');stores.push(storage);const store=new MemoryStore(storage);store.migrate(NOW);
  const embed=vi.fn(async()=>[1,...Array(1023).fill(0)]);
  const index=new MemoryIndex(store,{model:'fixture',baseUrl:'https://embedding.invalid',dimensions:1024,embed},{clock:{now:()=>NOW}});
  storage.transaction(()=>{for(let i=0;i<count;i++){
    const row=store.makeOwner({ownerType:'long',ownerId:`long-${String(i).padStart(4,'0')}`},{content:`手机经历 ${i} 完整尾部`,topics:['手机'],retainedFrom:NOW,expiresAt:'2027-01-01T00:00:00.000Z'},NOW);
    store.saveOwner(row);store.saveVector(row,index.configSignature,Float32Array.from([1,...Array(1023).fill(0)]));
  }});
  return {storage,store,index,embed};
}
function observeVectors(storage:Storage){
  const work={joins:0,bytes:0};const prepare=storage.prepare.bind(storage);
  vi.spyOn(storage,'prepare').mockImplementation((sql:string)=>{
    const statement=prepare(sql);
    if(!/WITH owners AS/.test(sql))return statement;
    if(/JOIN memory_index/.test(sql))work.joins++;
    return new Proxy(statement,{get(target,key){if(key==='all')return (...args:any[])=>{
      const rows=target.all(...args);for(const row of rows)if(row.vector instanceof Uint8Array)work.bytes+=row.vector.byteLength;return rows;
    };const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  });return work;
}
const calibrated=(signature:string):RetrievalCalibration=>({lexical:{fact:1,experience:1},semantic:{fact:.7,experience:.7,configSignature:signature}});

it.each(['no_index','empty_query','null_threshold','nan_threshold','out_of_range','signature_mismatch'] as const)('current build skips vector SQL for %s',async kind=>{
  const {storage,store,index,embed}=fixture();const q=request(kind==='empty_query'?' \n ': '手机');
  const calibration=kind==='null_threshold'?defaultCalibration:calibrated(index.configSignature);
  if(kind==='nan_threshold')calibration.semantic!.fact=NaN;
  if(kind==='out_of_range')calibration.semantic!.experience=1.01;
  if(kind==='signature_mismatch')calibration.semantic!.configSignature='stale';
  const activeIndex=kind==='no_index'?undefined:index;
  const expected=await new MemoryRetrieval(store,activeIndex,{},calibration).buildFrozen(q,store.selectCandidates(q),[],()=>{});
  const work=observeVectors(storage),retrieval=new MemoryRetrieval(store,activeIndex,{},calibration);
  const skipped=index.stats.semanticSkipped??0;
  expect(await retrieval.build(q,{includeRecent:false})).toEqual(expected);
  expect(work).toEqual({joins:0,bytes:0});expect(embed).not.toHaveBeenCalled();
  expect(retrieval.metrics.semanticSkipReason).toBe(kind.includes('threshold')||kind==='out_of_range'?'uncalibrated':kind);
  expect(retrieval.metrics.semanticSkipped).toBe(1);expect(index.stats.semanticSkipped??0).toBe(skipped+(activeIndex?1:0));
});

it('capability is pure, query independent and preserves preflight priority and configuration digest shape',()=>{
  const {store,index}=fixture(0);const absent=new MemoryRetrieval(store);
  expect(absent.semanticCapability()).toEqual({reason:'no_index',indexSignature:null,dimensions:null});
  expect(semanticPreflight('',absent.semanticCapability())).toBe('no_index');
  const uncalibrated=new MemoryRetrieval(store,index),cap=uncalibrated.semanticCapability();
  expect(cap).toEqual({reason:'uncalibrated',indexSignature:index.configSignature,dimensions:1024});
  expect(semanticPreflight('  ',cap)).toBe('empty_query');expect(semanticPreflight('手机',cap)).toBe('uncalibrated');
  const mismatch=new MemoryRetrieval(store,index,{},calibrated('stale'));
  expect(semanticPreflight('',mismatch.semanticCapability())).toBe('empty_query');
  expect(semanticPreflight('手机',mismatch.semanticCapability())).toBe('signature_mismatch');
  expect(new MemoryRetrieval(store,index,{},calibrated(index.configSignature)).semanticCapability().reason).toBeNull();
  expect(uncalibrated.metrics.semanticSkipped).toBe(0);expect(index.stats.semanticSkipped).toBeUndefined();
  expect(Object.keys(uncalibrated.configuration()).sort()).toEqual(['calibration','indexSignature','limits']);
});

it('selectCandidates defaults to vectors and false preserves visibility and permissions',()=>{
  const {store,index}=fixture(1);const base=store.owner({ownerType:'long',ownerId:'long-0000'})!;
  for(const [id,change] of Object.entries({expired:{expiresAt:'2026-01-01T00:00:00.000Z'},preview:{retainedFrom:'2027-01-01T00:00:00.000Z'},merged:{status:'merged',mergedInto:base.id},durable:{status:'durable'},archived:{capacityExitedAt:NOW},stale:{revision:2}})){
    const row={...base,...change,id,ownerId:id} as MemoryCandidate;store.saveOwner(row);store.saveVector({...row,revision:id==='stale'?1:row.revision},index.configSignature,new Float32Array([1,0]));
  }
  store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'A',key:'phone',value:'A'},NOW));
  store.saveOwner(store.makeOwner({ownerType:'learned',ownerId:'understanding'},{content:'手机认识'},NOW));
  for(const query of [request(),{...request(),scope:'archive' as const,permissions:{...request().permissions,allowArchive:true}}]){
    const full=store.selectCandidates(query),plain=store.selectCandidates(query,{includeVectors:false});
    expect(full.find(r=>r.id===base.id)?.normalizedVector?.length).toBe(1024);
    expect(full.find(r=>r.id==='stale')?.normalizedVector).toBeUndefined();
    expect(plain).toEqual(full.map(memoryOwnerData));expect(plain.every(r=>r.normalizedVector===undefined)).toBe(true);
    expect(plain.some(r=>r.id==='preview'||r.id==='merged'||r.id==='durable')).toBe(false);
  }
  expect(()=>store.selectCandidates({...request(),scope:'archive'},{includeVectors:false})).toThrow('permission');
  expect(()=>store.selectCandidates({...request(),includeDetailHistory:true},{includeVectors:false})).toThrow('permission');
});

it('calibrated current build reads exactly 1000x1024 vectors and preserves RRF results',async()=>{
  const {storage,store,index,embed}=fixture();const calibration=calibrated(index.configSignature);
  const expected=await new MemoryRetrieval(store,index,{},calibration).buildFrozen(request(),store.selectCandidates(request()),[],()=>{});
  // A fresh index avoids the expected-result query cache concealing a remote request.
  const actualIndex=new MemoryIndex(store,{model:'fixture',baseUrl:'https://embedding.invalid',dimensions:1024,embed},{clock:{now:()=>NOW}});embed.mockClear();
  const work=observeVectors(storage),retrieval=new MemoryRetrieval(store,actualIndex,{},calibration);
  expect(await retrieval.build(request(),{includeRecent:false})).toEqual(expected);
  expect(work).toEqual({joins:1,bytes:4096000});expect(actualIndex.stats.queries).toBe(1);expect(embed).toHaveBeenCalledTimes(1);
  expect(retrieval.metrics.semanticSkipReason).toBeNull();expect(retrieval.metrics.semanticSkipped).toBe(0);
});

it.each(['empty','wrong_dimension','non_finite','always_include','direct_alias'] as const)('no compatible %s candidates skips remote after read',async kind=>{
  const {store,index,embed}=fixture(0);const type=kind==='always_include'?'learned':kind==='direct_alias'?'detail':'long';
  const row=store.makeOwner({ownerType:type,ownerId:'only'},{content:'手机',topics:['手机'],retainedFrom:NOW,expiresAt:'2027-01-01T00:00:00.000Z',...(kind==='always_include'?{alwaysInclude:true}:{}),...(kind==='direct_alias'?{key:'phone',value:'A',aliases:['手机']}: {})},NOW);store.saveOwner(row);
  const vector=kind==='empty'?new Float32Array():kind==='wrong_dimension'?new Float32Array([1,0]):Float32Array.from([kind==='non_finite'?NaN:1,...Array(1023).fill(0)]);
  store.saveVector(row,index.configSignature,vector);const retrieval=new MemoryRetrieval(store,index,{},calibrated(index.configSignature));
  await retrieval.build(request(),{includeRecent:false});expect(retrieval.metrics.semanticSkipReason).toBe('no_compatible_candidate');expect(embed).not.toHaveBeenCalled();
});

it('index registration does not inherit the empty query gate or omit complete owner text',async()=>{
  const d=setup();stores.push(d.storage);const store=new MemoryStore(d.storage);store.migrate(NOW);store.migrateCapacity(NOW);
  const rows=['short','long','detail','learned'].map((kind,i)=>store.makeOwner({ownerType:kind as MemoryCandidate['ownerType'],ownerId:`register-${i}`},{content:`完整正文-${i}`,topics:[`主题-${i}`],feelingSummary:`感受-${i}`,projectionBasis:{content:`投影-${i}`} as MemoryCandidate['projectionBasis'],key:`key-${i}`,value:`事实-${i}`,aliases:['别名'],retainedFrom:NOW,shortExpiresAt:'2027-01-01T00:00:00.000Z',expiresAt:'2027-01-01T00:00:00.000Z',revision:3},NOW));rows.forEach(r=>store.saveOwner(r));
  d.storage.set('memory_index_rebuild_required',true);const dir=mkdtempSync(join(tmpdir(),'hdsi-vector-gate-'));dirs.push(dir);
  const file=join(dir,'settings.json');writeFileSync(file,readFileSync('examples/story.sample.json'));const settings=loadSettings(file,{}),fetcher=vi.spyOn(globalThis,'fetch'),work=observeVectors(d.storage);
  const memory=assembleMemory(d.storage,settings,d.models,d.clock,()=>{},{QWEN_API_KEY:'fixture'},store);
  try{
    const jobs=store.jobs<IndexJob>('memory_index_jobs',['pending']);expect(jobs).toHaveLength(rows.length);
    for(const row of rows)expect(jobs.find(j=>j.owner.ownerId===row.id)).toMatchObject({owner:{ownerId:row.id,revision:3},text:memoryIndexText(row),configSignature:memory.index.configSignature});
    expect(work).toEqual({joins:0,bytes:0});expect(fetcher).not.toHaveBeenCalled();expect(d.storage.get('memory_index_rebuild_required')).toBe(false);
  }finally{await memory.maintenance.stop();}
});
