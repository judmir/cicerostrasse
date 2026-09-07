import { checkSupabaseConnection, getSupabaseClient } from './supabase.js';

const BUCKET = 'journal-media';
const COLLECTIONS = ['images', 'notes', 'restyles', 'inspirations', 'roomNames', 'firstDesignDrafts', 'firstDesigns'];
let active = false;
let userId = null;
let initialization;

const recordIdFor = (collection, record) => collection === 'restyles' ? record.requestId
  : collection === 'firstDesigns' ? record.requestId
  : collection === 'notes' || collection === 'roomNames' || collection === 'firstDesignDrafts' ? record.roomId
    : record.id;

const extensionFor = (type) => ({
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp',
  'image/gif': 'gif', 'image/avif': 'avif',
})[type] || 'bin';

function splitRecordFiles(collection, record) {
  const data = { ...record };
  const blobs = new Map();
  const removed = new Set();
  const take = (object, key, slot) => {
    if (!Object.prototype.hasOwnProperty.call(object, key)) return;
    const value = object[key];
    delete object[key];
    if (value instanceof Blob) blobs.set(slot, value);
    else if (value == null) removed.add(slot);
  };
  if (collection === 'images' || collection === 'inspirations') {
    take(data, 'blob', 'blob');
    take(data, 'thumbnail', 'thumbnail');
  }
  if (collection === 'restyles') {
    data.source = data.source ? { ...data.source } : data.source;
    data.inspiration = data.inspiration ? { ...data.inspiration } : data.inspiration;
    if (data.source) take(data.source, 'blob', 'source_blob');
    if (data.inspiration) take(data.inspiration, 'blob', 'inspiration_blob');
  }
  if (collection === 'firstDesignDrafts') {
    take(data, 'layoutReferenceBlob', 'layout_reference');
  }
  if (collection === 'firstDesigns') {
    data.source = data.source ? { ...data.source } : data.source;
    data.sourceSnapshots = (data.sourceSnapshots || []).map(snapshot => ({ ...snapshot }));
    data.inspirationSnapshots = (data.inspirationSnapshots || []).map(snapshot => ({ ...snapshot }));
    if (data.source) take(data.source, 'blob', 'source_blob');
    data.sourceSnapshots.forEach((snapshot, index) => take(snapshot, 'blob', `room_${index}`));
    data.inspirationSnapshots.forEach((snapshot, index) => take(snapshot, 'blob', `inspiration_${index}`));
  }
  return { data, blobs, removed };
}

async function hydrateRecord(row) {
  const supabase = getSupabaseClient();
  const record = { ...row.data };
  const downloads = await Promise.all(Object.entries(row.files || {}).map(async ([slot, file]) => {
    const { data, error } = await supabase.storage.from(BUCKET).download(file.path);
    if (error) throw new Error(`Could not download ${slot.replaceAll('_', ' ')}.`);
    return [slot, data];
  }));
  const files = Object.fromEntries(downloads);
  if (row.collection === 'images' || row.collection === 'inspirations') {
    record.blob = files.blob;
    record.thumbnail = files.thumbnail;
  } else if (row.collection === 'firstDesignDrafts') {
    record.layoutReferenceBlob = files.layout_reference || null;
  } else if (row.collection === 'restyles') {
    if (record.source) record.source = { ...record.source, blob: files.source_blob };
    if (record.inspiration) record.inspiration = { ...record.inspiration, blob: files.inspiration_blob };
  } else if (row.collection === 'firstDesigns') {
    if (record.source) record.source = { ...record.source, blob: files.source_blob };
    record.sourceSnapshots = (record.sourceSnapshots || []).map((snapshot, index) => ({ ...snapshot, blob: files[`room_${index}`] }));
    record.inspirationSnapshots = (record.inspirationSnapshots || []).map((snapshot, index) => ({ ...snapshot, blob: files[`inspiration_${index}`] }));
  }
  return record;
}

async function existingRow(collection, recordId) {
  const { data, error } = await getSupabaseClient().from('journal_records')
    .select('collection,record_id,data,files,created_at,updated_at')
    .eq('collection', collection).eq('record_id', recordId).maybeSingle();
  if (error) throw error;
  return data;
}

