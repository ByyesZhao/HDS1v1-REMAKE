import {setup} from './helpers';
import {Storage} from '../src/storage';
import {EnvironmentStore} from '../src/environment/store';
import {SchoolStore} from '../src/school/store';
import {WebSearchService} from '../src/web/service';
import {WebSearchStore} from '../src/web/store';
import {ensureEnvironmentBatch,selectEnvironmentStep} from '../src/environment/scheduler';
export function asyncFixture(stage='world',storage?:Storage){
 const base=setup();if(storage)base.storage.close();
 const d={...base,storage:storage??base.storage,web:undefined as unknown as WebSearchService};
 d.environmentStore=new EnvironmentStore(d.storage);d.schoolStore=new SchoolStore(d.storage);
 d.storage.set('runtime',{...d.storage.runtime(),environmentPlanningVersion:2,nextEnvironmentAt:null});
 d.web=new WebSearchService(new WebSearchStore(d.storage),undefined,d.clock,{enabled:false});
 const batch=ensureEnvironmentBatch(d.storage,d.config,d.clock.now())!;
 for(const s of d.environmentStore.steps(batch.id)){if(s.stage===stage)break;d.environmentStore.saveStep({...s,status:'committed'});}
 return {d,step:selectEnvironmentStep(d.storage,d.clock.now())!,batch};
}
