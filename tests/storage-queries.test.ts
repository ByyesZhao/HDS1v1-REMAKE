import {it,expect} from 'vitest';
import {Storage,isUnfinishedTurn} from '../src/storage';
import {NOW} from './helpers';
it('SQL queries preserve explicit null, missing fields, residual activity batches and epoch ordering',()=>{
 const s=new Storage(':memory:');
 const rows=[
 {id:'seen-null',seenTurnId:null,batchId:null,sharedActivityId:null},
 {id:'seen-missing',batchId:null},
 {id:'batch-missing',seenTurnId:null},
 {id:'act',seenTurnId:null,batchId:null,sharedActivityId:'A'},
 {id:'old-act',seenTurnId:null,batchId:'old',sharedActivityId:'A'},
 {id:'open',seenTurnId:null,batchId:'open'},
 {id:'seen',seenTurnId:'t',batchId:null}
 ].map((r,i)=>({content:'m',receivedAt:i%2?'2026-10-07T02:00:00Z':NOW,direction:'incoming',turnId:null,outboxSeq:null,chatEpisodeId:'c',platformMessageIds:[],...r}));
 for(const r of rows)s.save('messages',r.id,r as any);
 for(const t of [{id:'a',done:true},{id:'b',done:false},{id:'c',done:null},{id:'d'},{id:'e',done:false,legacyDisposition:'superseded'}])s.save('turns',t.id,t as any);
 expect(s.unfinishedTurns()).toEqual(s.all('turns').filter(isUnfinishedTurn));expect(s.unfinishedTurn()?.id).toBe('b');
 for(const open of [null,{id:'open',readyAt:NOW}]){s.set('runtime',{...s.runtime(),openBatch:open});const oracle=s.messages().filter(m=>m.direction==='incoming'&&m.seenTurnId===null&&!(m.sharedActivityId&&m.batchId===null)&&m.batchId!==open?.id);expect(s.unreadMessages()).toEqual(oracle);}
 expect(s.unseenIncomingMessages()).toEqual(s.messages().filter(m=>m.direction==='incoming'&&m.seenTurnId===null));
 expect(s.unreadActivityMessages('A').map(m=>m.id)).toEqual(['act']);
 expect(s.messagesByActivity('A')).toEqual(s.messages().filter(m=>m.sharedActivityId==='A'));
 expect(s.messagesByIds(['old-act','act','old-act'])).toEqual(s.messages().filter(m=>['old-act','act'].includes(m.id)));
 expect(s.messagesByChatEpisode('c')).toEqual(s.messages());expect(s.messagesByIds([])).toEqual([]);s.close();
});
it('hot queries do not decode unrelated rows and outbox stays ordered',()=>{
 const s=new Storage(':memory:');for(let i=0;i<1000;i++)s.save('turns','done'+i,{id:'done'+i,done:true} as any);
 s.save('turns','only',{id:'only',done:false} as any);
 const all=s.all.bind(s);s.all=((table:any)=>{if(['turns','messages','outbox'].includes(table))throw Error('full decode');return all(table);}) as any;
 expect(s.unfinishedTurn()?.id).toBe('only');expect(s.unreadMessages()).toEqual([]);expect(s.outbox('only')).toEqual([]);s.close();
});

it('unseen predicate uses both columns of existing unread index',()=>{
 const s=new Storage(':memory:');let sql='';const prepare=s.prepare.bind(s);s.prepare=((query:string)=>{sql=query;return prepare(query);}) as any;
 // Capture the production query even though Storage uses its direct db connection.
 const db=(s as any).db,original=db.prepare;db.prepare=function(q:string){sql=q;return original.call(this,q);};s.unseenIncomingMessages();db.prepare=original;
 const plan=prepare('EXPLAIN QUERY PLAN '+sql).all().map(r=>String(r.detail)).join(';');expect(plan).toContain('<expr>=? AND <expr>=?');s.close();
});

it('unfinished lookup searches active index rather than scanning completed turns',()=>{
 const s=new Storage(':memory:'),db=(s as any).db,prepare=db.prepare;let sql='';db.prepare=function(q:string){sql=q;return prepare.call(this,q);};s.unfinishedTurn();db.prepare=prepare;
 const plan=s.prepare('EXPLAIN QUERY PLAN '+sql).all().map(r=>String(r.detail)).join(';');expect(plan).toContain('SEARCH turns USING INDEX turn_active_work');s.close();
});
