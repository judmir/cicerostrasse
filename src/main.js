import { createIcons, ArrowLeft, Plus, X, Upload, ImagePlus, Trash2, Download, RefreshCw, Check, Pencil, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Sparkles, History, FlaskConical, TriangleAlert, Layers, Image as ImageIcon } from 'lucide';
import { rooms, roomById, applyRoomNames, setRoomDisplayName } from './rooms.js';
import { createFloorplan } from './floorplan.js';
import { renderRoomPlan } from './room-plan.js';
import { createPhotoViewer } from './photo-viewer.js';
import { initializeStorage, listRoomNames, saveRoomName, listImages, addImage, updateImage, deleteImage, deleteDesignFamily, validateImageFile, getRestyleRecord, saveRestyleVersion } from './storage.js';
import { createRestyleClient } from './restyle-client.js';
import { createRestyleWizard } from './restyle-wizard.js';
import { createRoomLayoutWizard } from './room-layout-wizard.js';
import { getFirstDesignDraft, saveFirstDesignDraft, saveFirstDesign } from './storage.js';
import { createSourceDeleteDialog } from './source-delete-dialog.js';
import { createDesignPage, groupDesigns, renderSourceCards, parseGalleryRoute, designPath, designRoot } from './design-gallery.js';
import './style.css';
import './album.css';
import './restyle.css';
import './design-gallery.css';
import './desktop.css';
import './inspiration.css';
import './room-name.css';
import './plan-navigation.css';
import { createRoomNameEditor } from './room-name-editor.js';
import { createInspirationGallery } from './inspiration-gallery.js';

const icons = { ArrowLeft, Plus, X, Upload, ImagePlus, Trash2, Download, RefreshCw, Check, Pencil, ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, Ellipsis, Sparkles, History, FlaskConical, TriangleAlert, Layers, Image: ImageIcon };
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.6 } });
let currentRoom = null;
let currentRoot = null;
let inspirationActive = false;
let inspirationGallery;
let roomNameEditor;
let dataLoaded = false;
let images = [];
let plan;
let galleryURLs = [];
let photoViewer;
let restyleWizard;
let designPage;
let sourceDeleteDialog;
let uploadTarget;
let uploading = false;
let toastTimer;
let disposed = false;
let planExpanded = false;

$('#app').innerHTML = `
  <main>
    <section id="plan-page" class="plan-page" aria-label="Apartment floor plan">
      <button id="plan-toggle" class="plan-toggle" type="button" hidden aria-expanded="false" aria-controls="plan-navigation"><svg class="plan-miniature" viewBox="-90 -110 1460 770" aria-hidden="true" focusable="false">${rooms.map((room) => `<polygon data-mini-room="${room.id}" points="${room.polygon.map((point) => point.join(',')).join(' ')}"/>`).join('')}</svg><span class="visually-hidden">Expand floor plan</span>${icon('chevron-down')}</button>
      <div id="plan-navigation">
        <a id="plan-home" href="#/" hidden>Full floor plan</a>
        <div class="apartment-plan-viewport"><div id="floorplan" tabindex="-1" aria-label="Apartment floor plan"></div></div>
        <nav class="room-links" aria-label="Open a room gallery">${rooms.map((room) => `<a href="#/room/${room.id}" data-plan-room="${room.id}">${room.name}</a>`).join('')}</nav>
      </div>
    </section>
    <section id="room-page" class="room-page" hidden aria-labelledby="room-title">
      <div class="room-heading"><div class="room-heading-title"><h1 id="room-title"></h1><button id="rename-room" class="icon-button" disabled aria-label="Rename room" title="Rename room">${icon('pencil')}</button><span id="room-meta"></span></div><div class="room-heading-actions"><button id="style-room" class="button secondary">${icon('sparkles')} Style with AI</button><button class="button primary add-images">${icon('plus')} Add images</button></div></div>
      <div id="room-name-editor" class="room-name-editor" hidden></div>
      <nav class="room-collections" aria-label="Room collections"><a id="sources-link">Sources</a><a id="inspiration-link">Design inspiration</a></nav>
      <div class="room-layout">
        <div class="room-gallery-content">
            <div id="upload-progress" class="upload-progress" role="status" aria-live="polite" hidden><span id="upload-progress-label"></span><progress id="upload-progress-bar" aria-label="Photo upload progress" value="0" max="1"></progress></div>
          <div id="gallery" aria-label="Source designs"></div>
          <section id="inspiration-gallery" class="inspiration-gallery" aria-label="Design inspiration" hidden></section>
        </div>
        <aside class="room-plan-sidebar" aria-labelledby="room-plan-title">
          <div class="room-plan-heading"><h2 id="room-plan-title">Room plan</h2></div>
          <div id="room-plan-content"></div>
        </aside>
      </div>
    </section>
    <section id="design-page" class="design-page" hidden aria-labelledby="design-title"></section>
  </main>
  <input id="image-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden />
  <dialog id="image-dialog" class="album-viewer" aria-labelledby="image-dialog-title"></dialog>
  <dialog id="restyle-dialog" class="restyle-dialog" aria-labelledby="restyle-title"></dialog>
  <dialog id="room-layout-dialog"></dialog>
  <dialog id="source-delete-dialog" class="source-delete-dialog" aria-labelledby="source-delete-title" aria-describedby="source-delete-description"></dialog>
  <div id="drop-overlay" hidden>${icon('upload')}<span>Drop images to add them to <strong id="drop-room"></strong></span></div>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
`;

