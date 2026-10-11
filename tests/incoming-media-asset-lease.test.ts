import {afterEach,expect,it,vi} from 'vitest';
import {mkdtempSync,rmSync,writeFileSync,unlinkSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {Storage} from '../src/storage';
import {IncomingAssets,AttachmentResolver} from '../src/input-media/assets';
import {IncomingMediaStore} from '../src/input-media/store';
import {IncomingMediaService} from '../src/input-media/service';
import {INCOMING_IMAGE_RECOGNIZER_VERSION as V} from '../src/input-media/observe';
import {ChatCompletionsTransport,ModelClient} from '../src/model/client';
import {WebSearchService} from '../src/web/service';
import {WebSearchStore} from '../src/web/store';
import {TestClock} from './helpers';

vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,readFile:vi.fn(actual.readFile)};
});
const observation={description:'合成图片',visibleText:[],possibleTone:null,uncertain:false};
const cleanups:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const cleanup of cleanups.splice(0))await cleanup();vi.restoreAllMocks();vi.mocked(readFile).mockClear();});
function deferred<T=void>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return {promise,resolve};}
function fixture(values:unknown[]=[observation],withWeb=false){
 const root=mkdtempSync(join(tmpdir(),'hdsi-image-lease-')),db=new Storage(':memory:'),store=new IncomingMediaStore(db);
 const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(1_000_000,42)]),ref=createHash('sha256').update(bytes).digest('hex');
 const path=join(root,ref+'.png'),url='data:image/png;base64,'+bytes.toString('base64');writeFileSync(path,bytes);
 db.save('image_assets',ref,{id:ref,contentHash:ref,mimeType:'image/png',relativePath:ref+'.png',state:'ready'});
 const assets=new IncomingAssets(store,root,new AttachmentResolver(async()=>{throw Error('external network forbidden');}));
 const bodies:any[]=[];
 const fetcher=vi.fn(async(_url:unknown,init:any)=>{bodies.push(JSON.parse(String(init.body)));const value=values.shift()??observation;if(value instanceof Error)throw value;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(value)}}]}));});
 const model=new ModelClient(new ChatCompletionsTransport(()=>({model:'synthetic',apiKey:'offline',baseUrl:'https://offline.test'}),fetcher,asset=>assets.resolveImageAsset(asset)));
 const web=withWeb?new WebSearchService(new WebSearchStore(db),{signature:'offline',search:async()=>[],read:async()=>({bodyFormat:'text',title:'资料',body:'公开合成正文'})},new TestClock(),{enabled:true}):undefined;
 const service=new IncomingMediaService(store,assets,model,{enabled:true},web);
 function add(id='a',turnId='t',pending=false){
  store.register([{id,messageId:id,order:0,kind:'image'}]);db.save('message_attachments',id,{...db.read('message_attachments',id)!,assetRef:ref,downloadStatus:'ready'});
  db.save('turns',turnId,{id:turnId,done:false,inputMessageIds:[id],visualContext:{version:1,entries:pending?[{messageId:id,attachmentId:id,order:0,status:'pending',imageAssetRef:ref,phaseKey:'incoming_image:'+id,recognizerVersion:V}]:[]}} as any);
 }
 add();
 const encode=vi.spyOn(Buffer.prototype,'toString'),reads=vi.mocked(readFile);reads.mockClear();
 const work=()=>({reads:reads.mock.calls.filter(c=>String(c[0])===path).length,encodes:encode.mock.calls.filter(c=>c[0]==='base64').length});
 const reset=()=>{reads.mockClear();encode.mockClear();};
 cleanups.push(async()=>{await service.stop();db.close();rmSync(root,{recursive:true,force:true});});
 return {db,store,assets,service,model,bodies,fetcher,bytes,ref,path,url,add,work,reset,web};
}
const active=(assets:IncomingAssets)=>(assets as any).uses.size;
const payloads=(assets:IncomingAssets)=>(assets as any).payloads?.size??0;

