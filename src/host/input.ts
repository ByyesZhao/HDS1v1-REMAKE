import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from '../types';
import { Storage } from '../storage';
import { addMs, due } from '../time';

export function isTargetSession(session: { isDirect?: boolean; selfId?: string; userId?: string }, config: { botId: string; userId: string }): boolean {
  return session.isDirect === true && session.selfId === config.botId && session.userId === config.userId;
}

export class InputBuffer {
  constructor(private readonly storage: Storage) {}
  async acceptInput(message: IncomingMessage): Promise<void> {
    this.storage.transaction(() => {
      this.closeExpired(message.receivedAt);
      const runtime = this.storage.runtime();
      const batchId = runtime.openBatch?.id ?? randomUUID();
      this.storage.save('messages', message.id, {
        ...message, platformMessageIds: message.platformMessageIds ?? [], direction: 'incoming',
        batchId, seenTurnId: null, turnId: null, outboxSeq: null,
      });
      runtime.openBatch = { id: batchId, readyAt: addMs(message.receivedAt, 15_000) };
      this.storage.set('runtime', runtime);
    });
  }
  closeReady(now: string): void { this.storage.transaction(() => this.closeExpired(now)); }
  private closeExpired(now: string): void {
    const runtime = this.storage.runtime();
    if (runtime.openBatch && due(runtime.openBatch.readyAt, now)) {
      runtime.pendingBatchIds.push(runtime.openBatch.id);
      runtime.openBatch = null;
      this.storage.set('runtime', runtime);
    }
  }
}
