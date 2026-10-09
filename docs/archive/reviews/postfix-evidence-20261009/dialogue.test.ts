import {expect,it} from 'vitest';
import {Storage,isUnfinishedTurn} from '../../../../src/storage';
import {recentFromSnapshot} from '../../../../src/dialogue/chat-window';
import {assertFullWindow,checkActiveWindowConsistency} from '../../../../src/dialogue/active-consistency';
import {checkWindowConsistency} from '../../../../src/dialogue/window-consistency';
import {InputBuffer} from '../../../../src/host/input';
import {MemoryStore} from '../../../../src/memory/store';
import {MemoryRetrieval,makeRetrievalRequest} from '../../../../src/memory/retrieval';
import {modern} from '../../../../tests/chat-fixture';
import {NOW} from '../../../../tests/helpers';
import type {Message} from '../../../../src/types';

const options={idleMinutes:15,recentSegments:4};
const scope={touchedMessageIds:[],requiredMessageIds:[],sourceIds:[],touchedEpisodeIds:[]};
const literal=(a:string,b:string)=>a<b?-1:a>b?1:0;
const message=(id:string,changes:Partial<Message>={}):Message=>({id,content:id,receivedAt:NOW,direction:'incoming',platformMessageIds:[],seenTurnId:null,turnId:null,batchId:null,outboxSeq:null,sharedActivityId:null,...changes});

// Independent copy of the pre-fix selection algorithm (73774bf), not a call to the new helper.
function oldRecent(storage:Storage,phase:string,count:number,visibleIds:string[]){
 const allowed=new Set(phase==='narrative'?[]:visibleIds),messages=storage.messages().filter(m=>!m.sharedActivityId&&!!m.chatEpisodeId&&(m.direction==='outgoing'||m.seenTurnId!==null||allowed.has(m.id)));
 const ranks=new Map<string,number>();for(const m of messages)ranks.set(m.chatEpisodeId!,Math.max(ranks.get(m.chatEpisodeId!)??-Infinity,Date.parse(m.receivedAt)));
 const episodeIds=storage.all('chat_episodes').filter(e=>ranks.has(e.id)).sort((a,b)=>ranks.get(a.id)!-ranks.get(b.id)!||Date.parse(a.openedAt)-Date.parse(b.openedAt)||literal(a.id,b.id)).slice(-count).map(e=>e.id),order=new Map(episodeIds.map((id,i)=>[id,i]));
 return {episodeIds,messages:messages.filter(m=>order.has(m.chatEpisodeId!)).sort((a,b)=>order.get(a.chatEpisodeId!)!-order.get(b.chatEpisodeId!)!||Date.parse(a.receivedAt)-Date.parse(b.receivedAt)||(a.turnId===b.turnId&&a.outboxSeq!==null&&b.outboxSeq!==null?a.outboxSeq-b.outboxSeq:literal(a.id,b.id)))};
}

it('independent SQL oracle: chunked ids, exact null/missing, epoch ties and unfinished insertion order',()=>{
 const s=new Storage(':memory:');try{
  const times=['2026-10-07T10:00:00+08:00','2026-10-07T02:00:00Z','2026-10-06T21:00:00-05:00','2026-10-07T02:00:01Z'];
  for(let i=0;i<523;i++){
   const m:any=message('m'+i,{receivedAt:times[i%4],seenTurnId:i%3===0?'seen':null,batchId:i%5===0?'open':i%5===1?'old':null,sharedActivityId:i%7===0?'A':null,chatEpisodeId:'c'+i%3,turnId:'t'+i%4});
   if(i%17===0)delete m.seenTurnId;if(i%19===0)delete m.batchId;if(i%23===0)delete m.sharedActivityId;s.save('messages',m.id,m);
  }
  for(const t of [{id:'done',done:true},{id:'null',done:null},{id:'missing'},{id:'pending',done:false},{id:'superseded',done:false,legacyDisposition:'superseded'}])s.save('turns',t.id,t as any);
  expect(s.unfinishedTurns()).toEqual(s.all('turns').filter(isUnfinishedTurn));expect(s.unfinishedTurn()).toEqual(s.unfinishedTurns()[0]);
  const all=s.messages();expect(s.messagesByIds([...all.map(m=>m.id).reverse(),'m0','m1'])).toEqual(all);
  for(const openBatch of [null,{id:'open',readyAt:NOW}]){s.set('runtime',{...s.runtime(),openBatch});expect(s.unreadMessages()).toEqual(all.filter(m=>m.direction==='incoming'&&m.seenTurnId===null&&!(m.sharedActivityId&&m.batchId===null)&&m.batchId!==openBatch?.id));}
  expect(s.unseenIncomingMessages()).toEqual(all.filter(m=>m.direction==='incoming'&&m.seenTurnId===null));
  expect(s.unreadActivityMessages('A')).toEqual(all.filter(m=>m.direction==='incoming'&&m.seenTurnId===null&&m.batchId===null&&m.sharedActivityId==='A'));
  expect(s.messagesByTurn('t1')).toEqual(all.filter(m=>m.turnId==='t1'));
  expect(s.messagesByChatEpisode('c1')).toEqual(all.filter(m=>m.chatEpisodeId==='c1'));
 }finally{s.close();}
});

