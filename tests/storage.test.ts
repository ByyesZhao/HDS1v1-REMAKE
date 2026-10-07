import { it, expect } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Storage } from '../src/storage';

it('commits, reopens, and rolls back an incomplete transaction', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hdsi-'));
  const path = join(dir, 'story.sqlite');
  let db = new Storage(path);
  db.transaction(() => db.set('background', { name: '开发样例' }));
  expect(() => db.transaction(() => { db.set('background', { name: '未提交' }); db.set('other', 1); throw new Error('rollback'); })).toThrow('rollback');
  db.close();
  db = new Storage(path);
  expect(db.get('background')).toEqual({ name: '开发样例' });
  expect(db.get('other')).toBeNull();
  expect(db.pragmas()).toEqual({ journalMode: 'wal', synchronous: 2 });
  db.close();
  rmSync(dir, { recursive: true });
});
