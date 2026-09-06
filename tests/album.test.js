import test from 'node:test';
import assert from 'node:assert/strict';
import { createAlbum } from '../src/album.js';

test('carousel follows album order and stops at the first and last photos', () => {
  const album = createAlbum();
  album.setPhotos([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  album.select('b');
  assert.equal(album.move(1).id, 'c');
  assert.equal(album.hasNext, false);
  assert.equal(album.move(1).id, 'c');
  assert.equal(album.move(-2).id, 'a');
  assert.equal(album.hasPrevious, false);
  assert.equal(album.move(-1).id, 'a');
  assert.equal(album.select('not-in-this-album'), false);
  assert.equal(album.current.id, 'a');
});

test('uploads preserve the viewed photo; deleting it advances without skipping', () => {
  const album = createAlbum();
  album.setPhotos([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  album.select('b');
  album.setPhotos([{ id: 'new' }, { id: 'a' }, { id: 'b' }, { id: 'c' }]);
  assert.equal(album.current.id, 'b');
  assert.equal(album.index, 2);
  album.setPhotos([{ id: 'new' }, { id: 'a' }, { id: 'c' }]);
  assert.equal(album.current.id, 'c');
  album.setPhotos([{ id: 'new' }, { id: 'a' }]);
  assert.equal(album.current.id, 'a');
  album.setPhotos([]);
  assert.equal(album.current, null);
  assert.equal(album.move(1), null);
  assert.deepEqual(album.thumbnails(), []);
});

test('large albums limit decoded thumbnail previews and include the selected photo', () => {
  const album = createAlbum();
  album.setPhotos(Array.from({ length: 1000 }, (_, i) => ({ id: String(i) })));
  for (const id of ['0', '500', '999']) {
    album.select(id);
    const thumbnails = album.thumbnails();
    assert.equal(thumbnails.length, 11);
    assert.ok(thumbnails.some(({ photo }) => photo.id === id));
    assert.ok(thumbnails.every(({ photo, index }) => album.photos[index].id === photo.id));
  }
});

test('single-photo albums have no next or previous navigation', () => {
  const album = createAlbum();
  album.setPhotos([{ id: 'only' }]);
  assert.equal(album.hasNext, false);
  assert.equal(album.hasPrevious, false);
  assert.equal(album.thumbnails().length, 1);
  assert.equal(album.move(1).id, 'only');
});