it('ready asset is read once and encoded once throughout a real observation transport',async()=>{
 const d=fixture();expect((await d.service.prepareForTurn('t',['a']))[0].observation).toEqual(observation);
 expect(d.work()).toEqual({reads:1,encodes:1});expect(d.fetcher).toHaveBeenCalledTimes(1);
 expect(d.bodies[0].messages[1].content[1].image_url.url).toBe(d.url);
 expect(active(d.assets)).toBe(0);expect(payloads(d.assets)).toBe(0);
 expect(JSON.stringify(d.db.read('turns','t'))).not.toContain('data:image');
});
it('image tool continuation and format repair reuse one payload lease',async()=>{
 const d=fixture([{webRead:{url:'https://offline.test/page'}},{description:3},observation],true);
 await d.service.prepareForTurn('t',['a']);expect(d.fetcher).toHaveBeenCalledTimes(3);
 expect(d.work()).toEqual({reads:1,encodes:1});expect(d.bodies.every(b=>b.messages[1].content[1].image_url.url===d.url)).toBe(true);
 expect(d.bodies[1].messages[1].content[0].text).toContain('公开合成正文');
 expect(JSON.stringify(d.web!.store.snapshot(d.web!.store.openStage('turn','t','incoming_image:a','incoming_image').runId).checkpoint)).not.toContain('data:image');
 expect(active(d.assets)).toBe(0);expect(payloads(d.assets)).toBe(0);
});
it('cached observation validates the pending frozen file without encoding, even when new recognition is disabled',async()=>{
 const d=fixture();d.add('b','pending',true);d.store.saveObservation({id:d.ref+':'+V,contentHash:d.ref,recognizerVersion:V,origin:'vision',observation,confirmedAt:new Date().toISOString()});
 const disabled=new IncomingMediaService(d.store,d.assets,d.model,{enabled:false});
 expect((await disabled.prepareForTurn('pending',['b']))[0].origin).toBe('cache');
 expect(d.work()).toEqual({reads:1,encodes:0});expect(d.fetcher).not.toHaveBeenCalled();expect(active(d.assets)).toBe(0);
 d.add('c','missing',true);unlinkSync(d.path);d.reset();
 await expect(disabled.prepareForTurn('missing',['c'])).rejects.toThrow();
 expect(d.db.read('turns','missing')!.visualContext!.entries[0].status).toBe('pending');
 expect(d.work()).toEqual({reads:1,encodes:0});expect(d.fetcher).not.toHaveBeenCalled();expect(active(d.assets)).toBe(0);expect(payloads(d.assets)).toBe(0);
});
it('frozen ready and confirmed history remain readable after the image file is gone',async()=>{
 const d=fixture();await d.service.prepareForTurn('t',['a']);unlinkSync(d.path);d.reset();
 expect((await d.service.prepareForTurn('t',['a']))[0].observation).toEqual(observation);
 d.db.save('turns','next',{id:'next',visualContext:{version:1,entries:[]}} as any);
 expect((await d.service.prepareForTurn('next',['a']))[0].observation).toEqual(observation);
 expect(d.work()).toEqual({reads:0,encodes:0});expect(d.fetcher).toHaveBeenCalledTimes(1);
});
it('concurrent leases share the read and lazy encoding, protect retirement, and release idempotently',async()=>{
 const d=fixture(),[one,two]=await Promise.all([d.assets.acquireImageAsset(d.ref),d.assets.acquireImageAsset(d.ref)]);
 expect(d.work()).toEqual({reads:1,encodes:0});expect(await d.assets.retire(d.ref,()=>true)).toBe(false);
 expect(await d.assets.resolveImageAsset(d.ref)).toBe(d.url);one.release();one.release();
 expect(await d.assets.resolveImageAsset(d.ref)).toBe(d.url);expect(d.work()).toEqual({reads:1,encodes:1});
 expect(await d.assets.retire(d.ref,()=>true)).toBe(false);two.release();
 expect(active(d.assets)).toBe(0);expect(payloads(d.assets)).toBe(0);expect(await d.assets.retire(d.ref,()=>true)).toBe(true);
});
it('failed shared reads release every holder and do not poison a later acquisition',async()=>{
 const d=fixture();unlinkSync(d.path);
 const failed=await Promise.allSettled([d.assets.acquireImageAsset(d.ref),d.assets.acquireImageAsset(d.ref)]);
 expect(failed.map(r=>r.status)).toEqual(['rejected','rejected']);expect(d.work()).toEqual({reads:1,encodes:0});
 expect(active(d.assets)).toBe(0);expect(payloads(d.assets)).toBe(0);
 writeFileSync(d.path,d.bytes);d.reset();expect(await d.assets.resolveImageAsset(d.ref)).toBe(d.url);
 expect(d.work()).toEqual({reads:1,encodes:1});expect(active(d.assets)).toBe(0);expect(payloads(d.assets)).toBe(0);
});
it('simultaneous first transport resolutions encode their shared bytes only once',async()=>{
 const d=fixture(),lease=await d.assets.acquireImageAsset(d.ref);
 try{expect(await Promise.all([d.assets.resolveImageAsset(d.ref),d.assets.resolveImageAsset(d.ref)])).toEqual([d.url,d.url]);expect(d.work()).toEqual({reads:1,encodes:1});}
 finally{lease.release();}
});
it('an acquisition waiting for retirement rechecks the stored ready state',async()=>{
 const d=fixture(),retiring=d.assets.retire(d.ref,()=>true);
 await expect(d.assets.acquireImageAsset(d.ref)).rejects.toThrow('pending image asset missing');expect(await retiring).toBe(true);
 expect(d.work()).toEqual({reads:0,encodes:0});expect(active(d.assets)).toBe(0);
});
it('two same-hash observations keep their own leases until the shared model settles',async()=>{
 const d=fixture(),entered=deferred(),gate=deferred();d.add('b','u');
 const original=d.fetcher.getMockImplementation()!;d.fetcher.mockImplementation(async(...args)=>{entered.resolve();await gate.promise;return original(...args);});
 const one=d.service.prepareForTurn('t',['a']),two=d.service.prepareForTurn('u',['b']);
 try{await entered.promise;expect(await d.assets.retire(d.ref,()=>true)).toBe(false);gate.resolve();
 await Promise.all([one,two]);expect(d.fetcher).toHaveBeenCalledTimes(1);expect(d.work()).toEqual({reads:1,encodes:1});expect(active(d.assets)).toBe(0);
 }finally{gate.resolve();await Promise.allSettled([one,two]);}
});
it.each(['model','format','abort'] as const)('observation %s failure releases bytes and recovery reads afresh',async reason=>{
 const d=fixture(reason==='model'?[Error('synthetic model failure')]:reason==='format'?[{bad:1},{bad:1},{bad:1}]:[observation]),controller=new AbortController();
 if(reason==='abort'){const original=d.fetcher.getMockImplementation()!;d.fetcher.mockImplementation(async(...args)=>{const result=await original(...args);controller.abort(Error('synthetic stop'));return result;});}
 await expect(d.service.prepareForTurn('t',['a'],controller.signal)).rejects.toThrow();
 expect(active(d.assets)).toBe(0);expect(payloads(d.assets)).toBe(0);expect(d.db.read('turns','t')!.visualContext!.entries[0].status).toBe('pending');
 d.fetcher.mockImplementation(async()=>new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(observation)}}]})));d.reset();
 expect((await d.service.prepareForTurn('t',['a']))[0].status).toBe('ready');expect(d.work()).toEqual({reads:1,encodes:1});
});
it('abort immediately after acquisition cannot confirm a cached observation',async()=>{
 const d=fixture(),controller=new AbortController();d.add('b','u',true);
 d.store.saveObservation({id:d.ref+':'+V,contentHash:d.ref,recognizerVersion:V,origin:'vision',observation,confirmedAt:new Date().toISOString()});
 const acquire=d.assets.acquireImageAsset.bind(d.assets);vi.spyOn(d.assets,'acquireImageAsset').mockImplementation(async ref=>{const lease=await acquire(ref);controller.abort(Error('after acquire'));return lease;});
 await expect(d.service.prepareForTurn('u',['b'],controller.signal)).rejects.toThrow('after acquire');
 expect(d.db.read('turns','u')!.visualContext!.entries[0].status).toBe('pending');expect(d.db.read('message_attachments','b')!.confirmedObservationRef).toBeNull();
 expect(d.work()).toEqual({reads:1,encodes:0});expect(active(d.assets)).toBe(0);
});
it('graceful stop waits for the in-flight observation before storage closes',async()=>{
 const d=fixture(),entered=deferred(),gate=deferred();const original=d.fetcher.getMockImplementation()!;
 d.fetcher.mockImplementation(async(...args)=>{entered.resolve();await gate.promise;return original(...args);});
 const pending=d.service.prepareForTurn('t',['a']);await entered.promise;let stopped=false;
 const stopping=d.service.stop({graceful:true}).then(()=>{stopped=true;expect(d.db.read('turns','t')!.visualContext!.entries[0].status).toBe('ready');expect(active(d.assets)).toBe(0);});
 await Promise.resolve();expect(stopped).toBe(false);gate.resolve();await Promise.all([pending,stopping]);expect(stopped).toBe(true);
});
it('graceful stop also waits while an accepted observation is acquiring its image bytes',async()=>{
 const d=fixture(),entered=deferred(),gate=deferred<Buffer>();
 vi.mocked(readFile).mockImplementationOnce((()=>{entered.resolve();return gate.promise;}) as typeof readFile);
 const pending=d.service.prepareForTurn('t',['a']);await entered.promise;let stopped=false;
 const stopping=d.service.stop({graceful:true}).then(()=>{stopped=true;});
 try{await new Promise(resolve=>setTimeout(resolve,0));expect(stopped).toBe(false);gate.resolve(d.bytes);await Promise.all([pending,stopping]);
 expect(d.db.read('turns','t')!.visualContext!.entries[0].status).toBe('ready');expect(active(d.assets)).toBe(0);
 }finally{gate.resolve(d.bytes);await Promise.allSettled([pending,stopping]);}
});
