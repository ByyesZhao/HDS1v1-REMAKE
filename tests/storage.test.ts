import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../src/storage';
import {DialogueStore} from '../src/dialogue/store';
it('chat_index_transaction_rolls_back_and_reopens_without_copying_message_body',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-chat-')),path=join(dir,'chat.sqlite');let s=new Storage(path);const store=new DialogueStore(s),episode={id:'c',openedAt:'2026-10-08T00:00:00Z',lastInteractionAt:'2026-10-08T00:00:00Z',status:'open' as const,closedAt:null,closeReason:null};
 expect(()=>s.transaction(()=>{store.saveChatEpisode(episode);s.save('chat_index_metadata','chat-index',{id:'chat-index',idleMinutes:30});throw Error('rollback');})).toThrow('rollback');expect(store.chatEpisodes()).toEqual([]);s.transaction(()=>{store.saveChatEpisode(episode);s.set('runtime',{...s.runtime(),activeChatEpisodeId:'c'});});s.close();s=new Storage(path);expect(new DialogueStore(s).chatEpisode('c')).toEqual(episode);expect(s.runtime().activeChatEpisodeId).toBe('c');expect(s.messages()).toEqual([]);s.close();rmSync(dir,{recursive:true});
});

it('commits, reopens, and rolls back an incomplete transaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdsi-'));
  const path = join(dir, 'story.sqlite');
  let db = new Storage(path);
  db.transaction(() => db.set('background', { name: '开发样例' }));
  expect(() => db.transaction(() => { db.set('background', { name: '未提交' }); db.set('other', 1); throw new Error('rollback'); })).toThrow('rollback');
  db.close();
  db = new Storage(path);
  expect(db.get('background')).toEqual({ name: '开发样例' });
  expect(db.get('other')).toBeNull();
  expect(db.pragmas()).toEqual({ journalMode: 'wal', synchronous: 2 });
  db.close();
  rmSync(dir, { recursive: true });
});
