import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRestyleWizard } from '../src/restyle-wizard.js';
import { createPhotoViewer } from '../src/photo-viewer.js';
import { resultFixture } from './restyle-fixtures.js';

const dom = new JSDOM('<button id="opener">Restyle</button><dialog id="wizard"></dialog><dialog id="viewer"></dialog>', { url: 'http://localhost/' });
globalThis.window = dom.window; globalThis.document = dom.window.document; globalThis.AbortController = dom.window.AbortController;
dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; this.dispatchEvent(new dom.window.Event('close')); };
let downloads = 0;
dom.window.HTMLAnchorElement.prototype.click = () => { downloads++; };
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const tick = () => new Promise((resolve) => setImmediate(resolve));
const photo = { id: 'photo-001', roomId: 'kuche', title: 'Kitchen', blob: new Blob(['source'], { type: 'image/png' }), width: 100, height: 80 };
const inspiration = new File(['style'], 'inspiration.png', { type: 'image/png' });
const dialog = document.querySelector('#wizard');
const click = (action) => dialog.querySelector(`[data-action="${action}"]`).click();
async function upload(files = [inspiration]) {
  const input = dialog.querySelector('[data-inspiration]');
  Object.defineProperty(input, 'files', { value: files, configurable: true });
  input.dispatchEvent(new dom.window.Event('change', { bubbles: true })); await tick();
}
async function paste(files = [inspiration], { target = document.body, items = true } = {}) {
  const event = new dom.window.Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: {
    files,
    items: items ? files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })) : [],
  } });
  target.dispatchEvent(event); await tick();
  return event;
}
function setup(overrides = {}) {
  return createRestyleWizard(dialog, {
    initialMode: 'real', mockSaveDelayMs: 0,
    client: { status: async () => ({ configured: true }), run: async () => resultFixture() },
    escape, readImage: async (file) => ({ blob: file, width: 100, height: 80 }),
    saveVersion: async () => ({ ...photo, id: 'new-version' }), onSaved: async () => {}, onView: () => {}, getPhotos: () => [photo], ...overrides,
  });
}

test('wizard requires design selection and exactly one image, then saves and compares', async () => {
  let viewed; let saved = 0;
  const wizard = setup({ saveVersion: async (data) => { saved++; assert.equal(data.source.id, photo.id); return { ...photo, id: 'new-version' }; }, onView: (image) => { viewed = image; } });
  try {
    wizard.open([photo]); await tick();
    assert.equal(dialog.querySelector('[data-action="next"]').disabled, true);
    dialog.querySelector('[data-design]').click(); click('next');
    await upload([inspiration, inspiration]); assert.match(dialog.textContent, /exactly one/);
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, true);
    await upload(); assert.equal(dialog.querySelector('[data-action="run"]').disabled, false);
    click('run'); await tick(); await tick();
    assert.equal(saved, 1); assert.equal(wizard.busy, false); assert.equal(wizard.unsaved, false);
    assert.match(dialog.textContent, /New version saved/); assert.match(dialog.textContent, /No changes detected/);
    assert.equal(dialog.querySelectorAll('.restyle-comparison img').length, 2);
    click('view'); assert.equal(viewed.id, 'new-version');
  } finally { wizard.dispose(); }
});

