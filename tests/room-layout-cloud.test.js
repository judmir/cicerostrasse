import test from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

register(`data:text/javascript,${encodeURIComponent(`export async function load(url, context, next) {
  if (url.endsWith('/src/supabase.js')) return { format: 'module', shortCircuit: true, source: 'export const getSupabaseClient = () => globalThis.layoutCloudMock; export const checkSupabaseConnection = async () => ({ connected: true });' };
  return next(url, context);
}`)}`, import.meta.url);

test('cloud draft references serialize as media, hydrate, and survive failed replacement/removal saves', async () => {
  let row, fail = false;
  const media = new Map();
  globalThis.layoutCloudMock = {
    auth: { getSession: async () => ({ data: { session: { user: { id: 'test-user' } } } }) },
    storage: { from: () => ({
      upload: async (path, blob) => { media.set(path, blob); return {}; },
      download: async path => ({ data: media.get(path), error: media.has(path) ? null : new Error('missing') }),
      remove: async paths => { paths.forEach(path => media.delete(path)); return {}; },
    }) },
    from: () => ({
      select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: row }),
      upsert: async value => { if (fail) return { error: new Error('offline') }; row = structuredClone(value); return {}; },
    }),
  };
  const { initializeCloudStorage, cloudPutRecord, cloudGetRecord } = await import('../src/cloud-storage.js');
  assert.equal((await initializeCloudStorage(async () => ({}))).connected, true);
  const draft = { roomId: 'raum3', layoutWizardStep: 3, selectedSourceIds: ['source'], styleBrief: 'Oak', layoutReferenceBlob: new Blob(['original'], { type: 'image/png' }) };
  await cloudPutRecord('firstDesignDrafts', draft);
  assert.equal('layoutReferenceBlob' in row.data, false);
  assert.match(row.files.layout_reference.path, /firstDesignDrafts/);
  assert.equal(await (await cloudGetRecord('firstDesignDrafts', 'raum3')).layoutReferenceBlob.text(), 'original');
  fail = true;
  await assert.rejects(cloudPutRecord('firstDesignDrafts', { ...draft, layoutReferenceBlob: new Blob(['replacement'], { type: 'image/png' }) }), /offline/);
  assert.equal(media.size, 1);
  assert.equal(await (await cloudGetRecord('firstDesignDrafts', 'raum3')).layoutReferenceBlob.text(), 'original');
  await assert.rejects(cloudPutRecord('firstDesignDrafts', { ...draft, layoutReferenceBlob: null }), /offline/);
  assert.equal(await (await cloudGetRecord('firstDesignDrafts', 'raum3')).layoutReferenceBlob.text(), 'original');
  fail = false;
  await cloudPutRecord('firstDesignDrafts', { ...draft, layoutReferenceBlob: new Blob(['replacement'], { type: 'image/webp' }) });
  assert.equal(media.size, 1);
  assert.equal(await (await cloudGetRecord('firstDesignDrafts', 'raum3')).layoutReferenceBlob.text(), 'replacement');
  await cloudPutRecord('firstDesignDrafts', { ...draft, layoutReferenceBlob: null });
  assert.equal(media.size, 0);
  assert.equal((await cloudGetRecord('firstDesignDrafts', 'raum3')).layoutReferenceBlob, null);
});
