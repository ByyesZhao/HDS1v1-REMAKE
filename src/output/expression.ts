import { buildExpressionView } from '../model/context-views';
import type { ModelRunner } from '../types';
import { expressionTask } from '../model/contracts';
export const runExpression = (models: ModelRunner, input: unknown, options:import('../memory/types').ModelRunOptions={lookup:null}) => {
  const view = buildExpressionView({stage:'expression',input:(input??{}) as import('../model/context-types').StageBusinessSnapshot});
  return models.runModel(expressionTask(typeof view.context.mode === 'string' ? view.context.mode : 'chat'), view, options);
};
