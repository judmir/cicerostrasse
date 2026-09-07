import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
let JSDOM;
try { ({ JSDOM } = await import('jsdom')); }
catch (error) { if (error.code !== 'ERR_MODULE_NOT_FOUND' || !error.message.includes("Cannot find package 'jsdom'")) throw error; }
const interactionTest = (name, fn) => test(name, { skip: !JSDOM && 'jsdom is not installed' }, fn);

// Node's test runner has no CSS loader; leave the production Vite import intact.
register(`data:text/javascript,${encodeURIComponent('export async function load(url, context, next) { if (url.endsWith("/room-layout-wizard.css")) return { format: "module", source: "", shortCircuit: true }; return next(url, context); }')}`, import.meta.url);
const { createRoomLayoutWizard, roomLayoutCatalog, containPlacement, normalizeRoomLayout } = await import('../src/room-layout-wizard.js');
const room = { id: 'raum3', name: 'Living room', type: 'Room' };
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const tick = () => new Promise(resolve => setImmediate(resolve));
const { setAIMode } = await import('../src/ai-mode.js');
const { firstDesignInputSchema } = await import('../server/schema.js');
const { roomPlanConstraint } = await import('../src/first-design-wizard.js');

function generationSetup(options = {}) {
  setAIMode('mock');
  const calls = [], saves = [];
  const photo = id => ({ id, roomId: room.id, title: id, blob: new Blob([id], { type: 'image/png' }) });
  const draft = { roomId: room.id, layoutWizardStep: 3, selectedSourceIds: ['two', 'one'], viewpointSourceId: 'two', styleBrief: 'Warm oak', layoutReferenceBlob: photo('reference').blob,
    layout: { version: 1, placements: [{ id: 'sofa', label: 'Sofa', itemType: 'sofa', x: .4, y: .6, widthM: 2.1, depthM: .9, rotationDeg: 360 }] } };
  const complete = input => ({ requestId: input.requestId, operation: 'first_design', mode: input.mode, image: { base64: btoa('generated'), mimeType: 'image/png' }, designSpec: { conceptName: 'Warm room' }, layoutReview: { status: 'unchecked', findings: [] } });
  const ui = setup({ getDraft: async () => draft, listImages: async () => [photo('one'), photo('two')],
    client: { status: async () => ({ configured: true, mockAvailable: true }), run: async (input, settings) => { calls.push(input); return options.run ? options.run(input, settings, complete) : complete(input); } },
    saveDesign: async value => { saves.push(value); return options.saveDesign ? options.saveDesign(value) : { id: 'saved' }; }, ...options.dependencies });
  return { ...ui, calls, saves, draft };
}

interactionTest('generation sends all measured geometry, selected image bytes, style reference and explicit mode', async () => {
  const ui = generationSetup();
  try {
    await ui.wizard.open(room); await tick();
    assert.equal(ui.dialog.querySelector('[data-ai-mode="mock"]').getAttribute('aria-pressed'), 'true');
    ui.click('[data-action="generate"]'); await tick();
    assert.equal(ui.calls.length, 1);
    const input = ui.calls[0];
    assert.equal(firstDesignInputSchema.safeParse(input).success, true);
    assert.equal(input.mode, 'mock');
    assert.deepEqual(input.roomImages.map(item => [item.id, item.role, atob(item.image.base64)]), [['two', 'main_view', 'two'], ['one', 'context', 'one']]);
    assert.equal(atob(input.styleReferences[0].image.base64), 'reference');
    assert.equal(input.styleBrief, 'Warm oak');
    assert.deepEqual(input.layout.placements[0], { ...ui.draft.layout.placements[0], rotationDeg: 0 });
    assert.equal(input.room.plan.widthM, 4.52); assert.equal(input.room.plan.depthM, 4.67);
    assert.equal(input.room.plan.openings.find(item => item.kind === 'balcony_door').hinge, 'end');
    assert.match(input.room.plan.note, /normalized centers.*clockwise/);
    assert.ok(ui.dialog.querySelector('.rl-result')); assert.equal(ui.saves.length, 0);
    ui.click('[data-action="save-design"]'); await tick();
    assert.equal(ui.saves.length, 1); assert.equal(ui.saves[0].draft.plan.widthM, 4.52);
    assert.equal(await ui.saves[0].references[0].blob.text(), 'reference');
    ui.click('[data-action="close"]'); assert.equal(ui.liveURLs.size, 0);
  } finally { ui.cleanup(); }
  const hall = roomPlanConstraint({ id: 'flur' });
  assert.equal(hall.openings.length, 6);
  assert.equal(hall.openings[0].hinge, 'end');
  assert.equal(hall.openings.filter(item => item.kind === 'passage').length, 2);
});

