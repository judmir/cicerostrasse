import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { groupDesigns, designPath, parseGalleryRoute, resolveDesignSource, renderSourceCards, createDesignPage } from '../src/design-gallery.js';

const source = (id, createdAt = 1) => ({ id, roomId: 'kuche', title: `Layout ${id}`, createdAt, blob: new Blob([id], { type: 'image/png' }) });
const version = (id, parent, root, createdAt = 2) => ({ ...source(id, createdAt), parentImageId: parent, rootImageId: root, restyleId: `restyle-${id}`, geometryStatus: 'no_changes_detected', title: 'Layout · Oak' });
const escape = (text) => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const icon = () => '';

test('separate sources own their versions, including restyles of existing versions', () => {
  const a = source('a'); const b = source('b', 4);
  const v1 = version('v1', 'a', 'a', 2); const v2 = version('v2', 'v1', 'a', 3); const v3 = version('v3', 'b', 'b', 5);
  const families = groupDesigns([v3, v2, b, v1, a], 'kuche');
  assert.deepEqual(families.map((family) => family.rootId), ['a', 'b']);
  assert.deepEqual(families[0].versions.map((item) => item.id), ['v1', 'v2']);
  assert.equal(families[0].source, a);
  const markup = renderSourceCards(families, { roomId: 'kuche', escape, icon, imageURL: () => 'blob:test' });
  assert.equal((markup.match(/data-design-link=/g) || []).length, 2);
  assert.match(markup, /2 generated versions/);
  assert.match(markup, /Original 1/); assert.match(markup, /Original 2/);
  assert.deepEqual(groupDesigns([a, v1], 'bad'), []);
});

test('a moved version remains accessible in its room without splitting its lineage', () => {
  const a = source('a'); const moved = { ...version('v1', 'a', 'a'), roomId: 'bad' };
  const families = groupDesigns([a, moved], 'bad');
  assert.equal(families.length, 1); assert.equal(families[0].source.id, 'a'); assert.equal(families[0].versions[0].id, 'v1');
});

test('source cards expose deletion separately from navigation and label deleted originals', () => {
  const dom = new JSDOM(renderSourceCards(groupDesigns([source('a'), version('v1', 'b', 'b')]), {
    roomId: 'kuche', escape, icon, imageURL: () => 'blob:test',
  }));
  try {
    const buttons = dom.window.document.querySelectorAll('[data-delete-source]');
    const familyButtons = dom.window.document.querySelectorAll('[data-delete-family]');
    assert.equal(buttons.length, 1);
    assert.equal(buttons[0].dataset.deleteSource, 'a');
    assert.equal(buttons[0].closest('a'), null);
    assert.equal(familyButtons.length, 1);
    assert.equal(familyButtons[0].dataset.deleteFamily, 'b');
    assert.equal(familyButtons[0].getAttribute('aria-label'), 'Delete 1 retained version');
    assert.equal(familyButtons[0].closest('a'), null);
    assert.match(dom.window.document.body.textContent, /Source deleted · Versions retained/);
  } finally { dom.window.close(); }
});

test('mock and AI versions retain distinct indicators and accessible provenance without text captions', async () => {
  const dom = new JSDOM('<section id="page"></section>');
  globalThis.document = dom.window.document; globalThis.AbortController = dom.window.AbortController;
  const container = document.querySelector('#page');
  const page = createDesignPage(container, { escape, icon, refreshIcons: () => {}, getRecord: async () => null, onView: () => {}, onRestyle: () => {} });
  try {
    const mock = { ...version('mock-v1', 'a', 'a'), mode: 'mock', geometryStatus: 'unchecked' };
    await page.render(groupDesigns([source('a'), mock, version('ai-v2', 'a', 'a', 3)])[0], { room: { id: 'kuche', name: 'Küche' }, number: 1 });
    const mockCard = container.querySelector('[data-view-image="mock-v1"]');
    const aiCard = container.querySelector('[data-view-image="ai-v2"]');
    assert.ok(mockCard.querySelector('[data-origin="mock"]'));
    assert.ok(aiCard.querySelector('[data-origin="ai"]'));
    assert.match(mockCard.getAttribute('aria-label'), /Mock preview, not AI generated/);
    assert.match(aiCard.getAttribute('title'), /AI generated · Version 2 · From original/);
    assert.equal(mockCard.querySelector('.design-version-caption').textContent.trim(), '01');
    assert.equal(aiCard.querySelector('.design-version-caption').textContent.trim(), '02');
    assert.equal(container.querySelector('.design-flow').getAttribute('aria-hidden'), 'true');
    assert.equal(container.querySelector('.design-create').getAttribute('aria-label'), 'Create a version from the original');
  } finally { page.dispose(); dom.window.close(); }
});

test('source routes survive hash refresh/back navigation and reject malformed routes', () => {
  assert.equal(designPath('kuche', 'source-123'), '#/room/kuche/design/source-123');
  assert.deepEqual(parseGalleryRoute('#/room/kuche/design/source-123'), { roomId: 'kuche', rootId: 'source-123' });
  assert.deepEqual(parseGalleryRoute('#/room/kuche'), { roomId: 'kuche', rootId: null });
  assert.equal(parseGalleryRoute('#/room/kuche/design/<script>'), null);
});

test('deleted sources use saved source snapshots; missing ancestry never hides surviving versions', async () => {
  const family = groupDesigns([version('v1', 'a', 'a')])[0];
  const recovered = await resolveDesignSource(family, async () => ({ source: source('a') }));
  assert.equal(recovered.id, 'a'); assert.equal(recovered.archivedSource, true);
  const orphan = groupDesigns([version('v2', 'v1', 'a')])[0];
  assert.equal(await resolveDesignSource(orphan, async () => ({})), null);
  assert.equal(orphan.versions.length, 1);
});

