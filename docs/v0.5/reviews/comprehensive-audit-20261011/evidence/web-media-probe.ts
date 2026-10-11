import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { Storage } from '../../../../../src/storage';
import { WebSearchStore } from '../../../../../src/web/store';
import { WebSearchService } from '../../../../../src/web/service';
import { createManagedBrowserProvider } from '../../../../../src/web/browser/provider';
import { extractDomEvidence } from '../../../../../src/web/browser/extract';
import { ModelClient, ChatCompletionsTransport } from '../../../../../src/model/client';
import { buildCompletionEnvelope } from '../../../../../src/model/resource-pool';
import type { ModelTask } from '../../../../../src/types';
import { IncomingMediaStore } from '../../../../../src/input-media/store';
import { IncomingAssets, AttachmentResolver } from '../../../../../src/input-media/assets';
import { IncomingMediaService } from '../../../../../src/input-media/service';
import { defaultConfig } from '../../../../../src/config';
import { EnvironmentStore } from '../../../../../src/environment/store';
import { ensureEnvironmentBatch } from '../../../../../src/environment/scheduler';

const clock = { now: () => '2026-10-11T09:00:00+08:00' };
const evidence = resolve('docs/v0.5/reviews/comprehensive-audit-20261011/evidence');

async function plainTextRoundTrip() {
  const html = '<html><head><title>offline code article</title></head><body><article><p>关系：a &lt; b &amp;&amp; c &gt; d。</p><p>类型：List&lt;String&gt;。</p><p>字面 HTML 示例：&lt;nav&gt;保留这段示例&lt;/nav&gt;。</p></article></body></html>';
  const dom = extractDomEvidence(parseHTML(html).document as unknown as Document, 'https://example.org/code');
  assert(dom.main?.text.includes('List<String>'));
  const managed = createManagedBrowserProvider({openPage: async () => ({read: async () => dom, close: async () => {}})}, {engine:'bing',navigationTimeoutMs:1000,maxConcurrentPages:1});
  const db = new Storage(':memory:');
  try {
    const store = new WebSearchStore(db), service = new WebSearchService(store,managed.provider,clock,{enabled:true});
    const session = service.openSession(store.openStage('turn','offline-text','world','world'));
    const op = session.beginOperation({kind:'read',url:'https://example.org/code'});
    const result = await session.readPage('https://example.org/code',{operationId:op.operationId});
    const actual = result.materials[0]?.body;
    assert(actual && !actual.includes('List<String>') && !actual.includes('保留这段示例'));
    return {inputHtml:html,domText:dom.main!.text,storedMaterialBody:actual,counters:result.counters};
  } finally { await managed.dispose(); db.close(); }
}

function nestedArticle() {
  const html='<html><body><article><p>外层正文。</p><article><p>内层正文唯一标记。</p></article></article></body></html>';
  const result=extractDomEvidence(parseHTML(html).document as unknown as Document,'https://example.org/nested');
  const occurrences=result.main!.text.split('内层正文唯一标记').length-1;
  assert.equal(occurrences,2);
  return {inputHtml:html,extractedBody:result.main!.text,innerTextOccurrences:occurrences};
}

