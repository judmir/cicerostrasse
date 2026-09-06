import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { addImage, listImages, updateImage, deleteImage, validateImageFile } from '../src/storage.js';

test('room galleries retain original image bytes and stay isolated', async () => {
  const kitchen = await addImage({ roomId: 'kuche', blob: new Blob(['kitchen-photo'], { type: 'image/png' }), title: 'Kitchen tiles', filename: 'tiles.png', width: 800, height: 600 });
  const bathroom = await addImage({ roomId: 'bad', blob: new Blob(['bath-photo'], { type: 'image/jpeg' }), title: 'Bathroom', filename: 'bath.jpg', width: 640, height: 480 });
  const saved = await listImages('kuche');
  assert.deepEqual(saved.map((image) => image.id), [kitchen.id]);
  assert.equal(await saved[0].blob.text(), 'kitchen-photo');
  assert.equal((await listImages('bad'))[0].id, bathroom.id);
  await deleteImage(kitchen.id);
  await deleteImage(bathroom.id);
});

test('edits, replacement and moving rooms update the same image', async () => {
  const original = await addImage({ roomId: 'kuche', blob: new Blob(['original'], { type: 'image/png' }), title: 'Before', filename: 'before.png', width: 2, height: 2 });
  const edited = await updateImage(original.id, { title: '  New reference  ', caption: 'Blue tile', roomId: 'raum2', blob: new Blob(['replacement'], { type: 'image/webp' }), filename: 'after.webp', width: 10, height: 10, id: 'do-not-replace-id', createdAt: 0 });
  assert.equal(edited.id, original.id);
  assert.equal(edited.createdAt, original.createdAt);
  assert.equal(edited.title, 'New reference');
  assert.equal(edited.caption, 'Blue tile');
  assert.equal(edited.filename, 'after.webp');
  assert.equal(await edited.blob.text(), 'replacement');
  assert.equal((await listImages('kuche')).length, 0);
  assert.equal((await listImages('raum2'))[0].id, original.id);
  await deleteImage(original.id);
  assert.equal((await listImages('raum2')).length, 0);
});

test('a new storage connection reads saved images', async () => {
  const original = await addImage({ roomId: 'loggia', blob: new Blob(['saved'], { type: 'image/png' }), title: 'Plant' });
  const secondConnection = await import('../src/storage.js?second-connection');
  const records = await secondConnection.listImages('loggia');
  assert.equal(records[0].id, original.id);
  assert.equal(await records[0].blob.text(), 'saved');
  await deleteImage(original.id);
});

test('invalid edits reject without changing the saved image', async () => {
  const original = await addImage({ roomId: 'kuche', blob: new Blob(['saved'], { type: 'image/png' }), title: 'Keep me' });
  await assert.rejects(updateImage(original.id, { roomId: 'not-a-room' }), /valid room/);
  await assert.rejects(updateImage(original.id, { blob: new Blob(['text'], { type: 'text/plain' }) }), /image file/);
  await assert.rejects(updateImage('missing-image', { title: 'Nothing' }), /no longer exists/);
  assert.equal((await listImages('kuche'))[0].title, 'Keep me');
  await deleteImage(original.id);
});

test('file validation rejects unsupported, empty and oversized files', () => {
  assert.throws(() => validateImageFile(new File(['svg'], 'image.svg', { type: 'image/svg+xml' })), /Use a JPG/);
  assert.throws(() => validateImageFile(new File([], 'empty.png', { type: 'image/png' })), /empty/);
  assert.throws(() => validateImageFile({ type: 'image/jpeg', size: 26 * 1024 * 1024 }), /25 MB/);
  assert.doesNotThrow(() => validateImageFile(new File(['png'], 'valid.png', { type: 'image/png' })));
});

test('thumbnail uploads retain originals and replacement cannot leave a stale preview', async () => {
  const original = await addImage({ roomId: 'kuche', blob: new Blob(['original'], { type: 'image/png' }), thumbnail: new Blob(['small-preview'], { type: 'image/webp' }), title: 'Reference' });
  const saved = (await listImages('kuche'))[0];
  assert.equal(await saved.blob.text(), 'original');
  assert.equal(await saved.thumbnail.text(), 'small-preview');
  const replacement = await updateImage(original.id, { blob: new Blob(['replacement'], { type: 'image/jpeg' }) });
  assert.equal(replacement.thumbnail, undefined);
  await deleteImage(original.id);
});
