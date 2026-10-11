import {expect,it,vi} from 'vitest';
import {runMemoryAccessProbe} from '../scripts/check-memory-access-work';
import {MemoryRetrieval} from '../src/memory/retrieval';

it('access probe has deterministic work counts and independently reseeds every sample',async()=>{
  const report=await runMemoryAccessProbe();
  expect(report).toMatchObject({warmups:1,samples:7,fixtureSeed:'memory-access-v1',nodeVersion:process.version});
  expect(report.cases).toHaveLength(12);
  for(const entry of report.cases){
    expect(entry.samples).toHaveLength(7);expect(new Set(entry.samples.map(sample=>JSON.stringify(sample.work))).size).toBe(1);
    expect(new Set(entry.samples.map(sample=>JSON.stringify(sample.outcome))).size).toBe(1);
    if(entry.scenario==='normalize'||entry.scenario==='next_deadline')expect(entry.work).toMatchObject({snapshotLoads:1,metadataRows:1600,fullOwnerRows:0,awakeningQueries:0,ownerWrites:0,grantWrites:0,dirtyWrites:0});
    if(entry.scenario==='normalize_overflow'){
      expect(entry.work).toMatchObject({snapshotLoads:1,metadataRows:1601,fullOwnerRows:1,awakeningQueries:2,awakeningParameters:901,ownerWrites:1});
      expect(entry.samples.every(s=>JSON.stringify(s.outcome)===JSON.stringify(['l-0100']))).toBe(true);
    }
    if(entry.scenario==='build_uncalibrated'||entry.scenario==='freeze_uncalibrated')expect(entry.work).toMatchObject({vectorBytes:0,providerCalls:0,queryCalls:0});
    if(entry.scenario==='build_calibrated')expect(entry.work).toMatchObject({vectorBytes:4096000,providerCalls:1,queryCalls:1});
  }
},60000);

it('probe never uses network or real storage',async()=>{
  const fetcher=vi.spyOn(globalThis,'fetch').mockImplementation(()=>{throw Error('test forbids network');});
  try{
    const report=await runMemoryAccessProbe({scenarios:['build_calibrated'],textCharacters:[128]});
    expect(report.storagePaths).toEqual([':memory:']);expect(report.modelCalls).toBe(0);expect(report.networkRequests).toBe(0);expect(fetcher).not.toHaveBeenCalled();
  }finally{fetcher.mockRestore();}
});

it('rejects swallowed network attempts and restores global hooks',async()=>{
  const original=MemoryRetrieval.prototype.build,previousFetch=globalThis.fetch;
  const build=vi.spyOn(MemoryRetrieval.prototype,'build').mockImplementation(async function(this:MemoryRetrieval,...args){
    try{await globalThis.fetch('https://offline.invalid/forbidden');}catch{/* Simulate a production fallback swallowing the guard error. */}
    return original.apply(this,args);
  });
  try{await expect(runMemoryAccessProbe({scenarios:['build_uncalibrated'],textCharacters:[128]})).rejects.toThrow('network attempt');expect(globalThis.fetch).toBe(previousFetch);}
  finally{build.mockRestore();}
});
