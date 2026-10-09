import {it,expect} from 'vitest';
import {Storage} from '../src/storage';
import {recentFromSnapshot} from '../src/dialogue/chat-window';
import type {Message} from '../src/types';
const time=(n:number)=>new Date(Date.UTC(2026,9,7,2,n)).toISOString();
const msg=(id:string,e:string,n:number,seen:string|null='old'):Message=>({id,content:id+'尾部',chatEpisodeId:e,sharedActivityId:null,receivedAt:time(n),direction:'incoming',seenTurnId:seen,turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[]});
function episode(s:Storage,id:string,n:number){s.save('chat_episodes',id,{id,openedAt:time(n),lastInteractionAt:time(n),status:'closed',closedAt:time(n+15),closeReason:'idle'});}
function compare(s:Storage,count=4,visibleIds:string[]=[],eligibility:'ordinary_narrative'|'with_visible_inputs'='ordinary_narrative'){
 const options={count,visibleIds:new Set(visibleIds),eligibility},oracle=recentFromSnapshot({messages:s.messages(),episodes:s.all('chat_episodes')},options);
 const snapshot=s.recentChatSnapshot({...options,visibleIds});expect(recentFromSnapshot(snapshot,options)).toEqual(oracle);return oracle;
}
it('SQL ranks only stage-visible interactions and preserves every message of selected segments',()=>{
 const s=new Storage(':memory:');try{for(const [i,id] of ['A','B','C','D','E'].entries()){episode(s,id,i*30);s.save('messages',id,msg(id,id,i*30,id==='E'?null:'seen'));}
 s.save('messages','hidden',msg('hidden','A',200,null));s.save('chat_episodes','A',{...s.read('chat_episodes','A')!,lastInteractionAt:time(200)});
 expect(compare(s).episodeIds).toEqual(['A','B','C','D']);expect(compare(s,4,['hidden'],'with_visible_inputs').episodeIds).toEqual(['B','C','D','A']);expect(compare(s,4,['hidden']).episodeIds).toEqual(['A','B','C','D']);
 for(let i=0;i<40;i++)s.save('messages','x'+i,msg('x'+i,'D',210));s.save('messages','unread',msg('unread','D',215,null));s.save('messages','act',{...msg('act','D',220),sharedActivityId:'activity'});
 const result=compare(s);expect(result.messages.filter(m=>m.chatEpisodeId==='D')).toHaveLength(41);expect(result.messages.map(m=>m.id)).not.toContain('act');expect(result.messages.map(m=>m.id)).not.toContain('unread');
 }finally{s.close();}
});
it('SQL retains missing seen fields, closed segments, JS epoch and literal ID ties',()=>{
 const s=new Storage(':memory:');try{for(const id of ['a','z','\uE000','\u{10000}','x']){episode(s,id,0);s.save('messages',id,{...msg(id,id,0),receivedAt:'2026-10-07T10:00:00+08:00'});}
 const missing:any={...msg('missing','a',1)};delete missing.seenTurnId;s.save('messages','missing',missing);s.save('messages','unseen',msg('unseen','z',10,null));
 for(const count of [1,4,6,0,-1,1.5])compare(s,count);
 const dates=['2026-10-07T02:00:00.001Z','2026-10-07T10:00:00.010+08:00','2026-10-07T02:00:00.0009Z'];
 dates.forEach((t,i)=>s.save('messages','time'+i,{...msg('time'+i,'a',0),receivedAt:t}));compare(s);
 }finally{s.close();}
});
it('SQL preserves stable row insertion order when outbox comparator ties',()=>{
 const s=new Storage(':memory:');try{episode(s,'a',0);for(const [id,seq,turn] of [['z',1,'t'],['a',1,'t'],['c',2,'t'],['b',null,'other']] as const)s.save('messages',id,{...msg(id,'a',0),direction:'outgoing',turnId:turn,outboxSeq:seq});
 const result=compare(s);expect(result.messages.filter(m=>m.turnId==='t'&&m.outboxSeq===1).map(m=>m.id)).toEqual(['z','a']);
 }finally{s.close();}
});
it('SQL snapshot follows seen/activity/date/delete lifecycle and transaction rollback',()=>{
 const s=new Storage(':memory:');try{episode(s,'a',0);s.save('messages','m',msg('m','a',0,null));compare(s);s.save('messages','m',{...s.read('messages','m')!,seenTurnId:'seen'});compare(s);
 expect(()=>s.transaction(()=>{s.save('messages','m',{...s.read('messages','m')!,receivedAt:time(90),sharedActivityId:'act'});compare(s);throw Error('rollback');})).toThrow('rollback');expect(compare(s).messages).toHaveLength(1);s.remove('messages','m');compare(s);
 }finally{s.close();}
});
it('invalid time uses exact old selector fallback',()=>{
 const s=new Storage(':memory:');try{episode(s,'a',0);episode(s,'b',1);s.save('messages','bad',{...msg('bad','a',0),receivedAt:'invalid'});s.save('messages','b',msg('b','b',1));compare(s);}finally{s.close();}
});
it('epoch SQL function uses Date.parse precision and rejects nonstrings',()=>{
 const s=new Storage(':memory:');try{for(const t of ['2026-10-07T10:00:00.1239+08:00','2026-10-07T02:00:00.123Z','bad',null,1])expect(s.prepare('SELECT hdsi_epoch_ms(?) AS ms').get(t)!.ms).toBe(typeof t==='string'&&Number.isFinite(Date.parse(t))?Date.parse(t):null);}finally{s.close();}
});