interactionTest('loading preserves a saved camera by ordering it first and falls back only when unavailable', async () => {
  for (const [viewpointSourceId, selectedSourceIds, expected] of [
    ['b', ['a', 'b'], ['b', 'a']],
    [null, ['a', 'b'], ['a', 'b']],
    ['b', ['a'], ['a']],
    ['missing', ['a', 'missing', 'b'], ['a', 'b']],
  ]) {
    const ui = generationSetup({ dependencies: {
      listImages: async () => ['a', 'b'].map(id => ({ id, roomId: room.id, blob: new Blob([id], { type: 'image/png' }) })),
    } });
    Object.assign(ui.draft, { selectedSourceIds, viewpointSourceId });
    try {
      await ui.wizard.open(room); await tick();
      ui.click('[data-save]'); await tick();
      assert.deepEqual(ui.saved[0].selectedSourceIds, expected);
      assert.equal(ui.saved[0].viewpointSourceId, expected[0]);
      assert.deepEqual(ui.draft.selectedSourceIds, selectedSourceIds);
      assert.equal(ui.draft.viewpointSourceId, viewpointSourceId);
      await ui.wizard.open(room); await tick();
      ui.click('[data-action="generate"]'); await tick();
      assert.equal(ui.calls.length, 1);
      assert.equal(ui.calls[0].viewpoint.sourceImageId, expected[0]);
      assert.deepEqual(ui.calls[0].roomImages.map(image => [image.id, image.role]), expected.map((id, index) => [id, index === 0 ? 'main_view' : 'context']));
    } finally { ui.cleanup(); }
  }
});

interactionTest('real mode is explicit, stages do not invent progress, cancellation blocks late output and duplicates', async () => {
  let finish, progress;
  const ui = generationSetup({ run: (input, settings, complete) => new Promise(resolve => { finish = () => resolve(complete(input)); progress = settings.onProgress; }) });
  try {
    await ui.wizard.open(room); await tick(); ui.click('[data-ai-mode="real"]');
    ui.click('[data-action="generate"]'); await tick();
    assert.equal(ui.calls[0].mode, 'real'); assert.equal(ui.calls.length, 1);
    assert.match(ui.dialog.textContent, /Preparing room photos/);
    const sourceImage = ui.dialog.querySelector('.rl-generating img');
    assert.ok(sourceImage);
    assert.ok(ui.dialog.querySelector('.rl-generating .restyle-merge-scan'));
    assert.equal(ui.dialog.querySelector('.rl-dots, .rl-silhouette, .rl-result'), null);
    assert.match(ui.dialog.textContent, /Selected source photo, not generated output/);
    progress('rendering'); assert.match(ui.dialog.textContent, /Generating image/);
    assert.equal(ui.dialog.querySelector('.rl-generating img').src, sourceImage.src);
    assert.doesNotMatch(ui.dialog.textContent, /\d+%/);
    ui.window.confirm = () => true; ui.cancel(); assert.equal(ui.dialog.open, true);
    const unload = new ui.window.Event('beforeunload', { cancelable: true }); ui.window.dispatchEvent(unload); assert.equal(unload.defaultPrevented, true);
    ui.click('[data-action="cancel-generation"]'); finish(); await tick();
    assert.equal(ui.dialog.querySelector('.rl-result'), null); assert.match(ui.dialog.textContent, /cancelled/);
    assert.equal(ui.dialog.querySelector('[data-instructions]').value, 'Warm oak');
    assert.ok(ui.dialog.querySelector('.rl-reference img')); assert.equal(ui.saves.length, 0);
  } finally { ui.cleanup(); setAIMode('mock'); }
});

interactionTest('generation failure retains inputs; save failure and processing retry never regenerate', async () => {
  let attempts = 0, saveAttempts = 0, resolveSave;
  const ui = generationSetup({ run: (input, settings, complete) => { if (++attempts === 1) throw new Error('Generation unavailable'); return complete(input); },
    saveDesign: async () => { if (++saveAttempts === 1) throw new Error('Storage full'); return new Promise(resolve => { resolveSave = resolve; }); } });
  try {
    await ui.wizard.open(room); await tick(); ui.click('[data-action="generate"]'); await tick();
    assert.match(ui.dialog.textContent, /Generation unavailable/);
    assert.equal(ui.dialog.querySelector('[data-instructions]').value, 'Warm oak');
    ui.click('[data-action="generate"]'); await tick();
    ui.click('[data-action="save-design"]'); await tick();
    assert.match(ui.dialog.textContent, /Storage full/); assert.ok(ui.dialog.querySelector('.rl-result'));
    ui.cancel(); assert.equal(ui.dialog.open, true);
    ui.click('[data-action="save-design"]'); await tick();
    ui.window.confirm = () => true; ui.cancel(); assert.equal(ui.dialog.open, true);
    ui.click('[data-action="save-design"]'); assert.equal(saveAttempts, 2);
    resolveSave({ id: 'saved' }); await tick();
    assert.equal(attempts, 2); assert.ok(ui.dialog.querySelector('[data-action="open-design"]'));
  } finally { ui.cleanup(); }
});

