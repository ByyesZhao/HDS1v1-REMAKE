import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Storage} from '../storage';
import {MemoryStore,archiveStartSql} from '../memory/store';
import {activeShort,ordinaryLong,isArchivedLong,activeOrder,archiveOrder,capacityCounts,protectedCanonicalIds} from '../memory/capacity';
import {memoryMetadata,metadataCanonical} from '../memory/metadata';
import {defaultMemoryCapacity,type MemoryCapacityConfig} from '../memory/types';
import {addMs,milliseconds} from '../time';
export function inspectMemoryCapacity(path:string,at:string,config:MemoryCapacityConfig=defaultMemoryCapacity){
  const db=new DatabaseSync(path,{readOnly:true});try{
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
    const state=(key:string)=>tables.has('state')?db.prepare('SELECT data FROM state WHERE key=?').get(key):undefined;
    const runtime=state('runtime'),r=runtime?JSON.parse(String(runtime.data)):null,rows=memoryMetadata(db),protectedIds=protectedCanonicalIds(rows,at,true);
    const archived=tables.has('memories')?db.prepare(`WITH entries AS (SELECT id,${archiveStartSql()} archiveStart FROM memories) SELECT id,archiveStart FROM entries WHERE archiveStart IS NOT NULL ORDER BY id`).all(at):[];
    const archive=archived.map(row=>({id:String(row.id),archiveStart:String(row.archiveStart),deleteAt:config.archiveRetentionDays===null?null:addMs(String(row.archiveStart),config.archiveRetentionDays*86400000),protected:protectedIds.has(String(row.id))}));
    const unfinished=tables.has('turns')?db.prepare("SELECT id FROM turns WHERE COALESCE(json_extract(data,'$.done'),0)=0 AND COALESCE(json_extract(data,'$.legacyDisposition'),'')!='superseded'").all().map(r=>String(r.id)):[];
    const shortExpired=rows.filter(row=>row.kind==='short'&&row.status==='active'&&!!row.shortExpiresAt&&milliseconds(row.shortExpiresAt)<=milliseconds(at));
    const counts=capacityCounts(rows,at,config),policyReads={canonical:(id:string)=>metadataCanonical(rows,id),listAwakenings:(id:string)=>tables.has('memory_awakenings')?db.prepare('SELECT canonicalMemoryId,localDate,firstEffectiveAt,turnId FROM memory_awakenings WHERE canonicalMemoryId=?').all(id).map(r=>({...r,sourceIds:[]} as unknown as import('../memory/types').Awakening)):[]};
    const shortCapacityExits=rows.filter(r=>activeShort(r,at)&&!!r.linkedLongId&&!!metadataCanonical(rows,r.linkedLongId)?.content).sort(activeOrder(policyReads,at)).slice(0,counts.shortOverflow).map(r=>({id:r.id,reason:'short_capacity'}));
    const longCapacityExits=rows.filter(r=>ordinaryLong(r)&&!isArchivedLong(r,at)&&!protectedIds.has(r.id)).sort(activeOrder(policyReads,at)).slice(0,counts.longOverflow).map(r=>({id:r.id,reason:'long_capacity'}));
    const archiveCapacityDeletes=rows.filter(r=>isArchivedLong(r,at)&&!protectedIds.has(r.id)).sort(archiveOrder(policyReads)).slice(0,counts.archiveOverflow).map(r=>({id:r.id,reason:'archive_capacity'}));
    return {version:r?.memoryCapacityVersion??null,hasCharacter:tables.has('state')&&!!db.prepare("SELECT 1 FROM state WHERE key='character'").get(),schemaVersion:state('memory_schema_version')?JSON.parse(String(state('memory_schema_version')!.data)):2,at,config,counts,archive,shortCapacityExits,longCapacityExits,archiveCapacityDeletes,unfinishedTurnIds:unfinished,
      cleanupCandidates:[...archive.filter(r=>!r.protected&&r.deleteAt&&milliseconds(r.deleteAt)<=milliseconds(at)).map(r=>({id:r.id,reason:'archive_age'})),...shortExpired.filter(r=>!!r.linkedLongId&&!!metadataCanonical(rows,r.linkedLongId)?.content).map(r=>({id:r.id,reason:'short_deadline'}))],
      missingReferences:rows.filter(r=>r.kind==='short'&&r.linkedLongId&&!metadataCanonical(rows,r.linkedLongId)).map(r=>({id:r.id,targetId:r.linkedLongId})),backupPath:null as string|null};
  }finally{db.close();}
}
export function upgradeMemoryCapacity(path:string,at:string,options:{stopped:boolean;backupDirectory?:string;config?:MemoryCapacityConfig}){
  if(!options.stopped)throw Error('Stop HDSI and supply --stopped before memory capacity upgrade');
  const before=inspectMemoryCapacity(path,at,options.config);if(before.unfinishedTurnIds.length)throw Error('unfinished old story: finish it using the previous build before upgrading');
  if(before.version===1)return before;if(before.schemaVersion!==3)throw Error('Run memory:migrate first (schema 3 required)');
  const backupPath=join(options.backupDirectory??join(path+'.backups'),`memory-capacity-${at.replace(/[^\d]/g,'')}-${randomUUID()}`);mkdirSync(backupPath,{recursive:true});
  for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix))copyFileSync(path+suffix,join(backupPath,basename(path)+suffix));
  const storage=new Storage(path);try{new MemoryStore(storage).migrateCapacity(at);}finally{storage.close();}
  return {...inspectMemoryCapacity(path,at,options.config),backupPath};
}
