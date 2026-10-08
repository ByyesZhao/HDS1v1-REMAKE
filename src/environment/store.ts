import type { Storage } from '../storage';
import type { EnvironmentBatch, EnvironmentStep } from './types';
export class EnvironmentStore {
 constructor(readonly storage:Storage){}
 batches(){return this.storage.all('environment_batches');}
 steps(batchId?:string){return this.storage.all('environment_steps').filter(s=>!batchId||s.batchId===batchId);}
 batch(id:string){return this.storage.read('environment_batches',id);}
 step(id:string){return this.storage.read('environment_steps',id);}
 saveBatch(batch:EnvironmentBatch){this.storage.save('environment_batches',batch.id,batch);}
 saveStep(step:EnvironmentStep){this.storage.save('environment_steps',step.id,step);}
}
