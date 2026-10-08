import { Storage } from '../src/storage';
import { EnvironmentStore } from '../src/environment/store';
import { SchoolStore } from '../src/school/store';
import { defaultConfig, initialCharacter } from '../src/config';
import { MemoryStore } from '../src/memory/store';
import type { Clock, ModelRunner, ModelTask, Random, Sender, OutboxItem } from '../src/types';

export const NOW = '2026-10-07T10:00:00+08:00';
export class TestClock implements Clock {
  time = NOW;
  now() { return this.time; }
  advance(ms: number) { this.time = new Date(Date.parse(this.time) + ms).toISOString(); }
}
export class SequenceRandom implements Random {
  constructor(private values: number[] = [0.5]) {}
  next() { return this.values.length > 1 ? this.values.shift()! : this.values[0]; }
}
export const narrative = {
  experiences: [], currentScene: { description: '在宿舍', activity: null }, energy: { level: '正常', reason: '休息后' },
};
export const silent = { emotions: [], reply: { decision: 'none' }, taskChanges: [] };
export const emptyMemory = { schemaVersion:3,shortTermChanges: [], longTermChanges: [], detailChanges: [] };
export class ScriptedModels implements ModelRunner {
  calls: Array<{ name: string; input: any; options?:import('../src/memory/types').ModelRunOptions }> = [];
  constructor(public outputs: Record<string, any> = {}) {}
  async runModel<T>(task: ModelTask<T>, input: unknown,options?:import('../src/memory/types').ModelRunOptions): Promise<T> {
    this.calls.push({ name: task.name, input: structuredClone(input),options });
    const output = this.outputs[task.name];
    return task.parse(typeof output === 'function' ? output(input) : structuredClone(output));
  }
}
export class RecordingSender implements Sender {
  sent: OutboxItem[] = []; errors: string[] = [];
  constructor(private clock: TestClock) {}
  async sendItem(item: OutboxItem) { this.sent.push(structuredClone(item)); return { platformMessageIds: [`qq-${item.seq}`] }; }
  async sendError(message: string) { this.errors.push(message); }
}
export function setup() {
  const storage = new Storage(':memory:');
  const clock = new TestClock(); const random = new SequenceRandom();
  storage.set('character', initialCharacter(NOW));
  const models = new ScriptedModels({ narrative, personal_chat: silent, personal_life: { emotions: [], innerThought: '休息', contact: { willing: false } }, memory: emptyMemory });
  const config = { ...defaultConfig, background: '开发样例', chatExamples: '嗯嗯' };
  const sender = new RecordingSender(clock);
  const wait = async (ms: number) => { clock.advance(ms); };
  return { environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),storage, clock, random, models, config, sender, wait };
}
export function saveInput(storage: Storage, id: string, content: string) {
  storage.save('messages', id, { id, content, receivedAt: NOW, platformMessageIds: [], direction: 'incoming', batchId: `batch-${id}`, seenTurnId: null, turnId: null, outboxSeq: null });
}
