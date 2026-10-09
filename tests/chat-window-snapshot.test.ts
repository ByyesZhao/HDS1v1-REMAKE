import {it,expect} from 'vitest';
import {modern} from './chat-fixture';
import {checkWindowConsistency} from '../src/dialogue/window-consistency';
import {recentFromSnapshot} from '../src/dialogue/chat-window';
import {NOW} from './helpers';
import type {Message} from '../src/types';
it('full audit reads messages, episodes and turns exactly once',()=>{
 const d=modern(),calls:Record<string,number>={},all=d.storage.all.bind(d.storage);
 d.storage.all=((table:any)=>{calls[table]=(calls[table]??0)+1;return all(table);}) as any;
 expect(checkWindowConsistency(d.storage,{idleMinutes:15,recentSegments:4}).blockingIssues).toEqual([]);
 expect(calls.messages).toBe(1);expect(calls.chat_episodes).toBe(1);expect(calls.turns).toBe(1);d.storage.close();
});
it('snapshot preserves literal order, epoch offsets, whole episode and visibility variants',()=>{
 const episodes=[{id:'a',openedAt:NOW,lastInteractionAt:NOW,status:'closed' as const,closedAt:NOW,closeReason:'idle' as const},{id:'b',openedAt:NOW,lastInteractionAt:NOW,status:'open' as const,closedAt:null,closeReason:null}];
 const messages:Message[]=Array.from({length:42},(_,i)=>({id:'m'+i,receivedAt:NOW,direction:'outgoing' as const,content:String(i),platformMessageIds:[],batchId:null,seenTurnId:null,turnId:'t',outboxSeq:i,chatEpisodeId:'a',sharedActivityId:null}));
 messages.push({...messages[0],id:'new',direction:'incoming',chatEpisodeId:'b',receivedAt:'2026-10-07T03:00:00Z',seenTurnId:null});
 messages.push({...messages[0],id:'activity',sharedActivityId:'act',chatEpisodeId:null});
 const r=recentFromSnapshot({messages,episodes},{eligibility:'ordinary_narrative',count:4,visibleIds:new Set(['new'])});expect(r.messages.map(m=>m.id)).toEqual(Array.from({length:42},(_,i)=>'m'+i));
 const visible=recentFromSnapshot({messages,episodes},{eligibility:'with_visible_inputs',count:1,visibleIds:new Set(['new'])});expect(visible.messages.map(m=>m.id)).toEqual(['new']);
});
