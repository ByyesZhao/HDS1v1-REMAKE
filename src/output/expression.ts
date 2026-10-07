import type { ModelRunner } from '../types';
import { expressionTask } from '../model/contracts';
export const runExpression = (models: ModelRunner, input: unknown, options:import('../memory/types').ModelRunOptions={lookup:null}) => models.runModel(expressionTask(), input,options);
