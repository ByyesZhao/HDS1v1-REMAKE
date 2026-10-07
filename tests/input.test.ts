import { describe, it, expect } from 'vitest';
import { Storage } from '../src/storage';
import { InputBuffer } from '../src/host/input';

describe('input persistence', () => {
  it('waits for 15 seconds after the last input', async () => {
    const db = new Storage(':memory:');
    const input = new InputBuffer(db);
    for (const [second, content] of [[0, '今天有件事'], [10, '想跟你说'], [22, '考试通过了']] as const) {
      await input.acceptInput({ id: String(second), receivedAt: `2026-10-07T10:00:${String(second).padStart(2, '0')}+08:00`, content });
    }
    input.closeReady('2026-10-07T10:00:36+08:00');
    expect(db.runtime().pendingBatchIds).toEqual([]);
    input.closeReady('2026-10-07T10:00:37+08:00');
    expect(db.runtime().pendingBatchIds).toHaveLength(1);
    expect(db.messages().map(m => m.content)).toEqual(['今天有件事', '想跟你说', '考试通过了']);
    db.close();
  });
  it('closes an expired batch before accepting a new message even when busy', async () => {
    const db = new Storage(':memory:');
    const input = new InputBuffer(db);
    await input.acceptInput({ id: 'a', receivedAt: '2026-10-07T10:00:00+08:00', content: '旧批' });
    await input.acceptInput({ id: 'b', receivedAt: '2026-10-07T10:00:20+08:00', content: '发送期间的新批' });
    expect(db.runtime().pendingBatchIds).toHaveLength(1);
    expect(db.messages()[0].batchId).not.toBe(db.messages()[1].batchId);
    expect(db.unreadMessages().map(m => m.id)).toEqual(['a']);
    db.close();
  });
});