const roomLayoutWizard = createRoomLayoutWizard($('#room-layout-dialog'), {
  escape, getDraft: getFirstDesignDraft, saveDraft: saveFirstDesignDraft, listImages, readImage,
  client: createRestyleClient(), saveDesign: saveFirstDesign,
  onSaved: async () => { await refreshData(); toast('First design saved'); },
  onOpen: async image => { await refreshData(); location.hash = designPath(image.roomId, image.id); },
});

function toast(message, error = false) {
  clearTimeout(toastTimer);
  $('#toast').textContent = message;
  $('#toast').classList.toggle('error', error);
  $('#toast').hidden = false;
  toastTimer = setTimeout(() => { $('#toast').hidden = true; }, error ? 7000 : 3500);
}

function handleError(error) {
  console.error(error);
  toast(error.name === 'QuotaExceededError' ? 'Device storage is full. Free some space and try again.' : error.message || 'Could not save your changes. Please try again.', true);
}

function clearGalleryURLs() {
  galleryURLs.forEach((url) => URL.revokeObjectURL(url));
  galleryURLs = [];
}

function renderGallery() {
  if (!currentRoom) return;
  const room = roomById(currentRoom);
  const families = groupDesigns(images, currentRoom);
  clearGalleryURLs();
  $('#room-title').textContent = room.name;
  $('#room-plan-content').innerHTML = renderRoomPlan(room);
  $('#room-meta').textContent = `${families.length} ${families.length === 1 ? 'source' : 'sources'}`;
  $('#drop-room').textContent = room.name;
  if (!families.length) {
    $('#gallery').innerHTML = `<div class="empty-gallery">${icon('image-plus')}<h2>No images yet</h2><p>Drop images here, or add them from your files.</p><button class="button secondary add-images">${icon('plus')} Add images</button><small>JPG, PNG, WebP, GIF, AVIF · 25 MB each</small></div>`;
  } else {
    $('#gallery').innerHTML = renderSourceCards(families, { roomId: currentRoom, escape, icon,
      imageURL: (blob) => { const url = URL.createObjectURL(blob); galleryURLs.push(url); return url; },
    });
  }
  document.querySelectorAll('.add-images').forEach((button) => { button.disabled = uploading; });
  refreshIcons();
}

