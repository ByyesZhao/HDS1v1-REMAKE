import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {inspectWebPayloads,migrateWebPayloadBatch} from '../web/payload-migration';

export function inspectWebPayloadFile(path:string){const db=new DatabaseSync(path,{readOnly:true});try{return inspectWebPayloads(db);}finally{db.close();}}
export function migrateWebPayloads(path:string,options:{stopped:boolean;batchSize?:number;maxBatches?:number;backupDirectory?:string}){
 if(options.stopped!==true)throw Error('Stop HDSI and supply --stopped before web payload migration');
 const batchSize=options.batchSize??50,maxBatches=options.maxBatches??20;
 if(!Number.isInteger(batchSize)||batchSize<=0||batchSize>50||!Number.isInteger(maxBatches)||maxBatches<=0)throw Error('batchSize must be a positive integer at most 50; maxBatches must be a positive integer');
 const before=inspectWebPayloadFile(path);
 if(before.invalidReferences.length){const bad=before.invalidReferences[0];throw Error(`web run ${bad.runId}: missing material ${bad.materialId}`);}
 if(!before.legacySessions&&!before.legacyOperations)return {formatVersion:2 as const,before,after:before,batches:0,hasMore:false,backupPath:null,updated:0};
 const backupPath=join(options.backupDirectory??join(dirname(path),'backups','web-payloads'),randomUUID());
 mkdirSync(backupPath,{recursive:true});
 for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix))copyFileSync(path+suffix,join(backupPath,basename(path)+suffix));
 const db=new DatabaseSync(path);let batches=0,updated=0,hasMore=true;
 try{while(batches<maxBatches&&hasMore){db.exec('BEGIN IMMEDIATE');try{const report=migrateWebPayloadBatch(db,batchSize);db.exec('COMMIT');batches++;updated+=report.operationsUpdated+report.checkpointsUpdated;hasMore=report.hasMore;}catch(error){db.exec('ROLLBACK');throw error;}}}finally{db.close();}
 const after=inspectWebPayloadFile(path);
 hasMore=hasMore||after.legacySessions>0||after.legacyOperations>0;
 return {formatVersion:2 as const,before,after,batches,hasMore,backupPath,updated};
}
