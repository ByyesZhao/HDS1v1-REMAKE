import { stageInput } from '../model/context-views';
import type { ModelRunner, SharedTurnMeta, SharedOutline,NarrativeResult } from '../types';
import { narrativeTask } from '../model/contracts';
export const runNarrative = (models: ModelRunner, shared: boolean, from: string, at: string, eventIds: string[], input: unknown, options?:import('../memory/types').ModelRunOptions, sharedMeta?: SharedTurnMeta | null, previousOutline?: SharedOutline | null,validateSchool?:(r:NarrativeResult)=>void) => models.runModel(narrativeTask(shared, from, at, eventIds, sharedMeta, previousOutline,validateSchool), stageInput(shared?'narrative_shared':'narrative',input),options);
