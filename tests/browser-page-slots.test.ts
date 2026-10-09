import {it,expect} from 'vitest';import {BrowserPageSlots} from '../src/web/browser/slots';
const tick=()=>new Promise(r=>setImmediate(r));function deferred<T>(){let resolve!:(x:T)=>void;return {promise:new Promise<T>(r=>resolve=r),resolve};}
const request={kind:'article' as const,url:'https://example.org'};
const result={finalUrl:request.url,title:'title',access:'ok' as const,search:null,main:{text:'body',source:'article' as const}};
it('holds a reservation through a late factory and delayed actual close',async()=>{
 const factory=deferred<any>(),closing=deferred<void>();let opens=0,reads=0;
 const slots=new BrowserPageSlots({openPage:async()=>{opens++;return opens===1?factory.promise:{read:async()=>result,close:async()=>{}};}},{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1});
 const abort=new AbortController();const first=slots.read(request,abort.signal);const rejected=expect(first).rejects.toThrow();await tick();abort.abort(Error('cancel'));await rejected;
 const second=slots.read(request);await tick();expect(opens).toBe(1);
 factory.resolve({read:async()=>{reads++;return result;},close:()=>closing.promise});await tick();expect(reads).toBe(0);expect(opens).toBe(1);
 closing.resolve();expect(await second).toEqual(result);expect(opens).toBe(2);await slots.dispose();expect(slots.status().reservations).toBe(0);
});
it('normal completion also waits for actual close before another page opens',async()=>{
 let opens=0;const close=deferred<void>();const slots=new BrowserPageSlots({openPage:async()=>({read:async()=>{opens++;return result;},close:()=>opens===1?close.promise:Promise.resolve()})},{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1});
 const first=slots.read(request),second=slots.read(request);await tick();expect(opens).toBe(1);close.resolve();await Promise.all([first,second]);expect(opens).toBe(2);await slots.dispose();
});
it('queue deadline never creates page; dispose waits for pending factory',async()=>{
 const factory=deferred<any>();let opens=0;const slots=new BrowserPageSlots({openPage:async()=>{opens++;return factory.promise;}},{engine:'bing',navigationTimeoutMs:30,maxConcurrentPages:1});
 const first=slots.read(request);const rejected=expect(first).rejects.toThrow();const second=slots.read(request);await expect(second).rejects.toThrow();await rejected;expect(opens).toBe(1);
 let drained=false;const disposal=slots.dispose().then(()=>drained=true);await tick();expect(drained).toBe(false);factory.resolve({close:async()=>{},read:async()=>result});await disposal;expect(drained).toBe(true);
});
it('unknown close failure retains slot and rejects dispose rather than falsely draining',async()=>{
 const slots=new BrowserPageSlots({openPage:async()=>({read:async()=>result,close:async()=>{throw Error('close failed');}})},{engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1});
 await expect(slots.read(request)).rejects.toThrow('close failed');expect(slots.status().reservations).toBe(1);await expect(slots.dispose()).rejects.toThrow('close failed');await expect(slots.read(request)).rejects.toThrow();
});
