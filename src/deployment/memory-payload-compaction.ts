import {DatabaseSync} from 'node:sqlite';
import {copyFileSync,existsSync,mkdirSync} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {countCompletedPayloads,compactCompletedPayloads,installPayloadIndexes} from '../memory/payload-compaction';
export function inspectCompletedPayloads(path:string){const db=new DatabaseSync(path,{readOnly:true});try{return countCompletedPayloads(db);}finally{db.close();}}
export function compactMemoryPayloads(path:string,options:{stopped:boolean;batchSize?:number;maxBatches?:number;backupDirectory?:string}){
 if(options.stopped!==true)throw Error('Stop HDSI and supply --stopped before payload compaction');
 const batchSize=options.batchSize??50,maxBatches=options.maxBatches??20;
 if(!Number.isInteger(batchSize)||batchSize<=0||!Number.isInteger(maxBatches)||maxBatches<=0)throw Error('batchSize and maxBatches must be positive integers');
 const before=inspectCompletedPayloads(path);
 if(!Object.values(before).some(Boolean))return {before,after:before,batches:0,totalUpdated:0,hasMore:false,backupPath:null};
 const backupPath=join(options.backupDirectory??join(dirname(path),'backups','memory-payloads'),randomUUID());mkdirSync(backupPath,{recursive:true});for(const suffix of ['','-wal','-shm'])if(existsSync(path+suffix))copyFileSync(path+suffix,join(backupPath,basename(path)+suffix));
 const db=new DatabaseSync(path);let batches=0,totalUpdated=0,hasMore=true;
 try{installPayloadIndexes(db);while(batches<maxBatches&&hasMore){db.exec('BEGIN IMMEDIATE');try{const report=compactCompletedPayloads(db,batchSize);db.exec('COMMIT');batches++;totalUpdated+=report.totalUpdated;hasMore=report.hasMore;}catch(error){db.exec('ROLLBACK');throw error;}}}finally{db.close();}
 return {before,after:inspectCompletedPayloads(path),batches,totalUpdated,hasMore,backupPath};
}
