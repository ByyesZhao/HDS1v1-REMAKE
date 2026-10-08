import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Storage } from '../src/storage';
import { HdsiApp } from '../src/app';
import { InputBuffer } from '../src/host/input';
import { Scheduler } from '../src/host/scheduler';
import { ModelClient, ChatCompletionsTransport } from '../src/model/client';
import { loadSettings, appConfig, connectionFor, initialState } from '../src/settings';
import { MemoryStore } from '../src/memory/store';
import type { ModelRunner, ModelTask, OutboxItem, SharedNarrativeResult, PersonalResult } from '../src/types';
import type { ModelRunOptions } from '../src/memory/types';

// Explicit online acceptance, isolated database, recording sender, virtual time.
// No production database path, real QQ sender, embedding, or search adapter.
async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => args[args.indexOf(flag) + 1];
  if (!args.includes('--online') || !args.includes('--config')) throw Error('Explicit --online --config <local settings> required.');
  const configPath = resolve(value('--config'));
  const settings = loadSettings(configPath);
  const selected = args.includes('--scenario') ? value('--scenario') : 'all';
  if (!['all', 'quiet', 'interactive', 'wrap'].includes(selected)) throw Error('Unknown scenario.');
  const root = join(dirname(configPath), 'runtime', 'data', `shared-acceptance-${randomUUID()}`);
  mkdirSync(root, { recursive: true });
  console.log(`Isolated report: ${root}`);
  const summaries: unknown[] = [];
  for (const scenario of (selected === 'all' ? ['quiet', 'interactive'] : [selected])) {
    let now = '2026-10-08T19:00:00+08:00';
    const clock = { now: () => now };
    const advance = (ms: number) => { now = new Date(Date.parse(now) + ms).toISOString(); };
    const storage = new Storage(join(root, `${scenario}.sqlite`));
    const reports: any[] = [], sent: OutboxItem[] = [];
    let round: any = null, calls = 0, repairs = 0;
    const transport = new ChatCompletionsTransport(task => connectionFor(settings, task));
    const client = new ModelClient({ complete: async (request, options) => {
      calls++; if (request.repair) repairs++;
      console.log(`${scenario}: ${round?.step ?? '-'} ${request.task.name}${request.repair ? ' repair' : ''}`);
      return transport.complete(request, { signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(120_000)]) : AbortSignal.timeout(120_000) });
    } });
    const models: ModelRunner = { async runModel<T>(task: ModelTask<T>, input: unknown, options?: ModelRunOptions): Promise<T> {
      const result = await client.runModel(task, input, options);
      if (round) round[task.name] = result; // Output only; never serialize private prompts/config/credentials.
      return result;
    } };
    const cfg = { ...appConfig(settings), stickersEnabled: false };
    const state = initialState(settings, now);
    const title = scenario === 'interactive' ? '线下校园短途散步' : '线上二十分钟协作关卡试跑';
    // Explicit seed: the activity has already been mutually confirmed and its marker recorded.
    // This does not test a real user's confirmation or delivery of the start marker.
    state.sleep = null;
    state.scene = { mode: scenario === 'interactive' ? 'shared_offline' : 'shared_online',
      description: scenario === 'interactive' ? '校园店铺门外，两人已约好一起短途散步' : '线上共同游戏已进入二十个小关卡的试跑大厅', activity: null,
      shared: { activityId: randomUUID(), title, progress: scenario === 'wrap' ? '前十六个关卡已试跑，最后四个待完成' : '双方刚刚确认活动并准备开始',
        lastPublicNode: '', completedSteps: scenario === 'wrap' ? 16 : 0, maxSteps: 20, idleSeconds: 60,
        outline: scenario === 'wrap' ? { goal: '完成二十分钟协作试跑', openThreads: ['完成最后四个关卡并回到大厅'], endingCondition: '完成或合理暂停本次试跑并交代剩余内容' } : null, nextStepAt: null } };
    state.plan = scenario === 'interactive' ? '刚刚双方已确认现在一起散步，用户可随时动作参与或结束。'
      : '刚刚双方已确认现在开始二十分钟协作试跑，共二十个约一分钟的小关卡。按实际已过去时间推进，不把一分钟写成全程结束；允许合理暂停，最后回到大厅。';
    storage.set('character', state);
    storage.set('runtime', { ...storage.runtime(), nextWorldAt: null, nextSchoolAt: null,
      sharedClock: { activityId: state.scene.shared!.activityId, mode: state.scene.mode as 'shared_online' | 'shared_offline', status: 'active', startedAt: now, lastInputAt: null, lastOutputAt: null, lastSilentCompletedAt: null } });
    const memoryStore = new MemoryStore(storage); memoryStore.migrate(now);
    for (const detail of settings.initialDetails) {
      memoryStore.saveOwner(memoryStore.makeOwner({ ownerType: 'detail', ownerId: detail.key }, { ...detail, content: detail.value }, now));
    }
    const app = new HdsiApp({ storage, clock, models, config: cfg, memoryStore, random: { next: () => 0.5 },
      sender: { async sendItem(item) { sent.push(structuredClone(item)); return { platformMessageIds: [`acceptance-${randomUUID()}`] }; }, async sendError() {} },
      wait: async ms => advance(ms) });
    const input = new InputBuffer(storage), scheduler = new Scheduler(storage);
    let failure: string | null = null;
    try {
      while (storage.character().scene.shared) {
        const step = storage.character().scene.shared!.completedSteps + 1;
        round = { step, at: now, input: null };
        if (scenario === 'interactive' && step === 2) round.input = '【动作：把手里的水杯递过去】先在店门外等等我。';
        if (scenario === 'interactive' && step === 4) round.input = '我刚才还在店外，没有进店；接下来按我这条继续，前面已发的记录保留。';
        if (scenario === 'interactive' && step === 6) round.input = '今天散步先到这里吧，我们现在结束，剩下的路下次再走。';
        if (round.input) await input.acceptInput({ id: randomUUID(), content: round.input, receivedAt: now });
        if (step !== 1) advance(60_000);
        const request = await scheduler.collectReady(now);
        if (!request?.sharedMeta) throw Error('No selected shared node.');
        round.meta = request.sharedMeta;
        reports.push(round);
        await app.runTurn(request);
        const n = round.narrative_shared as SharedNarrativeResult, p = round.personal_shared as PersonalResult;
        if ((step === 1 || p.sharedChange?.action === 'end') && !n.publicNarration?.trim()) throw Error('Missing public boundary narration.');
        if (step > 20) throw Error('Exceeded twenty nodes.');
        round.done = true;
        writeFileSync(join(root, `${scenario}.json`), JSON.stringify({ scenario, seed: state, reports, sent, calls, repairs }, null, 2));
        console.log(`${scenario}: node ${step} ${request.sharedMeta.phase} committed`);
      }
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
      console.log(`${scenario}: failed; see private report`);
    } finally {
      const summary = { scenario, seedCompletedSteps: state.scene.shared!.completedSteps,
        nodes: reports.filter(r => r.done).length, finalStep: reports.at(-1)?.step,
        phases: [...new Set(reports.filter(r => r.done).map(r => r.meta.phase))],
        ended: storage.character().scene.mode === 'chat', calls, repairs, failure,
        memoryCount: storage.all('memories').length, detailCount: storage.all('details').length };
      summaries.push(summary);
      writeFileSync(join(root, `${scenario}.json`), JSON.stringify({ summary, seed: state, reports, sent }, null, 2));
      writeFileSync(join(root, 'summary.json'), JSON.stringify(summaries, null, 2));
      storage.close();
      console.log(JSON.stringify({ ...summary, failure: failure ? 'private report' : null }));
      if (failure) process.exitCode = 1;
    }
  }
}
main().catch(() => { console.error('Acceptance setup failed; no service started. Check local configuration.'); process.exitCode = 1; });
