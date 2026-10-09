// Offline audit probe: synthetic in-memory data only. Run after npm run build.
const { performance } = require('node:perf_hooks');
const { Storage } = require('../../../../lib/storage');
const { checkWindowConsistency } = require('../../../../lib/dialogue/window-consistency');
const { WebSearchStore } = require('../../../../lib/web/store');
const { WebSearchService } = require('../../../../lib/web/service');
const { initialCharacter, defaultConfig } = require('../../../../lib/config');
const { HdsiApp } = require('../../../../lib/app');
const { SerialHost } = require('../../../../lib/host/runtime');
const { EnvironmentStore } = require('../../../../lib/environment/store');
const { SchoolStore } = require('../../../../lib/school/store');
const NOW = '2026-10-09T02:00:00.000Z';
const median = a => [...a].sort((x,y)=>x-y)[Math.floor(a.length/2)];
async function historyProbe(n) {
  const s = new Storage(':memory:');
  s.set('character', initialCharacter(NOW));
  s.set('runtime', {...s.runtime(), paused:true, nextEnvironmentAt:'2026-10-10T06:00:00+08:00'});
  s.transaction(()=>{
    for(let i=0;i<n;i++) {
      const at = new Date(Date.parse(NOW)-(n-i)*60000).toISOString();
      const episodeId=`e:${Math.floor(i/20)}`;
      if(i%20===0)s.save('chat_episodes',episodeId,{id:episodeId,openedAt:at,lastInteractionAt:at,status:'closed',closedAt:at,closeReason:'idle'});
      s.save('messages',`m:${i}`,{id:`m:${i}`,direction:'outgoing',receivedAt:at,content:'合成历史消息。'.repeat(12),platformMessageIds:[],batchId:null,seenTurnId:null,turnId:`t:${i}`,outboxSeq:0,sharedActivityId:null,chatEpisodeId:episodeId});
      s.save('turns',`t:${i}`,{id:`t:${i}`,at,inputMessageIds:[],triggerTaskIds:[],triggerKinds:[],completedAt:at,frozenResult:null,outputComplete:true,done:true,dialogueWindowVersion:2});
    }
  });
  let loads={};const original=s.all.bind(s);s.all=(table)=>{const rows=original(table);loads[table]={calls:(loads[table]?.calls??0)+1,rows:(loads[table]?.rows??0)+rows.length};return rows;};
  const opts={idleMinutes:15,recentSegments:4};
  const report=checkWindowConsistency(s,opts), decoded=loads;
  if(report.blockingIssues.length)throw Error(JSON.stringify(report.blockingIssues));
  s.all=original;
  const samples=[];
  for(let i=0;i<5;i++){const start=performance.now();checkWindowConsistency(s,opts);samples.push(performance.now()-start);}
  s.close();return {historicalMessages:n,historicalTurns:n,medianCheckMs:+median(samples).toFixed(2),decoded};
}
async function statusProbe(turns) {
  const s=new Storage(':memory:');s.set('character',initialCharacter(NOW));
  s.set('runtime',{...s.runtime(),paused:true,nextEnvironmentAt:'2026-10-10T06:00:00+08:00'});
  const store=new WebSearchStore(s),web=new WebSearchService(store,undefined,{now:()=>NOW},{enabled:false});
  s.transaction(()=>{for(let i=0;i<turns;i++)for(const task of ['narrative','personal_chat','expression','memory'])store.openStage('turn',`completed-turn:${i}`,task,task);});
  const app=new HdsiApp({storage:s,clock:{now:()=>NOW},random:{next:()=>0.5},config:defaultConfig,web,environmentStore:new EnvironmentStore(s),schoolStore:new SchoolStore(s),models:{runModel:()=>{throw Error('must stay offline');}},sender:{sendItem:()=>{throw Error('must not send');},sendError:()=>{throw Error('must not send');}},wait:async()=>{}});
  const host=new SerialHost(app,{timers:false}),start=performance.now(),status=await host.status();
  const result={completedTurns:turns,searchEnabled:false,sessionCount:web.status().sessions.length,statusCharacters:status.length,statusMs:+(performance.now()-start).toFixed(2)};
  await host.stop();s.close();return result;
}
(async()=>{const history=[];for(const n of [1000,10000,50000])history.push(await historyProbe(n));const status=[];for(const n of [10,100,1000])status.push(await statusProbe(n));console.log(JSON.stringify({node:process.version,history,status},null,2));})().catch(error=>{console.error(error);process.exitCode=1;});

