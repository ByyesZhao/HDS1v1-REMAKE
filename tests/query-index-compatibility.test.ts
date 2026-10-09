import {it,expect,afterEach} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {DatabaseSync} from 'node:sqlite';
import {Storage} from '../src/storage';import {SchoolStore} from '../src/school/store';import {EnvironmentStore} from '../src/environment/store';
import {schoolItem} from './world-school-fixture';import {NOW} from './helpers';
const dirs:string[]=[];afterEach(()=>dirs.splice(0).forEach(d=>rmSync(d,{recursive:true,force:true})));
const names=['message_chat_rank','environment_batch_status','environment_step_batch','school_notice_status','school_knowledge_entity_version'];
it('read-only old schema queries work without installing indexes; writable install preserves all rows and rowid',()=>{
 const dir=mkdtempSync(join(tmpdir(),'hdsi-query-'));dirs.push(dir);const path=join(dir,'old.sqlite');let s=new Storage(path);
 const item=schoolItem();s.save('school_plan_items',item.id,item);s.save('school_knowledge','k',{id:'k',entityKind:'plan_item',entityId:item.id,revision:1,snapshot:{entityKind:'plan_item',entityId:item.id,revision:1,value:item},acquiredAt:'2026-10-07T10:00:00.1239+08:00',turnId:'t',experienceId:'e',via:'notice'});
 s.save('environment_batches','b',{id:'b',status:'active'} as any);
 s.save('chat_episodes','c',{id:'c',openedAt:NOW,lastInteractionAt:NOW,status:'closed',closedAt:NOW,closeReason:'idle'});s.save('messages','m',{id:'m',content:'完整正文',receivedAt:NOW,chatEpisodeId:'c',sharedActivityId:null,direction:'outgoing',seenTurnId:null,turnId:null,outboxSeq:null,batchId:null,platformMessageIds:[]});
 for(const name of names)s.prepare('DROP INDEX '+name).run();s.close();
 const db=new DatabaseSync(path,{readOnly:true}),tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all().map(r=>String(r.name)),rows=Object.fromEntries(tables.map(t=>[t,db.prepare('SELECT rowid,* FROM '+t+' ORDER BY rowid').all()]));db.close();const bytes=readFileSync(path);
 s=new Storage(path,{readOnly:true});expect(new EnvironmentStore(s).firstActiveBatch()!.id).toBe('b');expect(new SchoolStore(s).latestKnownSnapshots([{entityKind:'plan_item',entityId:item.id}])[0].value).toEqual(item);expect(s.recentChatSnapshot({eligibility:'ordinary_narrative',count:4,visibleIds:[]}).messages[0].content).toBe('完整正文');expect(s.prepare('SELECT hdsi_epoch_ms(?) AS ms').get('2026-10-07T10:00:00.1239+08:00')!.ms).toBe(Date.parse('2026-10-07T02:00:00.123Z'));s.close();expect(readFileSync(path)).toEqual(bytes);
 for(let i=0;i<2;i++){s=new Storage(path);for(const name of names)expect(s.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(name)).toBeTruthy();for(const table of tables)expect(s.prepare('SELECT rowid,* FROM '+table+' ORDER BY rowid').all()).toEqual(rows[table]);s.close();}
});