interactionTest('missing real config never falls back to mock and thumbnail failure keeps generated bytes', async () => {
  let reads = 0;
  const ui = generationSetup({ dependencies: { readImage: async blob => { if (++reads === 1) throw new Error('Thumbnail failed'); return { blob, thumbnail: blob }; } } });
  try {
    await ui.wizard.open(room); await tick(); ui.click('[data-action="generate"]'); await tick();
    assert.match(ui.dialog.textContent, /Thumbnail failed/); assert.ok(ui.dialog.querySelector('.rl-result'));
    ui.click('[data-action="save-design"]'); await tick(); assert.equal(ui.calls.length, 1); assert.equal(ui.saves.length, 1);
  } finally { ui.cleanup(); }
  const unavailable = generationSetup({ dependencies: { client: { status: async () => ({ configured: false, mockAvailable: true }), run: () => assert.fail('must not run') } } });
  try {
    await unavailable.wizard.open(room); await tick(); unavailable.click('[data-ai-mode="real"]');
    assert.equal(unavailable.dialog.querySelector('[data-action="generate"]').disabled, true);
    assert.match(unavailable.dialog.textContent, /Real AI unavailable/);
  } finally { unavailable.cleanup(); setAIMode('mock'); }
});

function setup(options = {}) {
  const dom = new JSDOM('<button id="opener">Style with AI</button><dialog></dialog>', { url: 'http://localhost' });
  const { window } = dom;
  const liveURLs = new Set();
  window.URL.createObjectURL = () => { const url = `blob:test-${Math.random()}`; liveURLs.add(url); return url; };
  window.URL.revokeObjectURL = url => liveURLs.delete(url);
  const dialog = window.document.querySelector('dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new window.Event('close')); };
  window.confirm = () => false;
  const saved = [];
  const wizard = createRoomLayoutWizard(dialog, { escape, getDraft: async () => saved.at(-1), saveDraft: async value => saved.push(value), listImages: async () => [{ id: 'source', roomId: room.id, blob: new Blob(['photo'], { type: 'image/png' }) }], readImage: async blob => ({ blob }), ...options });
  const click = selector => { const node = dialog.querySelector(selector); assert.ok(node, selector); node.click(); };
  const change = (field, value) => {
    const node = dialog.querySelector(`[data-field="${field}"]`); node.value = value;
    node.dispatchEvent(new window.Event('change', { bubbles: true }));
  };
  const cancel = () => dialog.dispatchEvent(new window.Event('cancel', { cancelable: true }));
  const cleanup = () => { window.confirm = () => true; wizard.dispose(); window.close(); };
  return { window, dialog, wizard, saved, click, change, cancel, cleanup, liveURLs };
}

test('catalog has nine concise categories and unique valid presets', () => {
  assert.deepEqual(roomLayoutCatalog.map(group => group.label), ['Bedroom', "Kids' room", 'Kitchen', 'Living room', 'Dining room', 'Bathroom', 'Office', 'Hallway', 'Outdoor']);
  const items = roomLayoutCatalog.flatMap(group => group.items);
  assert.equal(new Set(items.map(item => item[0])).size, items.length);
  for (const group of roomLayoutCatalog) {
    assert.ok(group.items.length >= 3);
    for (const [key, label, width, depth] of group.items) assert.ok(key && label && width > 0 && depth > 0);
  }
});

interactionTest('Living room TV and console add independently while saved media consoles stay unchanged', async () => {
  const legacy = { id: 'legacy', itemType: 'media_console', label: 'Media console', widthM: 1.6, depthM: .45, x: .5, y: .5, rotationDeg: 360 };
  const ui = setup({ getDraft: () => ui.saved.at(-1) || ({ roomId: room.id, layout: { version: 1, placements: [legacy] } }) });
  try {
    await ui.wizard.open(room);
    for (const [key, label] of [['wall_mounted_tv', 'Wall-mounted TV'], ['tv_console', 'TV console']]) {
      const selector = `[data-category="living"] [data-add="${key}"]`;
      assert.equal(ui.dialog.querySelector(selector)?.textContent, `+ ${label}`);
      ui.click(selector);
    }
    assert.equal(ui.dialog.querySelector('[data-add="media_console"]'), null);
    ui.click('[data-save]'); await tick();
    const [savedLegacy, tv, console] = ui.saved[0].layout.placements;
    assert.deepEqual(savedLegacy, legacy);
    assert.equal(new Set([savedLegacy.id, tv.id, console.id]).size, 3);
    assert.deepEqual([tv.itemType, tv.label, tv.widthM, tv.depthM], ['wall_mounted_tv', 'Wall-mounted TV', 1.2, .1]);
    assert.deepEqual([console.itemType, console.label, console.widthM, console.depthM], ['tv_console', 'TV console', 1.6, .45]);
    assert.deepEqual([tv.x, tv.y], [console.x, console.y]);
    await ui.wizard.open(room);
    ui.dialog.querySelector(`[data-placement="${tv.id}"]`).dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    ui.click('[data-save]'); await tick();
    assert.ok(ui.saved[1].layout.placements[1].x > tv.x);
    assert.deepEqual(ui.saved[1].layout.placements[2], console);
  } finally { ui.cleanup(); }
});

interactionTest('every room offers every category and preset regardless of purpose', async () => {
  for (const name of ['Schlafzimmer', 'Kitchen', 'Bad', 'Office', 'Loggia', 'Raum 1']) {
    const ui = setup();
    try {
      await ui.wizard.open({ ...room, name, type: name });
      assert.deepEqual([...ui.dialog.querySelectorAll('[data-category] > summary')].map(node => node.textContent), roomLayoutCatalog.map(group => group.label));
      assert.deepEqual([...ui.dialog.querySelectorAll('[data-add]')].map(node => node.dataset.add), roomLayoutCatalog.flatMap(group => group.items.map(item => item[0])));
    } finally { ui.cleanup(); }
  }
});

interactionTest('native catalog and categories retain independent state through adding, collapsed editing and all steps', async () => {
  const ui = setup();
  const expanded = () => [...ui.dialog.querySelectorAll('[data-category][open]')].map(node => node.dataset.category);
  const catalog = () => ui.dialog.querySelector('[data-furniture-catalog]');
  try {
    await ui.wizard.open(room);
    assert.equal(catalog().open, true);
    assert.equal(catalog().querySelector(':scope > summary > h3').textContent, 'Add furniture');
    assert.deepEqual(expanded(), ['living']);
    ui.click('[data-category="kids"] summary');
    assert.deepEqual(expanded(), ['kids', 'living']);
    ui.click('[data-add="crib"]');
    ui.click('[data-category="office"] summary');
    ui.click('[data-add="desk"]');
    assert.equal(catalog().open, true);
    ui.click('[data-category="living"] summary');
    ui.click('[data-furniture-catalog] > summary');
    assert.equal(catalog().open, false);
    assert.equal(ui.dialog.querySelector('.rl-selection').closest('details'), null);
    ui.dialog.querySelector('[data-placement]').dispatchEvent(new ui.window.MouseEvent('click', { bubbles: true }));
    ui.change('widthM', '1.1');
    assert.equal(catalog().open, false);
    assert.deepEqual(expanded(), ['kids', 'office']);
    ui.click('[data-action="next"]');
    ui.click('[data-source]');
    ui.click('[data-action="next"]');
    ui.click('[data-action="back"]');
    ui.click('[data-action="back"]');
    assert.deepEqual(expanded(), ['kids', 'office']);
    assert.equal(catalog().open, false);
    ui.click('[data-furniture-catalog] > summary');
    assert.deepEqual(expanded(), ['kids', 'office']);
    ui.click('[data-action="next"]');
    ui.click('[data-action="back"]');
    assert.equal(catalog().open, true);
    assert.deepEqual(expanded(), ['kids', 'office']);
    ui.click('[data-save]'); await tick();
    assert.deepEqual(ui.saved[0].layout.placements.map(item => item.itemType), ['crib', 'desk']);
    assert.equal(ui.saved[0].layout.placements[0].widthM, 1.1);
    assert.equal(ui.saved[0].layout.placements[0].depthM, 1.4);
    assert.equal(ui.saved[0].layout.placements[1].widthM, 1.2);
  } finally { ui.cleanup(); }
});

test('all rotated corners remain within the actual room rectangle', () => {
  for (const rotationDeg of [0, 15, 45, 90, 180, 135, 270, 360, -45, 725]) {
    for (const [width, depth] of [[1.46, 4.06], [6.72, 1.71], [4.52, 4.67]]) {
      const item = containPlacement({ widthM: 12, depthM: 3, x: -5, y: 7, rotationDeg }, width, depth);
      const a = item.rotationDeg * Math.PI / 180;
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        const x = item.x * width + sx * item.widthM / 2 * Math.cos(a) - sy * item.depthM / 2 * Math.sin(a);
        const y = item.y * depth + sx * item.widthM / 2 * Math.sin(a) + sy * item.depthM / 2 * Math.cos(a);
        assert.ok(x >= -1e-9 && x <= width + 1e-9);
        assert.ok(y >= -1e-9 && y <= depth + 1e-9);
      }
    }
  }
});

