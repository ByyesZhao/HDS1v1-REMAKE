import { strict as assert } from 'node:assert';
import { HdsiApp } from '../../../../../src/app';
import { SerialHost } from '../../../../../src/host/runtime';
import { Scheduler } from '../../../../../src/host/scheduler';
import { InputBuffer } from '../../../../../src/host/input';
import { EnvironmentPreparation } from '../../../../../src/environment/preparation';
import { MemoryStore } from '../../../../../src/memory/store';
import { compactCompletedPayloads } from '../../../../../src/memory/payload-compaction';
import { asyncFixture } from '../../../../../tests/environment-async-fixture';
import { modern } from '../../../../../tests/chat-fixture';
import { NOW, silent } from '../../../../../tests/helpers';

async function pauseSelectionRace() {
  const d = modern();
  const host = new SerialHost(new HdsiApp(d), { timers: false });
  d.storage.save('tasks', 'appointment', { id: 'appointment', kind: 'appointment', at: NOW, description: '已确认的见面', status: 'pending' });
  const starting = host.start();
  // collectReady has returned a Promise; its selected turn has not begun yet.
  const atPause = { modelCalls: d.models.calls.length, turns: d.storage.all('turns').length };
  const pausing = host.pause();
  const pausedImmediately = d.storage.runtime().paused;
  await Promise.all([starting, pausing]);
  const result = {
    atPause, pausedImmediately, pausedAfter: d.storage.runtime().paused,
    modelCallsAfter: d.models.calls.map(c => c.name),
    turnsAfter: d.storage.all('turns').map(t => ({ done: t.done, triggerKinds: t.triggerKinds })),
    appointmentAfter: d.storage.read('tasks', 'appointment')!.status,
  };
  assert.equal(atPause.modelCalls, 0);
  assert.equal(atPause.turns, 0);
  assert.equal(pausedImmediately, true);
  assert.equal(result.turnsAfter.length, 1);
  assert.equal(result.turnsAfter[0].done, true);
  await host.stop();
  d.storage.close();
  return result;
}

async function dueAppointmentDescriptionUpdate() {
  const d = modern(), app = new HdsiApp(d), scheduler = new Scheduler(d.storage);
  d.storage.save('tasks', 'appointment', { id: 'appointment', kind: 'appointment', at: NOW, description: '已确认的见面', status: 'pending' });
  d.models.outputs.personal_chat = { ...silent, taskChanges: [{ action: 'update', id: 'appointment', task: { description: '正在赴约，地点改为门口' } }] };
  const rounds: unknown[] = [];
  for (let i = 0; i < 3; i++) {
    const request = await scheduler.collectReady(d.clock.now());
    assert.deepEqual(request!.taskIds, ['appointment']);
    await app.runTurn(request!);
    rounds.push({ at: d.clock.now(), appointment: d.storage.read('tasks', 'appointment'), nextDeadline: await scheduler.nextDeadline(d.clock.now()) });
  }
  const result = { rounds, turns: d.storage.all('turns').length, modelCalls: d.models.calls.map(c => c.name) };
  assert.equal(result.turns, 3);
  assert.equal(d.storage.read('tasks', 'appointment')!.status, 'pending');
  d.storage.close();
  return result;
}

async function pauseWaitingSelectionRace() {
  const d = modern(), input = new InputBuffer(d.storage), s = new Scheduler(d.storage), app = new HdsiApp(d);
  await input.acceptInput({id:'old',content:'旧消息',receivedAt:d.clock.now()});d.clock.advance(15000);
  const request = (await s.collectReady(d.clock.now()))!;
  await input.acceptInput({id:'new',content:'新消息',receivedAt:d.clock.now()});
  await app.runTurn(request);
  const id = d.storage.unfinishedTurn()!.id;
  d.storage.save('tasks', 'appointment', { id:'appointment', kind:'appointment', at:d.clock.now(), description:'到期约定', status:'pending' });
  const host = new SerialHost(app, {timers:false});
  const starting = host.start();
  const beforePause = {state:d.storage.read('turns',id)!.replyFreshness!.state, modelCalls:d.models.calls.length};
  const pausing = host.pause();
  await Promise.all([starting,pausing]);
  const turn = d.storage.read('turns',id)!;
  const result = {beforePause, pausedAfter:d.storage.runtime().paused, done:turn.done, scope:turn.replyFreshness!.scope, modelCalls:d.models.calls.map(c=>c.name)};
  assert.equal(beforePause.state,'waiting');assert.equal(beforePause.modelCalls,0);assert.equal(turn.done,true);
  await host.stop();d.storage.close();return result;
}

