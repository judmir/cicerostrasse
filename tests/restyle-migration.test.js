import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

test('version 1 database upgrade preserves original image bytes and notes', async () => {
  await new Promise((resolve, reject) => {
    const request = indexedDB.open('cicerostrasse-room-journal', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const images = db.createObjectStore('images', { keyPath: 'id' }); images.createIndex('roomId', 'roomId');
      images.add({ id: 'legacy', roomId: 'kuche', blob: new Blob(['legacy bytes'], { type: 'image/png' }), createdAt: 1 });
      const notes = db.createObjectStore('notes', { keyPath: 'roomId' }); notes.add({ roomId: 'kuche', text: 'Keep this note' });
    };
    request.onsuccess = () => { request.result.close(); resolve(); }; request.onerror = () => reject(request.error);
  });
  const storage = await import('../src/storage.js');
  assert.equal(await (await storage.listImages('kuche'))[0].blob.text(), 'legacy bytes');
  assert.equal(await storage.getNotes('kuche'), 'Keep this note');
  const db = await storage.openDatabase();
  assert.equal(db.version, 5); assert.ok(db.objectStoreNames.contains('restyles'));
});
