const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {Storage} = require('../../../../lib/storage');
const {ChatEpisodes} = require('../../../../lib/dialogue/chat-episodes');
const {DialogueStore} = require('../../../../lib/dialogue/store');
const {recentFromSnapshot} = require('../../../../lib/dialogue/chat-window');
const {MemoryStore} = require('../../../../lib/memory/store');
const {MemoryRetrieval, makeRetrievalRequest} = require('../../../../lib/memory/retrieval');
const {ContextBuilder} = require('../../../../lib/memory/context');
const {captureQueries, plans} = require('../../../../scripts/query-probe.cjs');
const now = '2030-01-01T00:00:00Z';
const iso = n => new Date(Date.UTC(2026,0,1)+n).toISOString();
const episode = (s,id,t) => s.save('chat_episodes',id,{id,openedAt:t,lastInteractionAt:t,status:'closed',closedAt:t,closeReason:'idle'});
const message = (id,e,t) => ({id,chatEpisodeId:e,sharedActivityId:null,content:'正文'+id,receivedAt:t,direction:'outgoing',seenTurnId:null,turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[]});
const summarize = q => ({queries:q.length,rows:q.reduce((n,x)=>n+x.rows,0),jsonRows:q.reduce((n,x)=>n+x.jsonRows,0),writes:q.reduce((n,x)=>n+x.writes,0)});
async function scale() {
 const results=[];
 for(const H of [1000,10000,50000]){
  const s=new Storage(':memory:');
  try {
   s.transaction(()=>{
    for(let i=0;i<H+4;i++){
     const id='e'+i,t=iso(i*1200000);episode(s,id,t);
     for(let j=0;j<(i>=H?41:1);j++){const m=id+':'+j;s.save('messages',m,message(m,id,t));}
    }
    episode(s,'source',iso(-1200000));s.save('messages','source-message',message('source-message','source',iso(-1200000)));
   });
   const store=new MemoryStore(s);store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'phone'},{key:'phone',content:'phone owner',value:'phone owner',sourceIds:['source-message']},now));
   const b=new ContextBuilder(s,new MemoryRetrieval(store));
   const q=makeRetrievalRequest('phone',now,'memory');q.dialogueWindowVersion=2;
   let snapshots=0;const original=s.recentChatSnapshot.bind(s);s.recentChatSnapshot=x=>{snapshots++;return original(x);};
   const build=await captureQueries(s,()=>b.buildForMemory(q));
   const lookup=await captureQueries(s,()=>b.lookupForMemory('phone',q));
   assert.equal(snapshots,0);assert.equal(build.value.details.length,1);assert.deepEqual(lookup.value,build.value);
   for(const found of [build,lookup]){
    assert.equal(found.queries.some(x=>/^SELECT data FROM (messages|chat_episodes) ORDER BY rowid$/.test(x.sql)),false);
    assert.equal(found.queries.reduce((n,x)=>n+x.writes,0),0);
   }
   const recent=captureQueries(s,()=>new ChatEpisodes(new DialogueStore(s)).recent('narrative',now,4));
   assert.equal(recent.value.messages.length,164);
   const visible=captureQueries(s,()=>s.recentChatSnapshot({eligibility:'with_visible_inputs',count:4,visibleIds:['source-message','source-message']}));
   const detail={H,memoryBuild:summarize(build.queries),memoryLookup:summarize(lookup.queries),recentWindow:summarize(recent.queries.slice(0,3)),recentGate:summarize(recent.queries.slice(3)),recentAll:summarize(recent.queries),visibleRankPlan:plans(s,visible.queries)[0].plan,memoryQueries:build.queries,recentQueries:recent.queries};
   results.push(detail);process.stdout.write(JSON.stringify({H,memoryBuild:detail.memoryBuild,memoryLookup:detail.memoryLookup,recentWindow:detail.recentWindow,recentGate:detail.recentGate})+'\n');
  }finally{s.close();}
 }
 for(const key of ['memoryBuild','memoryLookup','recentWindow','recentGate','recentAll'])for(const row of results)assert.deepEqual(row[key],results[0][key]);
 return results;
}
function fuzz(){
 let seed=764123;const rand=n=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%n;};
 const times=['2026-10-07T10:00:00+08:00','2026-10-07T02:00:00Z','2026-10-07T02:00:00.001Z','2026-10-07T10:00:00.010+08:00','2026-10-07T02:00:00.0009Z','2026-10-07T03:00:00Z','2026-10-07T11:30:00+09:00'];
 let comparisons=0;
 for(let iteration=0;iteration<160;iteration++){
  const s=new Storage(':memory:');
  try{
   const ids=['a','z','\uE000','\u{10000}','e','g','h','i'];
   for(const id of ids)episode(s,id,times[rand(times.length)]);
   const visible=[];
   for(let i=0;i<65;i++){
    const id='m'+i,m=message(id,ids[rand(ids.length)],times[rand(times.length)]);
    m.direction=rand(2)?'incoming':'outgoing';m.seenTurnId=rand(3)?'seen':null;m.turnId=rand(3)?'t':'other';m.outboxSeq=rand(3)?rand(4):null;
    if(rand(4)===0)delete m.seenTurnId;
    if(rand(8)===0)m.sharedActivityId='activity';
    if(rand(5)===0)visible.push(id,id);
    s.save('messages',id,m);
   }
   for(const count of [1,4,6,0,-1,1.5])for(const eligibility of ['ordinary_narrative','with_visible_inputs']){
    const options={count,eligibility,visibleIds:new Set(visible)};
    const oracle=recentFromSnapshot({messages:s.messages(),episodes:s.all('chat_episodes')},options);
    const actual=recentFromSnapshot(s.recentChatSnapshot({count,eligibility,visibleIds:visible}),options);
    assert.deepEqual(actual,oracle,'SQL/oracle mismatch iteration='+iteration+' count='+count+' eligibility='+eligibility);comparisons++;
   }
  }finally{s.close();}
 }
 return {seed:764123,iterations:160,comparisons};
}
(async()=>{const result={scope:'offline synthetic memory databases; extra post-review evidence',node:process.version,fuzz:fuzz(),scale:await scale()};fs.writeFileSync(path.join(__dirname,'context-probe.json'),JSON.stringify(result,null,2));process.stdout.write(JSON.stringify({fuzz:result.fuzz,status:'passed'})+'\n');})().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1;});
