import type { Dependencies } from '../app';
import { runEnvironment } from './world';
export const runSchool = (d: Dependencies, at: string,turnId?:string) => runEnvironment(d, 'school', at,turnId);
import type {EnvironmentStepInput,EnvironmentModelResult} from '../environment/types';
import {schoolCampusTask,schoolGroupTask,schoolWeekTask} from '../school/contracts';
import {phaseOptions} from '../web/phases';
import {ContextBuilder} from '../memory/context';
import {makeRetrievalRequest} from '../memory/retrieval';
import {environmentTask} from '../model/contracts';
import type {SchoolExpansionInput} from '../school/types';
function optionsFor(d:Dependencies,input:EnvironmentStepInput){
 const context=new ContextBuilder(d.storage,d.retrieval),query=input.stage==='world'?d.config.worldSetting:d.config.schoolSetting;
 return phaseOptions(d.web,'environment',JSON.stringify([input.batchId,input.stage]),'generation',input.stage,{lookup:q=>context.retrieval.lookup(q,makeRetrievalRequest(query,input.at,input.stage,d.config.historyBudget))});
}
async function school(d:Dependencies,input:EnvironmentStepInput):Promise<EnvironmentModelResult>{
 const options=optionsFor(d,input),urls=()=>options.runRef?d.web!.providedUrls(options.runRef.runId):[];
 const task=input.stage==='school_campus'?schoolCampusTask(d,urls):input.stage==='school_group'?schoolGroupTask(d,urls):schoolWeekTask((input.context as Partial<SchoolExpansionInput>).requiredOccurrences?input.context as SchoolExpansionInput:undefined);
 return d.models.runModel(task,input,options);
}
export const runSchoolCampus=(d:Dependencies,input:EnvironmentStepInput)=>school(d,input);
export const runSchoolGroup=(d:Dependencies,input:EnvironmentStepInput)=>school(d,input);
export const runSchoolWeek=(d:Dependencies,input:EnvironmentStepInput)=>school(d,input);
export async function generateEnvironmentStep(d:Dependencies,input:EnvironmentStepInput):Promise<EnvironmentModelResult>{
 if(input.stage!=='world')return school(d,input);
 const options=optionsFor(d,input),context=input.context as {events?:import('../types').EnvironmentEvent[]};
 const events=(context.events??[]).filter(e=>e.kind==='world');
 const result=await d.models.runModel(environmentTask('world',events,()=>options.runRef?d.web!.providedUrls(options.runRef.runId):[]),input,options);
 return {stage:'world',changes:result.changes};
}
