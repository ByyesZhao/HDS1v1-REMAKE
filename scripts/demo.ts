import { isStageModelInput } from '../src/model/context-types';
import { EnvironmentStore } from '../src/environment/store';
import { SchoolStore } from '../src/school/store';
import { Storage } from '../src/storage';
import { HdsiApp } from '../src/app';
import { InputBuffer } from '../src/host/input';
import { Scheduler } from '../src/host/scheduler';
import { defaultConfig, initialCharacter } from '../src/config';
import type { ModelRunner, ModelTask } from '../src/types';
import { displayText } from '../src/output/qq';

// Explicitly offline: fixed model fixtures, memory database, simulated QQ IDs.
async function main() {
  let now = '2026-10-07T10:00:00+08:00';
  const clock = { now: () => now };
  const storage = new Storage(':memory:'); storage.set('character', initialCharacter(now));
  storage.set('runtime',{...storage.runtime(),nextEnvironmentAt:'2026-10-08T06:00:00+08:00'});
  const models: ModelRunner = {
    async runModel<T>(task: ModelTask<T>, rawInput: any): Promise<T> {
      const input=isStageModelInput(rawInput)?{...rawInput.context,visibleMessages:rawInput.resources.messages.filter(m=>rawInput.roles.visibleIds?.includes(m.id)),outgoing:rawInput.resources.messages.filter(m=>m.direction==='outgoing')}:rawInput;
      let output: unknown;
      if (task.name === 'narrative') output = { experiences: [], currentScene: { description: '开发样例：仍在宿舍休息', activity: null }, energy: { level: '正常', reason: '休息后' } };
      else if (task.name === 'personal_chat') output = input.visibleMessages.some((m: any) => m.content === '现在开始散步')
        ? { emotions: [], reply: { decision: 'none' }, taskChanges: [], sharedChange: { action: 'start', mode: 'shared_offline', title: '开发演示散步' } }
        : { emotions: [], reply: { decision: 'now', intention: '告诉用户已有的手机型号', draft: '我用的是某手机' }, taskChanges: [] };
      else if (task.name === 'narrative_shared') output = {
        experiences: [], currentScene: { description: '开发演示路灯旁', activity: null }, energy: { level: '正常', reason: '短暂散步' },
        publicNarration: input.sharedMeta.phase === 'final' ? '走到路口，这次散步告一段落，剩余路线留待下次。' : '路灯亮起来，晚风拂过树梢。',
        progress: `第${input.sharedMeta.stepNumber}轮`, outline: { goal: '一起短暂散步', openThreads: [], endingCondition: '走到路口后结束' }, simulatedUserActions: [],
      };
      else if (task.name === 'personal_shared') output = { emotions: [], reply: { decision: 'none' }, taskChanges: [], ...(input.sharedMeta.phase === 'final' ? { sharedChange: { action: 'end' }, nextPlan: '下次继续剩余路线' } : {}) };
      else if (task.name === 'expression') output = { parts: [{ kind: 'text', content: '我用某手机呀' }, { kind: 'text', content: '你想换手机吗' }] };
      else if (task.name === 'memory') output = { schemaVersion:3,shortTermChanges: [], longTermChanges: [], detailChanges: input.outgoing.some((m: any) => m.content.includes('某手机')) ? [{ action: 'create', key: 'character.phone.model', value: '某手机', aliases: ['手机', '型号'], reason: '开发样例实际输出', sourceIds: [input.outgoing[0].id] }] : [] };
      else throw new Error(`Demo fixture missing for ${task.name}`);
      return task.parse(output);
    },
  };
  const app = new HdsiApp({ environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),storage, clock, random: { next: () => 0.5 }, models, config: { ...defaultConfig, background: '开发样例', chatExamples: '嗯嗯', sharedMaxSteps: 3 },
    sender: { async sendItem(item) { console.log(`[模拟 QQ ${clock.now()}] ${displayText(item)}`); return { platformMessageIds: [`demo-${item.seq}`] }; }, async sendError(message) { console.log(message); } },
    wait: async ms => { now = new Date(Date.parse(now) + ms).toISOString(); },
  });
  try {
    const input = new InputBuffer(storage);
    for (const [second, content] of [[0, '你的手机'], [10, '是什么型号'], [22, '好用吗']] as const) {
      now = `2026-10-07T10:00:${String(second).padStart(2, '0')}+08:00`;
      await input.acceptInput({ id: `demo-${second}`, receivedAt: now, content });
    }
    now = '2026-10-07T10:00:37+08:00';
    await app.runTurn((await new Scheduler(storage).collectReady(now))!);
    console.log('已提交固定细节：', storage.read('details', 'character.phone.model')!.value);
    const scheduler = new Scheduler(storage);
    await input.acceptInput({ id: 'start', receivedAt: now, content: '现在开始散步' });
    now = new Date(Date.parse(now) + 15_000).toISOString();
    await app.runTurn((await scheduler.collectReady(now))!); // Preparation is not one of the three demo steps.
    await app.runTurn((await scheduler.collectReady(now))!); // Immediate first public node.
    await input.acceptInput({ id: 'advance', receivedAt: now, content: '【推进】' });
    await app.runTurn((await scheduler.collectReady(now))!); // Manual node without waiting.
    now = new Date(Date.parse(now) + 60_000).toISOString();
    await app.runTurn((await scheduler.collectReady(now))!); // Final silent-window node.
    if (storage.character().scene.mode !== 'chat' || storage.all('turns').filter(t => t.sharedMeta).length !== 3) throw new Error('bounded shared demo did not close');
    console.log('共同演示：首次立即、【推进】立即、60秒后末轮结束；仅本演示maxSteps=3，正式默认20。');
    console.log('开发样例结束；未连接 QQ、未调用外部模型、未写正式数据库。');
  } finally { storage.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
