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
  const models: ModelRunner = {
    async runModel<T>(task: ModelTask<T>, input: any): Promise<T> {
      let output: unknown;
      if (task.name === 'narrative') output = { experiences: [], currentScene: { description: '开发样例：仍在宿舍休息', activity: null }, energy: { level: '正常', reason: '休息后' } };
      else if (task.name === 'personal_chat') output = { emotions: [], reply: { decision: 'now', intention: '告诉用户已有的手机型号', draft: '我用的是某手机' }, taskChanges: [] };
      else if (task.name === 'expression') output = { parts: [{ kind: 'text', content: '我用某手机呀' }, { kind: 'text', content: '你想换手机吗' }] };
      else if (task.name === 'memory') output = { schemaVersion:3,shortTermChanges: [], longTermChanges: [], detailChanges: [{ action: 'create', key: 'character.phone.model', value: '某手机', aliases: ['手机', '型号'], reason: '开发样例实际输出', sourceIds: [input.outgoing[0].id] }] };
      else throw new Error(`Demo fixture missing for ${task.name}`);
      return task.parse(output);
    },
  };
  const app = new HdsiApp({ storage, clock, random: { next: () => 0.5 }, models, config: { ...defaultConfig, background: '开发样例', chatExamples: '嗯嗯' },
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
    console.log('开发样例结束；未连接 QQ、未调用外部模型、未写正式数据库。');
  } finally { storage.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
