import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createAIMiddleware } from '../server/vite-ai.js';
import { createRunner } from '../server/runner.js';
import { publicError } from '../server/restyle.js';
import { createRestyleClient } from '../src/restyle-client.js';
import { registerAIHandlers } from '../electron/ai-ipc.cjs';
import { resultFixture } from './restyle-fixtures.js';

async function http(runner, { path = '/api/restyle', method = 'POST', body = '{}', origin = 'http://127.0.0.1:5173', host = '127.0.0.1:5173' } = {}) {
  const req = Readable.from([Buffer.from(body)]);
  Object.assign(req, { url: path, method, headers: { host, origin, 'content-type': 'application/json' } });
  const res = new EventEmitter();
  Object.assign(res, { headersSent: false, chunks: [], destroyed: false,
    writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
    write(chunk) { this.chunks.push(chunk); }, end(chunk = '') { this.chunks.push(chunk); },
  });
  await createAIMiddleware(runner)(req, res, () => { throw new Error('Unexpected fallthrough'); });
  return { status: res.status, body: res.chunks.join(''), headers: res.headers };
}
function ipc(runner) {
  const ipcMain = new EventEmitter(); const handlers = new Map();
  ipcMain.handle = (name, handler) => handlers.set(name, handler);
  const sender = new EventEmitter(); sender.mainFrame = {}; sender.isDestroyed = () => false;
  const progress = []; sender.send = (_name, event) => progress.push(event.stage);
  registerAIHandlers({ ipcMain, runner, publicError, allowedSender: (candidate) => candidate === sender });
  return { handlers, sender, progress, ipcMain, event: { sender, senderFrame: sender.mainFrame } };
}

test('HTTP and Electron deliver the same result and progress from the shared runner', async () => {
  const result = resultFixture(); const request = { requestId: result.requestId };
  const run = async (_input, { onProgress }) => { for (const stage of ['extracting', 'rendering', 'checking']) onProgress(stage); return result; };
  const runner = createRunner({ getConfig: () => ({ apiKey: 'private-value' }), run });
  const response = await http(runner, { body: JSON.stringify(request) });
  const events = response.body.trim().split('\n').map(JSON.parse);
  const desktop = ipc(runner);
  const desktopResult = await desktop.handlers.get('ai:restyle')(desktop.event, request);
  assert.equal(response.status, 200);
  assert.deepEqual(events.at(-1).result, desktopResult.result);
  assert.deepEqual(events.filter((event) => event.type === 'progress').map((event) => event.stage), desktop.progress);
  const status = await http(runner, { path: '/api/ai/status', method: 'GET' });
  assert.deepEqual(JSON.parse(status.body), { configured: true, mockAvailable: true });
  assert.equal(status.body.includes('private-value'), false);
  assert.equal(desktop.sender.listenerCount('destroyed'), 0);
});

test('rejects cross-origin HTTP and untrusted Electron frames before model execution', async () => {
  let runs = 0;
  const runner = createRunner({ getConfig: () => ({}), run: async () => { runs++; } });
  assert.equal((await http(runner, { origin: 'https://untrusted.example' })).status, 403);
  assert.equal((await http(runner, { host: 'untrusted.example:5173', origin: 'http://untrusted.example:5173' })).status, 403);
  assert.equal((await http(runner, { body: 'not json' })).status, 400);
  const desktop = ipc(runner);
  const result = await desktop.handlers.get('ai:restyle')({ sender: desktop.sender, senderFrame: {} }, {});
  assert.equal(result.error.code, 'forbidden'); assert.equal(runs, 0);
});

test('HTTP and Electron route mock requests without credentials and never invoke real AI', async () => {
  const result = { ...resultFixture(), mode: 'mock' };
  const runner = createRunner({ getConfig: () => ({}), run: () => assert.fail('Unexpected real model call'),
    mockRun: async (input, { onProgress, apiKey }) => {
      assert.equal(input.mode, 'mock'); assert.equal(apiKey, undefined);
      for (const stage of ['extracting', 'rendering', 'checking']) onProgress(stage);
      return result;
    },
  });
  const request = { requestId: result.requestId, mode: 'mock' };
  const response = await http(runner, { body: JSON.stringify(request) });
  const messages = response.body.trim().split('\n').map(JSON.parse);
  const desktop = ipc(runner);
  assert.deepEqual(await desktop.handlers.get('ai:status')(desktop.event), { configured: false, mockAvailable: true });
  assert.deepEqual((await desktop.handlers.get('ai:restyle')(desktop.event, request)).result, messages.at(-1).result);
  assert.deepEqual(desktop.progress, ['extracting', 'rendering', 'checking']);
  assert.equal(messages.at(-1).result.mode, 'mock');
});

test('runner prevents duplicate execution and IPC cancellation aborts the owned request', async () => {
  const runner = createRunner({ getConfig: () => ({}), run: async (_input, { signal }) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) });
  const desktop = ipc(runner);
  const operation = desktop.handlers.get('ai:restyle')(desktop.event, { requestId: 'request-test-001' });
  await assert.rejects(runner.start({ requestId: 'request-test-002' }), { code: 'busy' });
  desktop.ipcMain.emit('ai:cancel', desktop.event, 'request-test-001');
  assert.equal((await operation).error.code, 'cancelled');
});

test('browser client handles split NDJSON chunks, stage errors and missing backend', async () => {
  const result = resultFixture(); const stages = [];
  const text = `${JSON.stringify({ type: 'progress', stage: 'rendering' })}\n${JSON.stringify({ type: 'result', result })}\n`;
  const bytes = new TextEncoder().encode(text);
  const fetchImpl = async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(bytes.slice(0, 14)); controller.enqueue(bytes.slice(14)); controller.close(); } }), { headers: { 'Content-Type': 'application/x-ndjson' } });
  const client = createRestyleClient({ fetchImpl });
  assert.deepEqual(await client.run({ requestId: result.requestId }, { onProgress: (stage) => stages.push(stage) }), result);
  assert.deepEqual(stages, ['rendering']);
  const errorClient = createRestyleClient({ fetchImpl: async () => new Response('{"type":"error","error":{"code":"rate_limit","message":"Try later"}}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }) });
  await assert.rejects(errorClient.run({ requestId: result.requestId }), { code: 'rate_limit' });
  const missing = createRestyleClient({ fetchImpl: async () => new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }) });
  assert.deepEqual(await missing.status(), { configured: false, unavailable: true });
});

test('desktop client filters progress, forwards cancellation and removes its subscription', async () => {
  const controller = new AbortController(); let cancelled; let removed = false; let listener;
  const client = createRestyleClient({ bridge: {
    onProgress(callback) { listener = callback; return () => { removed = true; }; },
    cancel(id) { cancelled = id; },
    async run() { listener({ requestId: 'different', stage: 'checking' }); listener({ requestId: 'request-001', stage: 'rendering' }); controller.abort(); return { result: resultFixture('request-001') }; },
  } });
  const stages = [];
  await assert.rejects(client.run({ requestId: 'request-001' }, { signal: controller.signal, onProgress: (stage) => stages.push(stage) }), { name: 'AbortError' });
  assert.deepEqual(stages, ['rendering']); assert.equal(cancelled, 'request-001'); assert.equal(removed, true);
});
