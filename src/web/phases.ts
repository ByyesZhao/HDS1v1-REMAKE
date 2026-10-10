import type {ModelRunOptions} from '../memory/types';
import type {ModelRunRef} from './types';
import type {WebSearchService} from './service';
export function phaseOptions(web:WebSearchService|undefined,ownerType:ModelRunRef['ownerType'],ownerId:string,stageKey:string,taskName:string,options:ModelRunOptions={}):ModelRunOptions {
 if(!web)return {...options,web:null};
 const runRef=web.store.openStage(ownerType,ownerId,stageKey,taskName);return {...options,runRef,web:web.openSession(runRef)};
}

export function turnPhaseOptions(web:WebSearchService|undefined,turn:import('../types').TurnRecord,stageKey:string,taskName:string,options:ModelRunOptions={}):ModelRunOptions{
 return phaseOptions(web,'turn',turn.id,turn.replyFreshness?`reply:${turn.replyFreshness.generation}:${stageKey}:${taskName}`:stageKey,taskName,options);
}
export function replyBusinessStageKeys(generation:number):string[]{
 return [['narrative','narrative'],['narrative','narrative_shared'],['personal','personal_chat'],['personal','personal_life'],['personal','personal_shared'],['expression','expression'],['memory','memory']].map(([stage,task])=>`reply:${generation}:${stage}:${task}`);
}
