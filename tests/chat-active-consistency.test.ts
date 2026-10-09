import {it,expect} from 'vitest';
import {modern} from './chat-fixture';
import {NOW} from './helpers';
import {checkWindowConsistency} from '../src/dialogue/window-consistency';
import {checkActiveWindowConsistency,assertActiveWindow} from '../src/dialogue/active-consistency';
import {MemoryStore} from '../src/memory/store';
import {MemoryLifecycle} from '../src/memory/lifecycle';
import {applyTasks} from '../src/memory/organize';
const options={idleMinutes:15,recentSegments:4},scope={touchedMessageIds:[],requiredMessageIds:[],sourceIds:[],touchedEpisodeIds:[]};
function orphan(d:ReturnType<typeof modern>){d.storage.save('messages','orphan',{id:'orphan',content:'旧话',receivedAt:'2020-01-01T00:00:00Z',direction:'incoming',platformMessageIds:[],seenTurnId:'old',turnId:null,batchId:null,outboxSeq:null,dialogueEpisodeId:'legacy'});d.storage.save('dialogue_episodes','legacy',{id:'legacy',openedAt:NOW,lastInteractionAt:NOW,status:'closed',closedAt:NOW,closeReason:'idle'});d.storage.save('turns','old',{id:'old',done:true} as any);
 for(let i=0;i<5;i++){d.storage.save('chat_episodes','c'+i,{id:'c'+i,openedAt:NOW,lastInteractionAt:NOW,status:'closed',closedAt:NOW,closeReason:'idle'});d.storage.save('messages','m'+i,{id:'m'+i,content:'现代正文',receivedAt:NOW,direction:'incoming',seenTurnId:'old',turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[],chatEpisodeId:'c'+i,sharedActivityId:null});}}
it('old warning becomes blocking when consumed as a required or source message; nonmessage sources remain valid',()=>{
 const d=modern();orphan(d);expect(checkWindowConsistency(d.storage,options).historicalWarnings).toHaveLength(1);
 expect(checkActiveWindowConsistency(d.storage,options,{...scope,sourceIds:['orphan']}).blockingIssues.some(s=>s.includes('orphan'))).toBe(true);
 expect(checkActiveWindowConsistency(d.storage,options,{...scope,sourceIds:['experience','self-read']}).blockingIssues).toEqual([]);
 expect(checkActiveWindowConsistency(d.storage,options,{...scope,requiredMessageIds:['missing']}).blockingIssues.some(s=>s.includes('missing'))).toBe(true);d.storage.close();
});
it.each(['task','memory','detail','learned'])('new %s protection blocks an old orphan and rolls back the write',kind=>{
 const d=modern();orphan(d);const store=new MemoryStore(d.storage);
 expect(()=>d.storage.transaction(()=>{
 if(kind==='task')applyTasks({...d} as any,{completedTaskIds:[],taskChanges:[{action:'create',id:'task',task:{kind:'check_messages',at:NOW,description:'重新回应',checkReason:'deferred_reply',messageIds:['orphan']}}]} as any);
 else store.saveOwner(store.makeOwner({ownerType:kind==='memory'?'long':kind as any,ownerId:'new'},{content:'引用',sourceIds:['orphan'],key:kind==='detail'?'phone':undefined,value:kind==='detail'?'A':undefined},NOW));
 })).toThrow(/orphan/);d.storage.close();
});
it('all modern and legacy unfinished bindings and frozen messages are checked',()=>{
 const d=modern();for(const id of ['a','b'])d.storage.save('turns',id,{id,at:NOW,done:false,inputMessageIds:[],outputComplete:false,dialogueWindowVersion:2,chatBinding:{episodeId:null,holdReply:false}} as any);
 const b=d.storage.read('turns','b')!;d.storage.save('turns','b',{...b,frozenResult:{visibleMessageIds:['missing'],reconsiderMessageIds:[]} as any});
 const report=checkActiveWindowConsistency(d.storage,options,scope);expect(report.blockingIssues).toContain('turn b: message missing missing');
 d.storage.save('turns','a',{...d.storage.read('turns','a')!,dialogueWindowVersion:1,dialogueBinding:{episodeId:'gone',holdReply:true}});
 expect(checkActiveWindowConsistency(d.storage,options,scope).legacyInflightErrors).toContain('a');d.storage.close();
});

