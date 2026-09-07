import { roomById, validateRoomName } from './rooms.js';
import { cloudDeleteRecord, cloudDeleteWhere, cloudGetRecord, cloudListRecords, cloudPutRecord, initializeCloudStorage, isCloudStorageActive } from './cloud-storage.js';

const DATABASE = 'cicerostrasse-room-journal';
let connection;
let storageInitialization;

const waitForStorage = async () => { if (storageInitialization) await storageInitialization; };

async function localSnapshot() {
  const db = await openDatabase();
  const stores = ['images', 'notes', 'restyles', 'inspirations', 'roomNames', 'firstDesignDrafts', 'firstDesigns'];
  const entries = await Promise.all(stores.map((store) => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const request = tx.objectStore(store).getAll();
    request.onsuccess = () => resolve([store, request.result]);
    request.onerror = () => reject(request.error);
  })));
  return Object.fromEntries(entries);
}

export function initializeStorage(options) {
  storageInitialization ||= initializeCloudStorage(localSnapshot, options);
  return storageInitialization;
}

export function openDatabase() {
  if (connection) return connection;
  connection = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 5);
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
      if (event.oldVersion < 5) {
        db.createObjectStore('firstDesignDrafts', { keyPath: 'roomId' });
        const firstDesigns = db.createObjectStore('firstDesigns', { keyPath: 'requestId' });
        firstDesigns.createIndex('roomId', 'roomId');
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
  await waitForStorage();
  if (isCloudStorageActive()) return cloudListRecords('images', roomId);
  const images = await transaction('images', 'readonly', (store) => roomId ? store.index('roomId').getAll(roomId) : store.getAll());
  return images.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function addImage({ roomId, blob, thumbnail, title, filename, width, height }) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  if (!(blob instanceof Blob) || !blob.type.startsWith('image/')) throw new Error('Choose an image file.');
  const image = { id: crypto.randomUUID(), roomId, blob, thumbnail, title: title?.trim() || 'Untitled image', filename, width, height, caption: '', createdAt: Date.now(), updatedAt: Date.now() };
  await waitForStorage();
  if (isCloudStorageActive()) { await cloudPutRecord('images', image); return image; }
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
  await waitForStorage();
  if (isCloudStorageActive()) {
    const current = await cloudGetRecord('images', id);
    if (!current) throw new Error('This image no longer exists.');
    if ((current.restyleId || current.firstDesignId) && 'blob' in patch) throw new Error('Generated designs cannot be replaced. Add a new image or refine this version.');
    const result = { ...current, ...patch, updatedAt: Date.now() };
    await cloudPutRecord('images', result);
    return result;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('images', 'readwrite');
    const store = tx.objectStore('images');
    const request = store.get(id);
    let result;
    let failure;
    request.onsuccess = () => {
      if (!request.result) { failure = new Error('This image no longer exists.'); tx.abort(); return; }
      if ((request.result.restyleId || request.result.firstDesignId) && 'blob' in patch) { failure = new Error('Generated designs cannot be replaced. Add a new image or refine this version.'); tx.abort(); return; }
      result = { ...request.result, ...patch, updatedAt: Date.now() };
      store.put(result);
    };
    tx.oncomplete = () => resolve(result);
    tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('Could not update the image.'));
  });
}

export async function deleteImage(id) {
  await waitForStorage();
  if (isCloudStorageActive()) {
    const image = await cloudGetRecord('images', id);
    if (image?.restyleId) await cloudDeleteRecord('restyles', image.restyleId);
    if (image?.firstDesignId) await cloudDeleteRecord('firstDesigns', image.firstDesignId);
    await cloudDeleteRecord('images', id);
    return;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images', 'restyles', 'firstDesigns'], 'readwrite');
    const store = tx.objectStore('images');
    const request = store.get(id);
    request.onsuccess = () => {
      if (request.result?.restyleId) tx.objectStore('restyles').delete(request.result.restyleId);
      if (request.result?.firstDesignId) tx.objectStore('firstDesigns').delete(request.result.firstDesignId);
      store.delete(id);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not delete the image.'));
  });
}

export async function deleteDesignFamily(rootId) {
  await waitForStorage();
  if (isCloudStorageActive()) {
    const family = (await cloudListRecords('images')).filter((image) => image.id === rootId || image.rootImageId === rootId);
    await Promise.all(family.filter((image) => image.restyleId).map((image) => cloudDeleteRecord('restyles', image.restyleId)));
    await Promise.all(family.filter((image) => image.firstDesignId).map((image) => cloudDeleteRecord('firstDesigns', image.firstDesignId)));
    await cloudDeleteWhere('images', (image) => image.id === rootId || image.rootImageId === rootId);
    return;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images', 'restyles', 'firstDesigns'], 'readwrite');
    const images = tx.objectStore('images');
    const restyles = tx.objectStore('restyles');
    const request = images.index('rootImageId').getAll(rootId);
    request.onsuccess = () => {
      for (const image of request.result) {
        if (image.restyleId) restyles.delete(image.restyleId);
        if (image.firstDesignId) tx.objectStore('firstDesigns').delete(image.firstDesignId);
        images.delete(image.id);
      }
      // Uploaded sources created before lineage tracking do not carry rootImageId.
      images.delete(rootId);
    };
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not delete the saved versions.'));
  });
}

