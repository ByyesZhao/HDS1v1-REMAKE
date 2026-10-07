import type { ModelRunner, ScheduledTask } from '../types';
import { personalTask } from '../model/contracts';
export const runPersonal = (models: ModelRunner, kind: 'chat' | 'life' | 'shared', at: string, tasks: ScheduledTask[], mode: string, messageIds: string[], input: unknown, options?:import('../memory/types').ModelRunOptions) => models.runModel(personalTask(kind, at, tasks, mode, messageIds), input,options);
