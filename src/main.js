import { createIcons, ArrowLeft, Plus, X, Upload, ImagePlus, Trash2, Download, RefreshCw, Check, Pencil, LayoutDashboard, PanelLeftClose, PanelLeftOpen, ArrowUpRight, ChevronLeft, ChevronRight, Ellipsis } from 'lucide';
import { rooms, roomById } from './rooms.js';
import { createFloorplan } from './floorplan.js';
import { renderRoomPlan } from './room-plan.js';
import { createPhotoViewer } from './photo-viewer.js';
import { listImages, addImage, updateImage, deleteImage, validateImageFile } from './storage.js';
import './style.css';
import './album.css';

const icons = { ArrowLeft, Plus, X, Upload, ImagePlus, Trash2, Download, RefreshCw, Check, Pencil, LayoutDashboard, PanelLeftClose, PanelLeftOpen, ArrowUpRight, ChevronLeft, ChevronRight, Ellipsis };
const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
const $ = (selector) => document.querySelector(selector);
const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]);
const refreshIcons = () => createIcons({ icons, attrs: { 'stroke-width': 1.6 } });
let currentRoom = null;
let images = [];
let plan;
let galleryURLs = [];
let photoViewer;
let uploadTarget;
let uploading = false;
let toastTimer;
let disposed = false;
let planCollapsed = false;
try { planCollapsed = localStorage.getItem('cicero-room-plan-collapsed') === 'true'; } catch { /* Use the open default if preferences are unavailable. */ }

$('#app').innerHTML = `
  <header class="site-header"><a class="wordmark" href="#/">${icon('layout-dashboard')} Cicerostraße</a><span class="header-caption">My apartment</span></header>
  <main>
    <section id="plan-page" class="plan-page" aria-label="Apartment floor plan">
      <div class="plan-intro"><h1>Floor plan</h1><p>Select a room.</p></div>
      <div class="apartment-plan-viewport"><div id="floorplan"></div></div>
      <nav class="room-links" aria-label="Open a room gallery">${rooms.map((room) => `<a href="#/room/${room.id}">${room.name}</a>`).join('')}</nav>
      <p class="plan-footnote">Dimensions from your measured plan · Layout schematic</p>
    </section>
    <section id="room-page" class="room-page" hidden aria-labelledby="room-title">
      <div class="room-navigation"><a href="#/" class="back-link">${icon('arrow-left')} Floor plan</a><button id="show-room-plan" class="text-button" aria-controls="room-plan-sidebar" aria-expanded="false" hidden>${icon('panel-left-open')} Room plan</button></div>
      <div class="room-layout">
        <aside id="room-plan-sidebar" class="room-plan-sidebar" aria-label="Room floor plan and dimensions"><div class="room-plan-heading"><h2>Room plan</h2><button id="hide-room-plan" class="icon-button" aria-label="Collapse room plan" aria-controls="room-plan-sidebar" aria-expanded="true">${icon('panel-left-close')}</button></div><div id="room-plan-content"></div><button id="view-measured-plan" class="text-button">View full plan ${icon('arrow-up-right')}</button></aside>
        <div class="room-gallery-content"><div class="room-heading"><div><h1 id="room-title"></h1><p id="room-meta"></p></div><button class="button primary add-images">${icon('plus')} Add images</button></div>
            <div id="upload-progress" class="upload-progress" role="status" aria-live="polite" hidden><span id="upload-progress-label"></span><progress id="upload-progress-bar" aria-label="Photo upload progress" value="0" max="1"></progress></div>
          <div id="gallery" aria-label="Room image gallery"></div>
          <p class="gallery-footnote" hidden>Drop more images anywhere on this page.</p>
        </div>
      </div>
    </section>
  </main>
  <footer class="site-footer"><span>Saved on this device</span></footer>
  <input id="image-upload" type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden />
  <dialog id="image-dialog" class="album-viewer" aria-labelledby="image-dialog-title"></dialog>
  <dialog id="measured-plan-dialog" class="measured-plan-dialog" aria-labelledby="measured-plan-title"><div class="dialog-heading"><h2 id="measured-plan-title">Full floor plan</h2><button class="icon-button close-measured-plan" aria-label="Close full floor plan">${icon('x')}</button></div><div class="measured-reference-window"><img src="./measured-floorplan.jpeg" alt="Supplied measured apartment drawing. Küche 2.17 by 4.06 meters, Bad 1.46 by 4.06, middle room 2.93 by 4.06, right room 3.45 by 5.85, left room 4.52 by 4.67, Flur 6.72 by 1.71, and balcony 4.40 by 1.37."/></div><p>Room names in this drawing differ from the first plan. Your galleries keep their original room assignments.</p></dialog>
  <div id="drop-overlay" hidden>${icon('upload')}<span>Drop images to add them to <strong id="drop-room"></strong></span></div>
  <div id="toast" class="toast" role="status" aria-live="polite" hidden></div>
`;

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
  const roomImages = images.filter((item) => item.roomId === currentRoom);
  clearGalleryURLs();
  $('#room-title').textContent = room.name;
  $('#room-meta').textContent = `${room.type} · ${roomImages.length} ${roomImages.length === 1 ? 'image' : 'images'}`;
  $('#drop-room').textContent = room.name;
  $('.gallery-footnote').hidden = !roomImages.length;
  if (!roomImages.length) {
    $('#gallery').innerHTML = `<div class="empty-gallery">${icon('image-plus')}<h2>Drop images here</h2><button class="text-button add-images">or choose files</button><p>JPG, PNG, WebP, GIF, AVIF · up to 25 MB each</p></div>`;
  } else {
    $('#gallery').innerHTML = `<div class="gallery-grid">${roomImages.map((item) => {
      const url = URL.createObjectURL(item.thumbnail || item.blob);
      galleryURLs.push(url);
      return `<button class="image-card" data-image="${item.id}" aria-label="Open ${escape(item.title)}"><div class="image-card-photo"><img src="${url}" alt="${escape(item.title)}" loading="lazy" decoding="async"/></div></button>`;
    }).join('')}</div>`;
  }
  document.querySelectorAll('.add-images').forEach((button) => { button.disabled = uploading; });
  refreshIcons();
}

