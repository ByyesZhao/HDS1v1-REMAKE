import {afterEach,expect,it,vi} from 'vitest';
import {setup,NOW} from './helpers';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryIndex} from '../src/memory/index';
import {WebSearchStore} from '../src/web/store';
import {MemoryRetrieval,defaultCalibration,type RetrievalCalibration} from '../src/memory/retrieval';
import {digest,freezeEnvironmentSnapshot,lookupFrozenEnvironment,lookupBasisCurrent,type EnvironmentPreparationSnapshot} from '../src/environment/snapshot';
import type {EnvironmentStep} from '../src/environment/types';
const stores:Storage[]=[];afterEach(()=>{vi.restoreAllMocks();stores.splice(0).forEach(s=>s.close());});
function fixture(enabled=false,count=1,query='手机'){
  const base=setup();stores.push(base.storage);base.config.worldSetting=query;new WebSearchStore(base.storage);
  const store=new MemoryStore(base.storage);store.migrate(NOW);
  const embed=vi.fn(async()=>[1,...Array(1023).fill(0)]),provider={model:'snapshot-fixture',baseUrl:'https://embedding.invalid',dimensions:1024,embed};
  const index=new MemoryIndex(store,provider,{clock:base.clock});
  base.storage.transaction(()=>{for(let i=0;i<count;i++){
    const row=store.makeOwner({ownerType:'long',ownerId:`long-${i}`},{content:`手机完整冻结正文 ${i}`,topics:['手机'],sourceIds:['source'],retainedFrom:NOW,expiresAt:'2027-01-01T00:00:00Z'},NOW);
    store.saveOwner(row);store.saveVector(row,index.configSignature,Float32Array.from([1,...Array(1023).fill(0)]));
  }});
  const calibration:RetrievalCalibration=enabled?{lexical:{fact:1,experience:1},semantic:{fact:.7,experience:.7,configSignature:index.configSignature}}:defaultCalibration;
  const retrieval=new MemoryRetrieval(store,index,{},calibration),d={...base,memoryStore:store,retrieval};
  const freeze=()=>freezeEnvironmentSnapshot(d,{id:'step',batchId:'batch',stage:'world',status:'pending',attempt:0} as EnvironmentStep,NOW);
  return {d,store,index,provider,embed,retrieval,calibration,freeze};
}
const roundtrip=(snapshot:EnvironmentPreparationSnapshot):EnvironmentPreparationSnapshot=>JSON.parse(JSON.stringify(snapshot));

it('uncalibrated environment freeze omits all 1000x1024 vectors and preserves configuration signature',()=>{
  const {store,retrieval,freeze}=fixture(false,1000);let joins=0,bytes=0;const prepare=store.storage.prepare.bind(store.storage);
  vi.spyOn(store.storage,'prepare').mockImplementation(sql=>{
    const statement=prepare(sql);if(!/WITH owners AS/.test(sql))return statement;if(/JOIN memory_index/.test(sql))joins++;
    return new Proxy(statement,{get(target,key){if(key==='all')return (...args:any[])=>{const rows=target.all(...args);for(const row of rows)if(row.vector instanceof Uint8Array)bytes+=row.vector.byteLength;return rows;};const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v;}});
  });
  const snapshot=freeze();expect({joins,bytes}).toEqual({joins:0,bytes:0});
  expect(snapshot.retrieval.candidates).toHaveLength(1000);expect(JSON.stringify(snapshot.retrieval.candidates)).not.toContain('normalizedVector');
  expect(snapshot.retrieval.semanticPolicy).toMatchObject({version:1,capability:{reason:'uncalibrated'},vectorsIncluded:false});
  expect(snapshot.retrieval.signature).toBe(digest(retrieval.configuration()));expect(snapshot.version).toBe(1);
  expect(snapshot.retrieval.candidates[0]).toMatchObject({content:'手机完整冻结正文 0',sourceIds:['source']});
});