test('normalization handles nonfinite numbers and refuses destructive truncation or unsupported data', () => {
  const item = { id: 'a', widthM: Infinity, depthM: 'bad', x: NaN, y: Infinity, rotationDeg: -90 };
  const layout = normalizeRoomLayout({ version: 1, placements: [item] }, 4, 4);
  assert.equal(layout.placements[0].rotationDeg, 270);
  assert.equal(layout.placements[0].x, .5);
  assert.equal(layout.placements[0].widthM, .5);
  assert.throws(() => normalizeRoomLayout({ version: 2, placements: [] }, 4, 4), /version/);
  assert.throws(() => normalizeRoomLayout({ version: 1, placements: [item, item] }, 4, 4), /invalid/);
  assert.throws(() => normalizeRoomLayout({ version: 1, placements: Array(41).fill(item) }, 4, 4), /40-item/);
});

test('zero rotation displays as 360 without changing unrotated geometry', () => {
  const item = { id: 'a', widthM: 4, depthM: 2, x: .5, y: .25, rotationDeg: 0 };
  assert.deepEqual(containPlacement(item, 4, 4), { ...item, rotationDeg: 360 });
  assert.equal(item.rotationDeg, 0);
});

interactionTest('saved zero uses the presets while other saved rotations remain available', async () => {
  for (const rotationDeg of [0, 45, 110]) {
    const item = { id: 'a', widthM: 1, depthM: .5, x: .5, y: .5, rotationDeg };
    const ui = setup({ getDraft: () => ({ roomId: room.id, layout: { version: 1, placements: [item] } }) });
    try {
      await ui.wizard.open(room);
      const control = ui.dialog.querySelector('[data-field="rotationDeg"]');
      assert.equal(Number(control.value), rotationDeg || 360);
      assert.deepEqual([...control.options].map(o => Number(o.value)), rotationDeg ? [rotationDeg, 90, 180, 270, 360] : [90, 180, 270, 360]);
      ui.click('[data-save]'); await tick();
      assert.equal(ui.saved[0].layout.placements[0].rotationDeg, rotationDeg || 360);
      assert.equal(item.rotationDeg, rotationDeg);
    } finally { ui.cleanup(); }
  }
});

