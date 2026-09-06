import { roomById } from './rooms.js';

const DATABASE = 'cicerostrasse-room-journal';
let connection;

export function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      const images = db.createObjectStore('images', { keyPath: 'id' });
      images.createIndex('roomId', 'roomId');
      db.createObjectStore('notes', { keyPath: 'roomId' });
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
      result = { ...request.result, ...patch, updatedAt: Date.now() };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Could not update the image.'));
  });
}

export const deleteImage = (id) => transaction('images', 'readwrite', (store) => store.delete(id));
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
