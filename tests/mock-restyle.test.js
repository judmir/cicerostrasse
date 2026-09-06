import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { runMockRestyle } from '../server/mock-restyle.js';
import { createRunner } from '../server/runner.js';
import { styleSpecSchema } from '../server/schema.js';

async function input() {
  const base64 = (await sharp({ create: { width: 24, height: 16, channels: 3, background: '#8c969f' } }).png().toBuffer()).toString('base64');
  return { requestId: 'mock-request-001', mode: 'mock', source: { base64, mimeType: 'image/png' }, inspiration: { base64, mimeType: 'image/png' } };
}

test('mock returns a valid PNG and structured test provenance with time for every stage', async () => {
  const stages = [], durations = [];
  const result = await runMockRestyle(await input(), { onProgress: (stage) => stages.push(stage), wait: async (ms) => { durations.push(ms); } });
  assert.deepEqual(stages, ['extracting', 'rendering', 'checking']);
  assert.deepEqual(durations, [1800, 6000, 1800]);
  assert.equal(result.mode, 'mock'); assert.match(result.spec.styleName, /Mock preview/);
  assert.ok(styleSpecSchema.safeParse(result.spec).success);
  assert.equal(result.geometry.status, 'unchecked'); assert.match(result.geometry.message, /no AI/);
  assert.equal(result.models.image, 'local-mock-image-v1'); assert.deepEqual(result.providerIds, {});
  const metadata = await sharp(Buffer.from(result.image.base64, 'base64')).metadata();
  assert.equal(metadata.format, 'png'); assert.equal(metadata.width, result.image.width);
  assert.equal(metadata.width / metadata.height, 24 / 16);
});

test('mock runner never reads credentials or invokes the real runner, even after a mock failure', async () => {
  const runner = createRunner({
    getConfig: () => assert.fail('Mock execution must not read credentials'),
    run: () => assert.fail('Mock must never fall back to real AI'),
    mockRun: (data, options) => runMockRestyle(data, { ...options, wait: async () => {} }),
  });
  const data = await input();
  const result = await runner.start(data);
  assert.equal(result.mode, 'mock');
  await assert.rejects(runner.start({ ...data, inspiration: { base64: 'bad' } }), { code: 'invalid_image' });
  await assert.rejects(runner.start({ ...data, mode: 'typo' }), { code: 'invalid_mode' });
  assert.equal((await runner.start(data)).mode, 'mock');
});

test('real mode remains an explicit separate execution path', async () => {
  let calls = 0;
  const runner = createRunner({
    getConfig: () => ({ apiKey: 'test-key' }),
    mockRun: () => assert.fail('Real mode must not call mock'),
    run: async (data, { apiKey }) => { calls++; assert.equal(apiKey, 'test-key'); return { requestId: data.requestId }; },
  });
  assert.equal((await runner.start({ requestId: 'real-request-001', mode: 'real' })).mode, 'real');
  assert.equal(calls, 1);
});

test('mock delays are abortable and cancellation prevents later progress or output', async () => {
  const data = await input();
  const controller = new AbortController(); const stages = [];
  await assert.rejects(runMockRestyle(data, { signal: controller.signal, onProgress: (stage) => { stages.push(stage); controller.abort(); } }), { name: 'AbortError' });
  assert.deepEqual(stages, ['extracting']);
  await assert.rejects(runMockRestyle(data, { signal: controller.signal }), { name: 'AbortError' });
});
