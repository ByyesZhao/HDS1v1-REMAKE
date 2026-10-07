import { afterEach, expect, it, vi } from 'vitest';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';
import { MemoryIndex, normalizeVector } from '../src/memory/index';
import { HttpEmbeddingProvider } from '../src/embedding';
import { TestClock, NOW } from './helpers';
const stores:Storage[]=[];afterEach(()=>{stores.splice(0).forEach(s=>s.close());vi.useRealTimers();});
function create(options:any={}){const storage=new Storage(':memory:');stores.push(storage);const store=new MemoryStore(storage);store.migrate(NOW);const clock=new TestClock();const embed=vi.fn(async(_text:string,_options?:{signal?:AbortSignal})=>[3,4]);const provider={model:'test',baseUrl:'https://embedding.test',dimensions:2,embed};const index=new MemoryIndex(store,provider,{clock,...options});return{store,clock,embed,index};}
it('normalizes both documents and queries and caches only query vectors with TTL/config identity',async()=>{
  const{store,clock,embed,index}=create();expect([...normalizeVector([3,4])][0]).toBeCloseTo(.6);
  const first=await index.query('手机');expect(first![1]).toBeCloseTo(.8);await index.query('手机');expect(embed).toHaveBeenCalledTimes(1);expect(index.stats).toMatchObject({queries:2,cacheHits:1,remoteRequests:1});
  clock.advance(600001);await index.query('手机');expect(embed).toHaveBeenCalledTimes(2);
  const changed=new MemoryIndex(store,{model:'new',baseUrl:'https://embedding.test',dimensions:2,embed},{clock});await changed.query('手机');expect(embed).toHaveBeenCalledTimes(3);expect(changed.configSignature).not.toBe(index.configSignature);
});
it('evicts least recently used queries at 256 entries without caching owner results',async()=>{
  const{index,embed}=create();for(let i=0;i<257;i++)await index.query(`query${i}`);await index.query('query0');expect(embed).toHaveBeenCalledTimes(258);await index.query('query256');expect(embed).toHaveBeenCalledTimes(258);
});
it('falls back after 1500ms, aborts local HTTP, and records timeout separately from failure',async()=>{
  vi.useFakeTimers();const{store,index}=create();let signal:AbortSignal|undefined;
  const blocked=new MemoryIndex(store,{model:'blocked',dimensions:2,embed:(_text,opts)=>{signal=opts?.signal;return new Promise(()=>{});}},{queryTimeoutMs:1500});
  const promise=blocked.query('手机');await vi.advanceTimersByTimeAsync(1500);expect(await promise).toBeNull();expect(signal!.aborted).toBe(true);expect(blocked.stats).toMatchObject({timeouts:1,failures:0,remoteRequests:1});
  const failed=new MemoryIndex(store,{model:'fail',embed:async()=>{throw new Error('offline');}});expect(await failed.query('手机')).toBeNull();expect(failed.stats.failures).toBe(1);
});
it('prepares an index result without changing owners or committing vectors and forwards cancellation',async()=>{
  const{store,index,embed}=create();const row=store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'手机A',key:'phone',value:'A'},NOW);store.saveOwner(row);store.queueIndex(row,NOW,index.configSignature);const job=store.jobs<any>('memory_index_jobs')[0];
  const controller=new AbortController();const result=await index.prepare(job,controller.signal);expect(result.normalizedVector[0]).toBeCloseTo(.6);expect(store.owner(row)?.revision).toBe(1);expect(store.job<any>('memory_index_jobs',job.id)?.status).toBe('pending');expect(embed.mock.calls[0][1]?.signal).toBe(controller.signal);
});
it('HTTP embedding forwards signal only as fetch option and preserves the current request payload',async()=>{
  let received:any;const provider=new HttpEmbeddingProvider('qwen-test','https://example.test','test-only',(async(_url,init)=>{received=init;return new Response(JSON.stringify({data:[{embedding:[3,4]}]}));}) as typeof fetch,2);const c=new AbortController();await provider.embed('测试',{signal:c.signal});
  expect(received.signal).toBe(c.signal);expect(JSON.parse(received.body)).toEqual({model:'qwen-test',input:'测试',dimensions:2,encoding_format:'float'});
});
