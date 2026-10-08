import type { Dependencies } from './app';
import type { TurnRecord, TurnCandidate, OutboxItem, MemoryResult } from './types';
import { displayText, nextItemDelay } from './output/qq';
import { addMs, milliseconds } from './time';
import { applyMemory, applyTasks, organizeMemory, currentSelfWebReads } from './memory/organize';
import { isSleeping } from './host/state';
import { recordSharedOutput, finishSharedTurn } from './host/shared';
import {applySchoolCommits} from './school/progress';

export function freezeTurn(d: Dependencies, turn: TurnRecord, candidate: TurnCandidate, items: OutboxItem[]): TurnRecord {
  const updated = { ...turn, frozenResult: candidate, outputComplete: items.length === 0,
    autonomousIntervalMinutes: turn.autonomousIntervalMinutes === undefined ? candidate.autonomousIntervalMinutes : turn.autonomousIntervalMinutes };
  d.storage.transaction(() => {
    d.storage.save('turns', turn.id, updated);
    items.forEach((item, index) => d.storage.saveOutbox({ ...item, notBefore: index === 0 ? d.clock.now() : null }));
    d.storage.save('post_jobs', turn.id, { turnId: turn.id, result: null });
  });
  return updated;
}

export async function sendFrozen(d: Dependencies, turn: TurnRecord): Promise<void> {
  const items = d.storage.outbox(turn.id);
  for (let index = 0; index < items.length; index++) {
    let item = d.storage.outbox(turn.id)[index];
    if (item.status === 'confirmed') continue;
    const remaining = item.notBefore ? milliseconds(item.notBefore) - milliseconds(d.clock.now()) : 0;
    if (remaining > 0) await d.wait(remaining);
    item = { ...item, status: 'sending' };
    d.storage.saveOutbox(item);
    let ids: string[];
    try {
      const result = await d.sender.sendItem(item); ids = result.platformMessageIds;
      if (!ids.length) throw new Error('QQ send returned no confirmation IDs');
    } catch (error) { d.storage.saveOutbox({ ...item, status: 'retry' }); throw error; }
    const confirmedAt = d.clock.now();
    d.storage.transaction(() => {
      d.storage.saveOutbox({ ...item, status: 'confirmed', confirmedAt, platformMessageIds: ids });
      const id = `${turn.id}:out:${item.seq}`;
      d.storage.save('messages', id, {
        id, content: item.kind === 'sticker' ? `[表情素材:${item.payload}]` : displayText(item), receivedAt: confirmedAt, platformMessageIds: ids,
        direction: 'outgoing', seenTurnId: null, batchId: null, turnId: turn.id, outboxSeq: item.seq,
        sharedActivityId: turn.sharedMeta?.activityId ?? turn.frozenResult!.nextState.scene.shared?.activityId ?? null,
      });
      recordSharedOutput(d.storage, turn, item, confirmedAt);
      if (index + 1 < items.length) {
        const next = d.storage.outbox(turn.id)[index + 1];
        d.storage.saveOutbox({ ...next, notBefore: addMs(confirmedAt, nextItemDelay(items, index + 1)) });
      } else {
        const current = d.storage.read('turns', turn.id)!;
        d.storage.save('turns', turn.id, { ...current, outputComplete: true });
      }
    });
  }
}

export async function finishPostprocessing(d: Dependencies, turn: TurnRecord): Promise<void> {
  if (turn.done) return;
  const post = d.storage.read('post_jobs', turn.id)!;
  let result: MemoryResult | null = post.result;
  if (result === null) {
    result = turn.environmentKind || !turn.frozenResult!.narrative ? { schemaVersion:3,shortTermChanges: [], longTermChanges: [], detailChanges: [] } : await organizeMemory(d, turn);
    let createIndex=0;const memoryIds:Record<string,string>={};for(const c of result.shortTermChanges)if(c.action==='create')memoryIds[c.clientRef]=`${turn.id}:short:${createIndex++}`;
    d.storage.save('post_jobs', turn.id, { ...post, result,memoryIds,selfWebReadSources:currentSelfWebReads(d,turn.id) });
  }
  const memoryResult = result;
  d.storage.transaction(() => {
    const current = d.storage.read('turns', turn.id)!;
    if (current.done) return;
    const c = current.frozenResult!;
    const completedAt = d.clock.now();
    if (!turn.environmentKind) applyMemory(d, turn.id, memoryResult, turn.at);
    c.experiences.forEach(e => d.storage.save('experiences', e.id, e));
    applySchoolCommits(d.storage,c,turn.id);
    if (!turn.environmentKind) d.storage.set('character', c.nextState);
    applyTasks(d, c);
    c.visibleMessageIds.forEach(id => {
      const m = d.storage.read('messages', id)!;
      d.storage.save('messages', id, { ...m, seenTurnId: m.seenTurnId ?? turn.id });
    });
    if (!turn.environmentKind) {
      finishSharedTurn(d.storage, current, completedAt);
      const state = d.storage.character();
      if (isSleeping(state, completedAt)) state.nextAutonomousAt = null;
      else if (c.autonomousIntervalMinutes !== null) state.nextAutonomousAt = addMs(completedAt, c.autonomousIntervalMinutes * 60_000);
      d.storage.set('character', state);
    }
    const runtime = d.storage.runtime();
    runtime.pendingBatchIds = runtime.pendingBatchIds.filter(id => !turn.batchIds.includes(id));
    runtime.contactMisses = c.probability.contactMisses; runtime.stickerMisses = c.probability.stickerMisses;
    for (const change of c.environmentChanges) {
      if (change.action === 'create') d.storage.save('events', change.id!, { ...change.event, id: change.id!, status: 'active' });
      else {
        const old = d.storage.read('events', change.id)!;
        d.storage.save('events', change.id, change.action === 'cancel' ? { ...old, status: 'cancelled' } : { ...old, ...change.event });
      }
    }
    d.storage.set('runtime', runtime);
    d.storage.save('turns', turn.id, { ...current, done: true, completedAt, frozenResult: null });
    const completedPost=d.storage.read('post_jobs',turn.id)!;d.storage.save('post_jobs',turn.id,{...completedPost,result:null});
    d.web?.compactOwnerCheckpoint('turn',turn.id);
  });
  d.web?.releaseOwner('turn',turn.id);
}

export function discardUnattempted(d: Dependencies, turn: TurnRecord): TurnRecord {
  const updated = { ...turn, at: d.clock.now(), frozenResult: null, outputComplete: false, entryMode: d.storage.character().scene.mode };
  d.storage.transaction(() => {
    d.storage.outbox(turn.id).forEach(item => d.storage.remove('outbox', `${turn.id}:${item.seq}`));
    d.storage.remove('post_jobs', turn.id);
    d.storage.save('turns', turn.id, updated);
  });
  return updated;
}
