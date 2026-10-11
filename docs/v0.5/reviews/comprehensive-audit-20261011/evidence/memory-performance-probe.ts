import { writeFileSync } from 'node:fs';
import { Storage } from '../../../../../src/storage';
import { MemoryStore } from '../../../../../src/memory/store';
import { MemoryCapacity } from '../../../../../src/memory/capacity';
import { MemoryCleanup } from '../../../../../src/memory/cleanup';
import { MemoryIndex } from '../../../../../src/memory/index';
import { MemoryRetrieval, makeRetrievalRequest } from '../../../../../src/memory/retrieval';
import { defaultMemoryCapacity } from '../../../../../src/memory/types';
import { lexicalCoverage } from '../../../../../src/memory/lexical';

// Offline review evidence only. No deployment configuration, network, or real DB.
const at='2026-10-11T00:00:00.000Z';
const later=(days:number)=>new Date(Date.parse(at)+days*86400000).toISOString();
const median=(values:number[])=>[...values].sort((a,b)=>a-b)[Math.floor(values.length/2)];
function sample(fn:()=>void){fn();const values:number[]=[];for(let i=0;i<7;i++){const start=performance.now();fn();values.push(performance.now()-start);}return {medianMs:median(values),samplesMs:values};}
async function main(){
 const cases=[];
 for(const textCharacters of [128,4096]){
  const db=new Storage(':memory:'),store=new MemoryStore(db),capacity=new MemoryCapacity(store,defaultMemoryCapacity),cleanup=new MemoryCleanup(store,capacity);
  const index=new MemoryIndex(store,{model:'offline',baseUrl:'https://offline.invalid',dimensions:1024,embed:async()=>{throw Error('unexpected remote request');}});
  const text='记忆内容'.repeat(Math.ceil(textCharacters/4)).slice(0,textCharacters);
  db.transaction(()=>{
   for(let i=0;i<1000;i++){
    const row=store.makeOwner({ownerType:'long',ownerId:`long-${i}`},{content:text,retainedFrom:at,expiresAt:later(90)},at);
    store.saveOwner(row);store.saveVector(row,index.configSignature,new Float32Array(1024).fill(1/32));
   }
   for(let i=0;i<100;i++)store.saveOwner(store.makeOwner({ownerType:'short',ownerId:`short-${i}`},{content:text,linkedLongId:`long-${i}`,shortExpiresAt:later(7)},at));
   for(let i=0;i<500;i++)store.saveOwner(store.makeOwner({ownerType:'long',ownerId:`archive-${i}`},{content:text,retainedFrom:later(-100),expiresAt:later(-1)},later(-100)));
  });
  let fullOwnerCalls=0,hydratedOwnerRows=0,sqlCalls=0;
  const all=store.allOwners.bind(store);store.allOwners=()=>{fullOwnerCalls++;const rows=all();hydratedOwnerRows+=rows.length;return rows;};
  const prepare=db.prepare.bind(db);db.prepare=(sql:string)=>{sqlCalls++;return prepare(sql);};
  const reset=()=>{fullOwnerCalls=0;hydratedOwnerRows=0;sqlCalls=0;};
  reset();const result=capacity.normalize(at);const normalizeWork={fullOwnerCalls,hydratedOwnerRows,sqlCalls,changedOwners:result.changedOwners.length};
  const normalizeTiming=sample(()=>{capacity.normalize(at);});
  const cleanupTiming=sample(()=>{cleanup.nextDeadline(at);});
  const retrieval=new MemoryRetrieval(store,index),request=makeRetrievalRequest('完全无关的检索问题',at,'personal_chat');
  const selected=store.selectCandidates(request);
  const vectorBytes=selected.reduce((n,r)=>n+(r.normalizedVector?.byteLength??0),0);
  const start=performance.now();await retrieval.build(request,{includeRecent:false});const retrievalMs=performance.now()-start;
  cases.push({textCharacters,pools:{short:100,long:1000,archive:500},normalizeWork,normalizeTiming,cleanupNextDeadline:cleanupTiming,uncalibratedRetrieval:{selectedCandidateCount:selected.length,hydratedVectorBytes:vectorBytes,elapsedMs:retrievalMs,semanticSkipReason:retrieval.metrics.semanticSkipReason,remoteRequests:index.stats.remoteRequests}});
  // Only one synthetic item over capacity. Count DB reads made in a sort comparator.
  const extra=store.makeOwner({ownerType:'long',ownerId:'overflow'},{content:'extra',retainedFrom:at,expiresAt:later(90)},at);store.saveOwner(extra);
  let awakeningQueries=0;const list=store.listAwakenings.bind(store);store.listAwakenings=id=>{awakeningQueries++;return list(id);};
  reset();const overflowStart=performance.now(),overflow=capacity.normalize(at);
  Object.assign(cases.at(-1)!,{singleLongOverflow:{elapsedMs:performance.now()-overflowStart,awakeningQueries,sqlCalls,changedOwners:overflow.changedOwners.length}});
  db.close();
 }
 const content='生日礼物是自己做的卡片';
 const lexicalExamples=['生日礼物','还记得那次生日礼物吗','你还记得我送你的生日礼物吗','我送你的贺卡还留着吗'].map(query=>({query,content,score:lexicalCoverage(query,content),selectedAtDefaultThreshold:lexicalCoverage(query,content)>=1}));
 const report={baseline:'ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c',runtime:process.version,method:'In-memory SQLite; synthetic data; 1 warmup + 7 timed runs. No implementation replacement; timings describe current code only. Pool text is synthetic; real data/model latency not measured.',cases,lexicalExamples};
 writeFileSync('docs/v0.5/reviews/comprehensive-audit-20261011/evidence/memory-performance.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}
void main();