it('independent pre-fix recent oracle: all fields, offset ties, whole long episodes and two eligibility classes',()=>{
 const s=new Storage(':memory:');try{
  for(const id of ['z','A','a','b','old'])s.save('chat_episodes',id,{id,openedAt:NOW,lastInteractionAt:NOW,status:'closed',closedAt:NOW,closeReason:'idle'});
  const offsets=['2026-10-07T10:00:00+08:00','2026-10-07T02:00:00Z','2026-10-06T21:00:00-05:00'];
  for(let i=0;i<65;i++)s.save('messages','out'+i,message('out'+i,{chatEpisodeId:'a',direction:'outgoing',turnId:'T',outboxSeq:64-i,receivedAt:offsets[i%3]}));
  for(const [i,id] of ['z','A','b','old'].entries())s.save('messages',id,message(id,{chatEpisodeId:id,seenTurnId:id==='old'?null:'seen',receivedAt:i===3?'2026-10-07T03:00:00Z':offsets[i%3]}));
  s.save('messages','activity',message('activity',{chatEpisodeId:null,sharedActivityId:'activity',direction:'outgoing'}));
  for(const phase of ['narrative','personal','expression','memory','lookup'])for(const count of [1,2,4,6]){
   expect(recentFromSnapshot({messages:s.messages(),episodes:s.all('chat_episodes')},{eligibility:phase==='narrative'?'ordinary_narrative':'with_visible_inputs',count,visibleIds:new Set(['old'])})).toEqual(oldRecent(s,phase,count,['old']));
  }
 }finally{s.close();}
});

function seedWarning(d:ReturnType<typeof modern>){
 d.storage.save('dialogue_episodes','legacy',{id:'legacy',openedAt:'2020-01-01T00:00:00Z',lastInteractionAt:'2020-01-01T00:00:00Z',status:'closed',closedAt:'2020-01-01T00:15:00Z',closeReason:'idle'});
 d.storage.save('turns','legacy-done',{id:'legacy-done',done:true} as any);
 d.storage.save('messages','orphan',message('orphan',{receivedAt:'2020-01-01T00:00:00Z',seenTurnId:'legacy-done',dialogueEpisodeId:'legacy'}));
 for(let i=0;i<4;i++){
  const id='episode'+i,at=new Date(Date.parse(NOW)-i*20*60000).toISOString();
  d.storage.save('chat_episodes',id,{id,openedAt:at,lastInteractionAt:at,status:'closed',closedAt:at,closeReason:'idle'});
  d.storage.save('messages','good'+i,message('good'+i,{receivedAt:at,seenTurnId:'legacy-done',chatEpisodeId:id}));
 }
}

it('first InputBuffer input checks history once; routine inputs retain warning while keeping required sources protected',async()=>{
 const d=modern();try{
  seedWarning(d);const all=d.storage.all.bind(d.storage);let messagesScans=0;
  d.storage.all=((table:any)=>{if(table==='messages')messagesScans++;return all(table);}) as any;
  const input=new InputBuffer(d.storage);await input.acceptInput({id:'current',receivedAt:NOW,content:'hello'});expect(messagesScans).toBe(1);
  await input.acceptInput({id:'current2',receivedAt:NOW,content:'again'});expect(messagesScans).toBe(1);
  expect(checkWindowConsistency(d.storage,options).historicalWarnings).toContain('message orphan: missing chat association');
  expect(checkActiveWindowConsistency(d.storage,options,{...scope,sourceIds:['orphan']}).blockingIssues).toContain('message orphan: missing chat association');
  expect(checkActiveWindowConsistency(d.storage,options,{...scope,sourceIds:['experience-id','self-web-read-id']}).blockingIssues).toEqual([]);
 }finally{d.storage.close();}
});

it('lookup detail history promotes an old allowed warning back into protection at the consumption boundary',async()=>{
 const d=modern();try{
  seedWarning(d);const store=new MemoryStore(d.storage);
  store.saveOwner(store.makeOwner({ownerType:'detail',ownerId:'phone'},{content:'现在手机是B',sourceIds:['good0'],key:'phone',value:'B'},NOW));
  d.storage.save('detail_history','old-phone',{id:'old-phone',key:'phone',value:'A',sourceIds:['orphan']} as any);
  expect(assertFullWindow(d.storage,options).historicalWarnings).toHaveLength(1);
  const retrieval=new MemoryRetrieval(store);
  await expect(retrieval.build(makeRetrievalRequest('phone',NOW,'personal'))).resolves.toHaveProperty('detailHistory',[]);
  await expect(retrieval.build(makeRetrievalRequest('以前 phone',NOW,'personal'))).rejects.toThrow(/orphan/);
 }finally{d.storage.close();}
});

it('active query cannot silently skip a second unfinished turn with a frozen missing message',()=>{
 const d=modern();try{
  for(const id of ['first','second'])d.storage.save('turns',id,{id,at:NOW,done:false,inputMessageIds:[],outputComplete:true,dialogueWindowVersion:2,chatBinding:{episodeId:null,holdReply:false},frozenResult:{visibleMessageIds:id==='second'?['lost']:[],reconsiderMessageIds:[]}} as any);
  expect(checkActiveWindowConsistency(d.storage,options,scope).blockingIssues).toEqual(checkWindowConsistency(d.storage,options).blockingIssues);
  expect(checkActiveWindowConsistency(d.storage,options,scope).blockingIssues).toContain('turn second: message lost missing');
 }finally{d.storage.close();}
});
