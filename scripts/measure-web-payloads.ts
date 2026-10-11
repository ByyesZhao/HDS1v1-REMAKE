import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {Storage} from '../src/storage';
import {WebSearchStore} from '../src/web/store';
import {WebSearchService} from '../src/web/service';
import {ModelClient} from '../src/model/client';
import {buildCompletionEnvelope} from '../src/model/resource-pool';

type Implementation='current'|'baseline';
const load=createRequire(resolve('scripts/measure-web-payloads.ts'));
function implementation(mode:Implementation){
 if(mode==='current')return {Storage,WebSearchStore,WebSearchService,ModelClient,buildCompletionEnvelope};
 const root=resolve('.tmp/comprehensive-remediation-baseline-build');
 return {Storage:load(resolve(root,'storage.js')).Storage,WebSearchStore:load(resolve(root,'web/store.js')).WebSearchStore,WebSearchService:load(resolve(root,'web/service.js')).WebSearchService,ModelClient:load(resolve(root,'model/client.js')).ModelClient,buildCompletionEnvelope:load(resolve(root,'model/resource-pool.js')).buildCompletionEnvelope};
}
export const payloadBody=(i:number)=>`WEB_BODY_${String(i).padStart(2,'0')}_`+'x'.repeat(100000-12);
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
function sourceIdentity(){
 const manifest=(root:string)=>readdirSync(root,{recursive:true,withFileTypes:true}).filter(entry=>entry.isFile()).map(entry=>{const path=resolve(entry.parentPath,entry.name);return {path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex')};}).sort((a,b)=>a.path.localeCompare(b.path));
 const baselineSource=manifest(resolve('.tmp/comprehensive-remediation-baseline/src')),baselineCompiled=manifest(resolve('.tmp/comprehensive-remediation-baseline-build')),currentSource=manifest(resolve('src'));
 return {baselineSourceRevision:readFileSync('.tmp/comprehensive-remediation-baseline/source-revision.txt','utf8').trim(),currentHead:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),currentDirty:execFileSync('git',['status','--porcelain=v1'],{encoding:'utf8'}).trim().split('\n'),manifests:{baselineSource,baselineCompiled,currentSource},manifestHashes:{baselineSource:hash(JSON.stringify(baselineSource)),baselineCompiled:hash(JSON.stringify(baselineCompiled)),currentSource:hash(JSON.stringify(currentSource))},probeSha256:createHash('sha256').update(readFileSync(__filename)).digest('hex')};
}
export async function measureWebPayloads(pages:number,mode:Implementation='current'){
 const impl=implementation(mode),db=new impl.Storage(':memory:'),store=new impl.WebSearchStore(db),clock={now:()=> '2026-10-11T00:00:00.000Z'};
 let providerCalls=0,modelCalls=0,snapshotCalls=0,materialReads=0,controlDepth=0,bodyParseCharacters=0,bodyParseCalls=0,parseCharacters=0,stringifyCharacters=0,controlBodyParseCharacters=0;
 const originalParse=JSON.parse,originalStringify=JSON.stringify;
 const parse:typeof JSON.parse=(text,reviver)=>{parseCharacters+=text.length;if(text.includes('WEB_BODY_')){bodyParseCalls++;bodyParseCharacters+=text.length;if(controlDepth)controlBodyParseCharacters+=text.length;}return originalParse(text,reviver);};
 const stringify:typeof JSON.stringify=((...args:Parameters<typeof JSON.stringify>)=>{const value=(originalStringify as any)(...args) as string|undefined;if(value)stringifyCharacters+=value.length;return value;}) as typeof JSON.stringify;
 for(const key of ['state','materialMetadata','openStage','incrementMetric','markProvided','beginOperation','saveCheckpoint'])if(typeof store[key]==='function'){const original=store[key].bind(store);store[key]=(...args:unknown[])=>{controlDepth++;try{return original(...args);}finally{controlDepth--;}};}
 const snapshot=store.snapshot.bind(store);store.snapshot=(...args:unknown[])=>{snapshotCalls++;return snapshot(...args);};
 if(store.materials){const materials=store.materials.bind(store);store.materials=(...args:unknown[])=>{materialReads++;return materials(...args);};}
 const provider={signature:'cost-fixture',search:async()=>[],read:async(url:string)=>{providerCalls++;return {bodyFormat:'text',title:`Page ${url.split('/').pop()}`,body:payloadBody(Number(url.split('/').pop()))};}},service=new impl.WebSearchService(store,provider,clock,{enabled:true}),web=service.openSession(store.openStage('turn','cost','personal','personal_life'));
 const task={name:'personal_life',prompt:'fixture',schema:{},parse:(v:any)=>{if(v?.answer!=='complete')throw Error('invalid fixture response');return v;}};
 const envelopeHashes:string[]=[];let envelopeCharacters=0;
 const client=new impl.ModelClient({complete:async(request:any)=>{const text=JSON.stringify(impl.buildCompletionEnvelope(request));envelopeHashes.push(hash(text));envelopeCharacters+=text.length;return ++modelCalls<=pages?{webRead:{url:`https://example.test/${modelCalls-1}`}}:{answer:'complete'};}});
 let elapsedMs:number,recovery:{bodyParseCharacters:number;materialReads:number;providerCalls:number};
 try{
  JSON.parse=parse;JSON.stringify=stringify;
  const start=performance.now();await client.runModel(task,{fixture:'unchanged'}, {web,lookup:null});elapsedMs=performance.now()-start;
 }finally{JSON.parse=originalParse;JSON.stringify=originalStringify;}
 const fresh={bodyParseCharacters,bodyParseCalls,parseCharacters,stringifyCharacters,controlBodyParseCharacters,snapshotCalls,materialReads};
 const beforeProvider=providerCalls,beforeReads=materialReads;bodyParseCharacters=0;
 try{JSON.parse=parse;await new impl.ModelClient({complete:async()=>({answer:'complete'})}).runModel(task,{fixture:'unchanged'},{web,lookup:null});recovery={bodyParseCharacters,materialReads:materialReads-beforeReads,providerCalls:providerCalls-beforeProvider};}finally{JSON.parse=originalParse;}
 try{
  const bytes:Record<string,number>={};for(const table of ['web_operations','web_sessions','web_materials'])bytes[table]=Number(db.prepare(`SELECT COALESCE(SUM(length(CAST(data AS BLOB))),0) bytes FROM ${table}`).get().bytes);
  const operationRows=db.prepare('SELECT data FROM web_operations ORDER BY rowid').all().map((r:any)=>String(r.data)),session=originalParse(String(db.prepare('SELECT data FROM web_sessions').get().data)),materials=db.prepare("SELECT json_extract(data,'$.material') material FROM web_materials ORDER BY rowid").all().map((r:any)=>originalParse(String(r.material)));
  return {mode,pages,bodyCharacters:pages*100000,elapsedMs,...fresh,recovery,bytes,envelopeCharacters,envelopeHashes,materialHashes:materials.map((m:any)=>hash(m.body)),materialLengths:materials.map((m:any)=>m.body.length),counters:session.counters,providerCalls,modelCalls,operationBodyFields:operationRows.reduce((n:number,r:string)=>n+(r.match(/"body":/g)?.length??0),0),checkpointBodyFields:(originalStringify(session.checkpoint.toolResults).match(/"body":/g)??[]).length};
 }finally{db.close();}
}
async function main(){
 const output=resolve(process.argv[2]??'docs/v0.5/records/comprehensive-remediation-20261011/evidence/web-payload-cost.json');
 const identity=sourceIdentity(),sourceRevision=identity.baselineSourceRevision,runs=[];
 for(const pages of [1,5,10,20]){for(const mode of ['baseline','current'] as const)await measureWebPayloads(pages,mode);for(let repetition=0;repetition<7;repetition++)for(const mode of ['baseline','current'] as const){const result=await measureWebPayloads(pages,mode);runs.push({repetition,...result});console.log(`${mode} pages=${pages} repetition=${repetition+1} ms=${result.elapsedMs.toFixed(1)} parsedBodyChars=${result.bodyParseCharacters}`);}}
 for(const pages of [1,5,10,20]){const samples=runs.filter(r=>r.pages===pages),reference=samples[0];for(const row of samples)for(const key of ['envelopeHashes','materialHashes','counters','providerCalls','modelCalls'] as const)if(JSON.stringify(row[key])!==JSON.stringify(reference[key]))throw Error(`semantic mismatch pages=${pages} ${key}`);}
 mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({baselineSourceRevision:sourceRevision,baselineSource:resolve('.tmp/comprehensive-remediation-baseline'),baselineCompiled:resolve('.tmp/comprehensive-remediation-baseline-build'),identity,fixture:'1/5/10/20 pages; each 100000 ASCII characters including unique marker; sequential reads then final; default 20/40 budgets',warmupsPerModeAndSize:1,repetitions:7,semanticEquivalence:true,units:{characters:'JavaScript UTF-16 code units',bytes:'SQLite UTF-8 data bytes',elapsedMs:'wall clock, runModel fresh loop only'},runs},null,2));console.log(output);
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(__filename))main().catch(error=>{console.error(error);process.exitCode=1;});
