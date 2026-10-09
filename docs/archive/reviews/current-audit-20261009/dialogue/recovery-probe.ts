import assert from 'node:assert/strict';
import { modern } from '../../../../../tests/chat-fixture';
import { NOW, narrative } from '../../../../../tests/helpers';
import { makeSharedFixture, configureSharedModels } from '../../../../../tests/shared-v3-fixture';
import { HdsiApp } from '../../../../../src/app';
import { InputBuffer } from '../../../../../src/host/input';
import { Scheduler } from '../../../../../src/host/scheduler';

async function sharedFrozenSelection() {
  const d = modern();
  try {
    makeSharedFixture(d);
    configureSharedModels(d);
    const input = new InputBuffer(d.storage, undefined, undefined, d.chat);
    await input.acceptInput({ id: 'chosen', content: '我在门口', receivedAt: NOW });
    d.clock.advance(60_000);
    const app = new HdsiApp(d), request = (await new Scheduler(d.storage).collectReady(d.clock.now()))!;
    const normal = d.models.outputs.personal_shared;
    d.models.outputs.personal_shared = () => { throw Error('synthetic-generation-interruption'); };
    await assert.rejects(app.runTurn(request), /synthetic-generation-interruption/);
    const before = d.storage.unfinishedTurn()!;
    assert.deepEqual(before.activityContext?.messageIds, ['chosen']);
    assert.equal(before.sharedMeta?.allowSimulatedUserActions, false);
    d.clock.advance(20 * 60_000);
    await input.acceptInput({ id: 'late', content: '后来补充', receivedAt: d.clock.now() });
    d.models.outputs.personal_shared = normal;
    await app.resumeUnfinishedTurn();
    const after = d.storage.read('turns', before.id)!;
    assert(after.done);
    assert.notEqual(after.at, before.at);
    assert.deepEqual(after.activityContext, before.activityContext);
    assert.deepEqual(after.sharedMeta, before.sharedMeta);
    assert.deepEqual(after.inputMessageIds, ['chosen']);
    assert.equal(d.storage.read('messages', 'late')?.seenTurnId, null);
    assert(d.models.calls.filter(c => c.name === 'narrative_shared').every(c => !c.input.resources.messages.some((m: any) => m.id === 'late')));
    return { name: 'modern-shared-unattempted-recovery', passed: true, originalAt: before.at, resumedAt: after.at, contextFrozen: true, permissionFrozen: true, laterInputUnread: true };
  } finally { d.storage.close(); }
}

async function ordinaryHeldBinding() {
  const d = modern();
  try {
    const input = new InputBuffer(d.storage, undefined, undefined, d.chat);
    await input.acceptInput({ id: 'ordinary', content: '你好', receivedAt: NOW });
    const app = new HdsiApp(d);
    d.models.outputs.narrative = () => { throw Error('synthetic-generation-interruption'); };
    await assert.rejects(app.runTurn({ inputMessageIds: ['ordinary'], taskIds: [], triggerKinds: ['input'] }), /synthetic-generation-interruption/);
    const before = d.storage.unfinishedTurn()!;
    assert(before.chatBinding?.holdReply);
    d.clock.advance(20 * 60_000);
    await input.acceptInput({ id: 'later', content: '稍后补充', receivedAt: d.clock.now() });
    assert.equal(d.storage.read('messages', 'later')?.chatEpisodeId, before.chatBinding?.episodeId);
    d.models.outputs.narrative = narrative;
    await app.resumeUnfinishedTurn();
    const after = d.storage.read('turns', before.id)!;
    assert(after.done);
    assert.notEqual(after.at, before.at);
    assert.equal(after.chatBinding?.episodeId, before.chatBinding?.episodeId);
    assert.equal(after.chatBinding?.holdReply, false);
    assert.equal(d.storage.read('messages', 'later')?.seenTurnId, null);
    assert(d.models.calls.every(c => !c.input.resources.messages.some((m: any) => m.id === 'later')));
    return { name: 'modern-ordinary-unattempted-recovery', passed: true, sameEpisode: true, releasedAfterCompletion: true, laterInputUnread: true };
  } finally { d.storage.close(); }
}
async function main() { process.stdout.write(JSON.stringify({ checks: [await sharedFrozenSelection(), await ordinaryHeldBinding()] }, null, 2) + '\n'); }
main().catch(error => { process.stderr.write(String(error.stack ?? error)); process.exitCode = 1; });