test('restyle instructions survive image changes and retries and accompany both images', async () => {
  const inputs = []; let stored;
  const wizard = setup({
    client: { status: async () => ({ configured: true }), run: async (input) => {
      inputs.push(input);
      if (inputs.length === 1) throw new Error('Try again.');
      return resultFixture();
    } },
    saveVersion: async (data) => { stored = data; return { ...photo, id: 'new-version' }; },
  });
  try {
    wizard.open([photo], photo.id, { lockSource: true }); await tick();
    const editor = dialog.querySelector('[data-restyle-instruction]');
    assert.equal(editor.maxLength, 2000);
    editor.value = '  Keep the sofa green.\nUse warm oak.  ';
    editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, true);
    assert.equal((await paste([], { target: editor })).defaultPrevented, false);
    await upload();
    assert.equal(dialog.querySelector('[data-restyle-instruction]').value, editor.value);
    click('run'); await tick();
    assert.equal(dialog.querySelector('[data-restyle-instruction]').value, editor.value.trim());
    click('run'); await tick(); await tick();
    assert.equal(inputs[1].instruction, editor.value.trim());
    assert.ok(inputs[1].source.base64); assert.ok(inputs[1].inspiration.base64);
    assert.equal(stored.result.instruction, editor.value.trim());
    click('again'); await tick();
    assert.equal(dialog.querySelector('[data-restyle-instruction]').value, '');
  } finally { wizard.dispose(); }
});

test('clipboard paste previews one image and a later paste replaces the submitted inspiration', async () => {
  let submitted; let stored;
  const replacement = new File(['clipboard replacement'], 'clipboard.png', { type: 'image/png' });
  const wizard = setup({
    client: { status: async () => ({ configured: true }), run: async (input) => { submitted = input; return resultFixture(); } },
    saveVersion: async (data) => { stored = data; return { ...photo, id: 'new-version' }; },
  });
  try {
    wizard.open([photo], photo.id); await tick();
    assert.match(dialog.textContent, /⌘V \/ Ctrl\+V/);
    assert.equal((await paste([inspiration], { target: dialog.querySelector('[data-action="close"]') })).defaultPrevented, true);
    assert.ok(dialog.querySelector('img[alt="Inspiration image"]'));
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, false);
    // Some clipboard implementations expose files without DataTransferItem entries.
    assert.equal((await paste([replacement], { items: false })).defaultPrevented, true);
    assert.equal(dialog.querySelector('.restyle-filename').textContent, 'clipboard.png');
    click('run'); await tick(); await tick();
    assert.equal(Buffer.from(submitted.inspiration.base64, 'base64').toString(), 'clipboard replacement');
    assert.equal(stored.inspiration, replacement);
    assert.equal((await paste()).defaultPrevented, false);
  } finally { wizard.dispose(); }
});

test('clipboard image validation preserves an existing inspiration after invalid input', async () => {
  const wizard = setup({ readImage: async (file) => {
    if (file.name === 'broken.png') throw new Error('Could not open this image.');
    return { blob: file, width: 100, height: 80 };
  } });
  try {
    wizard.open([photo], photo.id); await tick(); await upload();
    await paste([inspiration, inspiration]); assert.match(dialog.textContent, /exactly one/);
    await paste([new File(['svg'], 'unsupported.svg', { type: 'image/svg+xml' })]);
    assert.ok(dialog.querySelector('[role="alert"]'));
    const oversized = new File(['image'], 'large.png', { type: 'image/png' });
    Object.defineProperty(oversized, 'size', { value: 26 * 1024 * 1024 });
    await paste([oversized]); assert.match(dialog.textContent, /25 MB/);
    await paste([new File(['invalid'], 'broken.png', { type: 'image/png' })]);
    assert.match(dialog.textContent, /Could not open this image/);
    assert.equal(dialog.querySelector('.restyle-filename').textContent, inspiration.name);
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, false);
  } finally { wizard.dispose(); }
});

test('clipboard paste only handles images during an idle, open inspiration step', async () => {
  let reads = 0;
  const wizard = setup({
    readImage: async (file) => { reads++; return { blob: file, width: 100, height: 80 }; },
    client: { status: async () => ({ configured: true }), run: async (_input, { signal }) =>
      new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true })) },
  });
  try {
    assert.equal((await paste()).defaultPrevented, false);
    wizard.open([photo]); await tick();
    assert.equal((await paste()).defaultPrevented, false);
    dialog.querySelector('[data-design]').click(); click('next');
    assert.equal((await paste([new File(['text'], 'text.txt', { type: 'text/plain' })])).defaultPrevented, false);
    assert.equal((await paste([])).defaultPrevented, false);
    assert.equal(reads, 0);
    await paste(); assert.equal(reads, 1);
    click('run'); await tick();
    assert.equal((await paste()).defaultPrevented, false); assert.equal(reads, 1);
    click('cancel'); await tick(); click('close');
    assert.equal((await paste()).defaultPrevented, false); assert.equal(reads, 1);
  } finally { wizard.dispose(); }
  assert.equal((await paste()).defaultPrevented, false);
});

