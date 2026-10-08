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
import { sharedStorySeed } from './shared-story-seed';
import type { ModelRunner, ModelTask, OutboxItem, SharedNarrativeResult, PersonalResult } from '../src/types';
import type { ModelRunOptions } from '../src/memory/types';

// Explicit online acceptance, isolated database, recording sender, virtual time.
// No production database path, real QQ sender, embedding, or search adapter.
const requestTimeoutMs = 300_000;
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
        ? AbortSignal.any([options.signal, AbortSignal.timeout(requestTimeoutMs)]) : AbortSignal.timeout(requestTimeoutMs) });
    } });
    const models: ModelRunner = { async runModel<T>(task: ModelTask<T>, input: unknown, options?: ModelRunOptions): Promise<T> {
      const result = await client.runModel(task, input, options);
      if (round) round[task.name] = result; // Output only; never serialize private prompts/config/credentials.
      return result;
    } };
    const cfg = { ...appConfig(settings), stickersEnabled: false };
    // The seed is explicitly pre-confirmed; no live start marker is delivered.
    const { state, clock: sharedClock } = sharedStorySeed(initialState(settings, now), scenario, now);
    storage.set('character', state);
    storage.set('runtime', { ...storage.runtime(), nextWorldAt: null, nextSchoolAt: null, sharedClock });
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