import {InputBuffer} from '../src/host/input';
import {SerialHost} from '../src/host/runtime';
import {HdsiApp} from '../src/app';
import {makeSharedFixture} from './shared-v3-fixture';
it('controls and duplicate platform inputs keep original identity without phantom required messages',async()=>{
 const d=modern();makeSharedFixture(d);const buffer=new InputBuffer(d.storage);
 await buffer.acceptInput({id:'control',receivedAt:NOW,content:'【推进】'});expect(d.storage.read('messages','control')).toBeNull();
 await buffer.acceptInput({id:'m',receivedAt:NOW,content:'动作'});await buffer.acceptInput({id:'m',receivedAt:NOW,content:'重复'});
 expect(d.storage.read('messages','m')?.content).toBe('动作');expect(checkActiveWindowConsistency(d.storage,options,scope).blockingIssues).toEqual([]);d.storage.close();
});
it('input transaction rolls back on a newly introduced association failure',async()=>{
 const d=modern();const save=d.storage.save.bind(d.storage);
 d.storage.save=((table:any,id:string,row:any)=>save(table,id,table==='messages'?{...row,chatEpisodeId:'missing'}:row)) as any;
 await expect(new InputBuffer(d.storage).acceptInput({id:'m',receivedAt:NOW,content:'新话'})).rejects.toThrow(/missing chat association/);
 expect(d.storage.read('messages','m')).toBeNull();expect(d.storage.runtime().activeChatEpisodeId).toBeNull();d.storage.close();
});
it('activity migration that empties a ordinary episode keeps full fallback',()=>{
 const d=modern();d.chat.acceptMessage({id:'m',content:'邀请',receivedAt:NOW,direction:'incoming',platformMessageIds:[],seenTurnId:null,turnId:null,batchId:'b',outboxSeq:null,sharedActivityId:null});
 const all=d.storage.all.bind(d.storage);let scans=0;d.storage.all=((table:any)=>{if(table==='messages')scans++;return all(table);}) as any;
 d.storage.transaction(()=>d.chat.acceptMessage({...d.storage.read('messages','m')!,sharedActivityId:'A',batchId:null}));expect(scans).toBe(1);expect(d.storage.read('messages','m')?.chatEpisodeId).toBeNull();d.storage.close();
});
it('confirmed opening is accepted identically by full and active checks',()=>{
 const d=modern();const next=structuredClone(d.storage.character());next.scene.shared={activityId:'new'} as any;
 d.storage.save('turns','t',{id:'t',at:NOW,done:false,inputMessageIds:[],outputComplete:false,dialogueWindowVersion:2,chatBinding:{episodeId:null,holdReply:false},frozenResult:{visibleMessageIds:[],reconsiderMessageIds:[],personal:{sharedChange:{action:'start'}},nextState:next}} as any);
 d.storage.saveOutbox({turnId:'t',seq:0,kind:'narration',payload:'开始',status:'confirmed',confirmedAt:NOW,platformMessageIds:['qq'],notBefore:null});
 d.storage.save('messages','t:out:0',{id:'t:out:0',content:'开始',receivedAt:NOW,direction:'outgoing',platformMessageIds:['qq'],seenTurnId:null,turnId:'t',batchId:null,outboxSeq:0,sharedActivityId:'new',chatEpisodeId:null});
 d.storage.set('runtime',{...d.storage.runtime(),sharedClock:{activityId:'new',status:'active'} as any});
 expect(checkWindowConsistency(d.storage,options).blockingIssues).toEqual([]);expect(checkActiveWindowConsistency(d.storage,options,scope).blockingIssues).toEqual([]);d.storage.close();
});

it.each(['visible','reconsider','post'])('existing %s reference promotes old warning into blocking protection',kind=>{
 const d=modern();orphan(d);const frozen={visibleMessageIds:kind==='visible'?['orphan']:[],reconsiderMessageIds:kind==='reconsider'?['orphan']:[]};
 d.storage.save('turns','t',{id:'t',at:NOW,done:false,inputMessageIds:[],outputComplete:false,dialogueWindowVersion:2,chatBinding:{episodeId:null,holdReply:false},frozenResult:frozen} as any);
 if(kind==='post')d.storage.save('post_jobs','t',{turnId:'t',result:{schemaVersion:3,shortTermChanges:[{sourceIds:['orphan']}],longTermChanges:[],detailChanges:[]}} as any);
 expect(checkActiveWindowConsistency(d.storage,options,scope).blockingIssues.some(s=>s.includes('orphan'))).toBe(true);d.storage.close();
});
