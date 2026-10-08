import { it, expect } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readFileSync, writeFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings } from '../src/settings';
import { createHash } from 'node:crypto';
import { inspectDialogueUpgrade,upgradeDialogue } from '../src/deployment/dialogue-upgrade';
import type { Message } from '../src/types';
const digest=(path:string)=>createHash('sha256').update(readFileSync(path)).digest('hex');
const msg=(id:string,minutes:number,activity?:string):Message=>({id,direction:'incoming',content:id,receivedAt:new Date(Date.UTC(2026,9,8,0,minutes)).toISOString(),platformMessageIds:[],batchId:id,seenTurnId:'seen',turnId:null,outboxSeq:null,sharedActivityId:activity??null});
function fixture(messages:Message[]=[],turns:object[]=[],runtime:object={}) {
 const root=mkdtempSync(join(tmpdir(),'hdsi-dialogue-')),path=join(root,'db.sqlite'), db=new DatabaseSync(path);
 db.exec('CREATE TABLE state (key TEXT PRIMARY KEY,data TEXT); CREATE TABLE messages(id TEXT PRIMARY KEY,data TEXT); CREATE TABLE turns(id TEXT PRIMARY KEY,data TEXT);');
 db.prepare('INSERT INTO state VALUES (?,?)').run('runtime',JSON.stringify({openBatch:null,pendingBatchIds:[],sharedClock:null,...runtime}));
 for(const m of messages)db.prepare('INSERT INTO messages VALUES (?,?)').run(m.id,JSON.stringify(m));
 for(const t of turns as Array<{id:string}>)db.prepare('INSERT INTO turns VALUES (?,?)').run(t.id,JSON.stringify(t));
 db.close();return {root,path,clean:()=>rmSync(root,{recursive:true,force:true})};
}
it('legacy_30_maps_to_four_episodes and explicit settings win without activating budgets',()=>{
 const root=mkdtempSync(join(tmpdir(),'hdsi-dialogue-config-'));
 try { const sample=JSON.parse(readFileSync('examples/story.sample.json','utf8')); sample.memory={contextLimits:{recentMessagesLimit:30}}; writeFileSync(join(root,'config.json'),JSON.stringify(sample));
 const settings=loadSettings(join(root,'config.json'),{}); expect(settings.memory.contextLimits).toMatchObject({recentDialogueSegments:4,dialogueIdleMinutes:15,shortItemsLimit:null}); expect(settings.memory.contextLimits).not.toHaveProperty('recentMessagesLimit');
 sample.memory.contextLimits.recentDialogueSegments=6;sample.memory.contextLimits.dialogueIdleMinutes=20;writeFileSync(join(root,'config.json'),JSON.stringify(sample));expect(loadSettings(join(root,'config.json'),{}).memory.contextLimits).toMatchObject({recentDialogueSegments:6,dialogueIdleMinutes:20});
 }finally{rmSync(root,{recursive:true,force:true});}
});
it('check_read_only never creates tables or backups',async()=>{
 const f=fixture([msg('a',0)]);try{const before=digest(f.path),files=readdirSync(f.root);const report=inspectDialogueUpgrade(f.path);expect(report).toMatchObject({version:null,messageCount:1,canApply:true,backupPath:null});expect(digest(f.path)).toBe(before);expect(readdirSync(f.root)).toEqual(files);}finally{f.clean();}
});
it('apply_backup_atomic_idempotent preserves messages and refuses running services',async()=>{
 const f=fixture([msg('a',0),msg('b',30)]);try{expect(()=>upgradeDialogue(f.path,'2026-10-08T03:00:00Z',{stopped:false,backupDirectory:join(f.root,'backups')})).toThrow(/stop|停/i);
 const r=upgradeDialogue(f.path,'2026-10-08T03:00:00Z',{stopped:true,backupDirectory:join(f.root,'backups')});expect(r).toMatchObject({version:1,messageCount:2,episodeCount:2});expect(existsSync(join(r.backupPath!,'db.sqlite'))).toBe(true);const db=new DatabaseSync(f.path);const rows=db.prepare('SELECT data FROM messages ORDER BY id').all().map(r=>JSON.parse(String(r.data)));db.close();expect(rows[0]).toMatchObject(msg('a',0));expect(rows[0].dialogueEpisodeId).not.toBe(rows[1].dialogueEpisodeId);expect(upgradeDialogue(f.path,'2026-10-08T03:00:00Z',{stopped:true,backupDirectory:join(f.root,'backups')}).backupPath).toBeNull();expect(inspectDialogueUpgrade(f.path).episodeCount).toBe(2);
 }finally{f.clean();}
});
it('backfill_shared_id_overrides_gap without globally merging unknown history',async()=>{
 const f=fixture([msg('a',0),msg('b',20,'game'),msg('c',60,'game'),msg('d',90)]);try{const r=upgradeDialogue(f.path,'2026-10-08T03:00:00Z',{stopped:true,backupDirectory:join(f.root,'backups')});expect(r.episodeCount).toBe(3);const db=new DatabaseSync(f.path);const rows=db.prepare('SELECT data FROM messages ORDER BY id').all().map(r=>JSON.parse(String(r.data)));const links=db.prepare('SELECT data FROM dialogue_activity_links').all().map(r=>JSON.parse(String(r.data)));db.close();expect(rows[1].dialogueEpisodeId).toBe(rows[2].dialogueEpisodeId);expect(rows[0].dialogueEpisodeId).not.toBe(rows[3].dialogueEpisodeId);expect(links[0]).toMatchObject({status:'legacy_span',startedAt:null,endedAt:null,evidenceFrom:msg('b',20).receivedAt,evidenceTo:msg('c',60).receivedAt});}finally{f.clean();}
});
it('inflight_known_can_bind_unknown_rejected and latest interaction stays current',async()=>{
 const turn={id:'turn',done:false,outputComplete:false,inputMessageIds:['b'],entryMode:'chat',triggerKinds:['input']};const f=fixture([msg('a',0),msg('b',30)],[turn]);try{expect(inspectDialogueUpgrade(f.path).canApply).toBe(true);upgradeDialogue(f.path,'2026-10-08T01:00:00Z',{stopped:true,backupDirectory:join(f.root,'backups')});const db=new DatabaseSync(f.path);const t=JSON.parse(String(db.prepare('SELECT data FROM turns').get()!.data)),m=JSON.parse(String(db.prepare("SELECT data FROM messages WHERE id='b'").get()!.data)),r=JSON.parse(String(db.prepare("SELECT data FROM state WHERE key='runtime'").get()!.data));db.close();expect(t.dialogueBinding).toEqual({episodeId:m.dialogueEpisodeId,holdReply:true});expect(r.activeDialogueEpisodeId).toBe(m.dialogueEpisodeId);}finally{f.clean();}
 const unknown=fixture([], [{...turn,inputMessageIds:['missing']}]);try{expect(inspectDialogueUpgrade(unknown.path).canApply).toBe(false);const before=digest(unknown.path);expect(()=>upgradeDialogue(unknown.path,'2026-10-08T01:00:00Z',{stopped:true,backupDirectory:join(unknown.root,'backups')})).toThrow(/关联|bind|ambig/i);expect(digest(unknown.path)).toBe(before);}finally{unknown.clean();}
});

it('apply failure rolls back all indexes and message assignments',()=>{
 const f=fixture([msg('a',0),msg('b',30)]);try {const db=new DatabaseSync(f.path);db.exec("CREATE TRIGGER refuse_dialogue BEFORE UPDATE ON messages BEGIN SELECT RAISE(ABORT,'injected rollback'); END");db.close();const before=digest(f.path);expect(()=>upgradeDialogue(f.path,'2026-10-08T03:00:00Z',{stopped:true,backupDirectory:join(f.root,'backups')})).toThrow('injected rollback');expect(digest(f.path)).toBe(before);expect(inspectDialogueUpgrade(f.path).version).toBeNull();}finally{f.clean();}
});
