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

test('mock restyle accepts inspiration only, text only, or both and retains trimmed instructions', async () => {
  const { inspiration, ...data } = await input();
  for (const optionalImage of [{}, { inspiration: null }, { inspiration }]) {
    const instruction = 'Use warm oak.\nKeep the sofa green.';
    const stages = [];
    const result = await runMockRestyle({ ...data, ...optionalImage, instruction: `  ${instruction}  ` }, { wait: async () => {}, onProgress: (stage) => stages.push(stage) });
    assert.equal(result.instruction, instruction);
    assert.equal(result.operation, 'restyle');
    assert.equal(result.mode, 'mock');
    assert.ok(styleSpecSchema.safeParse(result.spec).success);
    assert.deepEqual(stages, ['extracting', 'rendering', 'checking']);
    assert.equal(result.geometry.status, 'unchecked');
  }
  for (const instruction of [undefined, '', ' \n ']) {
    const result = await runMockRestyle({ ...data, inspiration, instruction }, { wait: async () => {} });
    assert.equal(result.instruction, undefined);
  }
});

test('mock restyle requires inspiration or text and validates supplied images and instruction bounds', async () => {
  const { inspiration, ...data } = await input(); const stages = [];
  const options = { wait: async () => assert.fail('Invalid input must not start simulation'), onProgress: (stage) => stages.push(stage) };
  for (const optionalImage of [{}, { inspiration: null }]) {
    for (const instruction of [undefined, '', ' \n ']) {
      await assert.rejects(runMockRestyle({ ...data, ...optionalImage, instruction }, options), { code: 'invalid_request' });
    }
  }
  for (const inspiration of [false, '', 'image', 42, {}, { base64: 'bad' }, { base64: Buffer.from('not an image').toString('base64') }]) {
    for (const instruction of [undefined, 'Use warm oak.']) {
      await assert.rejects(runMockRestyle({ ...data, inspiration, instruction }, options), { code: 'invalid_image' });
    }
  }
  for (const optionalImage of [{}, { inspiration }]) {
    for (const instruction of [null, false, 42, {}, 'a'.repeat(2001)]) {
      await assert.rejects(runMockRestyle({ ...data, ...optionalImage, instruction }, options), { code: 'invalid_instruction' });
    }
  }
  assert.deepEqual(stages, []);
  const instruction = 'a'.repeat(2000);
  const result = await runMockRestyle({ ...data, instruction: ` ${instruction} ` }, { wait: async () => {} });
  assert.equal(result.instruction, instruction);
});

test('mock refinement accepts an optional reference without changing its text-only simulation', async () => {
  const { inspiration, ...data } = await input();
  const request = { ...data, operation: 'refine', instruction: '  Replace the sofa.  ' };
  const stages = [];
  const textOnly = await runMockRestyle(request, { wait: async () => {} });
  const withReference = await runMockRestyle({ ...request, reference: inspiration }, { wait: async () => {}, onProgress: (stage) => stages.push(stage) });
  assert.deepEqual(stages, ['extracting', 'rendering', 'checking']);
  assert.equal(textOnly.operation, 'refine');
  assert.equal(textOnly.instruction, 'Replace the sofa.');
  assert.deepEqual(withReference.image, textOnly.image);
  assert.deepEqual(withReference.spec, textOnly.spec);
  assert.equal(withReference.prompt, textOnly.prompt);
  assert.match(withReference.prompt, /No AI generation/);
  assert.equal(withReference.geometry.status, 'unchecked');
});

test('mock refinement rejects invalid references before simulating progress', async () => {
  const data = await input(); const stages = [];
  for (const reference of [null, false, 'image', {}, { base64: 'bad' }, { base64: Buffer.from('not an image').toString('base64') }]) {
    await assert.rejects(runMockRestyle({ ...data, operation: 'refine', instruction: 'Replace the sofa.', reference }, { wait: async () => assert.fail('Invalid references must not start simulation'), onProgress: (stage) => stages.push(stage) }), { code: 'invalid_image' });
  }
  assert.deepEqual(stages, []);
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
