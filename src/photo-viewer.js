import { createAlbum } from './album.js';
import { geometrySummary, styleSummary, refinementSummary } from './restyle-presenter.js';

export function createPhotoViewer(dialog, { rooms, icon, escape, refreshIcons, updatePhoto, removePhoto, readImage, handleError, notify, onRestyle, getVersions, onViewVersion, onShowDesign }) {
  dialog.classList.add('album-viewer');
  const album = createAlbum();
  const $ = (selector) => dialog.querySelector(selector);
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  let imageURL;
  let thumbnails = [];
  let roomName = '';
  let busy = false;
  let touchStart;
  let opener;
  let versionURLs = [];
  let versionRequest = 0;
  let relatedVersions = [];
  let comparisonOpener;
  let versionNumbers = new Map();

  dialog.innerHTML = `
    <div class="album-shell">
      <header class="album-toolbar"><h2 id="image-dialog-title"></h2><span id="album-counter" role="status" aria-live="polite"></span><div class="album-toolbar-actions"><button id="album-more" class="album-icon-button" aria-label="Photo actions" aria-expanded="false" aria-controls="album-actions">${icon('ellipsis')}</button><button id="album-close" class="album-icon-button" aria-label="Close photo viewer">${icon('x')}</button></div></header>
      <div id="album-stage" class="album-stage"><button id="album-previous" class="album-arrow previous" aria-label="Previous photo">${icon('chevron-left')}</button><img id="album-photo" alt="" draggable="false"/><button id="album-next" class="album-arrow next" aria-label="Next photo">${icon('chevron-right')}</button></div>
      <div class="album-design-actions" role="group" aria-label="Design actions"><button id="album-versions-open" class="button secondary" ${getVersions ? '' : 'hidden'}>${icon('history')} Versions</button><button id="album-compare" class="button secondary" hidden>${icon('image')} Compare</button><button id="album-restyle" data-action="restyle" class="button primary" ${onRestyle ? '' : 'hidden'}>${icon('sparkles')} <span>Restyle</span></button></div>
      <nav id="album-filmstrip" class="album-filmstrip" aria-label="Album thumbnails"></nav>
      <div id="album-actions" class="album-actions" role="group" aria-label="Photo actions" hidden><button data-action="edit">${icon('pencil')} Edit details</button><button data-action="replace">${icon('refresh-cw')} Replace photo</button><button data-action="download">${icon('download')} Download photo</button><button data-action="delete" class="danger">${icon('trash-2')} Delete photo</button></div>
      <aside id="album-versions" class="album-versions" aria-label="Design versions" hidden></aside>
      <aside id="album-editor" class="album-editor" aria-labelledby="album-editor-title" hidden><div class="dialog-heading"><h3 id="album-editor-title">Edit photo</h3><button id="album-editor-close" class="icon-button" aria-label="Close photo editor">${icon('x')}</button></div><form id="album-edit-form"><label for="album-title">Title</label><input id="album-title" maxlength="160" required/><label for="album-caption">Caption</label><textarea id="album-caption" rows="3" maxlength="5000" placeholder="Add a note…"></textarea><label for="album-room">Room</label><select id="album-room">${rooms.map((room) => `<option value="${room.id}">${escape(room.name)}</option>`).join('')}</select><button class="button primary full-width" type="submit">Save changes</button></form></aside>
      <input id="album-replace-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden/>
      <div id="album-message" class="album-message" role="status" hidden></div>
    </div>
    <div id="album-confirm" class="album-confirm" hidden><div role="alertdialog" aria-modal="true" aria-labelledby="album-confirm-title"><h3 id="album-confirm-title">Delete this photo?</h3><p>It will be removed from this room’s album.</p><div><button id="album-keep" class="button secondary">Keep photo</button><button id="album-delete" class="button destructive">Delete photo</button></div></div></div>`;
  refreshIcons();

  function releaseURLs() {
    if (imageURL) URL.revokeObjectURL(imageURL);
    imageURL = null;
    thumbnails.forEach((url) => URL.revokeObjectURL(url));
    thumbnails = [];
  }

  function clearVersions() { versionRequest++; versionURLs.forEach((url) => URL.revokeObjectURL(url)); versionURLs = []; relatedVersions = []; $('#album-versions').hidden = true; $('.album-shell').classList.remove('comparing'); }
  function panelsOpen() { return !$('#album-editor').hidden || !$('#album-confirm').hidden || !$('#album-versions').hidden; }
  function closeMenu() { $('#album-actions').hidden = true; $('#album-more').setAttribute('aria-expanded', 'false'); }
  function resetPanels() {
    closeMenu();
    clearVersions();
    $('#album-editor').hidden = true;
    $('#album-confirm').hidden = true;
    $('.album-shell').inert = false;
    $('#album-message').hidden = true;
  }

  function draw() {
    if (!dialog.open) return;
    const photo = album.current;
    if (!photo) { dialog.close(); return; }
    releaseURLs();
    imageURL = URL.createObjectURL(photo.blob);
    $('#album-photo').src = imageURL;
    $('#album-photo').alt = photo.title || `Photo ${album.index + 1}`;
    $('[data-action="replace"]').hidden = Boolean(photo.restyleId || photo.firstDesignId || photo.archivedSource);
    $('[data-action="edit"]').hidden = Boolean(photo.archivedSource);
    $('[data-action="delete"]').hidden = Boolean(photo.archivedSource);
    const identity = photo.firstDesignId ? 'First design' : photo.restyleId ? `Version ${versionNumbers.get(photo.id) || album.index + 1}` : 'Original';
    $('#image-dialog-title').textContent = `${roomName} · ${identity}${photo.mode === 'mock' ? ' · Mock preview' : ''}`;
    $('#album-restyle span').textContent = photo.restyleId ? 'Refine' : 'Restyle';
    $('#album-compare').hidden = !photo.restyleId || !getVersions;
    $('#album-compare').title = photo.geometryStatus !== 'no_changes_detected' ? 'Compare images and review changes' : 'Compare with the saved source';
    $('#album-counter').textContent = `${album.index + 1} of ${album.length}`;
    $('#album-previous').disabled = !album.hasPrevious || busy;
    $('#album-next').disabled = !album.hasNext || busy;
    $('#album-filmstrip').innerHTML = album.thumbnails().map(({ photo: thumbnail, index }) => {
      const url = URL.createObjectURL(thumbnail.thumbnail || thumbnail.blob);
      thumbnails.push(url);
      return `<button class="album-thumbnail" data-photo="${thumbnail.id}" aria-label="View photo ${index + 1}" aria-current="${thumbnail.id === photo.id ? 'true' : 'false'}"><img src="${url}" alt="" draggable="false" decoding="async"/></button>`;
    }).join('');
  }

  function step(offset) {
    if (busy || panelsOpen()) return;
    closeMenu();
    const previous = album.current?.id;
    album.move(offset);
    if (album.current?.id !== previous) draw();
  }

  function setBusy(value) {
    busy = value;
    $('#album-close').disabled = value;
    $('#album-more').disabled = value;
    $('#album-versions-open').disabled = value;
    $('#album-compare').disabled = value;
    $('#album-restyle').disabled = value;
    $('#album-editor-close').disabled = value;
    $('#album-edit-form button').disabled = value;
    $('#album-delete').disabled = value;
    $('#album-keep').disabled = value;
    $('#album-previous').disabled = value || !album.hasPrevious;
    $('#album-next').disabled = value || !album.hasNext;
  }

  async function mutate(operation) {
    if (busy || !album.current) return;
    const id = album.current.id;
    setBusy(true);
    try {
      await operation(id);
      resetPanels();
      draw();
      return true;
    } catch (error) {
      handleError(error);
      $('#album-message').textContent = error.name === 'QuotaExceededError' ? 'Device storage is full. Free some space and try again.' : error.message || 'Could not save this photo. Please try again.';
      $('#album-message').hidden = false;
      return false;
    } finally { setBusy(false); }
  }

  $('#album-close').addEventListener('click', () => { if (!busy) dialog.close(); }, events);
  $('#album-previous').addEventListener('click', () => step(-1), events);
  $('#album-next').addEventListener('click', () => step(1), events);
  $('#album-more').addEventListener('click', () => {
    if (busy) return;
    $('#album-editor').hidden = true;
    const open = $('#album-actions').hidden;
    $('#album-actions').hidden = !open;
    $('#album-more').setAttribute('aria-expanded', String(open));
    if (open) $('#album-actions button:not([hidden])').focus();
  }, events);
  $('#album-filmstrip').addEventListener('click', (event) => {
    const button = event.target.closest('[data-photo]');
    if (!button || busy || panelsOpen()) return;
    closeMenu();
    album.select(button.dataset.photo);
    draw();
    $(`[data-photo="${album.current.id}"]`)?.focus({ preventScroll: true });
  }, events);
  $('#album-actions').addEventListener('click', (event) => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    const photo = album.current;
    if (!action || !photo || busy) return;
    closeMenu();
    if (action === 'edit') {
      $('#album-title').value = photo.title;
      $('#album-caption').value = photo.caption || '';
      $('#album-room').value = photo.roomId;
      $('#album-editor').hidden = false;
      $('#album-title').focus();
    } else if (action === 'replace') {
      $('#album-replace-input').click();
    } else if (action === 'download') {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(photo.blob);
      link.download = photo.filename || 'photo';
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    } else if (action === 'delete') {
      $('.album-shell').inert = true;
      $('#album-confirm').hidden = false;
      $('#album-keep').focus();
    }
  }, events);
  $('#album-restyle').addEventListener('click', () => {
    if (busy || !album.current) return;
    const photo = album.current;
    dialog.close(); onRestyle?.(photo);
  }, events);
  $('#album-versions-open').addEventListener('click', async () => {
    if (!busy && album.current && onShowDesign) { const photo = album.current; dialog.close(); onShowDesign(photo); return; }
    await showComparison($('#album-versions-open'));
  }, events);
  $('#album-compare').addEventListener('click', () => showComparison($('#album-compare')), events);
  async function showComparison(trigger) {
    if (busy || !album.current || !getVersions) return;
    resetPanels();
    comparisonOpener = trigger;
    const token = ++versionRequest;
    const photo = album.current;
    const panel = $('#album-versions');
    panel.hidden = false;
    panel.innerHTML = `<div class="album-versions-heading"><h3>Compare</h3><button class="icon-button" data-close-versions aria-label="Close comparison">${icon('x')}</button></div><p role="status">Loading comparison…</p>`;
    $('.album-shell').classList.add('comparing');
    refreshIcons(); panel.querySelector('[data-close-versions]').focus();
    try {
      const { record, related } = await getVersions(photo);
      if (token !== versionRequest || !dialog.open) return;
      relatedVersions = related;
      const figure = (blob, label) => {
        const url = URL.createObjectURL(blob); versionURLs.push(url);
        return `<figure><figcaption>${escape(label)}</figcaption><div class="restyle-preview"><img src="${url}" alt="${escape(label)}"/></div></figure>`;
      };
      panel.innerHTML = `<div class="album-versions-heading"><h3>Compare</h3><button class="icon-button" data-close-versions aria-label="Close comparison">${icon('x')}</button></div>
        ${record ? `${record.mode === 'mock' ? '<p class="restyle-mock-note">Mock preview · No AI generation or geometry check.</p>' : ''}<div class="restyle-comparison">${figure(record.source.blob, record.operation === 'refine' ? 'Previous version' : 'Source design')}${figure(photo.blob, record.operation === 'refine' ? 'Refined version' : 'Restyled version')}</div>${geometrySummary(record.geometry, escape)}${record.operation === 'refine' ? refinementSummary(record.instruction, escape) : styleSummary(record.spec, escape)}` : '<p class="restyle-help">No saved comparison is available for this image.</p>'}
        ${!onShowDesign ? `<nav class="album-version-list" aria-label="Related versions">${related.map((item) => `<button data-version="${escape(item.id)}" aria-current="${item.id === photo.id}">${item.restyleId ? `Version ${versionNumbers.get(item.id) || ''}` : 'Source'}</button>`).join('')}</nav>` : ''}`;
      refreshIcons(); panel.querySelector('[data-close-versions]').focus();
    } catch { if (token === versionRequest) panel.innerHTML = '<p role="alert">Could not load versions.</p><button class="button secondary" data-close-versions>Close</button>'; }
  }
  $('#album-versions').addEventListener('click', (event) => {
    if (event.target.closest('[data-close-versions]')) { clearVersions(); comparisonOpener?.focus(); }
    const id = event.target.closest('[data-version]')?.dataset.version;
    const photo = relatedVersions.find((item) => item.id === id);
    if (photo) { clearVersions(); onViewVersion?.(photo); }
  }, events);
  $('#album-editor-close').addEventListener('click', () => { if (!busy) { $('#album-editor').hidden = true; $('#album-more').focus(); } }, events);
  $('#album-edit-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    const changes = { title: $('#album-title').value, caption: $('#album-caption').value, roomId: $('#album-room').value };
    if (await mutate((id) => updatePhoto(id, changes))) $('#album-more').focus();
  }, events);
  $('#album-replace-input').addEventListener('change', async (event) => {
    const file = event.target.files[0];
    event.target.value = '';
    if (!file) return;
    await mutate(async (id) => updatePhoto(id, await readImage(file)));
  }, events);
  $('#album-keep').addEventListener('click', () => { resetPanels(); $('#album-more').focus(); }, events);
  $('#album-delete').addEventListener('click', async () => {
    if (await mutate((id) => removePhoto(id))) { notify('Photo deleted'); $('#album-close').focus(); }
  }, events);
  dialog.addEventListener('click', (event) => {
    if (!event.target.closest('#album-more, #album-actions')) closeMenu();
  }, events);
  dialog.addEventListener('keydown', (event) => {
    if (event.target.closest('input, textarea, select') || busy || panelsOpen() || event.altKey || event.metaKey || event.ctrlKey) return;
    const offsets = { ArrowLeft: -1, ArrowRight: 1, Home: -album.length, End: album.length };
    if (event.key in offsets) { event.preventDefault(); step(offsets[event.key]); }
  }, events);
  dialog.addEventListener('cancel', (event) => {
    if (busy) { event.preventDefault(); return; }
    if (panelsOpen() || !$('#album-actions').hidden) { const comparing = !$('#album-versions').hidden; event.preventDefault(); resetPanels(); (comparing ? comparisonOpener : $('#album-more'))?.focus(); }
  }, events);
  dialog.addEventListener('close', () => {
    releaseURLs();
    resetPanels();
    document.body.classList.remove('album-open');
    const focusTarget = opener?.isConnected ? opener : document.querySelector(`[data-view-image="${album.current?.id}"]`) || document.querySelector('[data-source-preview]') || document.querySelector('#gallery .add-images');
    focusTarget?.focus({ preventScroll: true });
  }, events);
  $('#album-stage').addEventListener('pointerdown', (event) => {
    if (event.target.closest('button') || busy || panelsOpen() || event.button !== 0 || event.isPrimary === false) return;
    touchStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
    $('#album-stage').setPointerCapture(event.pointerId);
  }, events);
  $('#album-stage').addEventListener('pointerup', (event) => {
    if (!touchStart || touchStart.id !== event.pointerId) return;
    const dx = event.clientX - touchStart.x;
    const dy = event.clientY - touchStart.y;
    touchStart = null;
    if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.3) step(dx < 0 ? 1 : -1);
  }, events);
  $('#album-stage').addEventListener('pointercancel', () => { touchStart = null; }, events);

  return {
    open(id, photos, name) {
      for (const option of $('#album-room').options) option.textContent = rooms.find(room => room.id === option.value)?.name || option.textContent;
      opener = document.activeElement;
      roomName = name;
      versionNumbers = new Map(photos.filter((photo) => photo.restyleId).map((photo, index) => [photo.id, index + 1]));
      album.setPhotos(photos);
      if (!album.select(id)) return;
      resetPanels();
      document.body.classList.add('album-open');
      if (!dialog.open) dialog.showModal();
      draw();
      $('#album-close').focus();
    },
    setPhotos(photos) { versionNumbers = new Map(photos.filter((photo) => photo.restyleId).map((photo, index) => [photo.id, index + 1])); album.setPhotos(photos); if (!busy) draw(); },
    get busy() { return busy; },
    dispose() { lifecycle.abort(); releaseURLs(); dialog.close(); document.body.classList.remove('album-open'); },
  };
}
