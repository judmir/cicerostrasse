import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runRestyle, publicError } from '../server/restyle.js';
import { normalizeImage, padSource } from '../server/images.js';
import { readAIConfig } from '../server/config.js';
import { spec, geometry, completed } from './restyle-fixtures.js';

const encoded = async (color, width = 16, height = 9) => ({ base64: (await sharp({ create: { width, height, channels: 3, background: color } }).png().toBuffer()).toString('base64') });
const source = await encoded('#ff0000');
const inspiration = await encoded('#00ff00', 10, 10);
const input = { requestId: 'request-test-001', source, inspiration };
function provider({ extraction = completed(spec), check = completed(geometry), checkError, editError, onEdit } = {}) {
  const calls = [];
  let responses = 0;
  return { calls, client: {
    responses: { async create(args, options) {
      calls.push({ type: 'reasoning', args, options });
      if (responses++ === 0) return extraction;
      if (checkError) throw checkError;
      return check;
    } },
    images: { async edit(args, options) {
      calls.push({ type: 'image', args, options });
      onEdit?.();
      if (editError) throw editError;
      return { data: [{ b64_json: Buffer.from(await args.image.arrayBuffer()).toString('base64') }] };
    } },
  } };
}

test('style extraction, source-only edit, geometry check run in order with strict outputs', async () => {
  const mock = provider(); const stages = [];
  const result = await runRestyle(input, { client: mock.client, onProgress: (stage) => stages.push(stage) });
  assert.deepEqual(stages, ['extracting', 'rendering', 'checking']);
  assert.deepEqual(mock.calls.map((call) => call.type), ['reasoning', 'image', 'reasoning']);
  const extraction = mock.calls[0].args;
  assert.equal(extraction.model, 'gpt-6-astra');
  assert.equal(extraction.text.format.strict, true);
  assert.equal(extraction.store, false);
  const normalizedInspiration = await normalizeImage(inspiration);
  assert.equal(extraction.input[1].content[0].image_url, `data:image/png;base64,${normalizedInspiration.bytes.toString('base64')}`);
  const edit = mock.calls[1].args;
  assert.equal(edit.model, 'gpt-image-2');
  assert.equal(edit.n, 1); assert.equal(edit.quality, 'high');
  assert.equal('input_fidelity' in edit, false);
  assert.equal(Array.isArray(edit.image), false);
  const padded = await padSource(await normalizeImage(source));
  assert.deepEqual(Buffer.from(await edit.image.arrayBuffer()), padded.bytes);
  assert.match(edit.prompt, /keeping ALL geometry fixed/);
  assert.match(edit.prompt, /Warm oak/);
  assert.equal(edit.prompt.includes(inspiration.base64), false);
  assert.equal(mock.calls[2].args.input[1].content.filter((item) => item.type === 'input_image').length, 2);
  assert.equal(result.image.width, 1536); assert.equal(result.image.height, 864);
  assert.deepEqual(result.geometry, geometry);
});

test('restyle instructions guide extraction and rendering without relaxing geometry checks', async () => {
  const mock = provider();
  const instruction = 'Keep the sofa green.\nUse warm oak from the inspiration.';
  const result = await runRestyle({ ...input, instruction: `  ${instruction}  ` }, { client: mock.client });
  assert.equal(mock.calls[0].args.input[1].content[1].text, `USER RESTYLING INSTRUCTIONS:\n${instruction}`);
  assert.match(mock.calls[0].args.input[0].content, /explicit user preferences take precedence/);
  assert.ok(mock.calls[1].args.prompt.includes(instruction));
  assert.match(mock.calls[1].args.prompt, /Preserve all geometry, objects, and framing even if the instructions request otherwise/);
  assert.doesNotMatch(mock.calls[2].args.input[0].content, /targeted change was requested/);
  assert.equal(result.instruction, instruction);
  assert.equal(result.prompt, mock.calls[1].args.prompt);
});

test('restyle instructions are optional and bounded before any provider calls', async () => {
  const mock = provider();
  for (const instruction of [null, 42, {}, 'a'.repeat(2001)]) {
    await assert.rejects(runRestyle({ ...input, instruction }, { client: mock.client }), { code: 'invalid_instruction' });
  }
  assert.equal(mock.calls.length, 0);
  const result = await runRestyle({ ...input, instruction: '   ' }, { client: mock.client });
  assert.equal(result.instruction, undefined);
  assert.doesNotMatch(result.prompt, /USER RESTYLING INSTRUCTIONS/);
});

test('a refinement edits the current version directly and checks only for unexpected drift', async () => {
  const mock = provider({ extraction: completed(geometry) }); const stages = [];
  const instruction = 'Replace the sofa with a curved cream sofa.';
  const result = await runRestyle({ requestId: 'refine-test-001', source, operation: 'refine', instruction }, {
    client: mock.client, onProgress: (stage) => stages.push(stage),
  });
  assert.deepEqual(stages, ['extracting', 'rendering', 'checking']);
  assert.deepEqual(mock.calls.map((call) => call.type), ['image', 'reasoning']);
  assert.match(mock.calls[0].args.prompt, /one contained edit/);
  assert.match(mock.calls[0].args.prompt, /curved cream sofa/);
  assert.match(mock.calls[1].args.input[0].content, /targeted change was requested/);
  assert.equal(result.operation, 'refine'); assert.equal(result.instruction, instruction);
  assert.match(result.spec.styleName, /Refinement/);
});