test('failed save retains result across close/reopen; retry save and download never render again', async () => {
  let generations = 0; let saves = 0;
  const wizard = setup({
    client: { status: async () => ({ configured: true }), run: async () => { generations++; return resultFixture(); } },
    saveVersion: async () => { if (++saves === 1) throw Object.assign(new Error('Quota'), { name: 'QuotaExceededError' }); return { ...photo, id: 'new-version' }; },
  });
  try {
    wizard.open([photo], photo.id); await tick(); await upload(); click('run'); await tick(); await tick();
    assert.equal(wizard.unsaved, true); assert.match(dialog.textContent, /Device storage is full/);
    assert.equal(dialog.querySelector('.restyle-generation'), null);
    click('close'); wizard.open([photo]); await tick();
    assert.match(dialog.textContent, /Retry save/); click('download'); assert.ok(downloads > 0);
    click('save'); await tick(); assert.equal(saves, 2); assert.equal(generations, 1); assert.equal(wizard.unsaved, false);
  } finally { wizard.dispose(); }
});

test('generation placeholder follows real stages continuously through saving, then reveals the result', async () => {
  let advance, finishRender, finishSave;
  const rendering = new Promise((resolve) => { finishRender = resolve; });
  const saving = new Promise((resolve) => { finishSave = resolve; });
  const wizard = setup({
    client: { status: async () => ({ configured: true }), run: async (_input, { onProgress }) => { advance = onProgress; return rendering; } },
    saveVersion: async () => saving,
  });
  const states = () => [...dialog.querySelectorAll('.restyle-progress li')].map((item) => item.dataset.state);
  try {
    wizard.open([photo], photo.id); await tick(); await upload();
    assert.equal(dialog.querySelector('.restyle-generation'), null);
    dialog.querySelector('[data-action="run"]').focus(); click('run');
    const placeholder = dialog.querySelector('.restyle-generation-placeholder');
    const progress = dialog.querySelector('.restyle-progress');
    assert.ok(placeholder);
    const merge = placeholder.querySelector('.restyle-merge');
    assert.ok(merge);
    assert.equal(placeholder.getAttribute('aria-hidden'), 'true');
    const sourceURL = merge.querySelector('.restyle-merge-source img').src;
    const inspirationURL = merge.querySelector('.restyle-merge-inspiration img').src;
    assert.notEqual(sourceURL, inspirationURL);
    assert.deepEqual([...merge.querySelectorAll('.restyle-merge-blend img')].map((img) => img.src), [sourceURL, inspirationURL]);
    assert.ok(placeholder.compareDocumentPosition(progress) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.deepEqual([...progress.querySelectorAll('.restyle-step-label')].map((item) => item.textContent), ['Extracting style', 'Rendering', 'Checking geometry', 'Saving']);
    assert.deepEqual(states(), ['active', 'pending', 'pending', 'pending']);
    assert.equal(document.activeElement.dataset.action, 'cancel');
    assert.equal(dialog.querySelector('[data-inspiration]'), null);
    await tick(); advance('rendering');
    assert.deepEqual(states(), ['complete', 'active', 'pending', 'pending']);
    assert.match(dialog.querySelector('[role="status"]').textContent, /Rendering/);
    advance('checking');
    assert.deepEqual(states(), ['complete', 'complete', 'active', 'pending']);
    assert.equal(dialog.querySelector('.restyle-generation-placeholder'), placeholder);
    assert.equal(dialog.querySelector('.restyle-merge'), merge);
    assert.equal(progress.querySelectorAll('[aria-current="step"]').length, 1);
    finishRender(resultFixture()); await tick();
    assert.deepEqual(states(), ['complete', 'complete', 'complete', 'active']);
    assert.equal(dialog.querySelector('.restyle-generation-placeholder'), placeholder);
    assert.equal(dialog.querySelector('[data-action="cancel"]').disabled, true);
    assert.equal(dialog.querySelector('[data-action="close"]').disabled, true);
    assert.equal(dialog.querySelector('.restyle-comparison'), null);
    finishSave({ ...photo, id: 'new-version' }); await tick();
    assert.equal(dialog.querySelector('.restyle-generation'), null);
    assert.match(dialog.textContent, /New version saved/);
    assert.equal(dialog.querySelectorAll('.restyle-comparison img').length, 2);
  } finally { wizard.dispose(); }
});

test('a generation error removes the animation and restores the input previews for retry', async () => {
  const wizard = setup({ client: {
    status: async () => ({ configured: true }),
    run: async (_input, { onProgress }) => { onProgress('rendering'); throw new Error('Please try again later.'); },
  } });
  try {
    wizard.open([photo], photo.id); await tick(); await upload(); click('run'); await tick();
    assert.equal(dialog.querySelector('.restyle-generation'), null);
    assert.match(dialog.querySelector('[role="alert"]').textContent, /Please try again later/);
    assert.ok(dialog.querySelector('img[alt="Inspiration image"]'));
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, false);
  } finally { wizard.dispose(); }
});

