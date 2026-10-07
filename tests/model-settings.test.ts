import { it, expect } from 'vitest';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadSettings, connectionFor, type StorySettings } from '../src/settings';
import { ChatCompletionsTransport, ModelClient } from '../src/model/client';
import type { ModelTask } from '../src/types';

async function withSettings(change: (sample: any) => void, run: (settings: StorySettings) => Promise<void>) {
  const root = mkdtempSync(join(tmpdir(), 'hdsi-model-settings-'));
  try {
    const sample = JSON.parse(readFileSync('examples/story.sample.json', 'utf8'));
    change(sample);
    writeFileSync(join(root, 'story.json'), JSON.stringify(sample));
    await run(loadSettings(join(root, 'story.json'), {}));
  } finally { rmSync(root, { recursive: true }); }
}
function task(name: string): ModelTask<{ ok: true }> {
  return { name, prompt: 'Return JSON with ok true.', schema: { type: 'object' }, parse(value) {
    if ((value as { ok?: boolean })?.ok !== true) throw new Error('expected ok true');
    return { ok: true };
  } };
}
function captureTransport(settings: StorySettings, responses: string[] = ['{"ok":true}']) {
  const requests: Array<Record<string, any>> = [];
  const fetcher: typeof fetch = async (_url, init) => {
    requests.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify({ choices: [{ message: { content: responses.shift() } }] }), { status: 200 });
  };
  return { requests, transport: new ChatCompletionsTransport(name => connectionFor(settings, name, { DEEPSEEK_API_KEY: 'fixture-only' }), fetcher) };
}

it.each([['narrative', 'low'], ['memory', 'high'], ['sticker_description', 'high']])('sends the configured model and effort for %s through the HTTP transport', async (name, effort) => {
  await withSettings(sample => {
    const c = name === 'sticker_description' ? sample.stickerDescriptionModel : sample.models[name];
    c.model = 'deepseek-flash'; c.reasoningEffort = effort;
  }, async settings => {
    const { requests, transport } = captureTransport(settings);
    expect(await new ModelClient(transport).runModel(task(name), {})).toEqual({ ok: true });
    expect(requests[0]).toMatchObject({ model: 'deepseek-flash', reasoning_effort: effort });
  });
});
it('allows one task to switch to Pro without changing another task', async () => {
  await withSettings(sample => {
    sample.models.narrative = { model: 'deepseek-v4-pro', reasoningEffort: 'low' };
    sample.models.memory = { model: 'deepseek-flash', reasoningEffort: 'high' };
  }, async settings => {
    const { requests, transport } = captureTransport(settings, ['{"ok":true}', '{"ok":true}']);
    await transport.complete({ task: task('narrative'), input: {} });
    await transport.complete({ task: task('memory'), input: {} });
    expect(requests.map(({ model, reasoning_effort }) => [model, reasoning_effort])).toEqual([
      ['deepseek-v4-pro', 'low'], ['deepseek-flash', 'high'],
    ]);
  });
});
it('keeps the task model and effort during local detail continuation and format repair', async () => {
  await withSettings(sample => {
    sample.models.personal_chat = { model: 'deepseek-flash', reasoningEffort: 'low' };
  }, async settings => {
    const { requests, transport } = captureTransport(settings, ['{"lookupDetails":"测试事实"}', 'invalid JSON', '{"ok":true}']);
    expect(await new ModelClient(transport, query => ({ query, value: '本地事实' })).runModel(task('personal_chat'), {})).toEqual({ ok: true });
    expect(requests).toHaveLength(3);
    expect(requests.map(({ model, reasoning_effort }) => [model, reasoning_effort])).toEqual(Array(3).fill(['deepseek-flash', 'low']));
    expect(JSON.parse(requests[1].messages[1].content).lookupResult).toEqual({ query: '测试事实', value: '本地事实' });
    expect(JSON.parse(requests[2].messages[1].content).repair.original).toBe('invalid JSON');
  });
});
it('defaults omitted effort to high and rejects unsupported effort values', async () => {
  await withSettings(sample => { delete sample.models.world.reasoningEffort; }, async settings => {
    expect(connectionFor(settings, 'world', { DEEPSEEK_API_KEY: 'fixture-only' })).toHaveProperty('reasoningEffort', 'high');
  });
  await expect(withSettings(sample => { sample.models.world.reasoningEffort = 'normal'; }, async () => {})).rejects.toThrow(/reasoningEffort/);
});
