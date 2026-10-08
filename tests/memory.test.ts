import { it, expect } from 'vitest';
import { ContextBuilder } from '../src/memory/context';
import { HdsiApp, generateTurn } from '../src/app';
import { ModelClient, ChatCompletionsTransport } from '../src/model/client';
import { setup, saveInput, NOW } from './helpers';
import { MemoryStore } from '../src/memory/store';
import { makeRetrievalRequest } from '../src/memory/retrieval';

it('finds a Chinese topic alias, returns one current detail and includes history only when requested', async () => {
  const d = setup();
  d.storage.save('details', 'character.phone.model', { key: 'character.phone.model', value: '某手机', aliases: ['手机', '型号'], effectiveAt: NOW });
  d.storage.save('detail_history', 'history', { id: 'history', key: 'character.phone.model', previousValue: '小米12', newValue: '某手机', effectiveAt: NOW, reason: '换机', sourceIds: [], turnId: 'old' });
  const builder = new ContextBuilder(d.storage);
  expect(await builder.lookupDetails('你的手机型号')).toMatchObject({ details: [{ value: '某手机' }], detailHistory: [] });
  expect(await builder.lookupDetails('以前的手机')).toMatchObject({ detailHistory: [{ previousValue: '小米12' }] });
  expect(d.storage.all('details')).toHaveLength(1);
  d.storage.close();
});
it('keeps current facts out of future intent and saves real changes with previous values', async () => {
  const d = setup(); saveInput(d.storage, 'a', '已经换成苹果了');
  d.storage.save('details', 'character.phone.model', { key: 'character.phone.model', value: '某手机', aliases: ['手机', '型号'], effectiveAt: NOW });
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'none' }, taskChanges: [], nextPlan: '明天想买一部新手机' };
  d.models.outputs.memory = { schemaVersion:3,shortTermChanges: [], longTermChanges: [], detailChanges: [{ action: 'update', key: 'character.phone.model', value: '苹果', aliases: ['手机', '型号'], reason: '用户明确修订', sourceIds: ['a'] }] };
  await new HdsiApp(d).runTurn({ inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] });
  expect(d.storage.read('details', 'character.phone.model')!.value).toBe('苹果');
  expect(d.storage.all('detail_history')[0]).toMatchObject({ previousValue: '某手机', newValue: '苹果' });
  const input = d.models.calls.find(c => c.name === 'memory')!.input;
  expect(input.context.arrangementsAndIntent.plan).toBe('明天想买一部新手机');
  expect(input.resources.messages.filter((m:any)=>m.direction==='outgoing')).toEqual([]); expect(input.context.personal).toBeUndefined();
  d.storage.close();
});
it('retrieves related long memories without reinforcing and respects the history budget', async () => {
  const d = setup();
  for (let i = 0; i < 15; i++) d.storage.save('memories', String(i), { id: String(i), kind: 'long', content: `手机经历${i}`.repeat(100), topics: ['手机'], sourceIds: [], importance: 'high', mentions: 2, reinforcedAt: NOW, createdAt: NOW, turnId: 'old' });
  new MemoryStore(d.storage).migrate(NOW);
  const b = new ContextBuilder(d.storage);
  const history = await b.build(makeRetrievalRequest('手机', NOW, 'personal_chat',500));
  expect(JSON.stringify(history).length).toBeLessThan(700);
  expect(d.storage.read('memories', '0')!.mentions).toBe(2);
  saveInput(d.storage, 'a', '本轮输入不能因预算丢失'); d.config.historyBudget = 10;
  await generateTurn(d, { inputMessageIds: ['a'], taskIds: [], triggerKinds: ['input'] }, 'a');
  expect(d.models.calls.find(c => c.name === 'personal_chat')!.input.resources.messages[0].content).toBe('本轮输入不能因预算丢失');
  d.storage.close();
});
it('looks up a detail once in the same task then parses the actual result', async () => {
  const d = setup();
  d.storage.save('details', 'phone', { key: 'phone', value: '某手机', aliases: ['手机'], effectiveAt: NOW });
  const b = new ContextBuilder(d.storage); const requests: any[] = [];
  const client = new ModelClient({ complete: async r => { requests.push(r); return requests.length === 1 ? '{"lookupDetails":"手机"}' : '{"answer":"某手机"}'; } }, q => b.lookupDetails(q));
  const result = await client.runModel({ name: 'lookup', schema: {}, prompt: '', parse: v => v as any }, {});
  expect(result.answer).toBe('某手机'); expect(requests[1].lookupResult.details[0].value).toBe('某手机');
  d.storage.close();
});
it('uses the model configured for each task over the HTTP boundary', async () => {
  const bodies: any[] = [];
  const transport = new ChatCompletionsTransport(name => ({ baseUrl: 'https://api.deepseek.com', apiKey: 'test-only', model: name === 'narrative' ? 'deepseek-flash' : 'deepseek-v4-pro' }), (async (_url: any, init: any) => { bodies.push(JSON.parse(init.body)); return new Response(JSON.stringify({ choices: [{ message: { content: '{}' } }] })); }) as typeof fetch);
  await transport.complete({ task: { name: 'narrative', schema: {}, prompt: '', parse: v => v }, input: {} });
  await transport.complete({ task: { name: 'memory', schema: {}, prompt: '', parse: v => v }, input: {} });
  expect(bodies.map(b => b.model)).toEqual(['deepseek-flash', 'deepseek-v4-pro']);
  expect(bodies[0].response_format).toEqual({ type: 'json_object' });
});