test('duplicate start is prevented and cancellation keeps source and inspiration available', async () => {
  let calls = 0;
  const wizard = setup({ client: {
    status: async () => ({ configured: true }),
    run: async (_input, { signal, onProgress }) => {
      calls++; onProgress('rendering');
      return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
    },
  } });
  try {
    wizard.open([photo], photo.id); await tick(); await upload();
    const button = dialog.querySelector('[data-action="run"]'); button.click(); button.click(); await tick();
    assert.equal(calls, 1); assert.match(dialog.querySelector('[role="status"]').textContent, /Rendering/);
    click('cancel'); await tick();
    assert.equal(wizard.busy, false); assert.match(dialog.textContent, /Restyle cancelled/);
    assert.equal(dialog.querySelector('.restyle-generation'), null);
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, false);
    assert.ok(dialog.querySelector('img[alt="Inspiration image"]'));
  } finally { wizard.dispose(); }
});

test('missing key disables generation and Check again picks up local configuration', async () => {
  let configured = false;
  const wizard = setup({ client: { status: async () => ({ configured }) } });
  try {
    wizard.open([photo], photo.id); await tick(); await upload();
    assert.match(dialog.textContent, /OPENAI_API_KEY/);
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, true);
    configured = true; click('recheck'); await tick();
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, false);
  } finally { wizard.dispose(); }
});

test('mock is the default, works without a key and locks the selected mode during generation', async () => {
  window.localStorage.removeItem('cicero-restyle-mode');
  let submitted, stored, finish;
  const response = new Promise((resolve) => { finish = resolve; });
  const wizard = setup({ initialMode: undefined,
    client: { status: async () => ({ configured: false, mockAvailable: true }), run: async (input) => { submitted = input; return response; } },
    saveVersion: async (data) => { stored = data; return { ...photo, id: 'mock-version' }; },
  });
  try {
    wizard.open([photo], photo.id); await tick(); await upload();
    assert.equal(dialog.querySelector('[data-action="mode-mock"]').getAttribute('aria-pressed'), 'true');
    assert.equal(dialog.querySelector('[data-action="run"]').textContent, 'Test Restyle');
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, false);
    click('mode-real');
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, true);
    assert.ok(dialog.querySelector('img[alt="Inspiration image"]'));
    click('mode-mock'); click('run'); await tick();
    assert.equal(submitted.mode, 'mock');
    assert.equal(dialog.querySelector('[data-action="mode-real"]').disabled, true);
    click('mode-real');
    assert.equal(dialog.querySelector('[data-action="mode-mock"]').getAttribute('aria-pressed'), 'true');
    finish({ ...resultFixture(), mode: 'mock' });
    // Mock saving deliberately has a visible delay in production (zero for this test).
    await new Promise((resolve) => setTimeout(resolve, 10)); await tick();
    assert.equal(stored.result.mode, 'mock');
    assert.match(stored.rendered.blob.name, /^mock-restyle-/);
    assert.match(dialog.querySelector('.restyle-mock-note').textContent, /No AI generation/);
    assert.ok(dialog.querySelector('img[alt="Mock preview"]'));
  } finally { wizard.dispose(); window.localStorage.removeItem('cicero-restyle-mode'); }
});

