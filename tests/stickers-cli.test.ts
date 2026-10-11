import {it,expect} from 'vitest';
import {spawnSync} from 'node:child_process';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {Storage} from '../src/storage';
import {modelRoles} from '../src/settings';

function run(command:'import'|'rebuild',mode='ready',enabled=true){
 const root=mkdtempSync(join(tmpdir(),'hdsi-sticker-cli-')),database=join(root,'fixture.sqlite'),config=join(root,'config.json'),source=join(root,'fixture.png'),trace=join(root,'trace.json');
 const connection={baseUrl:'https://model.invalid/v1',apiKeyEnv:'SYNTHETIC_KEY',model:'deepseek-v4-flash'};
 writeFileSync(config,JSON.stringify({background:'fixture',chatExamples:'fixture',worldSetting:'',schoolSetting:'',initialScene:{description:'fixture'},initialPlan:'',historyBudget:null,models:Object.fromEntries(modelRoles.map(role=>[role,connection])),stickerDescriptionModel:connection,embedding:{baseUrl:'https://embedding.invalid/v1',apiKeyEnv:'SYNTHETIC_KEY',model:'fixture-vector',dimensions:2},webSearch:{enabled,provider:'browser',browser:{navigationTimeoutMs:100,maxConcurrentPages:1}}}));
 writeFileSync(source,Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aE1kAAAAASUVORK5CYII=','base64'));
 const seed=new Storage(database);if(command==='rebuild')seed.save('stickers','existing',{id:'existing',path:'original.png',description:'Original description',embedding:[0,1],embeddingModel:'old'});seed.close();
 const fixture=`
 const {createRequire}=require('node:module');const {writeFileSync}=require('node:fs');const req=createRequire(process.cwd()+'/package.json');req('tsx/cjs');
 const [command,source,config,database,trace,mode,enabled]=process.argv.slice(1);const counts={browserLoads:0,browserFactory:0,vision:0,embedding:0,pages:0,pageCloses:0,contextStops:0,storageCloses:0,externalRequests:0,host:0,adapter:0,events:[],requests:[]};
 const Module=require('node:module'),originalLoad=Module._load;Module._load=function(id,...args){if(id==='koishi-plugin-puppeteer')counts.browserLoads++;if(/serial-host|adapter-onebot|src[\\\\/]index/.test(id))throw Error('forbidden story dependency '+id);return originalLoad.call(this,id,...args);};
 const {Storage}=req('./src/storage.ts'),originalClose=Storage.prototype.close,originalPrepare=Storage.prototype.prepare;let ownedStorage;Storage.prototype.prepare=function(...args){ownedStorage=this;return originalPrepare.apply(this,args);};Storage.prototype.close=function(){counts.events.push('storage.close');counts.storageCloses++;return originalClose.call(this);};
 global.fetch=async(url,init)=>{const body=JSON.parse(init.body);if(String(url)==='https://embedding.invalid/v1/embeddings'){counts.embedding++;return new Response(JSON.stringify({data:[{embedding:[1,0]}]}));}if(String(url)!=='https://model.invalid/v1/chat/completions'){counts.externalRequests++;throw Error('unexpected network');}counts.vision++;counts.requests.push(body);if(mode==='model-failure'&&counts.vision===2)return new Response('{}',{status:500});return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(enabled==='true'&&counts.vision===1?{webRead:{url:'https://example.org/article'}}:{description:'Synthetic sticker description'})}}]}));};
 if(command==='import'&&enabled==='true'){
 const originalKoishi=req('koishi'),{Context,Service}=originalKoishi;class Observed extends Context{constructor(...args){super(...args);this.on('dispose',()=>{counts.contextStops++;counts.events.push('context.stop');});}}
 const kp=req.resolve('koishi');require.cache[kp].exports={...originalKoishi,Context:Observed};
 const {parseHTML}=req('linkedom'),{extractDomEvidence}=req('./src/web/browser/extract.ts');
 class Browser extends Service{static [Service.provide]='puppeteer';constructor(ctx){super(ctx,'puppeteer');counts.browserFactory++;}async start(){if(mode==='reject')throw Error('SYNTHETIC_BROWSER_START_FAILURE');}async stop(){if(mode==='service-stop-failure'){counts.events.push('browser.stop.started');await new Promise(resolve=>setImmediate(resolve));ownedStorage.prepare('SELECT 1').get();counts.events.push('browser.stop.storage.available');counts.events.push('browser.stop.failed');throw Error('REAL_ASYNC_BROWSER_STOP_FAILURE');}}async page(){counts.pages++;if(mode==='late-page')await new Promise(r=>setTimeout(r,180));let url='',closed=false;return {on(){},setRequestInterception:async()=>{},goto:async(u)=>{url=u;return {status:()=>200};},url:()=>url,evaluate:async(_f,...args)=>{if(!args.length)return true;return extractDomEvidence(parseHTML('<article>Synthetic full body END_STICKER_BODY</article>').document,url);},close:async()=>{await new Promise(r=>setTimeout(r,20));ownedStorage.prepare('SELECT 1').get();counts.events.push('cleanup.storage.available');counts.pageCloses++;counts.events.push('page.close');closed=true;if(mode==='close-failure'){closed=false;throw Error('SYNTHETIC_PAGE_CLOSE_FAILURE');}},isClosed:()=>closed,browser:()=>({connected:true})};}}
 const pp=req.resolve('koishi-plugin-puppeteer');req(pp);require.cache[pp].exports={default:mode==='never'?function noBrowser(){}:Browser};counts.browserLoads=0;
 if(mode==='never'){const runtimePath=req.resolve('./src/deployment/sticker-web-runtime.ts'),{createStickerWebRuntime}=req(runtimePath);require.cache[runtimePath].exports={createStickerWebRuntime:(...args)=>createStickerWebRuntime(...args,{startupTimeoutMs:100})};}
 }
 process.on('exit',()=>writeFileSync(trace,JSON.stringify(counts)));process.argv=['node','scripts/stickers.ts',command,command==='rebuild'?'-':source,config,database];req('./scripts/stickers.ts');`;
 const child=spawnSync(process.execPath,['-e',fixture,command,source,config,database,trace,mode,String(enabled)],{cwd:resolve('.'),env:{...process.env,SYNTHETIC_KEY:'synthetic'},timeout:12000,encoding:'utf8'});
 const counts=JSON.parse(readFileSync(trace,'utf8'));const storage=new Storage(database);const stickers=storage.all('stickers');const sessions=storage.prepare("SELECT name FROM sqlite_master WHERE name='web_sessions'").get()?storage.prepare('SELECT data FROM web_sessions').all().map(row=>JSON.parse(String(row.data))):[];storage.close();
 rmSync(root,{recursive:true,force:true});return {child,counts,stickers,sessions};
}

it('rebuild_with_enabled_browser_never_creates_web_or_vision',()=>{
 const {child,counts,stickers,sessions}=run('rebuild');expect(child.error).toBeUndefined();expect(child.status,child.stderr).toBe(0);
 expect(stickers).toEqual([expect.objectContaining({id:'existing',path:'original.png',description:'Original description',embedding:[1,0],embeddingModel:'fixture-vector'})]);
 expect(counts).toMatchObject({browserLoads:0,browserFactory:0,vision:0,embedding:1,host:0,adapter:0,externalRequests:0});expect(sessions).toEqual([]);
});
it('import_with_enabled_browser_completes_tool_roundtrip',()=>{
 const {child,counts,stickers,sessions}=run('import');expect(child.error).toBeUndefined();expect(child.status,child.stderr).toBe(0);expect(stickers).toHaveLength(1);
 expect(counts).toMatchObject({browserFactory:1,vision:2,embedding:1,pages:1,pageCloses:1,contextStops:1,storageCloses:1,host:0,adapter:0,externalRequests:0});
 expect(JSON.stringify(counts.requests[1])).toContain('END_STICKER_BODY');expect(sessions).toHaveLength(1);expect(sessions[0]).toMatchObject({ref:{ownerType:'asset'},counters:{successReads:1,failures:0},checkpoint:null});
 expect(counts.events.indexOf('context.stop')).toBeLessThan(counts.events.indexOf('storage.close'));expect(counts.events.indexOf('page.close')).toBeLessThan(counts.events.indexOf('storage.close'));
});
it('import_browser_start_reject_preserves_original_error',()=>{
 const {child,counts,stickers}=run('import','reject');expect(child.status).toBe(1);expect(child.stderr).toContain('SYNTHETIC_BROWSER_START_FAILURE');expect(counts).toMatchObject({pages:0,contextStops:1,storageCloses:1});expect(stickers).toEqual([]);
});
it('disabled_import_never_loads_browser',()=>{
 const {child,counts,sessions}=run('import','ready',false);expect(child.status,child.stderr).toBe(0);expect(counts).toMatchObject({browserLoads:0,browserFactory:0,vision:1,embedding:1,pages:0,host:0,adapter:0,externalRequests:0});expect(sessions).toHaveLength(1);
});
it('import_browser_start_timeout_closes_context',()=>{
 const {child,counts}=run('import','never');expect(child.error).toBeUndefined();expect(child.status).toBe(1);expect(child.stderr).toContain('browser startup timeout after 100ms');expect(counts).toMatchObject({pages:0,contextStops:1,storageCloses:1});expect(counts.events.indexOf('context.stop')).toBeLessThan(counts.events.indexOf('storage.close'));
});
it('import_failure_drains_pages_before_closing_storage',()=>{
 const {child,counts,stickers}=run('import','model-failure');expect(child.status).toBe(1);expect(child.stderr).toContain('model HTTP 500');expect(counts.pageCloses).toBe(1);expect(counts.contextStops).toBe(1);expect(counts.events.indexOf('context.stop')).toBeLessThan(counts.events.indexOf('storage.close'));expect(stickers).toEqual([]);
});
it('successful import reports page cleanup failure as nonzero',()=>{
 const {child,counts,stickers}=run('import','close-failure');expect(child.status).toBe(1);expect(child.stderr).toContain('SYNTHETIC_PAGE_CLOSE_FAILURE');expect(counts.contextStops).toBe(1);expect(stickers).toHaveLength(1);expect(counts.events.indexOf('context.stop')).toBeLessThan(counts.events.indexOf('storage.close'));
});
it('late page creation drains while storage is still open',()=>{
 const {child,counts}=run('import','late-page');expect(child.status,child.stderr).toBe(0);expect(counts.pageCloses).toBe(1);expect(counts.events).toContain('cleanup.storage.available');expect(counts.events.indexOf('page.close')).toBeLessThan(counts.events.indexOf('storage.close'));
});
it('actual asynchronous browser stop failure finishes before storage closes and exits nonzero',()=>{
 const {child,counts}=run('import','service-stop-failure');expect(child.status).toBe(1);expect(child.stderr).toContain('REAL_ASYNC_BROWSER_STOP_FAILURE');expect(counts.events).toContain('browser.stop.storage.available');expect(counts.events.indexOf('browser.stop.failed')).toBeLessThan(counts.events.indexOf('storage.close'));expect(counts.events.filter((event:string)=>event==='browser.stop.started')).toHaveLength(1);
});