it.each(['old_disabled','new_disabled','old_enabled','new_enabled'] as const)('%s survives JSON and uses only frozen owners and vectors',async shape=>{
  const enabled=shape.endsWith('enabled'),{store,index,embed,retrieval,freeze}=fixture(enabled);
  const snapshot=roundtrip(freeze());
  if(shape.startsWith('old')){
    delete snapshot.retrieval.semanticPolicy;
    // Old format froze vectors even when the semantic channel was disabled.
    snapshot.retrieval.candidates[0].normalizedVector=[1,...Array(1023).fill(0)];
  }
  const row=store.owner({ownerType:'long',ownerId:'long-0'})!;store.saveOwner({...row,content:'实时正文已经改变',topics:[],revision:2});store.saveVector({...row,revision:2},index.configSignature,new Float32Array(1024));
  vi.spyOn(store,'selectCandidates').mockImplementation(()=>{throw Error('live candidates must not be read');});vi.spyOn(store,'owner').mockImplementation(()=>{throw Error('live owner must not be read');});
  const from=vi.spyOn(Float32Array,'from');
  const result=await lookupFrozenEnvironment(snapshot,'手机',retrieval);
  expect(result.context.longTerm[0].content).toBe('手机完整冻结正文 0');expect(result.usedBasis.owners[0]).toMatchObject({ownerId:'long-0',revision:1});
  expect(embed).toHaveBeenCalledTimes(enabled?1:0);expect(index.stats.queries).toBe(enabled?1:0);
  if(!enabled){expect(from).not.toHaveBeenCalled();expect(retrieval.metrics.semanticSkipped).toBe(1);}
});

it('empty freeze query does not disable later semantic lookup',async()=>{
  const {freeze,retrieval,embed}=fixture(true,1,'');const snapshot=roundtrip(freeze());
  expect(snapshot.retrieval.semanticPolicy).toMatchObject({capability:{reason:null},vectorsIncluded:true});
  expect(snapshot.retrieval.candidates[0].normalizedVector).toHaveLength(1024);
  const from=vi.spyOn(Float32Array,'from');await lookupFrozenEnvironment(snapshot,' ',retrieval);
  expect(retrieval.metrics.semanticSkipReason).toBe('empty_query');expect(from).not.toHaveBeenCalled();expect(embed).not.toHaveBeenCalled();
  const semantic=await lookupFrozenEnvironment(snapshot,'智能终端',retrieval);
  expect(semantic.context.longTerm.map(r=>r.id)).toEqual(['long-0']);expect(embed).toHaveBeenCalledTimes(1);
});

it.each(['calibration','limits','endpoint','model','dimensions','template'] as const)('rejects changed %s before vector conversion or querying',async change=>{
  const {d,store,provider,calibration,freeze}=fixture(true);const snapshot=roundtrip(freeze());
  const embed=vi.fn(async()=>[1,...Array(1023).fill(0)]);
  const modified={...provider,embed,...(change==='endpoint'?{baseUrl:'https://other.invalid'}:{}),...(change==='model'?{model:'different'}:{}),...(change==='dimensions'?{dimensions:512}:{})};
  const index=new MemoryIndex(store,modified,{clock:d.clock,...(change==='template'?{templateVersion:'other'}:{})});
  const retrieval=new MemoryRetrieval(store,index,change==='limits'?{longItemsLimit:1}:{},change==='calibration'?{...calibration,lexical:{fact:.5,experience:1}}:calibration);
  const from=vi.spyOn(Float32Array,'from');await expect(lookupFrozenEnvironment(snapshot,'手机',retrieval)).rejects.toThrow('frozen retrieval configuration changed');
  expect(lookupBasisCurrent({...d,retrieval},snapshot)).toBe(false);expect(from).not.toHaveBeenCalled();expect(embed).not.toHaveBeenCalled();expect(index.stats.queries).toBe(0);
});

it('rejects mismatched saved capability even if the legacy configuration digest matches',async()=>{
  const {freeze,retrieval}=fixture(true);const snapshot=roundtrip(freeze());
  snapshot.retrieval.semanticPolicy!.capability.dimensions=512;
  const from=vi.spyOn(Float32Array,'from');await expect(lookupFrozenEnvironment(snapshot,'手机',retrieval)).rejects.toThrow('frozen retrieval configuration changed');expect(from).not.toHaveBeenCalled();
});

it.each(['old','new'] as const)('%s frozen lookup keeps permissions, source validation and cancellation without live reads',async shape=>{
  const {store,freeze,retrieval,embed}=fixture();const snapshot=roundtrip(freeze());if(shape==='old')delete snapshot.retrieval.semanticPolicy;
  vi.spyOn(store,'selectCandidates').mockImplementation(()=>{throw Error('live read');});
  for(const query of [{query:'手机',scope:'archive' as const,includeDetailHistory:false},{query:'手机',scope:'current' as const,includeDetailHistory:true}])await expect(lookupFrozenEnvironment(snapshot,query,retrieval)).rejects.toThrow('permission');
  const invalid=roundtrip(snapshot);invalid.retrieval.invalidSourceIds=['source'];await expect(lookupFrozenEnvironment(invalid,'手机',retrieval)).rejects.toThrow('source consistency');
  const controller=new AbortController();controller.abort(new Error('cancelled lookup'));await expect(lookupFrozenEnvironment(snapshot,'手机',retrieval,controller.signal)).rejects.toThrow('cancelled lookup');expect(embed).not.toHaveBeenCalled();
});