async function refreshData() {
  const savedImages = await listImages();
  if (disposed) return;
  images = savedImages;
  plan?.setCounts(Object.fromEntries(rooms.map((room) => [room.id, images.filter((item) => item.roomId === room.id).length])));
  renderGallery();
  photoViewer?.setPhotos(images.filter((item) => item.roomId === currentRoom));
}

function navigate() {
  const match = location.hash.match(/^#\/room\/([a-z0-9]+)$/);
  const room = match && roomById(match[1]);
  currentRoom = room?.id || null;
  $('#image-dialog').close();
  $('#measured-plan-dialog').close();
  $('#drop-overlay').hidden = true;
  $('#plan-page').hidden = !!currentRoom;
  $('#room-page').hidden = !currentRoom;
  document.title = currentRoom ? `${room.name} — Cicerostraße` : 'Floor plan — Cicerostraße';
  plan?.setVisible(!currentRoom);
  if (currentRoom) { renderGallery(); $('#room-plan-content').innerHTML = renderRoomPlan(room); applySidebarState(); }
  else { clearGalleryURLs(); plan?.resize(); }
  window.scrollTo(0, 0);
  const heading = currentRoom ? $('#room-title') : $('.plan-intro h1');
  heading.tabIndex = -1;
  heading.focus({ preventScroll: true });
}

function applySidebarState() {
  $('.room-layout').classList.toggle('plan-collapsed', planCollapsed);
  $('#room-plan-sidebar').hidden = planCollapsed;
  $('#show-room-plan').hidden = !planCollapsed;
  $('#show-room-plan').setAttribute('aria-expanded', String(!planCollapsed));
  $('#hide-room-plan').setAttribute('aria-expanded', String(!planCollapsed));
}

function toggleRoomPlan(collapsed) {
  planCollapsed = collapsed;
  applySidebarState();
  try { localStorage.setItem('cicero-room-plan-collapsed', String(collapsed)); } catch { /* Layout still works without preference storage. */ }
  $(collapsed ? '#show-room-plan' : '#hide-room-plan').focus();
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

photoViewer = createPhotoViewer($('#image-dialog'), {
  rooms, icon, escape, refreshIcons, readImage, handleError, notify: toast,
  updatePhoto: async (id, changes) => { await updateImage(id, changes); await refreshData(); },
  removePhoto: async (id) => { await deleteImage(id); await refreshData(); },
});

const lifecycle = new AbortController();
const events = { signal: lifecycle.signal };
document.addEventListener('click', (event) => {
  if (event.target.closest('.add-images') && currentRoom && !uploading) { uploadTarget = currentRoom; $('#image-upload').click(); }
  const imageButton = event.target.closest('[data-image]');
  if (imageButton) photoViewer.open(imageButton.dataset.image, images.filter((item) => item.roomId === currentRoom), roomById(currentRoom)?.name || 'Photos');
  if (event.target.closest('#hide-room-plan')) toggleRoomPlan(true);
  if (event.target.closest('#show-room-plan')) toggleRoomPlan(false);
  if (event.target.closest('#view-measured-plan')) $('#measured-plan-dialog').showModal();
  if (event.target.closest('.close-measured-plan')) $('#measured-plan-dialog').close();
}, events);
$('#image-upload').addEventListener('change', (event) => { uploadFiles(Array.from(event.target.files), uploadTarget); event.target.value = ''; });
let dragDepth = 0;
window.addEventListener('dragenter', (event) => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  dragDepth++;
  if (currentRoom && !document.querySelector('dialog[open]')) $('#drop-overlay').hidden = false;
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
  if (document.querySelector('dialog[open]')) { toast('Close the viewer before adding more photos.'); return; }
  uploadFiles(Array.from(event.dataTransfer.files), currentRoom);
}, events);
window.addEventListener('hashchange', navigate, events);
window.addEventListener('beforeunload', (event) => { if (uploading || photoViewer?.busy) { event.preventDefault(); event.returnValue = ''; } }, events);

try {
  plan = createFloorplan($('#floorplan'), (id) => { location.hash = `/room/${id}`; });
} catch (error) {
  console.error(error);
  $('#floorplan').innerHTML = '<div class="plan-fallback"><img src="./original-floorplan.jpeg" alt="Original apartment floor plan"/><p>Select a room below to open its gallery.</p></div>';
  $('.room-links').classList.add('fallback-links');
}
refreshIcons();
navigate();
refreshData().catch(handleError);

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
  });
}
