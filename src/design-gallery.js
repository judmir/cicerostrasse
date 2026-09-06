const chronological = (a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.id.localeCompare(b.id);
export const designRoot = (image) => image.rootImageId || image.id;
const versionOrigin = (version) => version.mode === 'mock' ? 'Mock preview, not AI generated' : 'AI generated';
export const designPath = (roomId, rootId) => `#/room/${roomId}/design/${encodeURIComponent(rootId)}`;
export function parseGalleryRoute(hash) {
  const match = hash.match(/^#\/room\/([a-z0-9]+)(?:\/design\/([a-zA-Z0-9-]+))?$/);
  return match ? { roomId: match[1], rootId: match[2] || null } : null;
}

export function groupDesigns(images, roomId) {
  const families = new Map();
  for (const image of images) {
    const rootId = designRoot(image);
    if (!families.has(rootId)) families.set(rootId, { rootId, source: null, versions: [], items: [] });
    const family = families.get(rootId);
    family.items.push(image);
    if (image.id === rootId) family.source = image;
    else family.versions.push(image);
  }
  return [...families.values()]
    .filter((family) => !roomId || family.items.some((image) => image.roomId === roomId))
    .map((family) => ({ ...family, versions: family.versions.sort(chronological) }))
    .sort((a, b) => chronological(a.source || a.versions[0], b.source || b.versions[0]));
}

export async function resolveDesignSource(family, getRecord) {
  if (family.source) return family.source;
  // Old versions retain their source even when its original gallery record was deleted.
  for (const version of family.versions) {
    if (version.parentImageId !== family.rootId || !version.restyleId) continue;
    const record = await getRecord(version.restyleId);
    if (record?.source?.id === family.rootId) return { ...record.source, archivedSource: true };
  }
  return null;
}

export function renderSourceCards(families, { roomId, escape, imageURL, icon }) {
  return `<div class="source-grid">${families.map((family, index) => {
    const preview = family.source || family.versions[0];
    const description = `Original ${index + 1}: ${family.source?.title || 'Original deleted'}. ${family.versions.length} generated ${family.versions.length === 1 ? 'version' : 'versions'}${family.source ? '' : '. Preview shows a surviving version'}`;
    return `<article class="source-card"><a class="source-card-link" href="${designPath(roomId, family.rootId)}" data-design-link="${escape(family.rootId)}" aria-label="Open ${escape(description)}" title="${escape(description)}">
      <div class="source-card-preview"><img src="${imageURL(preview.thumbnail || preview.blob)}" alt="${escape(preview.title)}" loading="lazy" decoding="async"/></div>
      <div class="source-card-caption" aria-hidden="true"><span class="image-index">${icon(family.source ? 'image' : 'triangle-alert')} ${index + 1}</span><span class="image-index">${icon('layers')} ${family.versions.length}</span></div></a>
      <div class="source-card-actions">${family.source ? `<button class="icon-button" data-delete-source="${escape(family.source.id)}" title="Delete source" aria-label="Delete source: ${escape(family.source.title)}">${icon('trash-2')}</button>` : '<span class="restyle-live">Source deleted · Versions retained</span>'}</div></article>`;
  }).join('')}</div>`;
}

export function createDesignPage(container, { escape, icon, refreshIcons, getRecord, onView, onRestyle, onRefine, onDelete }) {
  let source, family, urls = [], revision = 0;
  const lifecycle = new AbortController();
  const release = () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls = []; };
  const imageURL = (blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; };

  async function render(nextFamily, { room, number, loading = false, focusHeading = false }) {
    const token = ++revision;
    const previousFocus = container.contains(document.activeElement) ? document.activeElement.dataset.viewImage : null;
    release(); family = nextFamily; source = null;
    const roomLink = `<a class="back-link" href="#/room/${room.id}">${icon('arrow-left')} ${escape(room.name)}</a>`;
    const navigation = `<nav class="design-navigation">${roomLink}</nav>`;
    if (!family) {
      container.innerHTML = `${navigation}<div class="design-empty"><h1 id="design-title">${loading ? 'Loading design…' : 'Design not found'}</h1>${loading ? '' : '<p>This source and its versions are no longer in your collection.</p>'}</div>`;
      refreshIcons(); return;
    }
    // Keep navigation usable while recovering a deleted original from a saved snapshot.
    if (!family.source) container.innerHTML = `${navigation}<p role="status">Loading source…</p>`;
    let resolvedSource;
    try { resolvedSource = await resolveDesignSource(nextFamily, getRecord); }
    catch { resolvedSource = null; }
    if (token !== revision) return;
    source = resolvedSource;
    container.innerHTML = `<nav class="design-navigation">${roomLink}<h1 id="design-title" class="visually-hidden">Original ${number}: ${escape(source?.title || 'Saved design')}</h1><button class="button primary design-create" data-restyle-source title="Create a version from the original" aria-label="Create a version from the original" ${source ? '' : 'disabled'}>${icon('plus')}${icon('sparkles')}</button></nav>
      <div class="design-workspace"><section class="design-source" aria-label="Original uploaded image"><h2 class="visually-hidden">Original image</h2>${source ? `<button class="design-source-image" data-source-preview title="${escape(source.archivedSource ? 'Original deleted · Saved snapshot' : 'Original uploaded image')}: ${escape(source.title)}" aria-label="Enlarge original uploaded image"><img src="${imageURL(source.blob)}" alt="${escape(source.title)}" decoding="async"/><span class="image-provenance original-provenance" aria-hidden="true">${icon('image')}</span></button><div class="design-source-actions"><span class="visually-hidden">${source.archivedSource ? 'Source deleted · Saved snapshot' : 'Original uploaded image'}</span>${!source.archivedSource && onDelete ? `<button class="icon-button" data-delete-current-source title="Delete original image" aria-label="Delete original image">${icon('trash-2')}</button>` : '<span class="image-index" title="Original deleted · Saved snapshot" aria-label="Original deleted · Saved snapshot">'+icon('triangle-alert')+'</span>'}</div>` : '<div class="design-source-missing">Original unavailable. Saved versions remain accessible.</div>'}</section>
      <div class="design-flow" aria-hidden="true">${icon('chevron-right')}</div>
      <section class="design-versions" aria-labelledby="design-versions-title"><h2 id="design-versions-title" class="visually-hidden">Generated versions (${family.versions.length})</h2>
      <div class="design-version-grid">${family.versions.map((version, index) => {
        const parentIndex = family.versions.findIndex((item) => item.id === version.parentImageId);
        const ancestry = version.parentImageId === family.rootId ? 'From original' : parentIndex >= 0 ? `From version ${parentIndex + 1}` : 'From a removed version';
        const review = version.mode !== 'mock' && version.geometryStatus !== 'no_changes_detected';
        const description = `${versionOrigin(version)} · Version ${index + 1} · ${ancestry}${review ? ' · Review needed' : ''}. ${version.title}${version.restyleInstruction ? `. ${version.restyleInstruction}` : ''}`;
        return `<div class="design-version-node"><button class="design-version-card" data-view-image="${escape(version.id)}" title="${escape(description)}" aria-label="Open version ${index + 1}: ${escape(description)}">
        <div class="design-version-preview"><img src="${imageURL(version.thumbnail || version.blob)}" alt="${escape(version.title)}" loading="lazy" decoding="async"/><span class="image-provenance" data-origin="${version.mode === 'mock' ? 'mock' : 'ai'}" aria-hidden="true">${icon(version.mode === 'mock' ? 'flask-conical' : 'sparkles')}</span>${review ? `<span class="design-review-indicator" aria-hidden="true">${icon('triangle-alert')}</span>` : ''}</div>
        <div class="design-version-caption" aria-hidden="true"><span>${String(index + 1).padStart(2, '0')}</span>${parentIndex >= 0 ? `<span class="version-parent">${icon('arrow-up-right')}${String(parentIndex + 1).padStart(2, '0')}</span>` : ''}</div></button>${onRefine ? `<button class="design-refine-button" data-refine-version="${escape(version.id)}" title="Refine version ${index + 1}" aria-label="Refine version ${index + 1}">${icon('pencil')}</button>` : ''}</div>`;
      }).join('')}
      </div>${family.versions.length ? '' : '<div class="versions-empty"><p>No versions yet.</p></div>'}</section></div>`;
    refreshIcons();
    if (focusHeading) { const heading = container.querySelector('#design-title'); heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    else if (previousFocus) container.querySelector(`[data-view-image="${previousFocus}"]`)?.focus({ preventScroll: true });
  }
  container.addEventListener('click', (event) => {
    if (event.target.closest('[data-delete-current-source]') && source && !source.archivedSource) onDelete?.(source, family.versions.length);
    if (event.target.closest('[data-restyle-source]') && source) onRestyle(source);
    const refineId = event.target.closest('[data-refine-version]')?.dataset.refineVersion;
    const refinement = family?.versions.find((item) => item.id === refineId);
    if (refinement) onRefine?.(refinement);
    if (event.target.closest('[data-source-preview]') && source) onView(source, [source, ...family.versions]);
    const id = event.target.closest('[data-view-image]')?.dataset.viewImage;
    const image = family?.versions.find((item) => item.id === id);
    if (image) onView(image, [...(source ? [source] : []), ...family.versions]);
  }, { signal: lifecycle.signal });
  return {
    render,
    get source() { return source; },
    get photos() { return family ? [...(source ? [source] : []), ...family.versions] : []; },
    hide() { revision++; source = null; family = null; release(); container.innerHTML = ''; },
    dispose() { lifecycle.abort(); revision++; release(); },
  };
}
