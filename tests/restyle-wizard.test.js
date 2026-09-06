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
function setup(overrides = {}) {
  return createRestyleWizard(dialog, {
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

test('failed save retains result across close/reopen; retry save and download never render again', async () => {
  let generations = 0; let saves = 0;
  const wizard = setup({
    client: { status: async () => ({ configured: true }), run: async () => { generations++; return resultFixture(); } },
    saveVersion: async () => { if (++saves === 1) throw Object.assign(new Error('Quota'), { name: 'QuotaExceededError' }); return { ...photo, id: 'new-version' }; },
  });
  try {
    wizard.open([photo], photo.id); await tick(); await upload(); click('run'); await tick(); await tick();
    assert.equal(wizard.unsaved, true); assert.match(dialog.textContent, /Device storage is full/);
    click('close'); wizard.open([photo]); await tick();
    assert.match(dialog.textContent, /Retry save/); click('download'); assert.ok(downloads > 0);
    click('save'); await tick(); assert.equal(saves, 2); assert.equal(generations, 1); assert.equal(wizard.unsaved, false);
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