export async function cloudPutRecord(collection, record, { onlyIfNewer = false } = {}) {
  if (!userId || !COLLECTIONS.includes(collection)) throw new Error('Supabase storage is not ready.');
  const recordId = recordIdFor(collection, record);
  if (!recordId) throw new Error(`The ${collection} record has no identifier.`);
  const existing = await existingRow(collection, recordId);
  if (onlyIfNewer && existing && Number(existing.updated_at) >= Number(record.updatedAt || 0)) return;
  const { data, blobs, removed } = splitRecordFiles(collection, record);
  const files = { ...(existing?.files || {}) };
  const safeId = String(recordId).replace(/[^a-zA-Z0-9._-]/g, '_');
  const isDraft = collection === 'firstDesignDrafts';
  for (const [slot, blob] of blobs) {
    const path = `${userId}/${collection}/${safeId}/${slot}${isDraft ? `-${crypto.randomUUID()}` : ''}.${extensionFor(blob.type)}`;
    const { error } = await getSupabaseClient().storage.from(BUCKET).upload(path, blob, {
      contentType: blob.type || 'application/octet-stream', upsert: true,
    });
    if (error) throw new Error(`Could not upload ${slot.replaceAll('_', ' ')}.`);
    files[slot] = { path, type: blob.type || 'application/octet-stream' };
  }
  for (const slot of removed) {
    if (!isDraft && files[slot]?.path) await getSupabaseClient().storage.from(BUCKET).remove([files[slot].path]);
    delete files[slot];
  }
  const row = {
    user_id: userId, collection, record_id: String(recordId), room_id: record.roomId || record.source?.roomId || null,
    data, files, created_at: Number(record.createdAt || existing?.created_at || Date.now()),
    updated_at: Number(record.updatedAt || record.createdAt || Date.now()),
  };
  const { error } = await getSupabaseClient().from('journal_records').upsert(row, { onConflict: 'user_id,collection,record_id' });
  if (error) {
    if (isDraft) {
      const uploaded = [...blobs.keys()].map(slot => files[slot].path);
      if (uploaded.length) await getSupabaseClient().storage.from(BUCKET).remove(uploaded).catch(() => {});
    }
    throw error;
  }
  // Draft replacement must not destroy the last saved reference before metadata commits.
  if (isDraft) {
    const obsolete = Object.entries(existing?.files || {}).filter(([slot, file]) => file.path !== files[slot]?.path).map(([, file]) => file.path);
    if (obsolete.length) await getSupabaseClient().storage.from(BUCKET).remove(obsolete).catch(() => {});
  }
}

export async function cloudListRecords(collection, roomId) {
  let query = getSupabaseClient().from('journal_records')
    .select('collection,record_id,data,files,created_at,updated_at').eq('collection', collection);
  if (roomId) query = query.eq('room_id', roomId);
  const { data, error } = await query.order('created_at', { ascending: false }).order('record_id');
  if (error) throw error;
  return Promise.all(data.map(hydrateRecord));
}

export async function cloudGetRecord(collection, recordId) {
  const row = await existingRow(collection, recordId);
  return row ? hydrateRecord(row) : undefined;
}

export async function cloudDeleteRecord(collection, recordId) {
  const row = await existingRow(collection, recordId);
  if (!row) return;
  const { error } = await getSupabaseClient().from('journal_records')
    .delete().eq('collection', collection).eq('record_id', recordId);
  if (error) throw error;
  const paths = Object.values(row.files || {}).map((file) => file.path).filter(Boolean);
  if (paths.length) await getSupabaseClient().storage.from(BUCKET).remove(paths);
}

export async function cloudDeleteWhere(collection, predicate) {
  const records = await cloudListRecords(collection);
  await Promise.all(records.filter(predicate).map((record) => cloudDeleteRecord(collection, recordIdFor(collection, record))));
}

export function isCloudStorageActive() { return active; }

export function initializeCloudStorage(readLocalSnapshot, { onProgress = () => {} } = {}) {
  if (initialization) return initialization;
  initialization = (async () => {
    const supabase = getSupabaseClient();
    if (!supabase) return { connected: false, reason: 'not_configured' };
    onProgress('Connecting to Supabase…');
    let { data: { session }, error } = await supabase.auth.getSession();
    if (error) return { connected: false, reason: 'session_failed' };
    if (!session) {
      const result = await supabase.auth.signInAnonymously();
      session = result.data.session;
      error = result.error;
    }
    if (error || !session?.user?.id) return { connected: false, reason: 'sign_in_failed' };
    userId = session.user.id;
    const connection = await checkSupabaseConnection();
    if (!connection.connected) return connection;

    const marker = `cicero-supabase-migrated:${userId}`;
    let migrated = false;
    try { migrated = localStorage.getItem(marker) === '1'; } catch { /* A remote-only session still works. */ }
    if (!migrated) {
      const snapshot = await readLocalSnapshot();
      const records = COLLECTIONS.flatMap((collection) => (snapshot[collection] || []).map((record) => ({ collection, record })));
      let completed = 0;
      for (const { collection, record } of records) {
        onProgress(`Uploading existing data… ${completed + 1} of ${records.length}`);
        await cloudPutRecord(collection, record, { onlyIfNewer: true });
        completed++;
      }
      try { localStorage.setItem(marker, '1'); } catch { /* Migration remains idempotent if storage is restricted. */ }
    }
    active = true;
    return { connected: true, userId, projectRef: connection.projectRef, schemaVersion: connection.schemaVersion };
  })().catch((error) => ({ connected: false, reason: 'migration_failed', error }));
  return initialization;
}
