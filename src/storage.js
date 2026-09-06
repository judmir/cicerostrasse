import { roomById } from './rooms.js';

const DATABASE = 'cicerostrasse-room-journal';
let connection;

export function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 2);
    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (event.oldVersion < 1) {
        const images = db.createObjectStore('images', { keyPath: 'id' });
        images.createIndex('roomId', 'roomId');
        db.createObjectStore('notes', { keyPath: 'roomId' });
      }
      if (event.oldVersion < 2) {
        const images = request.transaction.objectStore('images');
        images.createIndex('rootImageId', 'rootImageId');
        images.createIndex('parentImageId', 'parentImageId');
        db.createObjectStore('restyles', { keyPath: 'requestId' });
      }
    };
    request.onsuccess = () => {
      request.result.onversionchange = () => { request.result.close(); connection = null; };
      resolve(request.result);
    };
    request.onerror = () => { connection = null; reject(request.error); };
    request.onblocked = () => { connection = null; reject(new Error('Close other Cicerostraße windows and try again.')); };
  });
  return connection;
}

async function transaction(store, mode, operation) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    let result;
    try {
      const request = operation(tx.objectStore(store));
      if (request) request.onsuccess = () => { result = request.result; };
    } catch (error) { tx.abort(); reject(error); return; }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error || new Error('Could not save your changes.'));
    tx.onabort = () => reject(tx.error || new Error('The save was interrupted. Please try again.'));
  });
}

export async function listImages(roomId) {
  const images = await transaction('images', 'readonly', (store) => roomId ? store.index('roomId').getAll(roomId) : store.getAll());
  return images.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function addImage({ roomId, blob, thumbnail, title, filename, width, height }) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) throw new Error('Choose an image file.');
  const image = { id: crypto.randomUUID(), roomId, blob, thumbnail, title: title?.trim() || 'Untitled image', filename, width, height, caption: '', createdAt: Date.now(), updatedAt: Date.now() };
  await transaction('images', 'readwrite', (store) => store.add(image));
  return image;
}

export async function updateImage(id, changes) {
  const allowed = ['title', 'caption', 'roomId', 'blob', 'thumbnail', 'filename', 'width', 'height'];
  const patch = Object.fromEntries(Object.entries(changes).filter(([key]) => allowed.includes(key)));
  if ('roomId' in patch && !roomById(patch.roomId)) throw new Error('Choose a valid room.');
  if ('title' in patch) patch.title = String(patch.title).trim() || 'Untitled image';
  if ('blob' in patch && (!(patch.blob instanceof Blob) || !patch.blob.type.startsWith('image/'))) throw new Error('Choose an image file.');
  // Legacy callers that replace only the original must not retain a stale thumbnail.
  if ('blob' in patch && !('thumbnail' in patch)) patch.thumbnail = undefined;
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    const request = store.get(id);
    let result;
    let failure;
    request.onsuccess = () => {
      if (!request.result) { failure = new Error('This image no longer exists.'); tx.abort(); return; }
      if (request.result.restyleId && 'blob' in patch) { failure = new Error('Restyled versions cannot be replaced. Add a new image or restyle this version.'); tx.abort(); return; }
      result = { ...request.result, ...patch, updatedAt: Date.now() };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Could not update the image.'));
  });
}

export async function deleteImage(id) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images', 'restyles'], 'readwrite');
    const store = tx.objectStore('images');
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result?.restyleId) tx.objectStore('restyles').delete(request.result.restyleId);
      store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not delete the image.'));
  });
}

export const getRestyleRecord = (requestId) => transaction('restyles', 'readonly', (store) => store.get(requestId));
export const getImage = (id) => transaction('images', 'readonly', (store) => store.get(id));

export function sourceSnapshot(image) {
  const { id, roomId, title, blob, width, height, createdAt, updatedAt } = image;
  return { id, roomId, title, blob, width, height, createdAt, updatedAt, rootImageId: image.rootImageId || id };
}

export async function saveRestyleVersion({ source, inspiration, result, rendered }) {
  if (!roomById(source?.roomId) || !source.id || !(source.blob instanceof Blob)) throw new Error('Choose a valid source design.');
  validateImageFile(inspiration);
  validateImageFile(rendered.blob);
  if (!result?.requestId || !result.spec || !result.geometry) throw new Error('The Restyle result is incomplete.');
  const now = Date.now();
  const image = {
    id: crypto.randomUUID(), roomId: source.roomId, blob: rendered.blob, thumbnail: rendered.thumbnail,
    width: rendered.width, height: rendered.height, title: `${source.title} · ${result.spec.styleName}`,
    filename: `restyle-${result.requestId}.png`, caption: '', createdAt: now, updatedAt: now,
    parentImageId: source.id, rootImageId: source.rootImageId || source.id, restyleId: result.requestId,
    geometryStatus: result.geometry.status,
  };
  const record = {
    requestId: result.requestId, imageId: image.id, source: sourceSnapshot(source),
    inspiration: { blob: inspiration, filename: inspiration.name || 'inspiration' },
    spec: result.spec, geometry: result.geometry, models: result.models, prompt: result.prompt,
    providerIds: result.providerIds, createdAt: result.createdAt || now,
  };
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images', 'restyles'], 'readwrite');
    const versions = tx.objectStore('restyles');
    const images = tx.objectStore('images');
    let saved = image;
    const existing = versions.get(result.requestId);
    existing.onsuccess = () => {
      if (existing.result) {
        const request = images.get(existing.result.imageId);
        request.onsuccess = () => { saved = request.result; };
      } else { images.add(image); versions.add(record); }
    };
    tx.oncomplete = () => resolve(saved);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not save this version. Please retry saving.'));
  });
}
export async function getNotes(roomId) {
  return (await transaction('notes', 'readonly', (store) => store.get(roomId)))?.text || '';
}
export function saveNotes(roomId, text) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  return transaction('notes', 'readwrite', (store) => store.put({ roomId, text, updatedAt: Date.now() }));
}

export function validateImageFile(file) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'].includes(file.type)) {
    throw new Error('Use a JPG, PNG, WebP, GIF, or AVIF image.');
  }
  if (file.size > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
  if (!file.size) throw new Error('This image file is empty.');
}