export async function getRestyleRecord(requestId) {
  await waitForStorage();
  return isCloudStorageActive() ? cloudGetRecord('restyles', requestId) : transaction('restyles', 'readonly', (store) => store.get(requestId));
}
export async function getFirstDesignRecord(requestId) {
  await waitForStorage();
  return isCloudStorageActive() ? cloudGetRecord('firstDesigns', requestId) : transaction('firstDesigns', 'readonly', (store) => store.get(requestId));
}
export async function getImage(id) {
  await waitForStorage();
  return isCloudStorageActive() ? cloudGetRecord('images', id) : transaction('images', 'readonly', (store) => store.get(id));
}

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
  await waitForStorage();
  if (isCloudStorageActive()) {
    const existing = await cloudGetRecord('restyles', result.requestId);
    if (existing) return cloudGetRecord('images', existing.imageId);
    await cloudPutRecord('images', image);
    try { await cloudPutRecord('restyles', record); }
    catch (error) { await cloudDeleteRecord('images', image.id); throw error; }
    return image;
  }
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

export async function getFirstDesignDraft(roomId) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  await waitForStorage();
  return isCloudStorageActive() ? cloudGetRecord('firstDesignDrafts', roomId) : transaction('firstDesignDrafts', 'readonly', store => store.get(roomId));
}

export async function saveFirstDesignDraft(draft) {
  if (!roomById(draft?.roomId)) throw new Error('Choose a valid room.');
  const record = { ...draft, roomId: draft.roomId, updatedAt: Date.now() };
  await waitForStorage();
  if (isCloudStorageActive()) { await cloudPutRecord('firstDesignDrafts', record); return record; }
  await transaction('firstDesignDrafts', 'readwrite', store => store.put(record));
  return record;
}

export async function clearFirstDesignDraft(roomId) {
  await waitForStorage();
  return isCloudStorageActive() ? cloudDeleteRecord('firstDesignDrafts', roomId) : transaction('firstDesignDrafts', 'readwrite', store => store.delete(roomId));
}

function firstDesignGeometry(review) {
  if (review?.status === 'matches_constraints') return { status: 'no_changes_detected', findings: review.findings || [], message: 'No layout differences detected.' };
  if (review?.status === 'differences_detected') return { status: 'changes_detected', findings: review.findings || [], message: 'Review detected layout differences.' };
  return { status: review?.status === 'uncertain' ? 'uncertain' : 'unchecked', findings: review?.findings || [], message: review?.message || 'Layout review was unavailable.' };
}

