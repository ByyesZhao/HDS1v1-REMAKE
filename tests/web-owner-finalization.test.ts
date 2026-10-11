import {it,expect,vi} from 'vitest';
import {setImmediate} from 'node:timers/promises';
import {setup} from './helpers';
import {WebSearchService} from '../src/web/service';
import {WebSearchStore} from '../src/web/store';
import type {WebModelCheckpoint,WebSearchSession} from '../src/web/types';
const checkpoint:WebModelCheckpoint={formatVersion:2,input:{body:'retained until settlement'},repairCount:0,lookupUsed:false,lookupPending:false,pendingOperationId:null,toolResults:[]};
function read(session:WebSearchSession,url:string,signal?:AbortSignal){const op=session.beginOperation({kind:'read',url});return session.readPage(url,{operationId:op.operationId,signal});}

it('finalize_owner_waits_for_queued_operation_then_releases_cache',async()=>{
 const d=setup();let release!:()=>void;
 const provider={signature:'fixture',search:async()=>[],read:vi.fn(async(url:string)=>{if(url.endsWith('/slow'))await new Promise<void>(resolve=>release=resolve);return {bodyFormat:'text' as const,title:url,body:'完整正文'.repeat(5000)};})};
 const web=new WebSearchService(new WebSearchStore(d.storage),provider,d.clock,{enabled:true});
 const ref=web.store.openStage('turn','owner','life','personal_life'),session=web.openSession(ref),other=web.openSession(web.store.openStage('turn','other','life','personal_life'));
 try{
 expect(typeof web.finalizeOwner).toBe('function');
 await read(session,'https://example.test/first');await read(other,'https://example.test/first');session.markProvided(session.materials().map(m=>m.id));session.saveCheckpoint(checkpoint);
 const source=web.selfReadSources('owner'),first=read(session,'https://example.test/slow'),queued=read(session,'https://example.test/queued');await setImmediate();
 const finishing=web.finalizeOwner('turn','owner');expect(web.finalizeOwner('turn','owner')).toBe(finishing);let settled=false;void finishing.then(()=>settled=true);
 await setImmediate();expect(settled).toBe(false);expect(session.checkpoint()).toEqual(checkpoint);release();await Promise.all([first,queued,finishing]);
 expect(session.checkpoint()).toBeNull();expect(session.state().counters).toEqual({successReads:3,failures:0});expect(session.materials()).toHaveLength(3);expect(session.snapshot().operations).toHaveLength(3);expect(web.selfReadSources('owner')).toEqual(source);
 const before=d.storage.prepare('SELECT total_changes() n').get()!.n;await web.finalizeOwner('turn','owner');expect(d.storage.prepare('SELECT total_changes() n').get()!.n).toBe(before);
 const count=provider.read.mock.calls.length;await read(web.openSession(web.store.openStage('turn','other','next','personal_life')),'https://example.test/first');expect(provider.read).toHaveBeenCalledTimes(count);
 await read(web.openSession(web.store.openStage('turn','owner','next','personal_life')),'https://example.test/first');expect(provider.read).toHaveBeenCalledTimes(count+1);
 }finally{release?.();d.storage.close();}
});

it('rejected_operation_does_not_block_cleanup_and_checkpoint_write_failure_is_retryable',async()=>{
 const d=setup();let release!:()=>void;const controller=new AbortController();
 const web=new WebSearchService(new WebSearchStore(d.storage),{signature:'fixture',search:async()=>[],read:async()=>{await new Promise<void>(resolve=>release=resolve);return {bodyFormat:'text',title:'page',body:'body'};}},d.clock,{enabled:true});
 const session=web.openSession(web.store.openStage('environment','owner','generation','world'));session.saveCheckpoint(checkpoint);
 try{
 expect(typeof web.finalizeOwner).toBe('function');
 const operation=read(session,'https://example.test/a',controller.signal),rejected=expect(operation).rejects.toThrow();await setImmediate();const finishing=web.finalizeOwner('environment','owner');controller.abort();release();await rejected;await finishing;expect(session.checkpoint()).toBeNull();expect(session.state().counters).toEqual({successReads:0,failures:0});
 session.saveCheckpoint(checkpoint);d.storage.prepare("CREATE TRIGGER fail_finalize BEFORE UPDATE ON web_sessions BEGIN SELECT RAISE(ABORT,'checkpoint failure'); END").run();
 await expect(web.finalizeOwner('environment','owner')).rejects.toThrow('checkpoint failure');expect(session.checkpoint()).toEqual(checkpoint);d.storage.prepare('DROP TRIGGER fail_finalize').run();await web.finalizeOwner('environment','owner');expect(session.checkpoint()).toBeNull();
 }finally{release?.();d.storage.close();}
});
