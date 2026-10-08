import { afterEach } from 'vitest';
import { setup } from './helpers';
import { MemoryStore } from '../src/memory/store';
import type { MemoryCandidate, RetrievalRequest } from '../src/memory/types';
const opened: ReturnType<typeof setup>[] = [];
afterEach(() => opened.splice(0).forEach(d => d.storage.close()));
export const at = '2026-10-08T02:00:00.000Z';
export const days = (n: number) => new Date(Date.parse(at) + n * 86400000).toISOString();
export function fixture() {
  const d = setup(); opened.push(d); d.clock.time = at;
  const store = new MemoryStore(d.storage); d.storage.set('memory_schema_version', 3);
  return { ...d, store };
}
export function long(store: MemoryStore, id: string, data: Partial<MemoryCandidate> = {}) {
  const row = store.makeOwner({ ownerType: 'long', ownerId: id }, { content: `经历-${id}`, retainedFrom: at, expiresAt: days(90), sourceIds: [`source-${id}`], ...data }, at);
  store.saveOwner(row); return row;
}
export function request(now = at, scope: 'current'|'archive' = 'current'): RetrievalRequest {
  return { query: '经历', at: now, phase: 'personal_chat', scope, includeDetailHistory: false, permissions: { allowArchive: scope === 'archive', allowDetailHistory: false, visibleSourceIds: [] }, budget: null };
}
