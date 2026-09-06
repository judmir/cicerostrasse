import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

test('version 2 upgrade retains sources, version lineage, restyle records and room notes', async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('cicerostrasse-room-journal', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      const images = db.createObjectStore('images', { keyPath: 'id' });
      for (const key of ['roomId', 'rootImageId', 'parentImageId']) images.createIndex(key, key);
      images.add({ id: 'source', roomId: 'kuche', blob: new Blob(['original'], { type: 'image/png' }), createdAt: 1 });
      images.add({ id: 'version', roomId: 'kuche', rootImageId: 'source', parentImageId: 'source', restyleId: 'saved-restyle', createdAt: 2 });
      db.createObjectStore('notes', { keyPath: 'roomId' }).add({ roomId: 'kuche', text: 'Room note' });
      db.createObjectStore('restyles', { keyPath: 'requestId' }).add({ requestId: 'saved-restyle', imageId: 'version', source: { id: 'source' } });
    };
    request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
  });
  const storage = await import('../src/storage.js');
  assert.equal((await storage.openDatabase()).version, 4);
  assert.equal(await (await storage.getImage('source')).blob.text(), 'original');
  assert.equal((await storage.getImage('version')).rootImageId, 'source');
  assert.equal((await storage.getRestyleRecord('saved-restyle')).imageId, 'version');
  assert.equal(await storage.getNotes('kuche'), 'Room note');
  assert.deepEqual(await storage.listInspirations('kuche'), []);
});
