import test from 'node:test';
import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';
import { saveFirstDesignDraft, getFirstDesignDraft, listImages } from '../src/storage.js';

test('draft reference bytes persist in IndexedDB without creating gallery images', async () => {
  const draft = { roomId: 'raum3', step: 1, layoutWizardStep: 3, selectedSourceIds: ['a', 'b'], viewpointSourceId: 'a', styleBrief: 'Oak', layout: { version: 1, placements: [] }, layoutReferenceBlob: new Blob(['reference bytes'], { type: 'image/png' }), layoutReferenceName: 'reference.png' };
  await saveFirstDesignDraft(draft);
  const stored = await getFirstDesignDraft('raum3');
  assert.equal(await stored.layoutReferenceBlob.text(), 'reference bytes');
  assert.equal(stored.layoutReferenceBlob.type, 'image/png');
  assert.deepEqual(stored.selectedSourceIds, ['a', 'b']);
  assert.equal(stored.layoutWizardStep, 3);
  assert.deepEqual(await listImages('raum3'), []);
  await saveFirstDesignDraft({ ...stored, layoutReferenceBlob: null });
  assert.equal((await getFirstDesignDraft('raum3')).layoutReferenceBlob, null);
});