test('source page keeps source before versions, puts Restyle in the toolbar, and routes actions correctly', async () => {
  const dom = new JSDOM('<section id="page"></section>');
  globalThis.document = dom.window.document;
  globalThis.AbortController = dom.window.AbortController;
  const container = document.querySelector('#page');
  const a = source('a'); const v1 = version('v1', 'a', 'a'); const v2 = { ...version('v2', 'v1', 'a', 3), geometryStatus: 'uncertain' };
  let selectedSource, selectedImage, album, deletion, refined, deletedVersion;
  const page = createDesignPage(container, { escape, icon, refreshIcons: () => {}, getRecord: async () => null,
    onRestyle: (image) => { selectedSource = image; }, onView: (image, family) => { selectedImage = image; album = family; },
    onRefine: (image) => { refined = image; },
    onDelete: (image, count) => { deletion = { image, count }; },
    onDeleteVersion: (image) => { deletedVersion = image; },
  });
  try {
    const family = groupDesigns([a, v2, v1])[0];
    await page.render(family, { room: { id: 'kuche', name: 'Küche' }, number: 1 });
    assert.ok(container.querySelector('.design-navigation [data-restyle-source]'));
    assert.equal(container.querySelector('.design-version-grid [data-restyle-source]'), null);
    assert.equal(container.querySelectorAll('.design-version-card').length, 2);
    assert.ok(container.querySelector('.design-source').compareDocumentPosition(container.querySelector('.design-versions')) & dom.window.Node.DOCUMENT_POSITION_FOLLOWING);
    assert.equal(container.querySelectorAll('.design-review-indicator').length, 1);
    assert.match(container.querySelector('[data-view-image="v2"]').getAttribute('aria-label'), /From version 1 · Review needed/);
    assert.equal(container.querySelector('[data-refine-version="v2"]').getAttribute('title'), 'Refine version 2');
    const deleteButton = container.querySelector('[data-delete-version="v2"]');
    assert.equal(container.querySelectorAll('[data-delete-version]').length, 2);
    assert.equal(deleteButton.getAttribute('aria-label'), 'Delete version 2');
    assert.equal(deleteButton.parentElement.closest('button'), null);
    deleteButton.click();
    assert.equal(deletedVersion, v2);
    assert.equal(selectedImage, undefined);
    assert.equal(refined, undefined);
    container.querySelector('[data-delete-current-source]').click();
    assert.equal(deletion.image.id, 'a'); assert.equal(deletion.count, 2);
    container.querySelector('[data-restyle-source]').click(); assert.equal(selectedSource.id, 'a');
    container.querySelector('[data-refine-version="v2"]').click(); assert.equal(refined.id, 'v2');
    container.querySelector('[data-view-image="v2"]').click(); assert.equal(selectedImage.id, 'v2'); assert.deepEqual(album.map((image) => image.id), ['a', 'v1', 'v2']);
    await page.render(groupDesigns([a])[0], { room: { id: 'kuche', name: 'Küche' }, number: 1 });
    assert.equal(container.querySelectorAll('[data-restyle-source]').length, 1);
    assert.match(container.textContent, /No versions yet/);
    assert.equal(container.querySelector('[data-delete-version]'), null);
    page.hide(); assert.equal(container.innerHTML, '');
  } finally { page.dispose(); dom.window.close(); }
});

test('recovered source snapshots expose deletion for the retained family', async () => {
  const dom = new JSDOM('<section id="page"></section>');
  globalThis.document = dom.window.document; globalThis.AbortController = dom.window.AbortController;
  const container = document.querySelector('#page');
  let deleted;
  const page = createDesignPage(container, { escape, icon, refreshIcons: () => {}, getRecord: async () => ({ source: source('a') }),
    onView: () => {}, onRestyle: () => {}, onDelete: () => assert.fail('Snapshots cannot be deleted as source records'),
    onDeleteFamily: (family) => { deleted = family; },
  });
  try {
    await page.render(groupDesigns([version('v1', 'a', 'a')])[0], { room: { id: 'kuche', name: 'Küche' }, number: 1 });
    assert.equal(container.querySelector('[data-delete-current-source]'), null);
    container.querySelector('[data-delete-current-family]').click();
    assert.equal(deleted.rootId, 'a');
    assert.match(container.textContent, /Source deleted · Saved snapshot/);
  } finally { page.dispose(); dom.window.close(); }
});

test('late source recovery cannot overwrite a newly selected design', async () => {
  const dom = new JSDOM('<section id="page"></section>');
  globalThis.document = dom.window.document; globalThis.AbortController = dom.window.AbortController;
  let finish;
  const page = createDesignPage(document.querySelector('#page'), { escape, icon, refreshIcons: () => {}, getRecord: () => new Promise((resolve) => { finish = resolve; }), onView: () => {}, onRestyle: () => {} });
  const room = { id: 'kuche', name: 'Küche' };
  try {
    const pending = page.render(groupDesigns([version('v1', 'a', 'a')])[0], { room, number: 1 });
    await page.render(groupDesigns([source('b')])[0], { room, number: 2 });
    finish({ source: source('a') }); await pending;
    assert.equal(page.source.id, 'b'); assert.match(document.querySelector('#design-title').textContent, /Layout b/);
  } finally { page.dispose(); dom.window.close(); }
});