interactionTest('add, numeric resize, rotate, keyboard move, explicit save and reopen preserve other draft fields', async () => {
  const original = { roomId: room.id, step: 3, styleBrief: 'Warm oak', selectedSourceIds: ['source'], custom: { keep: true }, layout: { version: 1, placements: [] } };
  let stored = original;
  const ui = setup({ getDraft: async () => stored, saveDraft: async value => { stored = value; } });
  try {
    ui.window.document.querySelector('#opener').focus();
    await ui.wizard.open(room);
    assert.match(ui.dialog.textContent, /Step 1 \/ Room layout/);
    assert.notEqual(ui.dialog.querySelector('[data-plan]').getAttribute('viewBox'), '0 0 280 370');
    assert.ok(ui.dialog.querySelector('[data-step-title]').classList.contains('rl-sr-only'));
    assert.equal(ui.window.document.activeElement, ui.dialog.querySelector('[data-step-title]'));
    assert.ok(ui.dialog.querySelector('#rl-plan-help').classList.contains('rl-sr-only'));
    ui.click('[data-add="sofa"]');
    assert.deepEqual([...ui.dialog.querySelector('[data-field="rotationDeg"]').options].map(o => Number(o.value)), [90, 180, 270, 360]);
    assert.equal(ui.dialog.querySelector('[data-field="rotationDeg"]').value, '360');
    assert.equal(ui.dialog.querySelectorAll('[data-field]').length, 3);
    ui.change('widthM', '2.4'); ui.change('depthM', '.8'); ui.change('rotationDeg', '180');
    const node = ui.dialog.querySelector('[data-placement]');
    node.dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    assert.equal(original.layout.placements.length, 0);
    ui.click('[data-action="save"]'); await tick();
    assert.equal(ui.dialog.open, false);
    assert.equal(stored.step, 3); assert.equal(stored.styleBrief, 'Warm oak');
    assert.deepEqual(stored.custom, { keep: true }); assert.deepEqual(stored.selectedSourceIds, ['source']);
    assert.equal(stored.layout.placements[0].widthM, 2.4);
    assert.equal(stored.layout.placements[0].rotationDeg, 180);
    assert.ok(stored.layout.placements[0].x > .5);
    assert.equal(ui.window.document.activeElement.id, 'opener');
    await ui.wizard.open(room);
    assert.equal(ui.dialog.querySelectorAll('[data-placement]').length, 1);
    ui.change('rotationDeg', '360');
    ui.click('[data-action="save"]'); await tick();
    await ui.wizard.open(room);
    assert.equal(ui.dialog.querySelector('[data-field="rotationDeg"]').value, '360');
    for (const angle of ['90', '180', '270', '360']) {
      ui.dialog.querySelector('[data-placement]').dispatchEvent(new ui.window.KeyboardEvent('keydown', { key: 'r', bubbles: true }));
      assert.equal(ui.dialog.querySelector('[data-field="rotationDeg"]').value, angle);
    }
    ui.click('[data-action="remove"]'); ui.click('[data-action="save"]'); await tick();
    assert.equal(stored.layout.placements.length, 0);
  } finally { ui.cleanup(); }
});

