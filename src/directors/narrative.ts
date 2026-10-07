import type { ModelRunner } from '../types';
import { narrativeTask } from '../model/contracts';
export const runNarrative = (models: ModelRunner, shared: boolean, from: string, at: string, eventIds: string[], input: unknown, options?:import('../memory/types').ModelRunOptions) => models.runModel(narrativeTask(shared, from, at, eventIds), input,options);
