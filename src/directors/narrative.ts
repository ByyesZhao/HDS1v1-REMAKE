import type { ModelRunner, SharedTurnMeta, SharedOutline } from '../types';
import { narrativeTask } from '../model/contracts';
export const runNarrative = (models: ModelRunner, shared: boolean, from: string, at: string, eventIds: string[], input: unknown, options?:import('../memory/types').ModelRunOptions, sharedMeta?: SharedTurnMeta | null, previousOutline?: SharedOutline | null) => models.runModel(narrativeTask(shared, from, at, eventIds, sharedMeta, previousOutline), input,options);
