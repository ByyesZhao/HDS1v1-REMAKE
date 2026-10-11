import {mkdtempSync,writeFileSync,rmSync,existsSync,readFileSync} from 'node:fs';
import fsPromises from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';

// One probe, unchanged public APIs, independently seeded baseline/after observations.
async function main(){
 const args=process.argv.slice(2),source=resolve(args[args.indexOf('--source')+1]??'.'),outputIndex=args.indexOf('--output');
 if(outputIndex<0||!args[outputIndex+1]||args.indexOf('--source')<0)throw Error('Usage: check-image-payload-work --source <source-root> --output <json>');
 const output=resolve(args[outputIndex+1]);
 const {Storage}=require(join(source,'src/storage.ts')) as typeof import('../src/storage');
 const {IncomingAssets,AttachmentResolver}=require(join(source,'src/input-media/assets.ts')) as typeof import('../src/input-media/assets');
 const {IncomingMediaStore}=require(join(source,'src/input-media/store.ts')) as typeof import('../src/input-media/store');
 const {IncomingMediaService}=require(join(source,'src/input-media/service.ts')) as typeof import('../src/input-media/service');
 const {ModelClient,ChatCompletionsTransport}=require(join(source,'src/model/client.ts')) as typeof import('../src/model/client');
 const {WebSearchStore}=require(join(source,'src/web/store.ts')) as typeof import('../src/web/store');
 const {WebSearchService}=require(join(source,'src/web/service.ts')) as typeof import('../src/web/service');
 const {INCOMING_IMAGE_RECOGNIZER_VERSION:version}=require(join(source,'src/input-media/observe.ts')) as typeof import('../src/input-media/observe');
 const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(1_000_000,42)]),ref=createHash('sha256').update(bytes).digest('hex');
 const expectedUrl='data:image/png;base64,'+bytes.toString('base64'),at='2026-10-11T00:00:00.000Z';
 const observation={description:'合成图片',visibleText:[],possibleTone:null,uncertain:false};
 const originalRead=fsPromises.readFile,originalEncode=Buffer.prototype.toString;
 const cases=[];
 for(const scenario of ['single','tool_repair','cached_pending'] as const){
  const samples=[];
  for(let sample=-1;sample<7;sample++){
   const root=mkdtempSync(join(tmpdir(),'hdsi-image-work-')),path=join(root,ref+'.png'),db=new Storage(':memory:');writeFileSync(path,bytes);
   const store=new IncomingMediaStore(db),assets=new IncomingAssets(store,root,new AttachmentResolver(async()=>{throw Error('network forbidden');}));
   let reads=0,encodings=0,modelRequests=0,webReads=0;
   const values:unknown[]=scenario==='tool_repair'?[{webRead:{url:'https://offline.test/page'}},{description:3},observation]:[observation];
   const model=new ModelClient(new ChatCompletionsTransport(()=>({model:'offline',apiKey:'synthetic',baseUrl:'https://offline.test'}),async(url,init)=>{
    if(url!=='https://offline.test/chat/completions')throw Error('unexpected network');
    modelRequests++;const body=JSON.parse(String(init!.body));
    if(body.messages[1].content[1].image_url.url!==expectedUrl)throw Error('image payload changed');
    return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(values.shift())}}]}));
   },asset=>assets.resolveImageAsset(asset)));
   const web=new WebSearchService(new WebSearchStore(db),{signature:'offline',search:async()=>[],read:async()=>{webReads++;return {bodyFormat:'text',title:'合成',body:'公开合成正文'};}},{now:()=>at},{enabled:true});
   const service=new IncomingMediaService(store,assets,model,{enabled:true},web);
   db.save('image_assets',ref,{id:ref,contentHash:ref,mimeType:'image/png',relativePath:ref+'.png',state:'ready'});
   store.register([{id:'a',messageId:'m',order:0,kind:'image'}]);db.save('message_attachments','a',{...db.read('message_attachments','a')!,assetRef:ref,downloadStatus:'ready'});
   db.save('turns','t',{id:'t',done:false,inputMessageIds:['m'],visualContext:{version:1,entries:scenario==='cached_pending'?[{messageId:'m',attachmentId:'a',order:0,status:'pending',imageAssetRef:ref,phaseKey:'incoming_image:a',recognizerVersion:version}]:[]}} as any);
   if(scenario==='cached_pending')store.saveObservation({id:ref+':'+version,contentHash:ref,recognizerVersion:version,origin:'vision',observation,confirmedAt:at});
   fsPromises.readFile=((...params:any[])=>{if(String(params[0])===path)reads++;return (originalRead as any)(...params);}) as typeof originalRead;
   Buffer.prototype.toString=function(...params:Parameters<Buffer['toString']>){if(params[0]==='base64')encodings++;return originalEncode.apply(this,params);};
   try{
    const start=performance.now(),result=await service.prepareForTurn('t',['m']),elapsedMs=performance.now()-start;
    if(JSON.stringify(result[0].observation)!==JSON.stringify(observation))throw Error('observation changed');
    if(JSON.stringify(db.read('turns','t')).includes('data:image'))throw Error('persisted image bytes');
    if(sample>=0)samples.push({elapsedMs,reads,encodings,modelRequests,webReads,networkRequests:0});
   }finally{fsPromises.readFile=originalRead;Buffer.prototype.toString=originalEncode;await service.stop();db.close();rmSync(root,{recursive:true,force:true});}
  }
  cases.push({scenario,samples,medianMs:[...samples.map(s=>s.elapsedMs)].sort((a,b)=>a-b)[3]});
 }
 const revisionPath=join(source,'source-revision.txt');
 const revision=existsSync(revisionPath)?readFileSync(revisionPath,'utf8').trim():execFileSync('git',['rev-parse','HEAD'],{cwd:source,encoding:'utf8'}).trim();
 const report={sourceRoot:source,revision,sourceIdentity:existsSync(revisionPath)?'archived source-revision.txt':'Git HEAD; inspect dirtyFiles',dirtyFiles:existsSync(revisionPath)?[]:execFileSync('git',['diff','--name-only'],{cwd:source,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean),node:process.version,platform:process.platform,bytes:bytes.length,warmups:1,samplesPerCase:7,timing:'prepareForTurn through confirmed observation; fixture creation and cleanup excluded',cases};
 writeFileSync(output,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({output,revision,cases:cases.map(c=>({scenario:c.scenario,medianMs:c.medianMs,work:c.samples.map(({elapsedMs,...work})=>work)}))}));
}
void main().catch(error=>{console.error(error);process.exitCode=1;});
