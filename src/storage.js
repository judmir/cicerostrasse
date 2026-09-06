import { roomById, validateRoomName } from './rooms.js';

const DATABASE = 'cicerostrasse-room-journal';
let connection;

export function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 4);
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
      if (event.oldVersion < 4) db.createObjectStore('roomNames', { keyPath: 'roomId' });
      if (event.oldVersion < 3) {
        const inspirations = db.createObjectStore('inspirations', { keyPath: 'id' });
        inspirations.createIndex('roomId', 'roomId');
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
  validateImageFile(rendered.blob);
  if (!result?.requestId || !result.spec || !result.geometry) throw new Error('The Restyle result is incomplete.');
  const operation = result.operation === 'refine' ? 'refine' : 'restyle';
  if (operation === 'restyle') validateImageFile(inspiration);
  if (operation === 'refine' && (typeof result.instruction !== 'string' || !result.instruction.trim())) throw new Error('The refinement is missing its edit request.');
  const now = Date.now();
  const mode = result.mode === 'mock' ? 'mock' : 'real';
  const image = {
    id: crypto.randomUUID(), roomId: source.roomId, blob: rendered.blob, thumbnail: rendered.thumbnail,
    width: rendered.width, height: rendered.height, title: `${source.title} · ${operation === 'refine' ? 'Refinement' : result.spec.styleName}`,
    filename: `${mode === 'mock' ? 'mock-' : ''}restyle-${result.requestId}.png`, caption: '', createdAt: now, updatedAt: now, mode,
    parentImageId: source.id, rootImageId: source.rootImageId || source.id, restyleId: result.requestId,
    geometryStatus: result.geometry.status, restyleOperation: operation,
    restyleInstruction: operation === 'refine' ? result.instruction.trim() : null,
  };
  const record = {
    requestId: result.requestId, imageId: image.id, mode, source: sourceSnapshot(source),
    operation, instruction: operation === 'refine' ? result.instruction.trim() : null,
    inspiration: operation === 'restyle' ? { blob: inspiration, filename: inspiration.name || 'inspiration' } : null,
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

export function normalizeInspirationURL(value) {
  if (!String(value ?? '').trim()) return '';
  let url;
  try { url = new URL(String(value).trim()); } catch { throw new Error('Enter a complete image or source URL, starting with https:// or http://.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Use an http:// or https:// link without a username or password.');
  return url.href;
}

function inspirationFields({ title, note, sourceUrl }) {
  const cleanNote = String(note ?? '').trim();
  if (cleanNote.length > 500) throw new Error('Keep the note to 500 characters or fewer.');
  const cleanTitle = String(title ?? '').trim() || 'Untitled inspiration';
  if (cleanTitle.length > 160) throw new Error('Keep the title to 160 characters or fewer.');
  return { title: cleanTitle, note: cleanNote, sourceUrl: normalizeInspirationURL(sourceUrl) };
}

export async function listInspirations(roomId) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  const items = await transaction('inspirations', 'readonly', store => store.index('roomId').getAll(roomId));
  return items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function addInspiration({ roomId, blob, thumbnail, filename, width, height, ...fields }) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  if (!(blob instanceof Blob)) throw new Error('Choose an image file.');
  validateImageFile(blob);
  const item = { ...inspirationFields(fields), id: crypto.randomUUID(), roomId, blob, thumbnail, filename, width, height, createdAt: Date.now(), updatedAt: Date.now() };
  await transaction('inspirations', 'readwrite', store => store.add(item));
  return item;
}

export async function updateInspiration(id, changes) {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('inspirations', 'readwrite');
    const store = tx.objectStore('inspirations');
    let result, failure;
    const request = store.get(id);
    request.onsuccess = () => {
      try {
        if (!request.result) throw new Error('This inspiration no longer exists.');
        const allowed = Object.fromEntries(Object.entries(changes).filter(([key]) => ['title', 'note', 'sourceUrl'].includes(key)));
        result = { ...request.result, ...inspirationFields({ ...request.result, ...allowed }), updatedAt: Date.now() };
        store.put(result);
      } catch (error) { failure = error; tx.abort(); }
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Could not update the inspiration.'));
  });
}

export const deleteInspiration = id => transaction('inspirations', 'readwrite', store => store.delete(id));

export const listRoomNames = () => transaction('roomNames', 'readonly', store => store.getAll());
export function saveRoomName(roomId, name) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  if (name === null) return transaction('roomNames', 'readwrite', store => store.delete(roomId));
  const validated = validateRoomName(name);
  return transaction('roomNames', 'readwrite', store => store.put({ roomId, name: validated, updatedAt: Date.now() }));
}
