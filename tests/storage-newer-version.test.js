import test from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';

const DATABASE = 'cicerostrasse-room-journal';
const blob = () => new Blob([new Uint8Array([0, 255, 42, 128])], { type: 'image/png' });
const requestResult = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

async function fixture(change = () => {}) {
  globalThis.indexedDB = new IDBFactory();
  const storage = await import(`../src/storage.js?newer-version=${crypto.randomUUID()}`);
  const original = await storage.addImage({ roomId: 'kuche', blob: blob(), title: 'Original' });
  assert.equal((await storage.openDatabase()).version, 5);
  const request = indexedDB.open(DATABASE, 6);
  request.onupgradeneeded = () => {
    request.result.createObjectStore('futureData', { keyPath: 'id' }).put({ id: 'future', value: ['keep', 6] });
    request.transaction.objectStore('images').createIndex('futureIndex', 'futureField');
    change(request.result, request.transaction);
  };
  const db = await requestResult(request);
  db.close();
  return { storage, original };
}

async function snapshot(db) {
  const names = [...db.objectStoreNames];
  const tx = db.transaction(names, 'readonly');
  return Promise.all(names.map(async name => {
    const store = tx.objectStore(name);
    const indexes = [...store.indexNames].map(name => {
      const index = store.index(name);
      return { name, keyPath: index.keyPath, unique: index.unique, multiEntry: index.multiEntry };
    });
    const records = await requestResult(store.getAll());
    for (const record of records) {
      if (record.blob) record.blob = [...new Uint8Array(await record.blob.arrayBuffer())];
    }
    return { name, keyPath: store.keyPath, autoIncrement: store.autoIncrement, indexes, records };
  }));
}

test('additive v6 preserves image bytes and extra data while allowing uploads and room listing', async () => {
  const { storage, original } = await fixture();
  const opening = storage.openDatabase();
  assert.equal(storage.openDatabase(), opening);
  const db = await opening;
  assert.equal(db.version, 6);
  const before = await snapshot(db);
  const uploaded = await storage.addImage({ roomId: 'kuche', blob: blob(), title: 'New upload' });
  const images = await storage.listImages('kuche');
  assert.deepEqual(new Set(images.map(image => image.id)), new Set([original.id, uploaded.id]));
  for (const image of images) assert.deepEqual([...new Uint8Array(await image.blob.arrayBuffer())], [0, 255, 42, 128]);
  assert.deepEqual(await storage.listImages('bad'), []);
  const after = await snapshot(db);
  after.find(store => store.name === 'images').records = after.find(store => store.name === 'images').records.filter(image => image.id !== uploaded.id);
  assert.deepEqual(after, before);

  // The accepted fallback connection must still close and clear its cache on versionchange.
  const next = await requestResult(indexedDB.open(DATABASE, 7));
  next.close();
  assert.equal((await storage.openDatabase()).version, 7);
  (await storage.openDatabase()).close();
});

const stores = ['images', 'notes', 'restyles', 'inspirations', 'roomNames', 'firstDesignDrafts', 'firstDesigns'];
const indexes = [['images', 'roomId'], ['images', 'rootImageId'], ['images', 'parentImageId'], ['inspirations', 'roomId'], ['firstDesigns', 'roomId']];
const incompatible = [
  ...stores.map(name => [`extra unique ${name} index`, (db, tx) => {
    tx.objectStore(name).createIndex('titleUnique', 'title', { unique: true });
  }]),
  ...stores.map(name => [`missing ${name} store`, db => db.deleteObjectStore(name)]),
  ...stores.map(name => [`wrong ${name} keyPath`, db => {
    db.deleteObjectStore(name);
    db.createObjectStore(name, { keyPath: 'wrong' });
  }]),
  ['autoIncrement store', db => {
    db.deleteObjectStore('notes');
    db.createObjectStore('notes', { keyPath: 'roomId', autoIncrement: true });
  }],
  ...indexes.flatMap(([storeName, name]) => ['missing', 'keyPath', 'unique', 'multiEntry'].map(kind => [
    `${kind} ${storeName}.${name} index`, (db, tx) => {
      const store = tx.objectStore(storeName);
      store.deleteIndex(name);
      if (kind !== 'missing') store.createIndex(name, kind === 'keyPath' ? 'wrong' : name, { unique: kind === 'unique', multiEntry: kind === 'multiEntry' });
    },
  ])),
];

for (const [name, change] of incompatible) {
  test(`incompatible v6 rejects without changes: ${name}`, async () => {
    const { storage } = await fixture(change);
    const db = await requestResult(indexedDB.open(DATABASE));
    const before = await snapshot(db);
    const first = storage.openDatabase();
    await assert.rejects(first, error => {
      assert.match(error.message, /requires a newer app.*Update/);
      assert.doesNotMatch(error.message, /delet|reset|clear/i);
      return true;
    });
    const retry = storage.openDatabase();
    assert.notEqual(retry, first);
    await assert.rejects(retry, /requires a newer app/);
    await assert.rejects(storage.addImage({ roomId: 'kuche', blob: blob() }), /requires a newer app/);
    assert.equal(db.version, 6);
    assert.deepEqual(await snapshot(db), before);
    db.close();
    // A leaked rejected connection would block this upgrade.
    const next = await requestResult(indexedDB.open(DATABASE, 7));
    next.close();
  });
}

test('a database deleted before the unversioned retry is not recreated', async t => {
  const { storage } = await fixture();
  const factory = indexedDB;
  const open = factory.open.bind(factory);
  let deletion;
  t.mock.method(factory, 'open', (...args) => {
    if (args.length === 1) deletion = requestResult(factory.deleteDatabase(DATABASE));
    return open(...args);
  });
  await assert.rejects(storage.openDatabase(), { name: 'AbortError' });
  await deletion;
  assert.deepEqual(await factory.databases(), []);
});

test('errors other than VersionError do not retry and clear the cached promise', async t => {
  const { storage } = await fixture();
  let calls = 0;
  t.mock.method(indexedDB, 'open', () => {
    calls++;
    const request = { error: new DOMException('Unavailable', 'UnknownError') };
    setImmediate(() => request.onerror());
    return request;
  });
  await assert.rejects(storage.openDatabase(), { name: 'UnknownError' });
  assert.equal(calls, 1);
  await assert.rejects(storage.openDatabase(), { name: 'UnknownError' });
  assert.equal(calls, 2);
});
