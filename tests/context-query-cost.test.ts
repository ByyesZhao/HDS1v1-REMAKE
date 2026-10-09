import {it,expect} from 'vitest';
import {Storage} from '../src/storage';
import {MemoryRetrieval,makeRetrievalRequest} from '../src/memory/retrieval';
import {MemoryStore} from '../src/memory/store';
import {ContextBuilder} from '../src/memory/context';
const {captureQueries,plans}=require('../scripts/query-probe.cjs');
it.each([1000,10000,50000])('directed window decodes only four complete segments at H=%s; memory never reads raw window',async H=>{
 const s=new Storage(':memory:');try{s.transaction(()=>{for(let i=0;i<H+4;i++){const id='e'+i,at=new Date(Date.UTC(2026,0,1)+i*1200000).toISOString();s.save('chat_episodes',id,{id,openedAt:at,lastInteractionAt:at,status:'closed',closedAt:at,closeReason:'idle'});for(let j=0;j<(i>=H?41:1);j++){const mid=id+':'+j;s.save('messages',mid,{id:mid,content:'正文'+j,receivedAt:at,direction:'outgoing',seenTurnId:null,turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[],chatEpisodeId:id,sharedActivityId:null});}}});
 const observed=captureQueries(s,()=>s.recentChatSnapshot({eligibility:'ordinary_narrative',count:4,visibleIds:[]}));expect(observed.value.messages).toHaveLength(164);expect(observed.value.episodes).toHaveLength(4);
 expect(observed.queries.reduce((n:number,q:any)=>n+q.jsonRows,0)).toBe(168);expect(observed.queries.reduce((n:number,q:any)=>n+q.writes,0)).toBe(0);
 const p=plans(s,observed.queries);expect(JSON.stringify(p[0].plan)).toContain('message_chat_rank');expect(JSON.stringify(p.find((q:any)=>q.sql.includes('SELECT rowid,data FROM messages')).plan)).toContain('message_chat');
 const rank=observed.queries[0];expect(rank.rows).toBe(4);
 const ops=s.prepare('EXPLAIN '+rank.sql).all(...rank.args);const root=s.prepare("SELECT rootpage FROM sqlite_master WHERE name='messages'").get()!.rootpage,cursors=ops.filter((op:any)=>op.opcode==='OpenRead'&&op.p2===root).map((op:any)=>op.p1);
 expect(ops.filter((op:any)=>op.opcode==='Column'&&cursors.includes(op.p1)&&op.p2===1)).toEqual([]);
 const recent=s.recentChatSnapshot.bind(s);let calls=0;s.recentChatSnapshot=(q)=>{calls++;return recent(q);};const b=new ContextBuilder(s,new MemoryRetrieval(new MemoryStore(s)));const q=makeRetrievalRequest('',new Date().toISOString(),'memory');q.dialogueWindowVersion=2;await b.buildForMemory(q);await b.lookupForMemory('',q);expect(calls).toBe(0);
 }finally{s.close();}
});
