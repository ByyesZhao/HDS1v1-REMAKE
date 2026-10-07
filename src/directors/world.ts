import type { Dependencies } from '../app';
import { environmentTask } from '../model/contracts';
import { ContextBuilder } from '../memory/context';
import { makeRetrievalRequest } from '../memory/retrieval';
import { phaseOptions } from '../web/phases';
export async function runEnvironment(d: Dependencies, kind: 'world' | 'school', at: string,turnId=at) {
  const events = d.storage.all('events').filter(e => e.status === 'active');
  const context=new ContextBuilder(d.storage,d.retrieval),base=makeRetrievalRequest(`${d.config.worldSetting}\n${d.config.schoolSetting}`,at,kind,d.config.historyBudget);
  const options=phaseOptions(d.web,'turn',turnId,'environment',kind,{lookup:q=>context.retrieval.lookup(q,base)});
  return d.models.runModel(environmentTask(kind, events,()=>options.runRef?d.web!.providedUrls(options.runRef.runId):[]), {
    at, timezone: d.config.timezone, worldSetting: d.config.worldSetting, schoolSetting: d.config.schoolSetting,
    events, campusDetails: kind === 'school' ? d.storage.all('details').filter(d => /school|roommate|classmate/.test(d.key)) : [],
  },options);
}
export const runWorld = (d: Dependencies, at: string,turnId?:string) => runEnvironment(d, 'world', at,turnId);