interactionTest('Escape, close, reopening another room and dispose cannot silently discard edits', async () => {
  const ui = setup();
  try {
    await ui.wizard.open(room); ui.click('[data-add="sofa"]');
    ui.cancel(); assert.equal(ui.dialog.open, true);
    ui.click('[data-action="close"]'); assert.equal(ui.dialog.open, true);
    await ui.wizard.open({ id: 'bad', name: 'Bathroom' });
    assert.ok(ui.dialog.querySelector('[data-add="sofa"]'));
    assert.equal(ui.wizard.dispose(), false);
    assert.equal(ui.saved.length, 0);
    ui.window.confirm = () => true; ui.cancel();
    assert.equal(ui.dialog.open, false);
  } finally { ui.cleanup(); }
});

interactionTest('load failure blocks editing and exposes retry rather than replacing a saved draft', async () => {
  let attempts = 0;
  const ui = setup({ getDraft: async () => { if (++attempts === 1) throw new Error('offline'); return null; } });
  try {
    await ui.wizard.open(room);
    assert.match(ui.dialog.querySelector('[role="alert"]').textContent, /Could not load/);
    assert.equal(ui.dialog.querySelector('[data-save]'), null);
    ui.click('[data-action="retry-load"]'); await tick();
    assert.ok(ui.dialog.querySelector('[data-add="sofa"]'));
    assert.equal(ui.saved.length, 0);
  } finally { ui.cleanup(); }
});

interactionTest('save failure retains edits for retry and prevents dismissal during persistence', async () => {
  let attempts = 0, finish;
  const ui = setup({ saveDraft: async () => { if (++attempts === 1) throw new Error('quota'); await new Promise(resolve => { finish = resolve; }); } });
  try {
    await ui.wizard.open(room); ui.click('[data-add="sofa"]'); ui.click('[data-action="save"]'); await tick();
    assert.match(ui.dialog.textContent, /Could not save draft/);
    assert.equal(ui.dialog.querySelectorAll('[data-placement]').length, 1);
    ui.click('[data-action="save"]'); await tick();
    ui.window.confirm = () => true; ui.cancel(); assert.equal(ui.dialog.open, true);
    assert.equal(ui.dialog.querySelector('[data-save]').disabled, true);
    finish(); await tick(); assert.equal(ui.dialog.open, false);
  } finally { ui.cleanup(); }
});

interactionTest('late loads cannot overwrite a subsequently opened room', async () => {
  let resolve;
  const ui = setup({ getDraft: id => id === room.id ? new Promise(done => { resolve = done; }) : null });
  try {
    const first = ui.wizard.open(room);
    await ui.wizard.open({ id: 'bad', name: 'Bathroom', type: 'Bathroom' });
    resolve({ roomId: room.id, layout: { version: 1, placements: [] } }); await first;
    assert.ok(ui.dialog.querySelector('[data-add="vanity"]'));
    assert.ok(ui.dialog.querySelector('[data-add="sofa"]'));
    assert.equal(ui.dialog.querySelector('h2').textContent, 'Bathroom');
  } finally { ui.cleanup(); }
});

interactionTest('40-item cap and escaped labels', async () => {
  const placements = Array.from({ length: 40 }, (_, i) => ({ id: `id-${i}`, label: '<img src=x onerror=alert(1)>', itemType: 'sofa', widthM: 1, depthM: 1, x: .5, y: .5, rotationDeg: 0 }));
  const ui = setup({ getDraft: () => ({ roomId: room.id, layout: { version: 1, placements } }) });
  try {
    await ui.wizard.open(room);
    assert.equal(ui.dialog.querySelector('[data-add]').disabled, true);
    assert.equal(ui.dialog.querySelector('img'), null);
    ui.click('[data-category="outdoor"] summary');
    assert.equal(ui.dialog.querySelector('[data-add="planter"]').disabled, true);
    ui.click('[data-add="planter"]');
    assert.equal(ui.dialog.querySelectorAll('[data-placement]').length, 40);
    ui.click('[data-action="remove"]');
    assert.ok([...ui.dialog.querySelectorAll('[data-add]')].every(button => !button.disabled));
    ui.click('[data-add="planter"]');
    ui.click('[data-category="kids"] summary');
    assert.ok([...ui.dialog.querySelectorAll('[data-add]')].every(button => button.disabled));
    ui.click('[data-add="crib"]');
    ui.click('[data-save]'); await tick();
    assert.equal(ui.saved[0].layout.placements.length, 40);
    assert.equal(ui.saved[0].layout.placements.at(-1).itemType, 'planter');
  } finally { ui.cleanup(); }
});

