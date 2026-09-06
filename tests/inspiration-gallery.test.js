import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createInspirationGallery } from '../src/inspiration-gallery.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function setup(overrides = {}) {
  const dom = new JSDOM('<section id="gallery"></section>', { url: 'https://example.com' });
  globalThis.document = dom.window.document;
  globalThis.AbortController = dom.window.AbortController;
  dom.window.HTMLDialogElement.prototype.close = function() { this.removeAttribute('open'); };
  const notices = [];
  const container = document.querySelector('section');
  const gallery = createInspirationGallery(container, { escape: value => String(value).replaceAll('<', '&lt;').replaceAll('"', '&quot;'), icon: () => '', refreshIcons() {}, readImage: async file => ({ blob: file }), notify: (...args) => notices.push(args), list: async () => [], ...overrides });
  const click = selector => container.querySelector(selector).click();
  const input = (selector, value) => { const el = container.querySelector(selector); el.value = value; el.dispatchEvent(new dom.window.Event('input', { bubbles: true })); };
  const paste = () => { const event = new dom.window.Event('paste', { cancelable: true }); Object.defineProperty(event, 'clipboardData', { value: { items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File(['png'], 'pasted.png', { type: 'image/png' }) }] } }); document.dispatchEvent(event); return event; };
  return { dom, container, gallery, click, input, paste, notices, close() { gallery.dispose(); dom.window.close(); } };
}

test('load failure offers retry and stale room reads cannot replace the new room', async () => {
  const pending = deferred();
  let count = 0;
  const ui = setup({ list: id => id === 'kuche' ? pending.promise : ++count === 1 ? Promise.reject(new Error('Storage unavailable')) : Promise.resolve([]) });
  ui.gallery.setRoom({ id: 'kuche', name: 'Küche' }, true);
  assert.match(ui.container.textContent, /Loading inspiration/);
  ui.gallery.setRoom({ id: 'bad', name: 'Bad' }, true); await tick();
  assert.match(ui.container.textContent, /Storage unavailable/);
  ui.click('[data-inspiration-retry]'); await tick();
  pending.resolve([{ id: 'wrong', title: 'Wrong room' }]); await tick();
  assert.match(ui.container.textContent, /No design inspiration/);
  assert.doesNotMatch(ui.container.textContent, /Wrong room/);
  ui.close();
});

test('save failure retains draft, blocks duplicates, and allows retry', async () => {
  const saving = deferred(); let calls = 0;
  const ui = setup({ add: () => ++calls === 1 ? saving.promise : Promise.resolve() });
  ui.gallery.setRoom({ id: 'kuche', name: 'Küche' }, true); await tick();
  assert.equal(ui.paste().defaultPrevented, true); await tick();
  ui.input('#inspiration-note', 'Keep this idea');
  ui.container.querySelector('form').dispatchEvent(new ui.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(ui.container.querySelector('button[type=submit]').disabled, true);
  ui.container.querySelector('form').dispatchEvent(new ui.dom.window.Event('submit', { bubbles: true, cancelable: true }));
  assert.equal(calls, 1);
  saving.reject(Object.assign(new Error('Quota'), { name: 'QuotaExceededError' })); await tick();
  assert.match(ui.container.textContent, /storage is full/);
  assert.equal(ui.container.querySelector('textarea').value, 'Keep this idea');
  ui.container.querySelector('form').dispatchEvent(new ui.dom.window.Event('submit', { bubbles: true, cancelable: true })); await tick();
  assert.equal(calls, 2); assert.equal(ui.container.querySelector('form'), null);
  ui.close();
});

test('canceled image loading and navigation never attach late image bytes to another room', async () => {
  const image = deferred();
  const ui = setup({ readImage: () => image.promise });
  ui.gallery.setRoom({ id: 'kuche', name: 'Küche' }, true); await tick(); ui.paste();
  ui.gallery.setRoom({ id: 'bad', name: 'Bad' }, true); await tick();
  image.resolve({ blob: new Blob(['png'], { type: 'image/png' }) }); await tick();
  assert.equal(ui.container.querySelector('.inspiration-draft-preview'), null);
  ui.gallery.setRoom({ id: 'bad', name: 'Bad' }, false);
  assert.equal(ui.paste().defaultPrevented, false);
  ui.close();
});

test('room navigation during deletion retains the target room and does not crash at the floor plan', async () => {
  const removing = deferred(); const removed = [];
  const ui = setup({ list: async () => [{ id: 'idea', title: 'Idea', blob: new Blob(['png']) }], remove: id => { removed.push(id); return removing.promise; } });
  ui.gallery.setRoom({ id: 'kuche', name: 'Küche' }, true); await tick();
  ui.click('[data-inspiration-delete]'); ui.click('[data-inspiration-confirm]');
  ui.gallery.setRoom(null, false); removing.resolve(); await tick();
  assert.deepEqual(removed, ['idea']);
  assert.deepEqual(ui.notices, [['Inspiration deleted']]);
  assert.equal(ui.gallery.busy, false);
  ui.close();
});