function stickerCli() {
  const root=mkdtempSync(join(tmpdir(),'hdsi-audit-sticker-cli-'));
  const configPath=join(root,'synthetic-config.json');
  const roles=['narrative','narrative_shared','personal_chat','personal_life','personal_shared','expression','memory','memory_consolidation','world','school_campus','school_group','school_week'];
  const model={model:'deepseek-flash',apiKeyEnv:'HDSI_AUDIT_OFFLINE_KEY',baseUrl:'https://example.invalid'};
  const config={background:'offline fixture',chatExamples:'fixture',worldSetting:'fixture',schoolSetting:'fixture',initialScene:{description:'fixture'},initialPlan:'fixture',models:Object.fromEntries(roles.map(r=>[r,model])),stickerDescriptionModel:model,embedding:{model:'fixture',apiKeyEnv:'HDSI_AUDIT_OFFLINE_KEY',baseUrl:'https://example.invalid'},webSearch:{enabled:true,provider:'browser'}};
  writeFileSync(configPath,JSON.stringify(config));
  writeFileSync(join(root,'deny-network.cjs'),"global.fetch=async()=>{throw Error('AUDIT: network is prohibited');};\n");
  try {
    return ['rebuild','import'].map(command=>{
      const child=spawnSync(process.execPath,['--require',join(root,'deny-network.cjs'),'--import','tsx','scripts/stickers.ts',command,command==='rebuild'?'-':join(root,'unused.png'),configPath,join(root,command+'.sqlite')],{cwd:process.cwd(),encoding:'utf8',env:{...process.env,HDSI_AUDIT_OFFLINE_KEY:'offline-placeholder'},timeout:30000});
      assert.equal(child.status,1);
      assert(child.stderr.includes('web search enabled but provider not configured'));
      return {command,exitCode:child.status,stdout:child.stdout,stderr:child.stderr.replace(/\(node:\d+\)/g,'(node:PID)')};
    });
  } finally { rmSync(root,{recursive:true,force:true}); }
}

const task:ModelTask<{answer:string}>={name:'world',prompt:'offline fixture',schema:{type:'object'},parse:v=>v as {answer:string}};
async function snapshotWorkload(pageCount:number,bodyCharacters:number) {
  const db=new Storage(':memory:');
  const store=new WebSearchStore(db);
  const marker='HDSI_AUDIT_BODY:';
  const body=marker+'x'.repeat(bodyCharacters-marker.length);
  const service=new WebSearchService(store,{signature:'offline',search:async()=>[],read:async()=>({title:'offline',body})},clock,{enabled:true});
  const web=service.openSession(store.openStage('turn','offline-cost','world','world'));
  let snapshots=0,jsonParsesWithBody=0,parsedCharacters=0,request=0,envelopeCharacters=0;
  const snapshot=store.snapshot.bind(store);
  store.snapshot=(id)=>{snapshots++;return snapshot(id);};
  const parse=JSON.parse;
  JSON.parse=((text:string,...args:any[])=>{if(typeof text==='string'&&text.includes(marker)){jsonParsesWithBody++;parsedCharacters+=text.length;}return parse(text,...args as [any]);}) as typeof JSON.parse;
  const started=performance.now();
  try {
    const model=new ModelClient({complete:async r=>{envelopeCharacters+=JSON.stringify(buildCompletionEnvelope(r)).length;return request++<pageCount?{webRead:{url:'https://example.org/'+request}}:{answer:'done'};}});
    await model.runModel(task,{}, {web,lookup:null});
  } finally {JSON.parse=parse;}
  const elapsedMs=performance.now()-started;
  const tableSizes=()=>Object.fromEntries(['web_sessions','web_operations','web_materials'].map(table=>[table,Number(db.prepare(`SELECT coalesce(sum(length(data)),0) n FROM ${table}`).get()!.n)]));
  const activeStoredCharacters=tableSizes();
  service.compactOwnerCheckpoint('turn','offline-cost');
  const compactedStoredCharacters=tableSizes();
  db.close();
  return {pageCount,bodyCharacters,uniqueBodyCharacters:pageCount*bodyCharacters,snapshots,jsonParsesWithBody,parsedCharacters,parseAmplification:parsedCharacters/(pageCount*bodyCharacters),envelopeCharacters,activeStoredCharacters,compactedStoredCharacters,elapsedMs};
}

