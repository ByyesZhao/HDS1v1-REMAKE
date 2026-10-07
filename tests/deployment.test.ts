import { it, expect } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadLocalCredentials } from '../src/deployment/credentials';
import { loadSettings, connectionFor } from '../src/settings';
import { importLegacyCatalog } from '../src/deployment/sticker-catalog';
import { Storage } from '../src/storage';

it('loads the labelled local keys without truncating a dotted token or overriding the environment', () => {
  const root = mkdtempSync(join(tmpdir(), 'hdsi-keys-'));
  try {
    writeFileSync(join(root, 'key.txt'), 'deepseek KEY: fixture.deepseek.token\nqwen3.7-text-embedding KEY: fixture.qwen.full.token');
    const environment: Record<string, string | undefined> = { DEEPSEEK_API_KEY: 'existing-key' };
    loadLocalCredentials(join(root, 'key.txt'), environment);
    expect(environment).toEqual({ DEEPSEEK_API_KEY: 'existing-key', QWEN_API_KEY: 'fixture.qwen.full.token' });
  } finally { rmSync(root, { recursive: true }); }
});
it('loads the supplied background and local credentials relative to the story configuration', () => {
  const root = mkdtempSync(join(tmpdir(), 'hdsi-settings-'));
  try {
    const sample = JSON.parse(readFileSync('examples/story.sample.json', 'utf8'));
    sample.backgroundFile = '角色.txt'; delete sample.background;
    writeFileSync(join(root, '角色.txt'), '正式人物背景');
    writeFileSync(join(root, 'key.txt'), 'deepseek KEY: fixture-only');
    writeFileSync(join(root, 'story.json'), JSON.stringify(sample));
    const environment = {};
    const settings = loadSettings(join(root, 'story.json'), environment);
    expect(settings.background).toBe('正式人物背景');
    expect(connectionFor(settings, 'expression', environment).apiKey).toBe('fixture-only');
    expect(JSON.stringify(settings)).not.toContain('fixture-only');
  } finally { rmSync(root, { recursive: true }); }
});

it('copies the existing image and preserves its ID, aliases and verified vector without a model call', () => {
  const root = mkdtempSync(join(tmpdir(), 'hdsi-catalog-')), storage = new Storage(':memory:');
  try {
    writeFileSync(join(root, 'a.gif'), 'image-fixture');
    const catalog = { assets: [{ assetId: 'old-a', filePath: 'a.gif', description: '挥手', aliases: ['你好'], embeddingInput: '挥手 你好', embedding: [1, 0], embeddingFingerprint: 'verified:d2' }] };
    const identity = { model: 'qwen-test', baseUrl: 'https://embedding.invalid/v1', dimensions: 2, fingerprint: 'verified:d2' };
    const destination = join(root, 'copied');
    expect(importLegacyCatalog(storage, catalog, root, destination, identity, identity)).toBe(1);
    expect(readFileSync(join(destination, 'a.gif'), 'utf8')).toBe('image-fixture');
    expect(storage.read('stickers', 'old-a')).toMatchObject({ id: 'old-a', description: '挥手', aliases: ['你好'], embeddingInput: '挥手 你好', embedding: [1, 0], embeddingModel: 'qwen-test' });
    importLegacyCatalog(storage, catalog, root, destination, identity, identity);
    expect(storage.all('stickers')).toHaveLength(1);
  } finally { storage.close(); rmSync(root, { recursive: true }); }
});
it('does not reuse equal-dimension vectors from a different embedding model', () => {
  const root = mkdtempSync(join(tmpdir(), 'hdsi-incompatible-')), storage = new Storage(':memory:');
  try {
    const identity = { model: 'old-model', baseUrl: 'https://embedding.invalid/v1', dimensions: 2, fingerprint: 'verified:d2' };
    expect(() => importLegacyCatalog(storage, { assets: [] }, root, join(root, 'copied'), identity, { ...identity, model: 'new-model' })).toThrow(/incompatible/i);
    expect(storage.all('stickers')).toEqual([]); expect(existsSync(join(root, 'copied'))).toBe(false);
  } finally { storage.close(); rmSync(root, { recursive: true }); }
});
