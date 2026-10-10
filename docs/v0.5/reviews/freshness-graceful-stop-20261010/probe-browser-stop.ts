/** Offline review probe. Run from the repository root with: node --import tsx <this file> */
import assert from 'node:assert/strict';
import {mkdir, mkdtemp, readFile} from 'node:fs/promises';
import {resolve, join} from 'node:path';
import {installBrowserRuntime, getBrowserRuntimeStatus} from '../../../../src/deployment/browser-runtime';
import {startStopControl} from '../../../../src/deployment/stop-control';

async function scenario(closeFails: boolean) {
  const temporaryRoot = resolve('.tmp/freshness-stop-review');
  await mkdir(temporaryRoot, {recursive: true});
  const dir = await mkdtemp(join(temporaryRoot, 'browser-stop-probe-'));
  const events = new Map<string, Array<(...args: any[]) => any>>();
  const errors: string[] = [], logs: string[] = [];
  let storageCloseReached = false, exitCalls = 0, searchFailure = '', pageClosed = false;
  // No real page, model, database, or public network is used.
  const page = {
    on() {}, setRequestInterception: async () => {},
    goto: async () => ({status: () => 500}),
    url: () => 'https://synthetic.test/', title: async () => '',
    isClosed: () => pageClosed, browser: () => ({connected: true}),
    close: async () => {
      if (closeFails) throw Error('synthetic page close failure');
      pageClosed = true;
    },
  };
  const ctx: any = {
    baseDir: dir, puppeteer: {page: async () => page},
    logger: () => ({error: (e: unknown) => errors.push(String(e)), info() {}}),
    command: () => ({action() {}}),
    on(name: string, fn: (...args: any[]) => any) {
      events.set(name, [...(events.get(name) ?? []), fn]);
    },
    inject(_dependencies: unknown, fn: (inner: any) => void) { fn(ctx); },
  };
  installBrowserRuntime(ctx, {} as any, {
    webSearch: {browser: {engine: 'bing', navigationTimeoutMs: 1000, maxConcurrentPages: 1}},
  } as any, async (_ctx, _config, _settings, managed) => {
    try { await managed!.provider.search('offline review fixture'); }
    catch (e) { searchFailure = (e as Error).message; }
    let closing: Promise<void> | null = null;
    return {
      host: {start: async () => {}, status: async () => ''},
      stopAcceptingInput() {},
      // Same disposal ordering as PluginRuntime.close(); the marker is not a real DB.
      close: () => closing ??= (async () => {
        await managed!.dispose();
        storageCloseReached = true;
      })(),
    } as any;
  });
  // Only await browser initialization. Do not start the automatically installed endpoint,
  // whose default exit would terminate this probe. The installed exit hook calls the
  // same shutdownOnce callback; connect it to an isolated endpoint with an exit spy.
  await events.get('ready')!.at(-1)!();
  const installedExit = events.get('exit')![0];
  const descriptorFile = join(dir, 'control.json');
  const control = await startStopControl(descriptorFile, async () => installedExit(), {
    exit: () => { exitCalls++; }, log: message => logs.push(message),
  });
  try {
    const descriptor = JSON.parse(await readFile(descriptorFile, 'utf8'));
    const response = await fetch(`http://127.0.0.1:${descriptor.port}/stop`, {
      method: 'POST', headers: {authorization: `Bearer ${descriptor.token}`},
    });
    const body = await response.json();
    await new Promise<void>(r => setImmediate(r));
    await control.close();
    await new Promise<void>(r => setImmediate(r));
    return {
      httpStatus: response.status, body, exitCalls, storageCloseReached,
      searchFailure, browserStatus: getBrowserRuntimeStatus(ctx), errors, logs,
    };
  } finally { await control.close(); }
}

async function main() {
  const healthy = await scenario(false), failed = await scenario(true);
  console.log(JSON.stringify({healthy, failed}, null, 2));
  assert.equal(healthy.httpStatus, 200);
  assert.deepEqual(healthy.body, {stopped: true});
  assert.equal(healthy.exitCalls, 1);
  assert.equal(healthy.storageCloseReached, true);
  assert.equal(failed.browserStatus.state, 'failed');
  assert.equal(failed.storageCloseReached, false);
  // Expected contract: disposal failure must reach the stop caller and prevent exit.
  // This assertion is RED on 086cd07. Preserve the original output after repairing R1.
  assert.equal(failed.httpStatus, 500);
  assert.equal(failed.body.stopped, false);
  assert.equal(failed.exitCalls, 0);
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
