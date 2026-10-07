import type { MemoryResult, TurnRecord, TurnCandidate } from '../types';
import type { Dependencies } from '../app';
import { memoryTask } from '../model/contracts';
import { ContextBuilder } from './context';
import { MemoryStore } from './store';
import { MemoryLifecycle } from './lifecycle';
import { makeRetrievalRequest } from './retrieval';
import { phaseOptions } from '../web/phases';

export function currentSelfWebReads(d:Dependencies,turnId:string) {return (d.web?.selfReadSources(turnId)??d.getSelfWebReadSources?.(turnId)??[]).filter(s=>s.turnId===turnId&&s.phase==='personal_life'&&s.sourceKind==='self_web_read');}

export async function organizeMemory(d: Dependencies, turn: TurnRecord): Promise<MemoryResult> {
  const c = turn.frozenResult!;
  const visibleMessages = c.visibleMessageIds.map(id => d.storage.read('messages', id)!);
  const reconsiderMessages = c.reconsiderMessageIds.map(id => d.storage.read('messages', id)!);
  const outgoing = d.storage.messages().filter(m => m.direction === 'outgoing' && m.turnId === turn.id);
  const sourceIds = [...c.experiences.map(e => e.id), ...visibleMessages.map(m => m.id), ...outgoing.map(m => m.id)];
  const query = [...c.experiences.map(e => e.description), ...visibleMessages.map(m => m.content), ...outgoing.map(m => m.content)].join('\n');
  const builder=new ContextBuilder(d.storage,d.retrieval),base=makeRetrievalRequest(query,turn.at,'memory',d.config.historyBudget,sourceIds);
  const context = await builder.buildForMemory(base);
  const memories = context.retrieved;
  const selfWebReadSources=currentSelfWebReads(d,turn.id);
  const shortIds=memories.filter(m=>m.ownerType==='short').map(m=>m.id);
  const longIds=memories.filter(m=>m.ownerType==='long'||m.ownerType==='learned').map(m=>m.id);
  const options=phaseOptions(d.web,'turn',turn.id,'memory','memory',{lookup:async q=>{const found=await builder.retrieval.lookup(q,base);const result=builder.retrieval.budget({details:found.details,retrieved:[...found.shortTerm,...found.longTerm,...found.learned]},base.budget,base.permissions.visibleSourceIds);includeLookupIds(result);return result;}});
  function includeLookupIds(result:unknown){if(!result||typeof result!=='object'||!('retrieved' in result)||!Array.isArray(result.retrieved))return;for(const row of result.retrieved){const ids=row.kind==='short'?shortIds:longIds;if(['short','long','learned'].includes(row.kind)&&!ids.includes(row.id))ids.push(row.id);}}
  includeLookupIds(options.web?.snapshot().checkpoint?.privateLookupResult);
  return d.models.runModel(memoryTask(sourceIds,longIds,shortIds,selfWebReadSources.map(s=>s.id)), {
    at: turn.at, background: d.config.background, experiences: c.experiences, visibleMessages, reconsiderMessages, outgoing,
    arrangementsAndIntent: { plan: c.nextState.plan, tasks: c.taskChanges },
    details: context.details, retrieved: memories,
    selfWebReadSources,
    selfWebReadMaterials:selfWebReadSources.map(source=>({sourceId:source.id,material:d.web?.store.snapshot(source.runId).materials.find(m=>m.id===source.materialId)})),
    ...(selfWebReadSources.length&&c.personal&&'innerThought' in c.personal?{selfWebReadReactions:{innerThought:c.personal.innerThought,emotions:c.personal.emotions}}:{}),
  },options);
}

// Called only inside the same transaction as the story and turn completion.
export function applyMemory(d: Dependencies, turnId: string, result: MemoryResult, at: string): void {
  const turn=d.storage.read('turns',turnId)!;const candidate=turn.frozenResult!;
  const sources=[...candidate.experiences.map(e=>e.id),...candidate.visibleMessageIds,...d.storage.messages().filter(m=>m.direction==='outgoing'&&m.turnId===turnId).map(m=>m.id)];
  const selfSources=d.storage.read('post_jobs',turnId)?.selfWebReadSources??currentSelfWebReads(d,turnId);
  (d.memoryLifecycle??new MemoryLifecycle(d.memoryStore??new MemoryStore(d.storage))).apply(result,turnId,at,sources,selfSources.map(s=>s.id));
}

export function applyTasks(d: Dependencies, candidate: TurnCandidate): void {
  const explicit = new Set(candidate.taskChanges.filter(c => c.action !== 'create').map(c => c.id));
  for (const id of candidate.completedTaskIds) {
    const old = d.storage.read('tasks', id);
    if (old && !explicit.has(id)) d.storage.save('tasks', id, { ...old, status: 'completed' });
  }
  candidate.taskChanges.forEach(change => {
    if (change.action === 'create') {
      d.storage.save('tasks', change.id!, { ...change.task, id: change.id!, status: 'pending' });
    } else {
      const old = d.storage.read('tasks', change.id)!;
      d.storage.save('tasks', change.id, change.action === 'cancel' ? { ...old, status: 'cancelled' } : { ...old, ...change.task, status: 'pending' });
    }
  });
}
