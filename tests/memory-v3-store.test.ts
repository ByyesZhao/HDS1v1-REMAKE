import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../src/storage';
import { MemoryStore } from '../src/memory/store';

const at = '2026-10-07T00:00:00.000Z';
const opened: Storage[] = []; const dirs: string[] = [];
afterEach(() => { opened.splice(0).forEach(s => s.close()); dirs.splice(0).forEach(d => rmSync(d, {recursive:true,force:true})); });
function database(file = ':memory:') { const storage = new Storage(file); opened.push(storage); return storage; }
function oldMemory(id: string, kind: 'short'|'long', createdAt = at) {
  return {id,kind,createdAt,reinforcedAt:createdAt,turnId:'legacy',content:'考试经历',topics:['考试'],sourceIds:['e1'],importance:'normal' as const,mentions:9};
}
const request = (atTime = at, scope: 'current'|'archive' = 'current') => ({query:'考试',at:atTime,phase:'personal_chat',scope,includeDetailHistory:false,permissions:{allowArchive:scope==='archive',allowDetailHistory:false,visibleSourceIds:[]},budget:null});
describe('V0.3 migration and SQL visibility', () => {
  it('preserves IDs/provenance, establishes preview and a 90-day migration grant exactly once', () => {
    const storage=database(); storage.save('memories','s',oldMemory('s','short')); storage.save('memories','l',oldMemory('l','long'));
    storage.save('details','phone',{key:'phone',value:'A',aliases:['手机'],effectiveAt:at});
    const store=new MemoryStore(storage); store.migrate(at);
    const short=store.owner({ownerType:'short',ownerId:'s'})!; const long=store.owner({ownerType:'long',ownerId:'l'})!;
    expect(short).toMatchObject({revision:1,stateVersion:1,sourceIds:['e1'],legacyMentions:9,totalAwakenings:0,shortExpiresAt:'2026-10-14T00:00:00.000Z',linkedLongId:'s:long'});
    expect(long).toMatchObject({revision:1,stateVersion:1,totalAwakenings:0,expiresAt:'2027-01-05T00:00:00.000Z'});
    expect(store.owner({ownerType:'long',ownerId:'s:long'})).toMatchObject({summaryQuality:'preview',retainedFrom:'2026-10-14T00:00:00.000Z'});
    expect(store.owner({ownerType:'detail',ownerId:'phone'})).toMatchObject({revision:1,stateVersion:1,key:'phone',value:'A'});
    expect(store.jobs<any>('memory_index_jobs').map(j=>j.owner.ownerId).sort()).toEqual(['l','phone','s','s:long']);
    const before=JSON.stringify(store.listGrants('l')); const deadline=storage.runtime().nextMaintenanceAt;
    store.migrate('2026-11-01T00:00:00.000Z'); expect(JSON.stringify(store.listGrants('l'))).toBe(before); expect(storage.runtime().nextMaintenanceAt).toBe(deadline);
  });
  it('uses now for overdue work and a future 04:30 when no work is due', () => {
    const empty=database(); new MemoryStore(empty).migrate(at); expect(empty.runtime().nextMaintenanceAt).toBe('2026-10-07T20:30:00.000Z');
    const old=database(); old.save('memories','s',oldMemory('s','short','2026-09-01T00:00:00.000Z')); new MemoryStore(old).migrate(at); expect(old.runtime().nextMaintenanceAt).toBe(at);
  });
  it('refuses an unfinished legacy turn without changing legacy rows or the migration marker', () => {
    const storage=database(); storage.save('memories','s',oldMemory('s','short')); storage.save('turns','t',{id:'t',done:false} as any);
    const store=new MemoryStore(storage); expect(()=>store.migrate(at)).toThrow(/unfinished|未完成/); expect((storage.read('memories','s') as any).revision).toBeUndefined(); expect(store.schemaVersion()).toBe(2);
  });
  it('filters expiry, preview, merged copies and stale vectors by SQL, retains vectorless current facts', () => {
    const storage=database(); storage.save('memories','s',oldMemory('s','short')); storage.save('memories','l',oldMemory('l','long')); storage.save('details','phone',{key:'phone',value:'A',aliases:['手机'],effectiveAt:at});
    const store=new MemoryStore(storage); store.migrate(at);
    const l=store.owner({ownerType:'long',ownerId:'l'})!; store.saveOwner({...l,revision:2}); store.saveVector({...l},'config',new Float32Array([1,0]));
    const found=store.selectCandidates(request()); expect(found.map(x=>x.ownerId)).toContain('phone'); expect(found.map(x=>x.ownerId)).not.toContain('s:long'); expect(found.find(x=>x.ownerId==='l')?.normalizedVector).toBeUndefined();
    storage.set('memory_embedding_signature','config'); store.saveVector({...l,revision:2},'config',new Float32Array([0,1])); expect([...store.selectCandidates(request()).find(x=>x.ownerId==='l')!.normalizedVector!]).toEqual([0,1]);
    storage.set('memory_embedding_signature','different'); expect(store.selectCandidates(request()).find(x=>x.ownerId==='l')?.normalizedVector).toBeUndefined();
    expect(store.selectCandidates(request('2026-10-14T00:00:00.000Z')).map(x=>x.ownerId)).not.toContain('s');
    store.saveOwner({...l,mergedInto:'s:long',status:'merged'}); expect(store.selectCandidates(request()).map(x=>x.ownerId)).not.toContain('l');
    const future='2027-02-01T00:00:00.000Z'; expect(store.selectCandidates(request(future)).map(x=>x.ownerId)).not.toContain('s:long'); expect(store.selectCandidates(request(future,'archive')).map(x=>x.ownerId)).toContain('s:long');
    expect(()=>store.selectCandidates({...request(future,'archive'),permissions:{allowArchive:false,allowDetailHistory:false,visibleSourceIds:[]}})).toThrow(/permission|权限/);
  });
  it('rolls back owner and job state together, preserving both after reopening the file', () => {
    const dir=mkdtempSync(join(tmpdir(),'hdsi-v3-')); dirs.push(dir); const path=join(dir,'test.sqlite');
    const storage=database(path); storage.save('memories','s',oldMemory('s','short')); const store=new MemoryStore(storage); store.migrate(at);
    const short=store.owner({ownerType:'short',ownerId:'s'})!;
    expect(()=>storage.transaction(()=>{ store.saveOwner({...short,content:'wrong'}); store.saveJob('memory_index_jobs',{id:'rollback',status:'ready'} as any); throw new Error('rollback'); })).toThrow('rollback');
    storage.close(); opened.splice(opened.indexOf(storage),1); const reopened=database(path); const restored=new MemoryStore(reopened);
    expect(restored.owner({ownerType:'short',ownerId:'s'})?.content).toBe('考试经历'); expect(restored.job('memory_index_jobs','rollback')).toBeNull();
  });
});