export async function saveFirstDesign({ roomId, draft, sources, references = [], result, rendered }) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  if (!result?.requestId || result.operation !== 'first_design' || !result.designSpec || !result.layoutReview) throw new Error('The first-design result is incomplete.');
  validateImageFile(rendered?.blob);
  const selectedIds = new Set(draft?.selectedSourceIds || []);
  const selectedSources = sources.filter(source => selectedIds.has(source.id));
  const main = selectedSources.find(source => source.id === draft?.viewpointSourceId);
  if (!main || !(main.blob instanceof Blob)) throw new Error('The selected main room viewpoint is unavailable.');
  const referenceIds = new Set(draft?.inspirationIds || []);
  const selectedReferences = references.filter(reference => referenceIds.has(reference.id));
  const now = Date.now();
  const mode = result.mode === 'mock' ? 'mock' : 'real';
  const image = {
    id: crypto.randomUUID(), roomId, blob: rendered.blob, thumbnail: rendered.thumbnail,
    width: rendered.width, height: rendered.height, title: `${roomById(roomId).name} · ${result.designSpec.conceptName}`,
    filename: `${mode === 'mock' ? 'mock-' : ''}first-design-${result.requestId}.png`, caption: '', createdAt: now, updatedAt: now,
    mode, firstDesignId: result.requestId, sourceType: 'first_design', geometryStatus: firstDesignGeometry(result.layoutReview).status,
  };
  image.rootImageId = image.id;
  const sourceSnapshots = selectedSources.map(sourceSnapshot);
  const inspirationSnapshots = selectedReferences.map(reference => ({
    id: reference.id, roomId: reference.roomId, title: reference.title, blob: reference.blob,
    width: reference.width, height: reference.height, sourceUrl: reference.sourceUrl || '', note: reference.note || '',
  }));
  const record = {
    requestId: result.requestId, roomId, imageId: image.id, mode, operation: 'first_design',
    source: sourceSnapshot(main), sourceSnapshots, inspirationSnapshots,
    plan: draft.plan, layout: draft.layout, viewpoint: draft.viewpoint, styleBrief: draft.styleBrief,
    designSpec: result.designSpec, layoutReview: result.layoutReview,
    // Compatibility fields let the existing compare surface present first designs.
    spec: result.designSpec.style, geometry: firstDesignGeometry(result.layoutReview),
    models: result.models, prompt: result.prompt, providerIds: result.providerIds,
    createdAt: result.createdAt || now, updatedAt: now,
  };
  await waitForStorage();
  if (isCloudStorageActive()) {
    const existing = await cloudGetRecord('firstDesigns', result.requestId);
    if (existing) return cloudGetRecord('images', existing.imageId);
    await cloudPutRecord('images', image);
    try { await cloudPutRecord('firstDesigns', record); await cloudDeleteRecord('firstDesignDrafts', roomId); }
    catch (error) { await cloudDeleteRecord('images', image.id); throw error; }
    return image;
  }
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(['images', 'firstDesigns', 'firstDesignDrafts'], 'readwrite');
    const designs = tx.objectStore('firstDesigns');
    const images = tx.objectStore('images');
    let saved = image;
    const existing = designs.get(result.requestId);
    existing.onsuccess = () => {
      if (existing.result) {
        const request = images.get(existing.result.imageId);
        request.onsuccess = () => { saved = request.result; };
      } else {
        images.add(image);
        designs.add(record);
        tx.objectStore('firstDesignDrafts').delete(roomId);
      }
    };
    tx.oncomplete = () => resolve(saved);
    tx.onerror = tx.onabort = () => reject(tx.error || new Error('Could not save this first design. Please retry.'));
  });
}
export async function getNotes(roomId) {
  await waitForStorage();
  if (isCloudStorageActive()) return (await cloudGetRecord('notes', roomId))?.text || '';
  return (await transaction('notes', 'readonly', (store) => store.get(roomId)))?.text || '';
}
export async function saveNotes(roomId, text) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  await waitForStorage();
  if (isCloudStorageActive()) return cloudPutRecord('notes', { roomId, text, updatedAt: Date.now() });
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
  await waitForStorage();
  if (isCloudStorageActive()) return cloudListRecords('inspirations', roomId);
  const items = await transaction('inspirations', 'readonly', store => store.index('roomId').getAll(roomId));
  return items.sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id));
}

export async function addInspiration({ roomId, blob, thumbnail, filename, width, height, ...fields }) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  if (!(blob instanceof Blob)) throw new Error('Choose an image file.');
  validateImageFile(blob);
  const item = { ...inspirationFields(fields), id: crypto.randomUUID(), roomId, blob, thumbnail, filename, width, height, createdAt: Date.now(), updatedAt: Date.now() };
  await waitForStorage();
  if (isCloudStorageActive()) { await cloudPutRecord('inspirations', item); return item; }
  await transaction('inspirations', 'readwrite', store => store.add(item));
  return item;
}

export async function updateInspiration(id, changes) {
  await waitForStorage();
  if (isCloudStorageActive()) {
    const current = await cloudGetRecord('inspirations', id);
    if (!current) throw new Error('This inspiration no longer exists.');
    const allowed = Object.fromEntries(Object.entries(changes).filter(([key]) => ['title', 'note', 'sourceUrl'].includes(key)));
    const result = { ...current, ...inspirationFields({ ...current, ...allowed }), updatedAt: Date.now() };
    await cloudPutRecord('inspirations', result);
    return result;
  }
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

export async function deleteInspiration(id) {
  await waitForStorage();
  return isCloudStorageActive() ? cloudDeleteRecord('inspirations', id) : transaction('inspirations', 'readwrite', store => store.delete(id));
}

export async function listRoomNames() {
  await waitForStorage();
  return isCloudStorageActive() ? cloudListRecords('roomNames') : transaction('roomNames', 'readonly', store => store.getAll());
}
export function saveRoomName(roomId, name) {
  if (!roomById(roomId)) throw new Error('Choose a valid room.');
  const validated = name === null ? null : validateRoomName(name);
  return (async () => {
    await waitForStorage();
    if (validated === null) return isCloudStorageActive() ? cloudDeleteRecord('roomNames', roomId) : transaction('roomNames', 'readwrite', store => store.delete(roomId));
    if (isCloudStorageActive()) return cloudPutRecord('roomNames', { roomId, name: validated, updatedAt: Date.now() });
    return transaction('roomNames', 'readwrite', store => store.put({ roomId, name: validated, updatedAt: Date.now() }));
  })();
}