async function renderCurrentDesign(focusHeading = false) {
  if (!currentRoot || !currentRoom) return;
  const families = groupDesigns(images, currentRoom);
  const index = families.findIndex((family) => family.rootId === currentRoot);
  await designPage.render(families[index], { room: roomById(currentRoom), number: index + 1, loading: !dataLoaded, focusHeading });
}

async function refreshData() {
  const savedImages = await listImages();
  if (disposed) return;
  images = savedImages;
  dataLoaded = true;
  plan?.setCounts(Object.fromEntries(rooms.map((room) => [room.id, images.filter((item) => item.roomId === room.id).length])));
  renderGallery();
  await renderCurrentDesign();
  photoViewer?.setPhotos(currentRoot ? designPage.photos : images.filter((item) => item.roomId === currentRoom));
}

function navigate() {
  roomNameEditor?.hide();
  inspirationActive = /^#\/room\/[a-z0-9]+\/inspiration$/.test(location.hash);
  const route = parseGalleryRoute(inspirationActive ? location.hash.replace(/\/inspiration$/, '') : location.hash);
  const room = route && roomById(route.roomId);
  currentRoom = room?.id || null;
  currentRoot = room ? route.rootId : null;
  $('#image-dialog').close();
  $('#drop-overlay').hidden = true;
  plan?.setSelectedRoom(currentRoom);
  setPlanExpanded(false);
  document.querySelectorAll('[data-mini-room], [data-plan-room]').forEach((element) => {
    const selected = (element.dataset.miniRoom || element.dataset.planRoom) === currentRoom;
    element.classList.toggle('is-selected', selected);
    if (selected) element.setAttribute('aria-current', 'page'); else element.removeAttribute('aria-current');
  });
  $('#room-page').hidden = !currentRoom || !!currentRoot;
  $('#design-page').hidden = !currentRoot;
  $('#gallery').hidden = inspirationActive;
  $('#inspiration-gallery').hidden = !inspirationActive;
  const sourcesLink = $('#sources-link'), inspirationLink = $('#inspiration-link');
  sourcesLink.href = `#/room/${currentRoom}`;
  inspirationLink.href = `#/room/${currentRoom}/inspiration`;
  sourcesLink.toggleAttribute('aria-current', !inspirationActive);
  inspirationLink.toggleAttribute('aria-current', inspirationActive);
  (inspirationActive ? inspirationLink : sourcesLink).setAttribute('aria-current', 'page');
  $('.room-heading .add-images').hidden = inspirationActive;
  inspirationGallery?.setRoom(room || null, Boolean(room && inspirationActive));
  document.title = currentRoot ? `Design versions — ${room.name}` : currentRoom ? `${room.name} — Cicerostraße` : 'Floor plan — Cicerostraße';
  if (currentRoom) renderGallery();
  else clearGalleryURLs();
  if (currentRoot) renderCurrentDesign(true).catch(handleError);
  else designPage?.hide();
  window.scrollTo(0, 0);
  const heading = currentRoot ? $('#design-title') : currentRoom ? $('#room-title') : $('#floorplan .plan-room-label.hovered') || $('#floorplan');
  if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
}

function setPlanExpanded(expanded, restoreFocus = false) {
  planExpanded = Boolean(currentRoom && expanded);
  $('#plan-page').classList.toggle('is-room', Boolean(currentRoom));
  $('#plan-page').classList.toggle('is-expanded', planExpanded);
  $('#plan-toggle').hidden = !currentRoom;
  $('#plan-toggle').setAttribute('aria-expanded', String(planExpanded));
  $('#plan-toggle .visually-hidden').textContent = planExpanded ? 'Collapse floor plan' : 'Expand floor plan';
  $('#plan-navigation').hidden = Boolean(currentRoom && !planExpanded);
  $('#plan-home').hidden = !planExpanded;
  plan?.setVisible(!currentRoom || planExpanded);
  if (restoreFocus && currentRoom) $('#plan-toggle').focus({ preventScroll: true });
}

function selectPlanRoom(id) {
  if (id === currentRoom) setPlanExpanded(false, true);
  else location.hash = `/room/${id}`;
}

