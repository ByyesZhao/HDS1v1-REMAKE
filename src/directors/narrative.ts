import { stageInput } from '../model/context-views';
import type { ModelRunner, SharedTurnMeta, SharedOutline,NarrativeResult } from '../types';
import { narrativeTask } from '../model/contracts';
export const runNarrative = (models: ModelRunner, shared: boolean, from: string, at: string, eventIds: string[], input: unknown, options?:import('../memory/types').ModelRunOptions, sharedMeta?: SharedTurnMeta | null, previousOutline?: SharedOutline | null,validateSchool?:(r:NarrativeResult)=>void) => {
  const view = stageInput(shared?'narrative_shared':'narrative',input);
  const state = view.context.state as import('../types').CharacterState | undefined;
  return models.runModel(narrativeTask(shared, from, at, eventIds, sharedMeta, previousOutline,validateSchool,state?.scene.mode ?? (shared ? 'shared_online' : 'chat')), view, options);
};