test('mode selection persists across wizard instances and Real AI is explicitly sent to the client', async () => {
  window.localStorage.removeItem('cicero-restyle-mode');
  const first = setup({ initialMode: undefined });
  first.open([photo], photo.id); await tick(); click('mode-real'); first.dispose();
  let input;
  const second = setup({ initialMode: undefined, client: {
    status: async () => ({ configured: true, mockAvailable: true }),
    run: async (value) => { input = value; return { ...resultFixture(), mode: 'real' }; },
  } });
  try {
    second.open([photo], photo.id); await tick(); await upload();
    assert.equal(dialog.querySelector('[data-action="mode-real"]').getAttribute('aria-pressed'), 'true');
    assert.match(dialog.textContent, /Uses API credits/);
    click('run'); await tick(); await tick(); assert.equal(input.mode, 'real');
  } finally { second.dispose(); window.localStorage.removeItem('cicero-restyle-mode'); }
});

test('mock never starts against an older backend without advertised support', async () => {
  const wizard = setup({ initialMode: 'mock', client: { status: async () => ({ configured: true }), run: () => assert.fail('Must not risk calling an older real-only backend') } });
  try {
    wizard.open([photo], photo.id); await tick(); await upload();
    assert.equal(dialog.querySelector('[data-action="run"]').disabled, true);
    assert.match(dialog.textContent, /Restart the local app/);
    click('run'); await tick(); assert.equal(wizard.busy, false);
  } finally { wizard.dispose(); }
});

test('source-page Restyle skips selection and another version keeps the original source', async () => {
  const inputs = [];
  const wizard = setup({
    client: { status: async () => ({ configured: true }), run: async (input) => { inputs.push(input); return resultFixture(input.requestId); } },
  });
  try {
    wizard.open([photo], photo.id, { lockSource: true }); await tick();
    assert.equal(dialog.querySelector('.restyle-steps'), null);
    assert.equal(dialog.querySelector('[data-action="back"]'), null);
    assert.ok(dialog.querySelector('[data-inspiration]'));
    await upload(); click('run'); await tick(); await tick();
    assert.match(dialog.textContent, /Back to versions/);
    click('again'); await tick(); await upload(); click('run'); await tick(); await tick();
    assert.equal(inputs.length, 2);
    assert.deepEqual(inputs[0].source, inputs[1].source);
    assert.notEqual(inputs[0].requestId, inputs[1].requestId);
  } finally { wizard.dispose(); }
});

test('refinement turns a saved version into the next message source and keeps the edit request', async () => {
  const inputs = []; let savedRequest;
  const version = { ...photo, id: 'version-001', rootImageId: photo.id, parentImageId: photo.id, restyleId: 'prior-restyle' };
  const wizard = setup({
    client: { status: async () => ({ configured: true }), run: async (input) => { inputs.push(input); return { ...resultFixture(input.requestId), operation: 'refine', instruction: input.instruction }; } },
    saveVersion: async (data) => { savedRequest = data; return { ...version, id: 'version-002' }; },
  });
  try {
    wizard.open([version], version.id, { lockSource: true, flow: 'refine' }); await tick();
    assert.ok(dialog.querySelector('[data-refinement-instruction]'));
    assert.equal(dialog.querySelector('[data-inspiration]'), null);
    const editor = dialog.querySelector('[data-refinement-instruction]');
    editor.value = 'Replace the sofa with a curved cream sofa.';
    editor.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    click('run'); await tick(); await tick();
    assert.equal(inputs[0].operation, 'refine'); assert.equal(inputs[0].instruction, 'Replace the sofa with a curved cream sofa.');
    assert.equal('inspiration' in inputs[0], false);
    assert.equal(savedRequest.source.id, version.id); assert.equal(savedRequest.inspiration, null);
    assert.match(dialog.textContent, /Continue refining/);
  } finally { wizard.dispose(); }
});

