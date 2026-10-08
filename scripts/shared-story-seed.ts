import { randomUUID } from 'node:crypto';
import type { CharacterState, SharedClock } from '../src/types';

export function sharedStorySeed(base: CharacterState, scenario: string, now: string): { state: CharacterState; clock: SharedClock } {
  const state = structuredClone(base);
  const title = scenario === 'interactive' ? '线下校园短途散步' : '线上二十分钟协作关卡试跑';
  state.sleep = null;
  state.scene = { mode: scenario === 'interactive' ? 'shared_offline' : 'shared_online',
    description: scenario === 'interactive' ? '校园店铺门外，两人已约好一起短途散步' : '线上共同游戏已进入二十个小关卡的试跑大厅', activity: null,
    shared: { activityId: randomUUID(), title, progress: scenario === 'wrap' ? '前十六个关卡已试跑，最后四个待完成' : '双方刚刚确认活动并准备开始',
      lastPublicNode: '', completedSteps: scenario === 'wrap' ? 16 : 0, maxSteps: 20, idleSeconds: 60,
      outline: scenario === 'wrap' ? { goal: '完成二十分钟协作试跑', openThreads: ['完成最后四个关卡并回到大厅'], endingCondition: '完成或合理暂停本次试跑并交代剩余内容' } : null, nextStepAt: null } };
  state.plan = scenario === 'interactive' ? '刚刚双方已确认现在一起散步，用户可随时动作参与或结束。'
    : '刚刚双方已确认现在开始二十分钟协作试跑，共二十个约一分钟的小关卡。按实际已过去时间推进，不把一分钟写成全程结束；允许合理暂停，最后回到大厅。';
  const startedAt = scenario === 'wrap' ? new Date(Date.parse(now) - 16 * 60_000).toISOString() : now;
  if (scenario === 'wrap') {
    state.scene.activity = { description: title, startsAt: startedAt, expectedEndAt: new Date(Date.parse(startedAt) + 20 * 60_000).toISOString(), phoneAccess: true };
    state.scene.shared!.lastPublicNode = '前十六个小关卡已试跑结束，回到关卡选择处，余下四个等待继续。';
    state.plan = `本次试跑于${startedAt}开始，已经进行约十六分钟、完成十六个关卡；当前是续场，余下四关。按已过去时间继续，二十分钟只是预计时长，允许合理暂停并回到大厅交代剩余内容。`;
  }
  return { state, clock: { activityId: state.scene.shared!.activityId, mode: state.scene.mode as SharedClock['mode'], status: 'active',
    startedAt, lastInputAt: null, lastOutputAt: scenario === 'wrap' ? now : null, lastSilentCompletedAt: null } };
}
