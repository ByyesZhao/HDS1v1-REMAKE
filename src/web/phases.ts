import type {ModelRunOptions} from '../memory/types';
import type {ModelRunRef} from './types';
import type {WebSearchService} from './service';
export function phaseOptions(web:WebSearchService|undefined,ownerType:ModelRunRef['ownerType'],ownerId:string,stageKey:string,taskName:string,options:ModelRunOptions={}):ModelRunOptions {
 if(!web)return {...options,web:null};
 const runRef=web.store.openStage(ownerType,ownerId,stageKey,taskName);return {...options,runRef,web:web.openSession(runRef)};
}