async function readImage(file) {
  validateImageFile(file);
  const bitmap = await createImageBitmap(file).catch(() => { throw new Error(`“${file.name}” could not be opened as an image.`); });
  try {
    const dimensions = { width: bitmap.width, height: bitmap.height };
    const scale = Math.min(1, 480 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const thumbnail = await new Promise((resolve) => canvas.toBlob(resolve, 'image/webp', .78));
    return { blob: file, thumbnail: thumbnail || undefined, filename: file.name, ...dimensions };
  } finally { bitmap.close(); }
}

async function uploadFiles(files, roomId) {
  if (!files.length || !roomById(roomId)) return;
  if (uploading) { toast('Please wait for the current upload to finish.'); return; }
  if (currentRoot) location.hash = `/room/${roomId}`;
  uploading = true;
  document.querySelectorAll('.add-images').forEach((button) => { button.disabled = true; });
  let added = 0;
  const failures = [];
  $('#upload-progress').hidden = false;
  $('#upload-progress-bar').max = files.length;
  $('#upload-progress-bar').value = 0;
  let processed = 0;
  try {
    for (const file of files) {
      $('#upload-progress-label').textContent = `Adding photo ${processed + 1} of ${files.length} to ${roomById(roomId).name}…`;
      try {
        const data = await readImage(file);
        await addImage({ ...data, roomId, title: file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ') });
        added++;
      } catch (error) { failures.push(error.name === 'QuotaExceededError' ? 'Device storage is full.' : `${file.name}: ${error.message}`); }
      $('#upload-progress-bar').value = ++processed;
    }
    await refreshData();
    if (failures.length) toast(`${added ? `${added} saved. ` : ''}${failures[0]}${failures.length > 1 ? ` (${failures.length} skipped)` : ''}`, true);
    else toast(`${added} ${added === 1 ? 'photo' : 'photos'} added to ${roomById(roomId).name}`);
  } catch (error) { handleError(error); }
  finally { uploading = false; $('#upload-progress').hidden = true; document.querySelectorAll('.add-images').forEach((button) => { button.disabled = false; }); }
}

function viewVersion(image) {
  photoViewer.open(image.id, currentRoot ? designPage.photos : images.filter((item) => designRoot(item) === designRoot(image)), roomById(image.roomId)?.name || 'Design');
}

function showDesign(image) {
  const roomId = currentRoom && groupDesigns(images, currentRoom).some((family) => family.rootId === designRoot(image)) ? currentRoom : image.roomId;
  const path = designPath(roomId, designRoot(image));
  if (location.hash === path) renderCurrentDesign(true).catch(handleError);
  else location.hash = path;
}

function refreshRoomNames() {
  for (const room of rooms) {
    $(`.room-links a[href="#/room/${room.id}"]`).textContent = room.name;
  }
  plan?.refreshNames();
  if (currentRoom) {
    renderGallery();
    document.title = currentRoot ? `Design versions — ${roomById(currentRoom).name}` : `${roomById(currentRoom).name} — Cicerostraße`;
    if (currentRoot) renderCurrentDesign().catch(handleError);
  }
  inspirationGallery?.refreshNames();
}

roomNameEditor = createRoomNameEditor($('#room-name-editor'), {
  getRoom: () => roomById(currentRoom), save: saveRoomName, escape, icon, refreshIcons,
  onSaved: (roomId, name) => { setRoomDisplayName(roomId, name); refreshRoomNames(); toast(`Room name saved: ${roomById(roomId).name}`); },
});

inspirationGallery = createInspirationGallery($('#inspiration-gallery'), { escape, icon, refreshIcons, readImage, notify: toast });

sourceDeleteDialog = createSourceDeleteDialog($('#source-delete-dialog'), {
  escape,
  removeSource: async (id) => {
    await deleteImage(id);
    await refreshData();
    if (currentRoot === id && !groupDesigns(images, currentRoom).some((family) => family.rootId === id)) location.hash = `/room/${currentRoom}`;
    toast('Source deleted');
  },
  removeFamily: async (rootId) => {
    await deleteDesignFamily(rootId);
    await refreshData();
    if (currentRoot === rootId) location.hash = `/room/${currentRoom}`;
    toast('Saved versions deleted');
  },
  removeVersion: async (id) => {
    await deleteImage(id);
    await refreshData();
    if (currentRoot && !groupDesigns(images, currentRoom).some((family) => family.rootId === currentRoot)) location.hash = `/room/${currentRoom}`;
    toast('Version deleted');
  },
  restoreFocus: () => {
    const target = currentRoot ? $('#design-title') : $('.room-heading .add-images');
    if (target) { if (currentRoot) target.tabIndex = -1; target.focus({ preventScroll: true }); }
  },
});

designPage = createDesignPage($('#design-page'), {
  escape, icon, refreshIcons, getRecord: getRestyleRecord,
  onView: (image, family) => photoViewer.open(image.id, family, roomById(currentRoom)?.name || 'Design'),
  onRestyle: (source) => restyleWizard.open([source], source.id, { lockSource: true }),
  onRefine: (version) => restyleWizard.open([version], version.id, { lockSource: true, flow: 'refine' }),
  onDelete: (source, versionCount) => sourceDeleteDialog.open(source, versionCount),
  onDeleteFamily: (family) => sourceDeleteDialog.openFamily(family),
  onDeleteVersion: (version) => sourceDeleteDialog.openVersion(version),
});

restyleWizard = createRestyleWizard($('#restyle-dialog'), {
  client: createRestyleClient(), escape, readImage, saveVersion: saveRestyleVersion,
  onSaved: async () => { await refreshData(); toast('New version saved'); },
  onView: showDesign, getPhotos: (roomId) => images.filter((item) => item.roomId === roomId),
});

photoViewer = createPhotoViewer($('#image-dialog'), {
  rooms, icon, escape, refreshIcons, readImage, handleError, notify: toast,
  updatePhoto: async (id, changes) => { await updateImage(id, changes); await refreshData(); },
  removePhoto: async (id) => { await deleteImage(id); await refreshData(); },
  onRestyle: (photo) => restyleWizard.open([photo], photo.id, { lockSource: true, flow: photo.restyleId ? 'refine' : 'restyle' }),
  onShowDesign: showDesign,
  onViewVersion: viewVersion,
  getVersions: async (photo) => ({
    record: photo.restyleId ? await getRestyleRecord(photo.restyleId) : null,
    related: images.filter((item) => (item.rootImageId || item.id) === (photo.rootImageId || photo.id)),
  }),
});

const lifecycle = new AbortController();
const events = { signal: lifecycle.signal };
$('#plan-toggle').addEventListener('click', () => setPlanExpanded(!planExpanded), events);
$('#plan-navigation').addEventListener('click', (event) => {
  const link = event.target.closest('[data-plan-room]');
  if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  event.preventDefault();
  selectPlanRoom(link.dataset.planRoom);
}, events);
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !planExpanded || event.defaultPrevented || document.querySelector('dialog[open]')) return;
  event.preventDefault();
  setPlanExpanded(false, true);
}, events);
document.addEventListener('click', (event) => {
  const deleteId = event.target.closest('[data-delete-source]')?.dataset.deleteSource;
  if (deleteId && currentRoom) {
    const family = groupDesigns(images, currentRoom).find((item) => item.source?.id === deleteId);
    if (family) sourceDeleteDialog.open(family.source, family.versions.length);
  }
  const familyId = event.target.closest('[data-delete-family]')?.dataset.deleteFamily;
  if (familyId && currentRoom) {
    const family = groupDesigns(images, currentRoom).find((item) => item.rootId === familyId && !item.source);
    if (family) sourceDeleteDialog.openFamily(family);
  }
  if (event.target.closest('.add-images') && currentRoom && !uploading) { uploadTarget = currentRoom; $('#image-upload').click(); }
  if (event.target.closest('#rename-room')) roomNameEditor.open();
  if (event.target.closest('#style-room') && currentRoom) roomLayoutWizard.open(roomById(currentRoom)).catch(handleError);
}, events);
$('#image-upload').addEventListener('change', (event) => { uploadFiles(Array.from(event.target.files), uploadTarget); event.target.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  if (currentRoom && !inspirationActive && !document.querySelector('dialog[open]')) $('#drop-overlay').hidden = false;
}, events);
window.addEventListener('dragover', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = currentRoom ? 'copy' : 'none';
}, events);
window.addEventListener('dragleave', () => { dragDepth = Math.max(0, dragDepth - 1); if (!dragDepth) $('#drop-overlay').hidden = true; }, events);
window.addEventListener('drop', (event) => {
  event.preventDefault();
  dragDepth = 0;
  $('#drop-overlay').hidden = true;
  if (!currentRoom) { toast('Open a room first to add images.'); return; }
  if (inspirationActive) { toast('Use Upload image or paste an image in Design inspiration.'); return; }
  if (document.querySelector('dialog[open]')) { toast('Close the viewer before adding more photos.'); return; }
  uploadFiles(Array.from(event.dataTransfer.files), currentRoom);
}, events);
window.addEventListener('hashchange', navigate, events);
window.addEventListener('beforeunload', (event) => { if (uploading || roomNameEditor?.busy || inspirationGallery?.busy || photoViewer?.busy || restyleWizard?.busy || restyleWizard?.unsaved || sourceDeleteDialog?.busy) { event.preventDefault(); event.returnValue = ''; } }, events);

