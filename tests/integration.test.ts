import { it, expect } from 'vitest';
import { HdsiApp } from '../src/app';
import { SerialHost } from '../src/host/runtime';
import { setup, NOW } from './helpers';

it('persists input during a busy output turn and waits for its own silence deadline', async () => {
  const d = setup();
  d.models.outputs.personal_chat = { emotions: [], reply: { decision: 'now', intention: '回复', draft: '你好' }, taskChanges: [] };
  d.models.outputs.expression = { parts: [{ kind: 'text', content: '你好' }] };
  let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
  let sending!: () => void; const started = new Promise<void>(resolve => { sending = resolve; });
  const send = d.sender.sendItem.bind(d.sender);
  d.sender.sendItem = async item => { if (d.sender.sent.length === 0) { sending(); await blocked; } return send(item); };
  const app = new HdsiApp(d); const host = new SerialHost(app, { timers: false });
  await host.acceptInput({ id: 'a', receivedAt: NOW, content: '第一批' });
  d.clock.advance(15_000); const work = host.wake(); await started;
  await host.acceptInput({ id: 'b', receivedAt: d.clock.now(), content: '发送期间的新消息' });
  expect(d.storage.read('messages', 'b')!.seenTurnId).toBeNull();
  release(); await work;
  expect(d.sender.sent).toHaveLength(1);
  d.clock.advance(15_000); await host.wake();
  expect(d.sender.sent).toHaveLength(2);
  expect(d.storage.read('messages', 'b')!.seenTurnId).toBeTruthy();
  await host.stop(); d.storage.close();
});

it('pauses new turns while saving inputs and resumes the existing queue', async () => {
  const d = setup(); const host = new SerialHost(new HdsiApp(d), { timers: false });
  await host.pause();
  await host.acceptInput({ id: 'a', receivedAt: NOW, content: '暂停时仍保存' });
  d.clock.advance(15_000); await host.wake();
  expect(d.models.calls).toEqual([]);
  await host.resume();
  expect(d.storage.read('messages', 'a')!.seenTurnId).toBeTruthy();
  await host.stop(); d.storage.close();
});