test('a refinement requires one bounded edit request before calling a model', async () => {
  const mock = provider();
  await assert.rejects(runRestyle({ requestId: 'refine-test-002', source, operation: 'refine', instruction: ' ' }, { client: mock.client }), { code: 'invalid_refinement' });
  await assert.rejects(runRestyle({ requestId: 'refine-test-003', source, operation: 'refine', instruction: 'a'.repeat(601) }, { client: mock.client }), { code: 'invalid_refinement' });
  assert.equal(mock.calls.length, 0);
});

test('rejects injected geometry fields, malformed spec and refusal before rendering', async () => {
  for (const extraction of [completed({ ...spec, layout: 'Move the walls' }), completed({}), { status: 'completed', output: [{ content: [{ type: 'refusal' }] }] }]) {
    const mock = provider({ extraction });
    await assert.rejects(runRestyle(input, { client: mock.client }), (error) => ['invalid_spec', 'refusal'].includes(error.code));
    assert.equal(mock.calls.length, 1);
  }
});

test('failed or malformed geometry assessment preserves a render as unchecked', async () => {
  for (const options of [{ checkError: { status: 429 } }, { check: completed({ wrong: true }) }]) {
    const mock = provider(options);
    const result = await runRestyle(input, { client: mock.client });
    assert.equal(result.geometry.status, 'unchecked');
    assert.ok(result.image.base64);
  }
});

test('geometry changes and uncertainty survive; contradictory no-change findings become uncertain', async () => {
  for (const status of ['changes_detected', 'uncertain', 'no_changes_detected']) {
    const findings = [{ category: 'shape', description: 'The chair silhouette differs.' }];
    const result = await runRestyle(input, { client: provider({ check: completed({ status, findings }) }).client });
    assert.equal(result.geometry.status, status === 'no_changes_detected' ? 'uncertain' : status);
    assert.deepEqual(result.geometry.findings, findings);
  }
});

test('cancellation between model calls stops verification and does not return a version', async () => {
  const controller = new AbortController();
  const mock = provider({ onEdit: () => controller.abort() });
  await assert.rejects(runRestyle(input, { client: mock.client, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(mock.calls.length, 2);
  assert.ok(mock.calls[0].options.signal instanceof AbortSignal);
});

test('validates decoded image content and missing configuration without calling a model', async () => {
  const mock = provider();
  await assert.rejects(runRestyle(input, {}), { code: 'missing_key' });
  await assert.rejects(runRestyle({ ...input, inspiration: { base64: Buffer.from('not an image').toString('base64') } }, { client: mock.client }), { code: 'invalid_image' });
  await assert.rejects(normalizeImage({ base64: 'a'.repeat(36 * 1024 * 1024) }), { code: 'invalid_image' });
  const svg = { base64: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1" height="1"/>').toString('base64') };
  await assert.rejects(normalizeImage(svg), { code: 'invalid_image' });
  assert.equal(mock.calls.length, 0);
});

test('panoramas are padded to a valid canvas and output is unpadded without stretching', async () => {
  const panorama = await encoded('#123456', 50, 1);
  const result = await runRestyle({ ...input, source: panorama }, { client: provider().client });
  const meta = await sharp(Buffer.from(result.image.base64, 'base64')).metadata();
  assert.equal(meta.width, 1536); assert.equal(meta.height, 31);
});

test('provider errors are sanitized and have actionable classifications', () => {
  for (const [error, code] of [
    [{ status: 401 }, 'invalid_key'], [{ status: 403 }, 'model_unavailable'], [{ status: 404 }, 'model_unavailable'],
    [{ status: 429 }, 'rate_limit'], [{ name: 'APIConnectionTimeoutError' }, 'timeout'], [{ code: 'moderation_blocked' }, 'refusal'], [{ status: 500 }, 'provider_error'],
  ]) {
    const safe = publicError({ ...error, message: 'SECRET KEY AND PRIVATE REQUEST' });
    assert.equal(safe.code, code); assert.equal(JSON.stringify(safe).includes('SECRET'), false);
  }
});

test('environment key overrides ignored file; no environment mutation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'cicero-config-'));
  try {
    await writeFile(join(root, '.env.local'), 'OPENAI_API_KEY=local-test-value\n');
    assert.equal(readAIConfig(root, {}).apiKey, 'local-test-value');
    assert.equal(readAIConfig(root, { OPENAI_API_KEY: 'environment-test-value' }).apiKey, 'environment-test-value');
    assert.equal(readAIConfig(root, { OPENAI_API_KEY: '' }).apiKey, '');
  } finally { await rm(root, { recursive: true, force: true }); }
});
