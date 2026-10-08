import { stageInput } from '../model/context-views';
import type { ModelRunner, ScheduledTask, SharedTurnMeta } from '../types';
import { personalTask } from '../model/contracts';
export const runPersonal = (models: ModelRunner, kind: 'chat' | 'life' | 'shared', at: string, tasks: ScheduledTask[], mode: string, messageIds: string[], input: unknown, options?:import('../memory/types').ModelRunOptions, sharedMeta?: SharedTurnMeta | null, publicNarration?: string | null, eligibility:{contactEligible?:boolean}={}) => models.runModel(personalTask(kind, at, tasks, mode, messageIds, sharedMeta, publicNarration,eligibility), stageInput(`personal_${kind}`,input),options);