test('viewer preselects Restyle and shows source snapshot with related version navigation', async () => {
  const viewerDialog = document.querySelector('#viewer'); let restyled; let viewed;
  const child = { ...photo, id: 'child', rootImageId: photo.id, parentImageId: photo.id, restyleId: 'restyle-001' };
  const viewer = createPhotoViewer(viewerDialog, {
    rooms: [{ id: 'kuche', name: 'Kitchen' }], icon: () => '', escape, refreshIcons: () => {}, handleError: () => {},
    onRestyle: (value) => { restyled = value; }, onViewVersion: (value) => { viewed = value; },
    getVersions: async () => ({ record: { ...resultFixture(), source: photo }, related: [photo, child] }),
  });
  try {
    viewer.open(photo.id, [photo, child], 'Kitchen');
    viewerDialog.querySelector('[data-action="restyle"]').click(); assert.equal(restyled.id, photo.id);
    viewer.open(child.id, [photo, child], 'Kitchen');
    assert.equal(viewerDialog.querySelector('[data-action="replace"]').hidden, true);
    viewerDialog.querySelector('#album-versions-open').click(); await tick();
    assert.equal(viewerDialog.querySelectorAll('#album-versions img').length, 2);
    viewerDialog.querySelector(`[data-version="${photo.id}"]`).click(); assert.equal(viewed.id, photo.id);
  } finally { viewer.dispose(); }
});

test('saved refinements have an independent Compare action even when Versions routes to the source page', async () => {
  const viewerDialog = document.querySelector('#viewer'); let shown;
  const child = { ...photo, id: 'refined-child', rootImageId: photo.id, parentImageId: photo.id, restyleId: 'refinement-001', restyleOperation: 'refine' };
  const viewer = createPhotoViewer(viewerDialog, {
    rooms: [{ id: 'kuche', name: 'Kitchen' }], icon: () => '', escape, refreshIcons: () => {}, handleError: () => {},
    onRestyle: () => {}, onShowDesign: (value) => { shown = value; },
    getVersions: async () => ({ record: { ...resultFixture(), source: photo, operation: 'refine', instruction: 'Make the walls warmer.' }, related: [photo, child] }),
  });
  try {
    viewer.open(child.id, [photo, child], 'Kitchen');
    assert.match(viewerDialog.querySelector('#image-dialog-title').textContent, /Version 1/);
    assert.equal(viewerDialog.querySelector('#album-restyle').textContent.trim(), 'Refine');
    assert.equal(viewerDialog.querySelector('#album-compare').hidden, false);
    viewerDialog.querySelector('#album-compare').click(); await tick();
    assert.equal(viewerDialog.open, true);
    assert.equal(shown, undefined);
    assert.equal(viewerDialog.querySelectorAll('#album-versions .restyle-comparison img').length, 2);
    assert.match(viewerDialog.querySelector('#album-versions').textContent, /Previous version/);
    assert.match(viewerDialog.querySelector('#album-versions').textContent, /Make the walls warmer/);
    viewerDialog.querySelector('[data-close-versions]').click();
    assert.equal(document.activeElement.id, 'album-compare');
    viewerDialog.querySelector('#album-versions-open').click();
    assert.equal(viewerDialog.open, false); assert.equal(shown.id, child.id);
  } finally { viewer.dispose(); }
});