try {
  plan = createFloorplan($('#floorplan'), selectPlanRoom);
} catch (error) {
  console.error(error);
  $('#floorplan').innerHTML = '<div class="plan-fallback"><img src="./original-floorplan.jpeg" alt="Original apartment floor plan"/><p>Select a room below to open its gallery.</p></div>';
  $('.room-links').classList.add('fallback-links');
}
const storageStartup = initializeStorage();
refreshIcons();
navigate();

async function bootstrapStorage() {
  const result = await storageStartup;
  if (disposed) return;
  if (result.error) handleError(result.error);
  await refreshData();
  const records = await listRoomNames();
  if (!disposed) { applyRoomNames(records); refreshRoomNames(); $('#rename-room').disabled = false; }
}
bootstrapStorage().catch((error) => { handleError(error); if (!disposed) $('#rename-room').disabled = false; });

const modelContext = document.modelContext || navigator.modelContext;
if (modelContext?.registerTool) {
  const toolDefinitions = [
    { name: 'list_apartment_rooms', description: 'List the apartment rooms and their saved image counts.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true }, execute: async () => ({ rooms: rooms.map(({ id, name }) => ({ id, name, imageCount: images.filter((image) => image.roomId === id).length })) }) },
    { name: 'open_apartment_room', description: 'Navigate to a room’s image gallery.', inputSchema: { type: 'object', properties: { roomId: { type: 'string', enum: rooms.map((room) => room.id) } }, required: ['roomId'], additionalProperties: false }, annotations: { readOnlyHint: false }, execute: async ({ roomId }) => { if (!roomById(roomId)) throw new Error('Unknown room'); location.hash = `/room/${roomId}`; navigate(); return { room: roomById(roomId).name }; } },
  ];
  for (const tool of toolDefinitions) {
    try { Promise.resolve(modelContext.registerTool(tool, events)).catch(console.error); }
    catch (error) { console.error(error); }
  }
}

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    disposed = true;
    lifecycle.abort();
    clearTimeout(toastTimer);
    plan?.dispose();
    clearGalleryURLs();
    photoViewer?.dispose();
    restyleWizard?.dispose();
    roomLayoutWizard.dispose();
    designPage?.dispose();
    sourceDeleteDialog?.dispose();
    inspirationGallery?.dispose();
    roomNameEditor?.dispose();
  });
}