interactionTest('pointer move and rotated resize update existing SVG nodes without rerendering the dialog', async () => {
  const ui = setup();
  try {
    await ui.wizard.open(room); ui.click('[data-add="sofa"]');
    const svg = ui.dialog.querySelector('[data-plan]');
    ui.dialog.querySelector('[data-placements]').getScreenCTM = () => ({ inverse: () => ({}) });
    svg.createSVGPoint = () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } });
    const pointer = (target, type, x, y) => {
      const event = new ui.window.MouseEvent(type, { bubbles: true, clientX: x, clientY: y, button: 0 });
      Object.defineProperty(event, 'pointerId', { value: 1 }); target.dispatchEvent(event);
    };
    pointer(ui.dialog.querySelector('[data-placement]'), 'pointerdown', 2, 2);
    const itemNode = ui.dialog.querySelector('[data-placement]');
    const editor = ui.dialog.querySelector('[data-editor]');
    pointer(svg, 'pointermove', 2.2, 2.3);
    assert.equal(ui.dialog.querySelector('[data-placement]'), itemNode);
    assert.equal(ui.dialog.querySelector('[data-editor]'), editor);
    assert.match(itemNode.getAttribute('transform'), /translate\(2\.46 2\.635\)/);
    pointer(svg, 'pointerup', 2.2, 2.3);
    ui.change('rotationDeg', '90');
    pointer(ui.dialog.querySelector('[data-resize]'), 'pointerdown', 2, 2);
    pointer(svg, 'pointermove', 2, 2.2);
    assert.equal(Number(ui.dialog.querySelector('[data-field="widthM"]').value), 2.5);
    pointer(svg, 'pointercancel', 2, 2.2);
    ui.click('[data-action="save"]'); await tick();
    assert.ok(Math.abs(ui.saved[0].layout.placements[0].widthM - 2.5) < 1e-9);
  } finally { ui.cleanup(); }
});

interactionTest('unknown room cannot edit an invented floor plan or overwrite its draft', async () => {
  const ui = setup();
  try {
    await ui.wizard.open({ id: 'unknown', name: 'New room', type: 'Room' });
    assert.match(ui.dialog.textContent, /No measured floor plan/);
    assert.equal(ui.dialog.querySelector('[data-plan]'), null);
    assert.equal(ui.dialog.querySelector('[data-save]'), null);
  } finally { ui.cleanup(); }
});

interactionTest('rail and Next/Back validate steps, focus headings and isolate original room photos', async () => {
  const photo = { roomId: room.id, blob: new Blob(['photo'], { type: 'image/png' }) };
  const ui = setup({ listImages: async () => [
    { ...photo, id: 'one' }, { ...photo, id: 'two' },
    { ...photo, id: 'restyle', restyleId: 'r' }, { ...photo, id: 'generated', firstDesignId: 'f' },
    { ...photo, id: 'other-room', roomId: 'bad' }, { ...photo, id: 'child', parentImageId: 'one' },
  ] });
  try {
    await ui.wizard.open(room);
    assert.equal(ui.dialog.querySelector('[data-step="3"]').disabled, true);
    ui.click('[data-action="next"]');
    assert.match(ui.dialog.querySelector('[data-error]').textContent, /Place at least/);
    ui.click('[data-add="sofa"]'); ui.click('[data-action="next"]');
    assert.equal(ui.window.document.activeElement, ui.dialog.querySelector('[data-step-title]'));
    assert.equal(ui.dialog.querySelector('[aria-current="step"]').dataset.step, '2');
    assert.ok(ui.dialog.querySelector('[data-step="1"]').classList.contains('is-complete'));
    assert.deepEqual([...ui.dialog.querySelectorAll('[data-source]')].map(n => n.dataset.source), ['one', 'two']);
    ui.click('[data-action="next"]'); assert.match(ui.dialog.textContent, /Select at least one room photo/);
    ui.click('[data-source="one"]'); ui.click('[data-source="two"]'); ui.click('[data-source="one"]');
    ui.click('[data-action="next"]'); ui.click('[data-action="back"]');
    assert.equal(ui.dialog.querySelector('[data-source="two"]').checked, true);
    ui.click('[data-step="1"]'); assert.equal(ui.dialog.querySelectorAll('[data-placement]').length, 1);
    ui.click('[data-step="2"]'); ui.click('[data-step="3"]');
    const text = ui.dialog.querySelector('[data-instructions]'); text.value = 'Warm oak'; text.dispatchEvent(new ui.window.Event('input', { bubbles: true }));
    ui.click('[data-save]'); await tick();
    assert.deepEqual(ui.saved[0].selectedSourceIds, ['two']); assert.equal(ui.saved[0].viewpointSourceId, 'two');
    assert.equal(ui.saved[0].styleBrief, 'Warm oak'); assert.equal(ui.saved[0].layoutWizardStep, 3);
    assert.equal(ui.liveURLs.size, 0);
    await ui.wizard.open(room); assert.equal(ui.dialog.querySelector('[data-instructions]').value, 'Warm oak');
  } finally { ui.cleanup(); }
});

