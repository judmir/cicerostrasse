import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import 'fake-indexeddb/auto';
import { buildFirstDesignRequest, roomPlanConstraint } from '../src/first-design-wizard.js';
import { runRestyle } from '../server/restyle.js';
import { runMockRestyle } from '../server/mock-restyle.js';
import { createRunner } from '../server/runner.js';
import { spec, completed } from './restyle-fixtures.js';
import { saveFirstDesign, saveFirstDesignDraft, getFirstDesignDraft, getFirstDesignRecord, listImages, sourceSnapshot } from '../src/storage.js';
import { groupDesigns, renderSourceCards } from '../src/design-gallery.js';

const room = { id: 'flur', name: 'Hallway', type: 'Hallway' };
const photo = async (id, color) => ({ id, title: id, roomId: room.id, blob: new Blob([await sharp({ create: { width: 32, height: 24, channels: 3, background: color } }).png().toBuffer()], { type: 'image/png' }) });
const sources = await Promise.all([photo('main', '#ff0000'), photo('context', '#00ff00')]);
const references = [await photo('reference', '#0000ff')];
const draft = { roomId: room.id, selectedSourceIds: ['context', 'main'], viewpointSourceId: 'main', inspirationIds: ['reference'], styleBrief: 'Warm oak', plan: roomPlanConstraint(room),
  viewpoint: { sourceImageId: 'main', label: 'Main camera' }, layout: { version: 1, placements: [{ id: 'bench', label: 'Bench', itemType: 'bench', x: .3, y: .5, widthM: 1.1, depthM: .45, rotationDeg: 360 }] } };
const input = await buildFirstDesignRequest({ room, draft, sources, references, requestId: 'first-design-test-001', mode: 'real' });

test('first design real provider receives every image, canonical layout and reference-only style instructions in order', async () => {
  const calls = [], stages = [];
  const design = { conceptName: 'Oak hallway', style: spec, roomReading: { architecture: ['Hallway'], daylight: [] }, designIntent: 'Warm oak' };
  const review = { status: 'matches_constraints', findings: [] };
  let reasoning = 0;
  const client = {
    responses: { create: async args => { calls.push(args); return completed(reasoning++ ? review : design); } },
    images: { edit: async args => { calls.push(args); return { data: [{ b64_json: Buffer.from(await args.image[0].arrayBuffer()).toString('base64') }] }; } },
  };
  const result = await runRestyle(input, { client, onProgress: stage => stages.push(stage) });
  assert.deepEqual(stages, ['analyzing', 'rendering', 'reviewing']);
  assert.equal(calls[0].input[1].content.filter(item => item.type === 'input_image').length, 3);
  assert.match(calls[0].input[1].content[1].text, /authoritative main viewpoint.*main/);
  assert.equal(calls[1].image.length, 3);
  assert.match(calls[1].image[0].name, /main-view/); assert.match(calls[1].image[1].name, /room-context/); assert.match(calls[1].image[2].name, /style-reference/);
  assert.match(calls[1].prompt, /Do not copy furniture or room geometry from style-reference/);
  const canonical = JSON.parse(calls[1].prompt.split('CANONICAL ROOM AND PLACEMENTS:\n')[1].split('\n\n')[0]);
  assert.deepEqual(canonical.layout, input.layout);
  assert.deepEqual(canonical.room.plan, input.room.plan);
  assert.match(calls[1].prompt, /normalized centers.*clockwise/);
  assert.equal(result.operation, 'first_design'); assert.equal(result.layoutReview.status, 'matches_constraints');
});

test('first design mock traverses shared runner without credentials or real API and saves one generated family idempotently', async () => {
  const runner = createRunner({ getConfig: () => { throw new Error('Mock must not read credentials'); }, run: () => assert.fail('No paid calls'), mockRun: (request, options) => runMockRestyle(request, { ...options, wait: async () => {} }) });
  const result = await runner.start({ ...input, mode: 'mock' }, { owner: {} });
  assert.equal(result.mode, 'mock'); assert.equal(result.layoutReview.status, 'unchecked');
  const blob = new Blob([Buffer.from(result.image.base64, 'base64')], { type: 'image/png' });
  const rendered = { blob, thumbnail: blob, width: result.image.width, height: result.image.height };
  await saveFirstDesignDraft(draft);
  const args = { roomId: room.id, draft, sources, references, result, rendered };
  const saved = await saveFirstDesign(args), retry = await saveFirstDesign(args);
  assert.equal(saved.id, retry.id); assert.equal(saved.rootImageId, saved.id); assert.equal(saved.sourceType, 'first_design');
  assert.equal(await getFirstDesignDraft(room.id), undefined);
  const record = await getFirstDesignRecord(result.requestId);
  assert.deepEqual(record.plan, draft.plan); assert.deepEqual(record.layout, draft.layout);
  assert.equal(record.sourceSnapshots.length, 2); assert.equal(record.inspirationSnapshots.length, 1);
  assert.deepEqual(await record.inspirationSnapshots[0].blob.arrayBuffer(), await references[0].blob.arrayBuffer());
  const families = groupDesigns(await listImages(room.id), room.id);
  assert.equal(families.length, 1); assert.equal(families[0].source.id, saved.id);
  const cards = renderSourceCards(families, { roomId: room.id, escape: String, imageURL: () => 'blob:test', icon: String });
  assert.match(cards, /Mock preview, not AI generated first design/); assert.match(cards, /data-origin="mock"/);
  assert.equal(sourceSnapshot(saved).firstDesignId, saved.firstDesignId);
  assert.equal(sourceSnapshot(saved).mode, 'mock');
});

test('first design cancellation prevents further provider calls and invalid constraints reject before spending', async () => {
  const controller = new AbortController(); let calls = 0;
  const client = { responses: { create: async () => { calls++; controller.abort(); return completed({ conceptName: 'Oak hallway', style: spec, roomReading: { architecture: [], daylight: [] }, designIntent: 'Warm oak' }); } }, images: { edit: () => assert.fail('Cancelled') } };
  await assert.rejects(runRestyle(input, { client, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 1);
  await assert.rejects(runRestyle({ ...input, layout: { version: 1, placements: [{ ...input.layout.placements[0], rotationDeg: 361 }] } }, { client }), { code: 'invalid_first_design' });
  assert.equal(calls, 1);
});
