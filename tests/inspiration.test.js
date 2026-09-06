import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { addInspiration, listInspirations, updateInspiration, deleteInspiration, addImage, listImages, normalizeInspirationURL } from '../src/storage.js';
import { imageFromURL } from '../src/inspiration-image.js';
const blob = new Blob(['image bytes'], { type: 'image/png' });

test('inspiration persists in its room without entering source or version galleries', async () => {
  const original = await addImage({ roomId: 'kuche', blob, title: 'Vetted source' });
  const idea = await addInspiration({ roomId: 'kuche', blob, title: ' Oak ', note: ' Beside the window ', sourceUrl: 'https://example.com/idea' });
  await addInspiration({ roomId: 'bad', blob, title: 'Tile' });
  const second = await import('../src/storage.js?inspiration-reload');
  const saved = await second.listInspirations('kuche');
  assert.equal(saved.length, 1);
  assert.equal(await saved[0].blob.text(), 'image bytes');
  assert.equal(saved[0].note, 'Beside the window');
  assert.equal(saved[0].title, 'Oak');
  assert.deepEqual((await listImages('kuche')).map(x => x.id), [original.id]);
  const edited = await updateInspiration(idea.id, { note: 'Above the desk', title: 'Shelf', roomId: 'bad', blob: new Blob(['bad']) });
  assert.equal(edited.roomId, 'kuche');
  assert.equal(await edited.blob.text(), 'image bytes');
  assert.equal(edited.createdAt, idea.createdAt);
  await deleteInspiration(idea.id);
  assert.equal((await listInspirations('kuche')).length, 0);
  assert.equal((await listImages('kuche')).length, 1);
  assert.equal((await listInspirations('bad')).length, 1);
});

test('invalid inspiration input rejects without modifying an item', async () => {
  await assert.rejects(addInspiration({ roomId: 'unknown', blob }), /valid room/);
  await assert.rejects(addInspiration({ roomId: 'kuche', blob, note: 'x'.repeat(501) }), /500/);
  await assert.rejects(addInspiration({ roomId: 'kuche', blob: new Blob(['svg'], { type: 'image/svg+xml' }) }), /Use a JPG/);
  const idea = await addInspiration({ roomId: 'kuche', blob, note: 'Keep' });
  await assert.rejects(updateInspiration(idea.id, { sourceUrl: 'javascript:alert(1)' }), /http/);
  await assert.rejects(updateInspiration('missing', { note: 'New' }), /no longer exists/);
  assert.equal((await listInspirations('kuche')).find(x => x.id === idea.id).note, 'Keep');
  for (const value of ['data:image/png,abc', 'file:///image.png', 'https://user:password@example.com/image.png', 'example.com/image.png']) assert.throws(() => normalizeInspirationURL(value));
});

test('URL importer saves bytes with credentials omitted and rejects pages, failures, and large streams', async () => {
  let request;
  const file = await imageFromURL('https://example.com/image', { fetchImage: async (url, options) => { request = { url, options }; return new Response(blob, { headers: { 'Content-Type': 'image/png' } }); } });
  assert.equal(await file.text(), 'image bytes');
  assert.equal(request.options.credentials, 'omit');
  assert.equal(request.options.referrerPolicy, 'no-referrer');
  await assert.rejects(imageFromURL('https://example.com/page', { fetchImage: async () => new Response('page', { headers: { 'Content-Type': 'text/html' } }) }), /Use a JPG/);
  await assert.rejects(imageFromURL('https://example.com/404', { fetchImage: async () => new Response('', { status: 404 }) }), /404/);
  await assert.rejects(imageFromURL('https://example.com/blocked', { fetchImage: async () => { throw new TypeError('CORS'); } }), /paste.*upload/);
  let canceled = false;
  await assert.rejects(imageFromURL('https://example.com/huge', { fetchImage: async () => new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(26 * 1024 * 1024)); }, cancel() { canceled = true; } }), { headers: { 'Content-Type': 'image/png' } }) }), /25 MB/);
  assert.equal(canceled, true);
});
