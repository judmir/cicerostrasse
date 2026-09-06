import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createSourceDeleteDialog } from '../src/source-delete-dialog.js';
import { addImage, deleteImage, getImage, saveRestyleVersion, getRestyleRecord } from '../src/storage.js';
import { resultFixture } from './restyle-fixtures.js';

const tick = () => new Promise((resolve) => setImmediate(resolve));
const image = { id: 'source-a', title: 'Kitchen <layout>', blob: new Blob(['source'], { type: 'image/png' }) };
const escape = (text) => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function setup(removeSource) {
  const dom = new JSDOM('<button id="opener">Delete source</button><dialog></dialog>');
  globalThis.document = dom.window.document; globalThis.AbortController = dom.window.AbortController;
  const dialog = document.querySelector('dialog');
  dialog.showModal = () => { dialog.open = true; };
  dialog.close = () => { dialog.open = false; dialog.dispatchEvent(new dom.window.Event('close')); };
  const opener = document.querySelector('#opener'); opener.focus();
  const controller = createSourceDeleteDialog(dialog, { escape, removeSource });
  return { dom, dialog, controller, opener, cleanup() { controller.dispose(); dom.window.close(); } };
}

test('deletion requires confirmation; Keep source and Escape leave the image alone', () => {
  const { dom, dialog, controller, opener, cleanup } = setup(() => assert.fail('Must not delete'));
  try {
    controller.open(image);
    assert.equal(document.activeElement, dialog.querySelector('[data-keep-source]'));
    assert.equal(dialog.querySelector('.source-delete-name').textContent, image.title);
    assert.equal(dialog.querySelector('layout'), null);
    dialog.querySelector('[data-keep-source]').click();
    assert.equal(dialog.open, false); assert.equal(document.activeElement, opener);
    controller.open(image);
    const cancel = new dom.window.Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel); assert.equal(cancel.defaultPrevented, false);
    dialog.close(); // Native Escape closes the dialog when cancel is not prevented.
    controller.open({ ...image, archivedSource: true }); assert.equal(dialog.open, false);
  } finally { cleanup(); }
});

test('deletion blocks duplicate submissions, retains failures for retry, and closes after success', async () => {
  let calls = 0, finish;
  const { dom, dialog, controller, cleanup } = setup(async (id) => {
    assert.equal(id, image.id); calls++;
    if (calls === 1) throw new Error('Storage unavailable');
    await new Promise((resolve) => { finish = resolve; });
  });
  try {
    controller.open(image, 2);
    assert.match(dialog.textContent, /2 restyled versions and their saved source snapshots will stay available/);
    dialog.querySelector('[data-confirm-delete]').click(); await tick();
    assert.equal(dialog.open, true); assert.equal(controller.busy, false);
    assert.equal(dialog.querySelector('[role="alert"]').hidden, false);
    const confirm = dialog.querySelector('[data-confirm-delete]'); confirm.click(); confirm.click();
    assert.equal(calls, 2); assert.equal(controller.busy, true);
    assert.equal(dialog.querySelector('[data-keep-source]').disabled, true);
    const cancel = new dom.window.Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel); assert.equal(cancel.defaultPrevented, true);
    finish(); await tick();
    assert.equal(dialog.open, false); assert.equal(controller.busy, false);
  } finally { cleanup(); }
});

test('confirmed source deletion removes only that source and preserves saved versions and other rooms', async () => {
  const source = await addImage({ ...image, roomId: 'kuche' });
  const other = await addImage({ ...image, roomId: 'bad' });
  const result = resultFixture(crypto.randomUUID());
  const version = await saveRestyleVersion({ source, result,
    inspiration: new File(['style'], 'style.png', { type: 'image/png' }), rendered: { blob: image.blob, width: 100, height: 80 },
  });
  let deleted;
  const done = new Promise((resolve) => { deleted = resolve; });
  const { dialog, controller, cleanup } = setup(async (id) => { await deleteImage(id); deleted(); });
  try {
    controller.open(source, 1); dialog.querySelector('[data-confirm-delete]').click();
    await done; await tick();
    assert.equal(dialog.open, false);
    assert.equal(await getImage(source.id), undefined);
    assert.equal((await getImage(version.id)).parentImageId, source.id);
    assert.equal((await getImage(other.id)).roomId, 'bad');
    assert.equal(await (await getRestyleRecord(result.requestId)).source.blob.text(), 'source');
  } finally { cleanup(); }
});
