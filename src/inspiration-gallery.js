import { listInspirations, addInspiration, updateInspiration, deleteInspiration } from './storage.js';
import { imageFromURL } from './inspiration-image.js';

export function createInspirationGallery(container, { escape, icon, refreshIcons, readImage, notify,
  list = listInspirations, add = addInspiration, update = updateInspiration, remove = deleteInspiration, loadURL = imageFromURL }) {
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  const drafts = new Map();
  let room, active = false, items = [], loading = false, loadError = '', revision = 0;
  let urls = [], pending, busy = false, deleting = null, error = '';
  const fresh = () => ({ open: false, id: null, title: '', note: '', sourceUrl: '', image: null });
  const draft = () => room ? drafts.get(room.id) : null;
  const $ = selector => container.querySelector(selector);
  const release = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; };
  const imageURL = blob => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
  const message = err => err.name === 'QuotaExceededError' ? 'Device storage is full. Free some space, then try saving again.' : err.message || 'Could not save the inspiration. Please try again.';
  const focus = selector => $(selector)?.focus({ preventScroll: true });
  const viewer = document.createElement('dialog');
  viewer.className = 'inspiration-viewer';
  viewer.setAttribute('aria-labelledby', 'inspiration-view-title');
  document.body.append(viewer);
  let viewerURL;
  const closeViewer = () => { viewer.close(); if (viewerURL) URL.revokeObjectURL(viewerURL); viewerURL = null; viewer.innerHTML = ''; };
  viewer.addEventListener('close', () => { if (viewerURL) URL.revokeObjectURL(viewerURL); viewerURL = null; }, events);
  viewer.addEventListener('click', event => { if (event.target.closest('[data-close-inspiration]')) closeViewer(); }, events);

  function render() {
    release();
    if (!room || !active) { container.innerHTML = ''; return; }
    const d = draft();
    container.innerHTML = `
      <div class="inspiration-toolbar"><p>Ideas for ${escape(room.name)}</p><button class="button secondary" data-inspiration-add ${busy ? 'disabled' : ''}>${icon('plus')} Add inspiration</button></div>
      ${d.open ? `<form class="inspiration-composer" aria-label="${d.id ? 'Edit' : 'Add'} design inspiration" aria-busy="${busy}">
        <div class="inspiration-composer-heading"><h2>${d.id ? 'Edit inspiration' : 'Add inspiration'}</h2><button type="button" class="icon-button" data-inspiration-cancel aria-label="${busy ? 'Cancel image loading' : 'Close inspiration editor'}" ${busy && !pending ? 'disabled' : ''}>${icon('x')}</button></div>
        <div class="inspiration-fields"><div class="inspiration-image-field">
          ${d.image ? `<div class="inspiration-draft-preview"><img src="${imageURL(d.image.thumbnail || d.image.blob)}" alt="Selected inspiration preview"/></div>` : `<div class="inspiration-paste-area" tabindex="0" role="group" aria-label="Paste an inspiration image" aria-describedby="inspiration-paste-help">${icon('image-plus')}<span id="inspiration-paste-help">Paste an image here with ⌘V or Ctrl+V</span></div>`}
          ${d.id ? '' : `<div class="inspiration-upload-row"><button type="button" class="button secondary" data-inspiration-upload ${busy ? 'disabled' : ''}>${icon('upload')} ${d.image ? 'Replace image' : 'Upload image'}</button><span>JPG, PNG, WebP, GIF, AVIF · 25 MB</span></div><input data-inspiration-file type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden/>`}
        </div><div class="inspiration-details">
          <label for="inspiration-url">${d.id || d.image ? 'Source link (optional)' : 'Image URL'}</label><div class="inspiration-url-row"><input id="inspiration-url" type="url" placeholder="https://…" value="${escape(d.sourceUrl)}" ${busy ? 'disabled' : ''}/>${d.id ? '' : `<button type="button" class="button secondary" data-inspiration-load ${busy ? 'disabled' : ''}>Load image</button>`}</div>
          ${d.id ? '' : '<p class="inspiration-help">Use a direct image link. For a web page, upload or paste its image and keep the page link here.</p>'}
          <label for="inspiration-title">Title (optional)</label><input id="inspiration-title" maxlength="160" value="${escape(d.title)}" placeholder="e.g. Oak shelving" ${busy ? 'disabled' : ''}/>
          <label for="inspiration-note">Room note (optional)</label><textarea id="inspiration-note" maxlength="500" rows="3" placeholder="How or where could this fit in the room?" ${busy ? 'disabled' : ''}>${escape(d.note)}</textarea>
        </div></div><div class="inspiration-composer-footer"><span role="status">${busy ? pending ? 'Loading image…' : 'Saving inspiration…' : d.image ? 'Image ready to save' : 'Upload, paste, or load an image to continue.'}</span><button class="button primary" type="submit" ${busy || !d.image ? 'disabled' : ''}>${d.id ? 'Save changes' : 'Save inspiration'}</button></div>
      </form>` : ''}
      <p class="inspiration-error" role="alert" ${error ? '' : 'hidden'}>${escape(error)}</p>
      ${loading ? '<p class="inspiration-state" role="status">Loading inspiration…</p>' : loadError ? `<div class="inspiration-state" role="alert"><p>${escape(loadError)}</p><button class="button secondary" data-inspiration-retry>Try again</button></div>` : items.length ? `<div class="inspiration-grid">${items.map(item => `<article class="inspiration-item" data-inspiration-item="${escape(item.id)}">
        <button class="inspiration-preview" data-inspiration-view="${escape(item.id)}" aria-label="View inspiration: ${escape(item.title)}"><img src="${imageURL(item.thumbnail || item.blob)}" alt="${escape(item.title)}" loading="lazy" decoding="async"/></button>
        <div class="inspiration-caption"><h2>${escape(item.title)}</h2><div class="inspiration-actions">${item.sourceUrl ? `<a class="icon-button" href="${escape(item.sourceUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Open source for ${escape(item.title)}" title="Open source">${icon('arrow-up-right')}</a>` : ''}<button class="icon-button" data-inspiration-edit="${escape(item.id)}" aria-label="Edit inspiration: ${escape(item.title)}" title="Edit inspiration" ${busy ? 'disabled' : ''}>${icon('pencil')}</button><button class="icon-button" data-inspiration-delete="${escape(item.id)}" aria-label="Delete inspiration: ${escape(item.title)}" title="Delete inspiration" ${busy ? 'disabled' : ''}>${icon('trash-2')}</button></div></div>
        ${item.note ? `<p class="inspiration-note">${escape(item.note)}</p>` : ''}
        ${deleting === item.id ? `<div class="inspiration-delete-confirm" role="group" aria-label="Confirm deletion"><span>Delete this inspiration?</span><button class="button secondary" data-inspiration-keep ${busy ? 'disabled' : ''}>Keep</button><button class="button destructive" data-inspiration-confirm="${escape(item.id)}" ${busy ? 'disabled' : ''}>${busy ? 'Deleting…' : 'Delete'}</button></div>` : ''}
      </article>`).join('')}</div>` : d.open ? '' : `<div class="empty-gallery inspiration-empty">${icon('image-plus')}<h2>No design inspiration yet</h2><p>Collect images and ideas for ${escape(room.name)}.<br>Upload, use an image link, or paste an image.</p><button class="button secondary" data-inspiration-add>${icon('plus')} Add inspiration</button></div>`}`;
    refreshIcons();
  }

  async function reload() {
    const token = ++revision;
    loading = true; loadError = ''; render();
    try { const saved = await list(room.id); if (token === revision) items = saved; }
    catch (err) { if (token === revision) loadError = message(err); }
    finally { if (token === revision) { loading = false; render(); } }
  }

  function start() { if (busy) return; draft().open = true; error = ''; render(); focus('#inspiration-url'); }

  async function selectImage(file, fromURL = false) {
    if (busy) return;
    const target = draft();
    target.open = true; error = ''; busy = true;
    const controller = new AbortController(); pending = controller;
    const timeout = setTimeout(() => controller.abort(), 20000);
    render();
    try {
      const input = fromURL ? await loadURL(target.sourceUrl, { signal: controller.signal }) : file;
      const image = await readImage(input);
      if (pending !== controller) return;
      if (controller.signal.aborted) throw new Error('Image loading was canceled.');
      target.image = image;
      if (!target.title) target.title = fromURL ? '' : input.name.replace(/\.[^.]+$/, '').slice(0, 160);
    } catch (err) {
      if (pending === controller) error = controller.signal.aborted ? 'The image took too long to load. Try again, upload it, or paste it.' : message(err);
    } finally {
      clearTimeout(timeout);
      if (pending === controller) { pending = null; busy = false; render(); focus(target.image ? '#inspiration-note' : '[data-inspiration-load]'); }
    }
  }

  function cancel() {
    if (busy && !pending) return;
    if (pending) { pending.abort(); pending = null; busy = false; render(); focus('[data-inspiration-load]'); return; }
    drafts.set(room.id, fresh()); error = ''; render(); focus('[data-inspiration-add]');
  }

  container.addEventListener('input', event => {
    const field = { 'inspiration-title': 'title', 'inspiration-note': 'note', 'inspiration-url': 'sourceUrl' }[event.target.id];
    if (field) draft()[field] = event.target.value;
  }, events);
  container.addEventListener('change', event => { if (event.target.matches('[data-inspiration-file]') && event.target.files[0]) selectImage(event.target.files[0]); }, events);
  container.addEventListener('submit', async event => {
    if (!event.target.matches('.inspiration-composer')) return;
    event.preventDefault();
    if (busy || !draft().image) return;
    const d = draft(), targetRoom = room.id;
    busy = true; error = ''; render();
    try {
      const fields = { title: d.title, note: d.note, sourceUrl: d.sourceUrl };
      if (d.id) await update(d.id, fields);
      else await add({ ...d.image, ...fields, roomId: targetRoom });
      drafts.set(targetRoom, fresh());
      notify(d.id ? 'Inspiration updated' : 'Inspiration saved');
      if (room?.id === targetRoom && active) await reload();
    } catch (err) { if (room?.id === targetRoom) error = message(err); else notify(message(err), true); }
    finally { busy = false; render(); focus(error ? '#inspiration-note' : '[data-inspiration-add]'); }
  }, events);
  container.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.matches('[data-inspiration-add]')) start();
    if (button.matches('[data-inspiration-cancel]')) cancel();
    if (button.matches('[data-inspiration-upload]')) $('[data-inspiration-file]').click();
    if (button.matches('[data-inspiration-load]')) selectImage(null, true);
    if (button.matches('[data-inspiration-retry]')) reload();
    const id = button.dataset.inspirationEdit || button.dataset.inspirationDelete || button.dataset.inspirationView;
    const item = items.find(item => item.id === id);
    if (item && button.dataset.inspirationEdit && !busy) { drafts.set(room.id, { ...item, image: item, open: true }); error = ''; deleting = null; render(); focus('#inspiration-note'); }
    if (item && button.dataset.inspirationDelete && !busy) { deleting = item.id; render(); focus('[data-inspiration-keep]'); }
    if (button.matches('[data-inspiration-keep]')) { const id = deleting; deleting = null; render(); focus(`[data-inspiration-delete="${id}"]`); }
    if (item && button.dataset.inspirationView) {
      closeViewer(); viewerURL = URL.createObjectURL(item.blob);
      viewer.innerHTML = `<div class="inspiration-view-heading"><h2 id="inspiration-view-title">${escape(item.title)}</h2><button class="icon-button" data-close-inspiration aria-label="Close inspiration image">${icon('x')}</button></div><img src="${viewerURL}" alt="${escape(item.title)}"/>${item.note ? `<p>${escape(item.note)}</p>` : ''}`;
      refreshIcons(); viewer.showModal();
    }
    if (button.dataset.inspirationConfirm && !busy) {
      const targetRoom = room.id, id = button.dataset.inspirationConfirm;
      busy = true; error = ''; render();
      try { await remove(id); if (drafts.get(targetRoom)?.id === id) drafts.set(targetRoom, fresh()); deleting = null; notify('Inspiration deleted'); if (room?.id === targetRoom && active) await reload(); }
      catch (err) { error = message(err); }
      finally { busy = false; render(); focus(deleting ? '[data-inspiration-keep]' : '[data-inspiration-add]'); }
    }
  }, events);
  // Scoped to the visible inspiration collection; text paste and all other app flows remain native.
  document.addEventListener('paste', event => {
    if (!active || !room || document.querySelector('dialog[open]') || draft().id) return;
    const file = Array.from(event.clipboardData?.items || []).find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (!file) return;
    event.preventDefault();
    if (busy) { notify('Wait for the current image to finish loading or saving.'); return; }
    selectImage(file);
  }, events);
  return {
    setRoom(nextRoom, visible) {
      closeViewer();
      if (pending) { pending.abort(); pending = null; busy = false; }
      revision++; room = nextRoom; active = visible; deleting = null; error = ''; items = [];
      if (room && !drafts.has(room.id)) drafts.set(room.id, fresh());
      if (room && active) reload(); else render();
    },
    refreshNames() { render(); },
    start,
    get busy() { return busy; },
    dispose() { revision++; pending?.abort(); pending = null; active = false; lifecycle.abort(); release(); closeViewer(); viewer.remove(); },
  };
}
