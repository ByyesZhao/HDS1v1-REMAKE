import { isStageModelInput } from '../src/model/context-types';
import {ChatEpisodes} from '../src/dialogue/chat-episodes';
import { DialogueEpisodes } from '../src/dialogue/episodes';
import { DialogueStore } from '../src/dialogue/store';
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
  experiences: [], currentScene: { description: '在宿舍', activity: null }, energy: { level: '正常' as const, reason: '休息后' },
};
export const silent = { emotions: [], reply: { decision: 'none' }, taskChanges: [] };
export const emptyMemory = { schemaVersion:3,shortTermChanges: [], longTermChanges: [], detailChanges: [] };
// Existing scripted fixtures consume semantic fields; captured calls retain the real DTO.
export function fixtureModelInput(input:any):any {
 if(!isStageModelInput(input))return input;
 const owners=input.resources.owners,messages=input.resources.messages,byRole=(ids:string[]|undefined)=>messages.filter(m=>ids?.includes(m.id));
 return {...input.context,recent:byRole(input.roles.recentIds),visibleMessages:byRole(input.roles.visibleIds),reconsiderMessages:byRole(input.roles.reconsiderIds),outgoing:messages.filter(m=>m.direction==='outgoing'),details:owners.filter(r=>r.kind==='detail'),retrieved:owners.filter(r=>r.kind!=='detail'),snapshot:owners,tasks:input.resources.tasks.filter(t=>input.roles.pendingTaskIds?.includes(t.id)),dueTasks:input.resources.tasks.filter(t=>input.roles.dueTaskIds?.includes(t.id)),history:{recent:byRole(input.roles.recentIds),details:owners.filter(r=>r.kind==='detail'),shortTerm:owners.filter(r=>r.kind==='short'),longTerm:owners.filter(r=>r.kind==='long'),learned:owners.filter(r=>r.kind==='learned'),detailHistory:input.context.detailHistory??[]},selfWebReadSources:input.roles.selfReadSources??[]};
}
export class ScriptedModels implements ModelRunner {
  calls: Array<{ name: string; input: any; options?:import('../src/memory/types').ModelRunOptions }> = [];
  constructor(public outputs: Record<string, any> = {}) {}
  async runModel<T>(task: ModelTask<T>, input: unknown,options?:import('../src/memory/types').ModelRunOptions): Promise<T> {
    this.calls.push({ name: task.name, input: structuredClone(input),options });
    const output = this.outputs[task.name];
    return task.parse(typeof output === 'function' ? output(fixtureModelInput(input)) : structuredClone(output));
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
  storage.set('runtime',{...storage.runtime(),dialogueContextVersion:1,environmentPlanningVersion:1,nextEnvironmentAt:'2026-10-08T06:00:00+08:00'});
  const models = new ScriptedModels({ narrative, personal_chat: silent, personal_life: { emotions: [], innerThought: '休息', contact: { willing: false } }, memory: emptyMemory });
  const config = { ...defaultConfig, background: '开发样例', chatExamples: '嗯嗯' };
  const sender = new RecordingSender(clock);
  const wait = async (ms: number) => { clock.advance(ms); };
  return { generateEnvironment:undefined as import('../src/environment/types').EnvironmentGenerator|undefined,environmentStore:new EnvironmentStore(storage),schoolStore:new SchoolStore(storage),storage, clock, random, models, config, sender, wait };
}
export function saveInput(storage: Storage, id: string, content: string) {
  new (storage.runtime().dialogueContextVersion===2?ChatEpisodes:DialogueEpisodes)(new DialogueStore(storage)).acceptMessage({ id, content, receivedAt: NOW, platformMessageIds: [], direction: 'incoming', batchId: `batch-${id}`, seenTurnId: null, turnId: null, outboxSeq: null });
}
