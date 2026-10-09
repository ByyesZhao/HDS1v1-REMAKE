'use strict';
// Synthetic offline probes only. Never opens deployment configuration or formal DB.
const {mkdtempSync,mkdirSync,writeFileSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');const {resolve,join,dirname,basename,relative}=require('node:path');const {createHash}=require('node:crypto');
const {Storage}=require('../lib/storage');const {initialCharacter,defaultConfig}=require('../lib/config');
const {HdsiApp}=require('../lib/app');const {SerialHost}=require('../lib/host/runtime');
const {EnvironmentStore}=require('../lib/environment/store');const {SchoolStore}=require('../lib/school/store');
const {checkWindowConsistency}=require('../lib/dialogue/window-consistency');
const {WebSearchStore}=require('../lib/web/store');const {WebSearchService}=require('../lib/web/service');
const now='2026-10-09T02:00:00Z',options={idleMinutes:15,recentSegments:4};
function outputDirectory(args=process.argv,cwd=process.cwd()){
 const flag=args.indexOf('--output'),output=resolve(cwd,flag>=0?args[flag+1]:'runtime/astra-fixes-acceptance-20261009');
 if(relative(cwd,output).startsWith('..'))throw Error('output must remain under this project');
 return output;
}
const median=a=>[...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
function fixture(root){
 const storage=new Storage(join(root,'synthetic.sqlite'));storage.set('character',initialCharacter(now));
 storage.set('runtime',{...storage.runtime(),paused:true,nextMaintenanceAt:null,nextEnvironmentAt:'2099-01-01T00:00:00Z'});
 const clock={now:()=>now},web=new WebSearchService(new WebSearchStore(storage),undefined,clock);
 const d={storage,clock,web,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),models:{runModel:()=>{throw Error('benchmark must not call model');}},config:{...defaultConfig,background:'synthetic'},random:{next:()=>0.5},sender:{sendItem:()=>{throw Error('benchmark must not send');}},wait:async()=>{}};
 return {...d,host:new SerialHost(new HdsiApp(d),{timers:false,onError:e=>{throw e;}})};
}
async function measure(s,fn){
 const parse=JSON.parse,prepare=s.db.prepare;let queries=0,decoded=0,returnedDataRows=0;
 JSON.parse=function(...args){decoded++;return parse.apply(this,args);};
 s.db.prepare=function(...args){queries++;const stmt=prepare.apply(this,args);return new Proxy(stmt,{get(target,key){
 const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
 return function(...args){const result=value.apply(target,args);if(key==='get'||key==='all'){const rows=Array.isArray(result)?result:[result];returnedDataRows+=rows.filter(r=>r&&Object.hasOwn(r,'data')).length;}return result;};
 }});};
 const start=performance.now();try{const value=await fn();return {ms:performance.now()-start,queries,decoded,returnedDataRows,value};}finally{JSON.parse=parse;s.db.prepare=prepare;}
}
function cleanup(root){const target=resolve(root);if(dirname(target)!==resolve(tmpdir())||!basename(target).startsWith('hdsi-astra-bench-'))throw Error('unexpected temp target');rmSync(target,{recursive:true,force:true});}
async function dialogue(n){
 const root=mkdtempSync(join(tmpdir(),'hdsi-astra-bench-')),d=fixture(root),s=d.storage;
 try{
 s.transaction(()=>{for(let i=0;i<n;i++){
 const id='history'+i,at='2020-01-01T00:00:00Z';s.save('turns','t'+i,{id:'t'+i,done:true});
 s.save('chat_episodes','c'+i,{id:'c'+i,openedAt:at,lastInteractionAt:at,status:'closed',closedAt:at,closeReason:'idle'});
 s.save('messages',id,{id,content:'synthetic read history',receivedAt:at,direction:'incoming',platformMessageIds:[],batchId:null,seenTurnId:'t'+i,turnId:null,outboxSeq:null,sharedActivityId:null,chatEpisodeId:'c'+i});}});
 const samples=[],reads=[];await d.host.start();
 for(let i=0;i<6;i++){
 const count={},all=s.all.bind(s);s.all=table=>{count[table]=(count[table]??0)+1;return all(table);};
 const full=await measure(s,()=>checkWindowConsistency(s,options));s.all=all;if(full.value.blockingIssues.length)throw Error('synthetic full audit failed');
 // Restore the exact valid synthetic baseline outside the timed sample.
 const prior=s.runtime().activeChatEpisodeId;s.remove('messages','probe');if(prior)s.remove('chat_episodes',prior);
 s.set('runtime',{...s.runtime(),activeChatEpisodeId:null,openBatch:null,pendingBatchIds:[]});
 const active=await measure(s,async()=>{await d.host.acceptInput({id:'probe',receivedAt:now,content:'new synthetic input'});await d.host.wake();});
 if(i){samples.push({full:{...full,value:undefined},active:{...active,value:undefined}});reads.push(count);}
 }
 for(const r of reads)if(r.messages!==1||r.turns!==1||r.chat_episodes!==1)throw Error('full audit did not read each table once');
 return {size:n,samples,fullReads:reads,medianMs:{full:median(samples.map(r=>r.full.ms)),active:median(samples.map(r=>r.active.ms))},
 queryPlans:[
 ["unfinished","SELECT data FROM turns WHERE COALESCE(json_extract(data,'$.done'),0)=0 AND COALESCE(json_extract(data,'$.legacyDisposition'),'')!='superseded' ORDER BY rowid"],
 ["unread","SELECT data FROM messages WHERE json_extract(data,'$.direction')='incoming' AND json_type(data,'$.seenTurnId')='null' AND json_extract(data,'$.seenTurnId') IS NULL ORDER BY rowid"],
 ["chat","SELECT data FROM messages WHERE json_extract(data,'$.chatEpisodeId')='probe' ORDER BY rowid"],
 ["activity","SELECT data FROM messages WHERE json_extract(data,'$.sharedActivityId')='synthetic' ORDER BY rowid"],
 ["open","SELECT data FROM chat_episodes WHERE json_extract(data,'$.status')='open' ORDER BY rowid"]
 ].map(([name,sql])=>({name,sql,plan:s.prepare('EXPLAIN QUERY PLAN '+sql).all()}))};
 }finally{await d.host.stop();s.close();cleanup(root);}
}
async function status(n){
 const root=mkdtempSync(join(tmpdir(),'hdsi-astra-bench-')),d=fixture(root),s=d.storage;
 try{
 for(let i=0;i<n;i++)for(let stage=0;stage<4;stage++)d.web.store.openStage('turn',i?'owner'+i:'active','stage'+stage,'task');
 const hash=()=>createHash('sha256').update(JSON.stringify(s.prepare('SELECT data FROM web_sessions ORDER BY rowid').all())).digest('hex'),before=hash(),samples=[];
 // Fixed current owner, independent of history length.
 s.save('turns','active',{id:'active',done:false,inputMessageIds:[],dialogueWindowVersion:2,chatBinding:{episodeId:null,holdReply:false}});
 for(let i=0;i<6;i++){const result=await measure(s,()=>d.host.status());const chars=result.value.slice(result.value.indexOf('；网页')).length;if(chars>2048)throw Error('web status exceeded display limit');if(i)samples.push({...result,value:undefined,webCharacters:chars});}
 const summary=d.web.statusSummary([{ownerType:'turn',ownerId:'active'}]);if(summary.totals.sessions!==4*n)throw Error('wrong session total');
 const after=hash();if(before!==after)throw Error('status mutated raw sessions');
 return {size:n,samples,medianMs:median(samples.map(r=>r.ms)),summary,rawHash:before,rawUnchanged:true};
 }finally{await d.host.stop();s.close();cleanup(root);}
}
async function main(){
 const output=outputDirectory();mkdirSync(output,{recursive:true});
 const report={node:process.version,platform:process.platform,createdAt:new Date().toISOString(),scope:'offline synthetic; no model/QQ/formal DB',dialogue:[],status:[]};
 for(const n of [1000,10000,50000])report.dialogue.push(await dialogue(n));
 const costs=report.dialogue.flatMap(r=>r.samples.map(s=>[s.active.queries,s.active.decoded,s.active.returnedDataRows].join(':')));if(new Set(costs).size!==1)throw Error('fixed working set input cost grew with historical rows');
 for(const n of [10,100,1000])report.status.push(await status(n));
 if(report.status[2].samples[0].webCharacters-report.status[0].samples[0].webCharacters>64)throw Error('web status growth exceeded 64 characters');
 writeFileSync(join(output,'benchmark.json'),JSON.stringify(report,null,2));
 console.log(JSON.stringify({dialogue:report.dialogue.map(r=>({size:r.size,medianMs:r.medianMs,cost:r.samples[0].active})),status:report.status.map(r=>({size:r.size,medianMs:r.medianMs,chars:r.samples[0].webCharacters})),output},null,2));
}
module.exports={outputDirectory};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
