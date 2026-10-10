import { it, expect } from 'vitest';
import { HdsiApp, generateTurn } from '../src/app';
import { StickerLibrary, HttpEmbeddingProvider } from '../src/output/stickers';
import { setup, saveInput, SequenceRandom, NOW } from './helpers';

it('selects the highest cosine score without a matching threshold', async () => {
  const d = setup();
  for (const [id, embedding] of [['a', [-1, 0]], ['b', [-0.2, 0.9]]] as const) d.storage.save('stickers', id, { id, embedding: [...embedding], path: `${id}.png`, description: id, embeddingModel: 'qwen-test' });
  const library = new StickerLibrary(d.storage, { model: 'qwen-test', embed: async () => [1, 0] });
  expect(await library.findSticker('严肃话题')).toBe('b');
  d.storage.close();
});
it('requests the configured dimension so imported vectors and queries use the same space', async () => {
  let body: any;
  const fetcher: typeof fetch = async (_, init) => {
    body = JSON.parse(String(init?.body));
    return new Response(JSON.stringify({ data: [{ embedding: [1, 0] }] }));
  };
  const provider = new HttpEmbeddingProvider('qwen-test', 'https://embedding.invalid/v1', 'fixture', fetcher, 2);
  expect(await provider.embed('你好')).toEqual([1, 0]);
  expect(body).toMatchObject({ model: 'qwen-test', input: '你好', dimensions: 2 });
});
it('samples every text, inserts each hit immediately, and freezes the final cross-turn counter', async () => {
  const d = setup(); saveInput(d.storage, 'a', '你好'); d.config.stickersEnabled = true;
  d.storage.set('runtime', { ...d.storage.runtime(), stickerMisses: 2, contactMisses: 7 });
  d.storage.set('character', { ...d.storage.character(), sleep: { sleepAt: '2026-10-07T23:30:00+08:00', wakeAt: '2026-10-08T08:30:00+08:00' } });
  // Foreground idle interval, followed by the three unchanged sticker opportunities.
  d.random = new SequenceRandom([0.5, 0.999, 0, 0.999]);
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '回答', draft: '严肃内容' }, taskChanges: [] };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '一' }, { kind: 'text', content: '二' }, { kind: 'text', content: '三' }] };
  let lookups = 0; const stickers = { findSticker: async () => { lookups++; return 's'; } };
  const result = await generateTurn({ ...d, stickers }, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
  expect(result.items.map(i => i.kind)).toEqual(['text', 'text', 'sticker', 'text']);
  expect(lookups).toBe(1); expect(result.candidate.probability.stickerMisses).toBe(1);
  expect(result.candidate.probability.contactMisses).toBe(7); expect(d.storage.runtime().stickerMisses).toBe(2);
  d.random = new SequenceRandom([0.5, 0.999, 0, 0.999]);
  await new HdsiApp({ ...d, stickers }).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(d.storage.runtime().stickerMisses).toBe(1);
  d.storage.close();
});
it('excludes offline entry and exit text and preserves the count', async () => {
  const d = setup(); saveInput(d.storage, 'a', '一起走'); d.config.stickersEnabled = true; d.random = new SequenceRandom([0]);
  d.storage.set('runtime', { ...d.storage.runtime(), stickerMisses: 10 });
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '确认', draft: '好', actions: ['点头'] }, taskChanges: [], sharedChange: { action: 'start', mode: 'shared_offline', title: '散步' } };
  d.models.outputs.expression = { parts: [{ kind: 'action', content: '点头' }, { kind: 'text', content: '好' }] };
  const stickers = { findSticker: async () => { throw new Error('offline must not retrieve'); } };
  const r = await generateTurn({ ...d, stickers }, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
  expect(r.items.map(i => i.kind)).toEqual(['narration', 'action', 'text']); expect(r.candidate.probability.stickerMisses).toBe(10);
  d.storage.close();
});