interactionTest('empty photos allow incomplete draft save and photo load errors can retry', async () => {
  let attempts = 0;
  const ui = setup({ listImages: async () => { if (++attempts === 1) throw new Error('offline'); return []; } });
  try {
    await ui.wizard.open(room); assert.match(ui.dialog.textContent, /offline/);
    ui.click('[data-action="retry-load"]'); await tick();
    ui.click('[data-add="sofa"]'); ui.click('[data-action="next"]');
    assert.match(ui.dialog.textContent, /No original room photos/);
    ui.click('[data-save]'); await tick(); assert.equal(ui.saved.length, 1);
    await ui.wizard.open(room); assert.equal(ui.dialog.querySelector('[aria-current]').dataset.step, '2');
  } finally { ui.cleanup(); }
});

interactionTest('upload and clipboard replace one reference, retain valid bytes on error and persist after reopen', async () => {
  const ui = setup();
  const paste = file => {
    const event = new ui.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } });
    ui.dialog.dispatchEvent(event); return event;
  };
  try {
    await ui.wizard.open(room); ui.click('[data-add="sofa"]'); ui.click('[data-action="next"]'); ui.click('[data-source]'); ui.click('[data-action="next"]');
    const file = new File(['upload'], 'upload.png', { type: 'image/png' });
    const input = ui.dialog.querySelector('[data-reference-file]'); Object.defineProperty(input, 'files', { value: [file] });
    input.dispatchEvent(new ui.window.Event('change', { bubbles: true })); await tick();
    assert.equal(ui.dialog.querySelector('.rl-reference img').alt, 'upload.png');
    assert.equal(paste(new File(['paste'], 'paste.png', { type: 'image/png' })).defaultPrevented, true); await tick();
    assert.equal(ui.dialog.querySelectorAll('.rl-reference img').length, 1);
    paste(new File(['svg'], 'bad.svg', { type: 'image/svg+xml' })); await tick();
    assert.match(ui.dialog.querySelector('[data-error]').textContent, /Use a JPG/);
    assert.equal(ui.dialog.querySelector('.rl-reference img').alt, 'paste.png');
    ui.cancel(); assert.equal(ui.dialog.open, true);
    ui.click('[data-save]'); await tick();
    assert.equal(await ui.saved[0].layoutReferenceBlob.text(), 'paste'); assert.equal(ui.liveURLs.size, 0);
    await ui.wizard.open(room); assert.equal(ui.dialog.querySelector('.rl-reference img').alt, 'paste.png');
    ui.click('[data-action="remove-reference"]'); ui.click('[data-save]'); await tick();
    assert.equal(ui.saved[1].layoutReferenceBlob, null);
  } finally { ui.cleanup(); }
});

interactionTest('late image reads cannot replace a newer image or attach after cancellation and reopening', async () => {
  const pending = [];
  const ui = setup({ readImage: blob => new Promise(resolve => pending.push(() => resolve({ blob }))) });
  const paste = name => {
    const file = new File([name], `${name}.png`, { type: 'image/png' });
    const event = new ui.window.Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: file.type, getAsFile: () => file }] } }); ui.dialog.dispatchEvent(event);
  };
  try {
    await ui.wizard.open(room); ui.click('[data-add="sofa"]'); ui.click('[data-action="next"]'); ui.click('[data-source]'); ui.click('[data-action="next"]');
    paste('old'); assert.equal(ui.dialog.querySelector('[data-save]').disabled, true);
    paste('new'); pending[1](); await tick(); pending[0](); await tick();
    assert.equal(ui.dialog.querySelector('.rl-reference img').alt, 'new.png');
    paste('canceled'); ui.click('[data-action="remove-reference"]'); pending[2](); await tick();
    assert.equal(ui.dialog.querySelector('.rl-reference img'), null);
    paste('closed'); ui.window.confirm = () => true; ui.cancel(); await ui.wizard.open({ id: 'bad', name: 'Bad' });
    pending[3](); await tick(); assert.equal(ui.dialog.querySelector('.rl-reference img'), null);
    assert.equal(ui.liveURLs.size, 0);
  } finally { ui.cleanup(); }
});
