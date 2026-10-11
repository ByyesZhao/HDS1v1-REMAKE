import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {Socket} from 'node:net';
import {Storage} from '../src/storage';
import {MemoryStore} from '../src/memory/store';
import {MemoryCapacity} from '../src/memory/capacity';
import {MemoryCleanup} from '../src/memory/cleanup';
import {MemoryIndex} from '../src/memory/index';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
import {defaultMemoryCapacity} from '../src/memory/types';
import {freezeEnvironmentRetrieval} from '../src/environment/snapshot';
import {WebSearchStore} from '../src/web/store';
import {defaultConfig,initialCharacter} from '../src/config';

const currentApi={Storage,MemoryStore,MemoryCapacity,MemoryCleanup,MemoryIndex,MemoryRetrieval,makeRetrievalRequest,defaultMemoryCapacity,freezeEnvironmentRetrieval,WebSearchStore,defaultConfig,initialCharacter};
const NOW='2026-10-08T02:00:00.000Z',days=(n:number)=>new Date(Date.parse(NOW)+n*86400000).toISOString();
const scenarios=['normalize','normalize_overflow','next_deadline','build_uncalibrated','freeze_uncalibrated','build_calibrated'] as const;
type Scenario=typeof scenarios[number];
export interface MemoryAccessWork {snapshotLoads:number;metadataRows:number;fullOwnerRows:number;awakeningQueries:number;awakeningRows:number;awakeningParameters:number;vectorBytes:number;ownerWrites:number;grantWrites:number;dirtyWrites:number;providerCalls:number;queryCalls:number;}
interface Sample {elapsedMs:number;work:MemoryAccessWork;snapshotBytes:number;outcome:unknown;}
interface ProbeIo {storagePaths:Set<string>;modelCalls:number;networkRequests:number;}
interface ProbeCase {scenario:Scenario;textCharacters:number;pools:{shorts:number;longs:number;archives:number};samples:Sample[];medianMs:number;work:MemoryAccessWork;vectorBytes:number;snapshotBytes:number;}
export interface MemoryAccessProbeReport {head:string;sourceRoot:string;sourceHashes:Record<string,string>;probeHash:string;dirtyFiles:string[];nodeVersion:string;platform:string;fixtureSeed:string;warmups:number;samples:number;textCharacters:number[];storagePaths:string[];modelCalls:number;networkRequests:number;cases:ProbeCase[];}
const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
function apiFor(sourceRoot:string):typeof currentApi {
  if(sourceRoot===resolve('.'))return currentApi;
  const module=(file:string)=>require(join(sourceRoot,'src',file+'.ts'));
  return {...module('storage'),...module('memory/store'),...module('memory/capacity'),...module('memory/cleanup'),...module('memory/index'),...module('memory/retrieval'),...module('memory/types'),...module('environment/snapshot'),...module('web/store'),...module('config')};
}
function instrument(storage:Storage){
  const work:MemoryAccessWork={snapshotLoads:0,metadataRows:0,fullOwnerRows:0,awakeningQueries:0,awakeningRows:0,awakeningParameters:0,vectorBytes:0,ownerWrites:0,grantWrites:0,dirtyWrites:0,providerCalls:0,queryCalls:0};
  const prepare=storage.prepare;
  storage.prepare=function(sql:string){
    const statement=prepare.call(this,sql),normalized=sql.trim();
    return new Proxy(statement,{get(target,key){const member=Reflect.get(target,key,target);if(typeof member!=='function')return member;
      return (...args:unknown[])=>{
        const result=Reflect.apply(member,target,args),rows:Record<string,unknown>[]=key==='all'?result as Record<string,unknown>[]:key==='get'&&result?[result as Record<string,unknown>]:[];
        if((key==='all'||key==='get')&&/^SELECT name FROM sqlite_master/.test(normalized))work.snapshotLoads++;
        if(normalized.includes('AS hasContent FROM'))work.metadataRows+=rows.length;
        if(/^SELECT data FROM (memories|details|learned_background)\b/.test(normalized)||/^WITH owners AS/.test(normalized))work.fullOwnerRows+=rows.length;
        if((key==='all'||key==='get')&&/\bFROM memory_awakenings\b/.test(normalized)){work.awakeningQueries++;work.awakeningRows+=rows.length;work.awakeningParameters+=args.length;}
        for(const row of rows)if(row.vector instanceof Uint8Array)work.vectorBytes+=row.vector.byteLength;
        if(key==='run'&&/^(INSERT|UPDATE|DELETE)/.test(normalized)){
          if(/^(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM) (memories|details|learned_background)\b/.test(normalized))work.ownerWrites++;
          if(/^(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM) memory_retention_grants\b/.test(normalized))work.grantWrites++;
          if(/^(?:INSERT(?: OR \w+)? INTO|UPDATE|DELETE FROM) memory_dirty_owners\b/.test(normalized))work.dirtyWrites++;
        }
        return result;
      };
    }});
  };
  return {work,restore(){storage.prepare=prepare;}};
}
async function sample(api:typeof currentApi,scenario:Scenario,textCharacters:number,io:ProbeIo):Promise<Sample>{
  const storagePath=':memory:';io.storagePaths.add(storagePath);
  const storage=new api.Storage(storagePath);let meter:ReturnType<typeof instrument>|undefined;
  try{
    const store=new api.MemoryStore(storage);storage.set('memory_schema_version',3);storage.set('character',api.initialCharacter(NOW));new api.WebSearchStore(storage);
    const policy=scenario==='normalize'||scenario==='normalize_overflow'||scenario==='next_deadline',extra=scenario==='normalize_overflow';
    const content='手机'+ 'x'.repeat(textCharacters-2),vector=Float32Array.from([1,...Array(1023).fill(0)]);
    let providerCalls=0;
    const index=new api.MemoryIndex(store,{model:'offline-memory-probe',baseUrl:'https://offline.invalid',dimensions:1024,embed:async()=>{providerCalls++;return Array.from(vector);}},{clock:{now:()=>NOW}});
    storage.transaction(()=>{
      for(let i=0;i<1000+Number(extra);i++){
        const row=store.makeOwner({ownerType:'long',ownerId:`l-${String(i).padStart(4,'0')}`},{content,topics:['手机'],retainedFrom:NOW,expiresAt:days(90)},NOW);store.saveOwner(row);if(!policy)store.saveVector(row,index.configSignature,vector);
      }
      if(policy){
        for(let i=0;i<100;i++)store.saveOwner(store.makeOwner({ownerType:'short',ownerId:`s-${i}`},{content,linkedLongId:`l-${String(i).padStart(4,'0')}`,shortExpiresAt:days(7)},NOW));
        for(let i=0;i<500;i++)store.saveOwner(store.makeOwner({ownerType:'long',ownerId:`a-${i}`},{content,retainedFrom:days(-180),expiresAt:days(-89),archiveEnteredAt:days(-89)},days(-180)));
      }
    });
    const capacity=new api.MemoryCapacity(store,api.defaultMemoryCapacity),cleanup=new api.MemoryCleanup(store,capacity);
    const calibration={lexical:{fact:1,experience:1},semantic:scenario==='build_calibrated'?{fact:.7,experience:.7,configSignature:index.configSignature}:null};
    const retrieval=new api.MemoryRetrieval(store,index,{},calibration),request=api.makeRetrievalRequest('手机',NOW,'personal_chat');
    const d={storage,clock:{now:()=>NOW},config:{...api.defaultConfig,worldSetting:'手机'},memoryStore:store,retrieval,models:{runModel:()=>{io.modelCalls++;throw Error('model call forbidden in memory access probe');}}};
    meter=instrument(storage);let outcome:unknown,snapshotBytes=0;const started=performance.now();
    if(scenario==='normalize'||scenario==='normalize_overflow')outcome=capacity.normalize(NOW).changedOwners.map(r=>r.ownerId);
    else if(scenario==='next_deadline')outcome=cleanup.nextDeadline(NOW);
    else if(scenario==='freeze_uncalibrated'){
      const frozen=api.freezeEnvironmentRetrieval(d as any,'world',NOW);snapshotBytes=Buffer.byteLength(JSON.stringify(frozen));
      outcome={count:frozen.candidates.length,publicOwnersHash:hash(JSON.stringify(frozen.candidates.map(({normalizedVector,...row})=>row)))};
    }else{const result=await retrieval.build(request,{includeRecent:false});outcome={count:result.longTerm.length,contextHash:hash(JSON.stringify(result))};}
    const elapsedMs=performance.now()-started;meter.work.providerCalls=providerCalls;meter.work.queryCalls=index.stats.queries;
    return {elapsedMs,work:meter.work,snapshotBytes,outcome};
  }finally{meter?.restore();storage.close();}
}
export async function runMemoryAccessProbe(options:{sourceRoot?:string;scenarios?:Scenario[];textCharacters?:number[]}={}):Promise<MemoryAccessProbeReport>{
  const sourceRoot=resolve(options.sourceRoot??'.'),api=apiFor(sourceRoot),cases:ProbeCase[]=[],texts=options.textCharacters??[128,4096];
  const io:ProbeIo={storagePaths:new Set(),modelCalls:0,networkRequests:0};
  const originalFetch=globalThis.fetch,originalConnect=Socket.prototype.connect;
  const rejectNetwork=()=>{io.networkRequests++;throw Error('network forbidden in memory access probe');};globalThis.fetch=rejectNetwork;Socket.prototype.connect=rejectNetwork;
  const checkedSample=async(scenario:Scenario,textCharacters:number)=>{const result=await sample(api,scenario,textCharacters,io);if(io.networkRequests)throw Error(`memory access probe intercepted ${io.networkRequests} network attempt(s)`);if(io.modelCalls)throw Error(`memory access probe intercepted ${io.modelCalls} model call(s)`);return result;};
  try{
    for(const textCharacters of texts)for(const scenario of options.scenarios??scenarios){
      await checkedSample(scenario,textCharacters);const samples:Sample[]=[];for(let i=0;i<7;i++)samples.push(await checkedSample(scenario,textCharacters));
      const expected=JSON.stringify({work:samples[0].work,outcome:samples[0].outcome,snapshotBytes:samples[0].snapshotBytes});
      if(samples.some(s=>JSON.stringify({work:s.work,outcome:s.outcome,snapshotBytes:s.snapshotBytes})!==expected))throw Error('non-deterministic fixture work: '+scenario);
      const policy=scenario==='normalize'||scenario==='normalize_overflow'||scenario==='next_deadline';
      cases.push({scenario,textCharacters,pools:{shorts:policy?100:0,longs:1000+Number(scenario==='normalize_overflow'),archives:policy?500:0},samples,medianMs:samples.map(s=>s.elapsedMs).sort((a,b)=>a-b)[3],work:samples[0].work,vectorBytes:samples[0].work.vectorBytes,snapshotBytes:samples[0].snapshotBytes});
    }
  }finally{globalThis.fetch=originalFetch;Socket.prototype.connect=originalConnect;}
  const marker=join(sourceRoot,'source-revision.txt'),head=existsSync(marker)?readFileSync(marker,'utf8').trim():execFileSync('git',['rev-parse','HEAD'],{cwd:sourceRoot,encoding:'utf8'}).trim();
  const sourceHashes=Object.fromEntries((readdirSync(join(sourceRoot,'src'),{recursive:true}) as string[]).filter(file=>file.endsWith('.ts')).sort().map(file=>[file.replaceAll('\\','/'),hash(readFileSync(join(sourceRoot,'src',file)))]));
  return {head,sourceRoot,sourceHashes,probeHash:hash(readFileSync(__filename)),dirtyFiles:existsSync(marker)?[]:execFileSync('git',['status','--short'],{cwd:sourceRoot,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean),nodeVersion:process.version,platform:process.platform,fixtureSeed:'memory-access-v1',warmups:1,samples:7,textCharacters:texts,storagePaths:[...io.storagePaths],modelCalls:io.modelCalls,networkRequests:io.networkRequests,cases};
}
async function main(){
  const args=process.argv.slice(2),options:Record<string,string>={};
  for(let i=0;i<args.length;i+=2){const key=args[i];if(!['--output','--source-root'].includes(key)||options[key]||!args[i+1]||args[i+1].startsWith('--'))throw Error('Usage: check-memory-access-work --output <json> [--source-root <archived-source>]');options[key]=args[i+1];}
  if(!options['--output'])throw Error('explicit --output is required');
  const report=await runMemoryAccessProbe({sourceRoot:options['--source-root']}),output=resolve(options['--output']);mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,head:report.head,cases:report.cases.map(({scenario,textCharacters,medianMs,work,snapshotBytes})=>({scenario,textCharacters,medianMs,work,snapshotBytes}))}));
}
if(typeof require!=='undefined'&&require.main===module)void main().catch(error=>{console.error(error);process.exitCode=1;});