async function appointmentAutomaticHostRepeat() {
  const d = modern();
  d.storage.save('tasks', 'appointment', { id: 'appointment', kind: 'appointment', at: NOW, description: '已确认的见面', status: 'pending' });
  let personalCalls = 0;
  d.models.outputs.personal_chat = () => ++personalCalls <= 3
    ? { ...silent, taskChanges: [{ action: 'update', id: 'appointment', task: { description: '正在赴约，地点改为门口' } }] }
    : silent;
  const host = new SerialHost(new HdsiApp(d), { timers: false });
  await host.start();
  const result = {
    inputCount: d.storage.unseenIncomingMessages().length,
    personalCalls,
    turnCount: d.storage.all('turns').length,
    turnTimes: d.storage.all('turns').map(t => t.at),
    finalTaskStatus: d.storage.read('tasks', 'appointment')!.status,
    note: 'The fourth model result intentionally stops updating so the real Host pump terminates.',
  };
  assert.equal(result.turnCount, 4);
  await host.stop();d.storage.close();
  return result;
}

async function taskHistoryCost() {
  const results: unknown[] = [];
  for (const historicalTaskCount of [0, 1000, 10000]) {
    const d = modern(), s = new Scheduler(d.storage);
    d.storage.transaction(() => {
      for (let i = 0; i < historicalTaskCount; i++) d.storage.save('tasks', `completed-${i}`, {
        id: `completed-${i}`, kind: 'check_messages', at: NOW, description: '已完成的历史消息检查'.repeat(12),
        checkReason: 'deferred_reply', messageIds: [], status: 'completed',
      });
    });
    let allTaskCalls = 0, materializedTaskRows = 0;
    const originalAll = d.storage.all.bind(d.storage);
    d.storage.all = ((table: any) => {
      const rows = originalAll(table);
      if (table === 'tasks') { allTaskCalls++;materializedTaskRows += rows.length; }
      return rows;
    }) as typeof d.storage.all;
    const measurements: number[] = [];
    for (let sample = 0; sample < 5; sample++) {
      const start = performance.now();
      assert.equal(await s.collectReady(NOW), null);
      await s.nextDeadline(NOW);
      measurements.push(performance.now() - start);
    }
    const indexedStart = performance.now();
    const pending = d.storage.prepare("SELECT data FROM tasks WHERE json_extract(data,'$.status')='pending' ORDER BY rowid").all();
    const indexedPendingQueryMs = performance.now() - indexedStart;
    results.push({ historicalTaskCount, samples: 5, allTaskCalls, materializedTaskRows, measurementsMs: measurements, indexedPendingRows: pending.length, indexedPendingQueryMs });
    d.storage.close();
  }
  return results;
}

async function terminalEnvironmentPayload() {
  const {d,step} = asyncFixture();
  const memory = new MemoryStore(d.storage);
  for (let i=0;i<100;i++) memory.saveOwner(memory.makeOwner({ownerType:'detail',ownerId:'detail-'+i}, {key:'公开测试项'+i,value:'用于审核的合成固定信息'.repeat(50),content:'用于审核的合成固定信息'.repeat(50),aliases:[],sourceIds:[],effectiveAt:NOW}, NOW));
  d.generateEnvironment = async () => ({stage:'world',changes:[]});
  const p = new EnvironmentPreparation(d);
  assert.equal(p.startOne(step.id,NOW),true);await p.wait();assert.equal(p.applyReady(step.id,NOW),'applied');
  const saved = d.environmentStore.step(step.id)!;
  const before = Number(d.storage.prepare('SELECT length(CAST(data AS BLOB)) bytes FROM environment_steps WHERE id=?').get(step.id)!.bytes);
  const compaction = compactCompletedPayloads(d.storage);
  const after = Number(d.storage.prepare('SELECT length(CAST(data AS BLOB)) bytes FROM environment_steps WHERE id=?').get(step.id)!.bytes);
  const result = {status:saved.status,candidateCount:saved.preparationSnapshot?.retrieval.candidates.length,savedStepBytes:before,bytesAfterExistingCompactor:after,compaction};
  assert.equal(saved.status,'committed');assert.equal(saved.preparationSnapshot!.retrieval.candidates.length,100);assert.equal(before,after);
  await p.stop();d.storage.close();return result;
}

async function main() {
  console.log(JSON.stringify({ baseline: 'ce7e88e9c8e4940ec17ae4b5dae2392fd6ddb57c', isolation: 'Only in-memory SQLite and scripted models; no network or live services.', pauseSelectionRace: await pauseSelectionRace(), pauseWaitingSelectionRace:await pauseWaitingSelectionRace(), dueAppointmentDescriptionUpdate: await dueAppointmentDescriptionUpdate(), appointmentAutomaticHostRepeat: await appointmentAutomaticHostRepeat(), taskHistoryCost: await taskHistoryCost(),terminalEnvironmentPayload:await terminalEnvironmentPayload() }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
