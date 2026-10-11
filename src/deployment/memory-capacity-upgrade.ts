import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {basename,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Storage} from '../storage';
import {MemoryStore,archiveStartSql} from '../memory/store';
import {activeShort,ordinaryLong,isArchivedLong,policyCapacityCounts,policyProtectedIds} from '../memory/capacity';
import {readMemoryPolicySnapshot,policyCanonical} from '../memory/policy-snapshot';
import {readLatestAwakeningTimes,memoryOrderKeys,activePolicyOrder,archivePolicyOrder} from '../memory/policy-order';
import {defaultMemoryCapacity,type MemoryCapacityConfig} from '../memory/types';
import {addMs,milliseconds} from '../time';
export function inspectMemoryCapacity(path:string,at:string,config:MemoryCapacityConfig=defaultMemoryCapacity){
  const db=new DatabaseSync(path,{readOnly:true});try{
    const tables=new Set(db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(r=>String(r.name)));
    const state=(key:string)=>tables.has('state')?db.prepare('SELECT data FROM state WHERE key=?').get(key):undefined;
    const runtime=state('runtime'),r=runtime?JSON.parse(String(runtime.data)):null,snapshot=readMemoryPolicySnapshot(db),rows=snapshot.rows;
    const exitProtectedIds=policyProtectedIds(snapshot,at),deletionProtectedIds=policyProtectedIds(snapshot,at,true);
    const archived=tables.has('memories')?db.prepare(`WITH entries AS (SELECT id,${archiveStartSql()} archiveStart FROM memories) SELECT id,archiveStart FROM entries WHERE archiveStart IS NOT NULL ORDER BY id`).all(at):[];
    const archive=archived.map(row=>({id:String(row.id),archiveStart:String(row.archiveStart),deleteAt:config.archiveRetentionDays===null?null:addMs(String(row.archiveStart),config.archiveRetentionDays*86400000),protected:deletionProtectedIds.has(String(row.id))}));
    const unfinished=tables.has('turns')?db.prepare("SELECT id FROM turns WHERE COALESCE(json_extract(data,'$.done'),0)=0 AND COALESCE(json_extract(data,'$.legacyDisposition'),'')!='superseded'").all().map(r=>String(r.id)):[];
    const shortExpired=rows.filter(row=>row.kind==='short'&&row.status==='active'&&!!row.shortExpiresAt&&milliseconds(row.shortExpiresAt)<=milliseconds(at));
    const counts=policyCapacityCounts(snapshot,at,config);
    const shorts=counts.shortOverflow>0?rows.filter(row=>activeShort(row,at)&&!!row.linkedLongId&&!!policyCanonical(snapshot,row.linkedLongId,'metadata')?.hasContent):[];
    const longs=counts.longOverflow>0?rows.filter(row=>ordinaryLong(row)&&!isArchivedLong(row,at)&&!exitProtectedIds.has(row.id)):[];
    const archives=counts.archiveOverflow>0?rows.filter(row=>isArchivedLong(row,at)&&!deletionProtectedIds.has(row.id)):[];
    const orderedRows=[...shorts,...longs,...archives],ids=orderedRows.flatMap(row=>row.kind==='short'?[policyCanonical(snapshot,row.linkedLongId!,'metadata')!.id]:[row.id]);
    const latest=tables.has('memory_awakenings')?readLatestAwakeningTimes(db,ids):new Map<string,number>(),keys=memoryOrderKeys(orderedRows,snapshot,latest,at,'metadata');
    const shortCapacityExits=shorts.sort(activePolicyOrder(keys)).slice(0,counts.shortOverflow).map(row=>({id:row.id,reason:'short_capacity'}));
    const longCapacityExits=longs.sort(activePolicyOrder(keys)).slice(0,counts.longOverflow).map(row=>({id:row.id,reason:'long_capacity'}));
    const archiveCapacityDeletes=archives.sort(archivePolicyOrder(keys)).slice(0,counts.archiveOverflow).map(row=>({id:row.id,reason:'archive_capacity'}));
    return {version:r?.memoryCapacityVersion??null,hasCharacter:tables.has('state')&&!!db.prepare("SELECT 1 FROM state WHERE key='character'").get(),schemaVersion:state('memory_schema_version')?JSON.parse(String(state('memory_schema_version')!.data)):2,at,config,counts,archive,shortCapacityExits,longCapacityExits,archiveCapacityDeletes,unfinishedTurnIds:unfinished,
      cleanupCandidates:[...archive.filter(r=>!r.protected&&r.deleteAt&&milliseconds(r.deleteAt)<=milliseconds(at)).map(r=>({id:r.id,reason:'archive_age'})),...shortExpired.filter(r=>!!r.linkedLongId&&!!policyCanonical(snapshot,r.linkedLongId,'metadata')?.hasContent).map(r=>({id:r.id,reason:'short_deadline'}))],
      missingReferences:rows.filter(r=>r.kind==='short'&&r.linkedLongId&&!policyCanonical(snapshot,r.linkedLongId,'metadata')).map(r=>({id:r.id,targetId:r.linkedLongId})),backupPath:null as string|null};
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