async function imageConversionWorkload() {
  const root=mkdtempSync(join(tmpdir(),'hdsi-audit-image-cost-'));
  const db=new Storage(':memory:'), store=new IncomingMediaStore(db);
  const bytes=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),Buffer.alloc(1000000)]);
  const assets=new IncomingAssets(store,root,new AttachmentResolver());
  let resolvedCount=0,totalDataUrlCharacters=0,modelCalls=0;
  const originalResolve=assets.resolveImageAsset.bind(assets);
  assets.resolveImageAsset=async ref=>{const url=await originalResolve(ref);resolvedCount++;totalDataUrlCharacters+=url.length;return url;};
  const models=new ModelClient(new ChatCompletionsTransport(()=>({model:'fixture',baseUrl:'https://example.invalid',apiKey:'offline-placeholder'}),async()=>{modelCalls++;return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify({description:'合成观察',visibleText:[],possibleTone:null,uncertain:false})}}]}));},ref=>assets.resolveImageAsset(ref)));
  const media=new IncomingMediaService(store,assets,models,{enabled:true});
  try {
    store.register([{id:'image-a',messageId:'image-m',order:0,kind:'image',sourceUrl:'data:image/png;base64,'+bytes.toString('base64')}]);
    // Seed the exact ready-asset shape; sandbox rename restrictions are unrelated to this read/encode measurement.
    const ref=createHash('sha256').update(bytes).digest('hex'),relativePath=ref+'.png';
    writeFileSync(join(root,relativePath),bytes);
    db.save('image_assets',ref,{id:ref,contentHash:ref,mimeType:'image/png',relativePath,state:'ready'});
    db.save('message_attachments','image-a',{...db.read('message_attachments','image-a')!,downloadStatus:'ready',assetRef:ref});
    db.save('turns','image-turn',{id:'image-turn',visualContext:{version:1,entries:[]}} as any);
    await media.prepareForTurn('image-turn',['image-m']);
    assert.equal(modelCalls,1);assert.equal(resolvedCount,2);
    return {syntheticBytes:bytes.length,modelCalls,resolveImageAssetCalls:resolvedCount,totalDataUrlCharacters,discardedDataUrlCharacters:totalDataUrlCharacters/2,note:'Synthetic bytes test the asset plumbing only; no real vision model or PNG decoder was called.'};
  } finally {await media.stop();db.close();rmSync(root,{recursive:true,force:true});}
}

async function supersededOwner() {
  const db=new Storage(':memory:'), env=new EnvironmentStore(db), store=new WebSearchStore(db);
  const service=new WebSearchService(store,{signature:'offline',search:async()=>[],read:async()=>({title:'offline',body:'obsolete-public-body'})},clock,{enabled:true});
  try {
    db.set('runtime',{...db.runtime(),environmentPlanningVersion:2});
    const oldBatch=ensureEnvironmentBatch(db,defaultConfig,'2026-10-11T23:59:00+08:00')!;
    const oldStep=env.stepMetadata(oldBatch.id)[0];
    const web=service.openSession(store.openStage('environment',oldStep.id,'generation','world'));
    const op=web.beginOperation({kind:'read',url:'https://example.org/old'});
    const response=await web.readPage('https://example.org/old',{operationId:op.operationId});
    web.saveCheckpoint({input:{context:'obsolete-input'},repairCount:0,lookupUsed:false,pendingOperationId:null,toolResults:[response]});
    const beforeCacheOwners=(service as any).cache.size;
    ensureEnvironmentBatch(db,defaultConfig,'2026-10-12T00:01:00+08:00');
    const result={stepStatus:env.step(oldStep.id)!.status,beforeCacheOwners,afterCacheOwners:(service as any).cache.size,checkpointRetained:!!web.snapshot().checkpoint,materialRetained:web.snapshot().materials.length};
    assert.equal(result.stepStatus,'superseded');assert.equal(result.afterCacheOwners,1);assert(result.checkpointRetained);
    return result;
  } finally {db.close();}
}

async function main(){
  const result={baseline:'ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c',scope:'offline fixtures only; no private config, formal DB, service or network',plainTextRoundTrip:await plainTextRoundTrip(),nestedArticle:nestedArticle(),stickerCli:stickerCli(),imageConversionWorkload:await imageConversionWorkload(),supersededOwner:await supersededOwner(),snapshotWorkload:[] as unknown[]};
  for(const pages of [1,5,10,20])result.snapshotWorkload.push(await snapshotWorkload(pages,100000));
  writeFileSync(join(evidence,'web-media-probe.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(result,null,2));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
