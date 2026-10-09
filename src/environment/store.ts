import type { Storage } from '../storage';
import type { EnvironmentBatch, EnvironmentStep,EnvironmentStepMetadata } from './types';
export class EnvironmentStore {
 constructor(readonly storage:Storage){}
 batches(){return this.storage.all('environment_batches');}
 activeBatches():EnvironmentBatch[]{return this.storage.prepare("SELECT data FROM environment_batches WHERE json_extract(data,'$.status')='active' ORDER BY rowid").all().map(r=>JSON.parse(String(r.data)));}
 firstActiveBatch():EnvironmentBatch|null{const r=this.storage.prepare("SELECT data FROM environment_batches WHERE json_extract(data,'$.status')='active' ORDER BY rowid LIMIT 1").get();return r?JSON.parse(String(r.data)):null;}
 latestBatch():EnvironmentBatch|null{const r=this.storage.prepare('SELECT data FROM environment_batches ORDER BY rowid DESC LIMIT 1').get();return r?JSON.parse(String(r.data)):null;}
 stepMetadata(batchId:string):EnvironmentStepMetadata[]{return this.storage.prepare("SELECT id,json_extract(data,'$.batchId') AS batchId,json_extract(data,'$.stage') AS stage,json_extract(data,'$.status') AS status,json_extract(data,'$.retryAt') AS retryAt,json_extract(data,'$.preparationVersion') AS preparationVersion,json_extract(data,'$.preparationGeneration') AS preparationGeneration,json_extract(data,'$.attempt') AS attempt,json_extract(data,'$.startedAt') AS startedAt,json_extract(data,'$.staleReason') AS staleReason FROM environment_steps WHERE json_extract(data,'$.batchId')=? ORDER BY rowid").all(batchId) as unknown as EnvironmentStepMetadata[];}
 steps(batchId?:string):EnvironmentStep[]{return batchId===undefined?this.storage.all('environment_steps'):this.storage.prepare("SELECT data FROM environment_steps WHERE json_extract(data,'$.batchId')=? ORDER BY rowid").all(batchId).map(r=>JSON.parse(String(r.data)));}
 batch(id:string){return this.storage.read('environment_batches',id);}
 step(id:string){return this.storage.read('environment_steps',id);}
 saveBatch(batch:EnvironmentBatch){this.storage.save('environment_batches',batch.id,batch);}
 saveStep(step:EnvironmentStep){this.storage.save('environment_steps',step.id,step);}
}
