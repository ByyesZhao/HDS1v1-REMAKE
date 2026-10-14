// Offline, read-only replay. Never dispatches models or modifies a maintenance job.
const {createRequire}=require('node:module');
const {resolve,join}=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const fs=require('node:fs');
const sourceRoot=resolve(process.argv[2]||join(__dirname,'../../../../..'));
const database=resolve(process.argv[3]||join(sourceRoot,'runtime/data/hdsi-remake.sqlite'));
const sourceRequire=createRequire(join(sourceRoot,'package.json'));sourceRequire('tsx/cjs');
const {consolidationTask}=sourceRequire('./src/model/contracts.ts');
const {buildCompletionEnvelope}=sourceRequire('./src/model/resource-pool.ts');
const db=new DatabaseSync(database,{readOnly:true});
const jobs=db.prepare('SELECT data FROM memory_maintenance_jobs').all().map(r=>JSON.parse(r.data));
const job=jobs.find(j=>j.id==='f7669e69-96cd-4638-b417-48770a2a3681');
if(!job?.snapshot?.length)throw Error('Original failed snapshot unavailable; do not substitute current owners.');
const task=consolidationTask(job.snapshot,job.selectedIds,job.kind,job.cutoff);
const records=db.prepare("SELECT data FROM model_run_records WHERE json_extract(data,'$.ownerId')=?").all(job.id).map(r=>JSON.parse(r.data));
const responses=records.filter(r=>typeof r.rawResponse==='string').map(r=>{
 const raw=JSON.parse(r.rawResponse);
 const input=buildCompletionEnvelope({task,input:r.checkpoint.input});
 const provided=new Set(input.resources.owners.map(o=>o.ref));
 const read=raw.units.flatMap(u=>u.readOwners);
 try{const units=task.parse(raw);return {at:r.occurredAt,repairCount:r.checkpoint.repairCount,readRefs:read.filter(id=>provided.has(id)).length,readCount:read.length,passed:true,units:units.length,normalizedIdsOnly:units.every(u=>u.readOwners.every(id=>job.snapshot.some(o=>o.id===id)))};}
 catch(e){return {at:r.occurredAt,passed:false,error:e.message};}
});
db.close();
const report={checkedAt:new Date().toISOString(),source:'TypeScript source via tsx/cjs',offline:true,databaseReadOnly:true,jobId:job.id,snapshotCount:job.snapshot.length,selectedCount:job.selectedIds.length,responses};
if(process.argv[4])fs.writeFileSync(resolve(process.argv[4]),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
if(responses.length!==5||responses.some(r=>!r.passed||!r.normalizedIdsOnly))process.exitCode=1;
