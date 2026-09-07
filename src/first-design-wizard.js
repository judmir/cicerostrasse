import { getAIMode, subscribeAIMode } from './ai-mode.js';
import { imagePayload, resultFile } from './restyle-client.js';
import { roomMeasurements, getRoomPlanMetrics } from './room-plan.js';
import { sourceSnapshot, validateImageFile } from './storage.js';
import { styleSummary } from './restyle-presenter.js';

const stageList = [
  ['analyzing', 'Analyzing room', 'Reading the selected room views and structured plan.'],
  ['rendering', 'Rendering design', 'Composing the design from the main viewpoint.'],
  ['reviewing', 'Reviewing layout', 'Checking the render against the canonical placements.'],
  ['saving', 'Saving', 'Adding the first design to this room.'],
];

const commonFurniture = [
  ['sofa', 'Sofa', 2.1, .9], ['armchair', 'Armchair', .85, .85], ['coffee_table', 'Coffee table', 1.1, .6],
  ['rug', 'Rug', 2.0, 1.5], ['media_console', 'Media console', 1.6, .45], ['dining_table', 'Dining table', 1.6, .9],
  ['bed', 'Bed', 2.0, 1.6], ['nightstand', 'Nightstand', .5, .45], ['wardrobe', 'Wardrobe', 1.8, .62], ['desk', 'Desk', 1.2, .6],
];
const furnitureByType = {
  Kitchen: [['base_cabinets', 'Base cabinets', 2.2, .62], ['tall_cabinet', 'Tall cabinet', .65, .65], ['kitchen_island', 'Kitchen island', 1.8, .9], ['dining_table', 'Dining table', 1.4, .8], ['stool', 'Stool', .45, .45]],
  Bathroom: [['vanity', 'Vanity', .9, .55], ['bathtub', 'Bathtub', 1.7, .75], ['shower', 'Shower', .9, .9], ['toilet', 'Toilet', .7, .45], ['cabinet', 'Storage cabinet', .6, .4]],
  Hallway: [['console', 'Console', 1.1, .35], ['bench', 'Bench', 1.1, .45], ['wardrobe', 'Wardrobe', 1.4, .62], ['mirror', 'Standing mirror', .65, .18]],
  'Outdoor space': [['outdoor_table', 'Outdoor table', 1.2, .8], ['outdoor_chair', 'Outdoor chair', .65, .65], ['planter', 'Planter', .45, .45], ['lounge_chair', 'Lounge chair', 1.55, .7]],
};

export function furnitureCatalog(room) { return furnitureByType[room?.type] || commonFurniture; }

function opening(kind, value) {
  if (!value) return null;
  return { kind, edge: value.edge, start: Math.min(value.start, value.end), end: Math.max(value.start, value.end), ...(kind === 'door' || kind === 'balcony_door' ? { hinge: value.reverse ? 'end' : 'start', swing: 'inward' } : {}) };
}

export function roomPlanConstraint(room) {
  const measured = roomMeasurements[room.id];
  if (!measured) return { source: 'relative_only', widthM: null, depthM: null, areaM2: null, openings: [], note: 'No verified room dimensions are stored.' };
  return {
    source: 'measured_plan', widthM: measured.width, depthM: measured.depth, areaM2: measured.area,
    openings: [opening('door', measured.door), opening('window', measured.window), measured.balconyDoor ? opening('balcony_door', { edge: 'bottom', start: .56, end: .74, reverse: true }) : null,
      ...(measured.hallway ? [[.09, .20], [.42, .51], [.68, .81]].map(([start, end]) => opening('door', { edge: 'bottom', start, end })) : []),
      ...(measured.hallway ? ['left', 'right'].map(edge => opening('passage', { edge, start: .4, end: 1 - 8 / getRoomPlanMetrics(room.id).drawDepth })) : []),
    ].filter(Boolean),
    note: `Dimensions from supplied drawing; openings are schematic. Placement x/y are normalized centers from top-left, x right, y down. Footprints are meters before rotation; front faces top at 0/360 degrees, clockwise as in SVG. Opening start/end run left-to-right on horizontal edges, top-to-bottom on vertical edges. ${measured.note || ''}${measured.balcony ? ' Outdoor balcony with railing along the bottom edge.' : ''}`,
  };
}

export function blankFirstDesignDraft(room) {
  return { roomId: room.id, step: 1, selectedSourceIds: [], viewpointSourceId: null, layout: { version: 1, placements: [] }, styleBrief: '', inspirationIds: [], plan: roomPlanConstraint(room) };
}

export function normalizeFirstDesignDraft(room, draft, sources = [], references = []) {
  const base = blankFirstDesignDraft(room);
  if (!draft || draft.roomId !== room.id) return base;
  const sourceIds = new Set(sources.map(item => item.id));
  const referenceIds = new Set(references.map(item => item.id));
  const selectedSourceIds = [...new Set(draft.selectedSourceIds || [])].filter(id => sourceIds.has(id));
  const placements = Array.isArray(draft.layout?.placements) ? draft.layout.placements.filter(item => item && typeof item.id === 'string').map(item => ({
    id: item.id, itemType: String(item.itemType || 'item').slice(0, 80), label: String(item.label || 'Item').slice(0, 120),
    x: Math.min(1, Math.max(0, Number(item.x) || 0)), y: Math.min(1, Math.max(0, Number(item.y) || 0)),
    widthM: Math.min(12, Math.max(.1, Number(item.widthM) || .5)), depthM: Math.min(12, Math.max(.1, Number(item.depthM) || .5)),
    rotationDeg: ((Number(item.rotationDeg) || 0) % 360 + 360) % 360,
  })) : [];
  return {
    ...base, ...draft, step: Math.min(3, Math.max(1, Number(draft.step) || 1)),
    selectedSourceIds, viewpointSourceId: selectedSourceIds.includes(draft.viewpointSourceId) ? draft.viewpointSourceId : selectedSourceIds[0] || null,
    layout: { version: 1, placements }, styleBrief: String(draft.styleBrief || '').slice(0, 1200),
    inspirationIds: [...new Set(draft.inspirationIds || [])].filter(id => referenceIds.has(id)), plan: roomPlanConstraint(room),
  };
}

export function firstDesignStepError(draft, step = draft.step) {
  if (step === 1 && !draft.selectedSourceIds.length) return 'Select at least one actual room photo.';
  if (step === 1 && !draft.viewpointSourceId) return 'Choose the main output viewpoint.';
  if (step === 1 && !draft.layout.placements.length) return 'Place at least one furniture or fixture item.';
  if (step === 2 && draft.styleBrief.trim().length < 3) return 'Add a short style brief.';
  return '';
}

export async function buildFirstDesignRequest({ room, draft, sources, references, requestId, mode }) {
  const error = firstDesignStepError(draft, 1) || firstDesignStepError(draft, 2);
  if (error) throw new Error(error);
  const selected = draft.selectedSourceIds.map(id => sources.find(source => source.id === id)).filter(Boolean);
  const selectedReferences = draft.inspirationIds.map(id => references.find(reference => reference.id === id)).filter(Boolean);
  if (selected.length !== draft.selectedSourceIds.length) throw new Error('A selected room photo is unavailable. Select the room photos again.');
  if (selected.length > 8) throw new Error('Choose up to 8 room photos.');
  return {
    requestId, mode, operation: 'first_design',
    room: { id: room.id, name: room.name, type: room.type, plan: roomPlanConstraint(room) },
    roomImages: await Promise.all(selected.map(async source => ({ id: source.id, title: source.title || source.filename || 'Room photo', role: source.id === draft.viewpointSourceId ? 'main_view' : 'context', image: await imagePayload(source.blob) }))),
    styleReferences: await Promise.all(selectedReferences.map(async reference => ({ id: reference.id, title: reference.title, image: await imagePayload(reference.blob) }))),
    layout: { ...draft.layout, placements: draft.layout.placements.map(item => ({ ...item, rotationDeg: item.rotationDeg % 360 })) },
    viewpoint: { sourceImageId: draft.viewpointSourceId, label: 'Use this room photo camera and framing for the output.' },
    styleBrief: draft.styleBrief.trim(),
  };
}

function reviewSummary(review, escape) {
  const labels = { matches_constraints: 'No layout differences detected', differences_detected: 'Layout differences detected', uncertain: 'Layout review uncertain', unchecked: 'Layout unchecked' };
  const status = review?.status || 'unchecked';
  return `<section class="first-design-review ${status !== 'matches_constraints' ? 'needs-review' : ''}"><strong>${labels[status]}</strong>${review?.message ? `<p>${escape(review.message)}</p>` : ''}${review?.findings?.length ? `<ul>${review.findings.map(item => `<li>${escape(item.description)}</li>`).join('')}</ul>` : ''}<p>Canonical placement data remains authoritative.</p></section>`;
}

export function createFirstDesignWizard(dialog, { client, escape, icon, refreshIcons, readImage, getDraft, saveDraft, clearDraft, saveDesign, loadSources, loadReferences, addRoomPhotos, addStyleReference, onSaved, onOpen, notify = () => {}, mockSaveDelayMs = 900 }) {
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  let room, sources = [], references = [], draft, selectedPlacementId = null, loading = false, config, error = '', controller, saving = false;
  let result, rendered, saved, opener, mode = getAIMode(), revision = 0, urls = [], persistQueue = Promise.resolve(), disposed = false;
  const busy = () => loading || Boolean(controller) || saving;
  const configured = () => mode === 'mock' ? config?.mockAvailable : config?.configured;
  const imageURL = blob => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
  const release = () => { urls.forEach(url => URL.revokeObjectURL(url)); urls = []; };
  const selectedPlacement = () => draft?.layout.placements.find(item => item.id === selectedPlacementId);
  const scheduleSave = () => {
    if (!draft || !room) return;
    const snapshot = structuredClone(draft);
    persistQueue = persistQueue.catch(() => {}).then(() => saveDraft(snapshot)).catch(() => { error ||= 'Draft changes could not be saved on this device.'; draw(); });
  };

  function sourcePicker() {
    if (!sources.length) return `<div class="first-design-empty"><p>Add actual room photos from several directions, then choose the output viewpoint.</p><button class="button secondary" data-action="upload-room">${icon('upload')} Add room photos</button></div>`;
    return `<div class="first-design-source-toolbar"><p>Select room photos</p><button class="button secondary" data-action="upload-room">${icon('plus')} Add photos</button></div><div class="first-design-photo-grid">${sources.map(source => {
      const selected = draft.selectedSourceIds.includes(source.id);
      const main = draft.viewpointSourceId === source.id;
      return `<article class="first-design-photo ${selected ? 'selected' : ''}"><button data-source-toggle="${escape(source.id)}" aria-pressed="${selected}" title="${selected ? 'Remove' : 'Use'} ${escape(source.title)}"><img src="${imageURL(source.thumbnail || source.blob)}" alt="${escape(source.title)}"/><span>${selected ? icon('check') : icon('plus')}</span></button><label><input type="radio" name="first-design-viewpoint" value="${escape(source.id)}" ${main ? 'checked' : ''} ${selected ? '' : 'disabled'}/> Main view</label></article>`;
    }).join('')}</div><p class="first-design-hint">Room photos provide architecture and spatial context. They are kept separate from style inspiration.</p>`;
  }

  function planBoard() {
    const plan = draft.plan;
    const width = plan.widthM || 4;
    const depth = plan.depthM || 4;
    const ratio = Math.min(1.6, Math.max(.58, width / depth));
    return `<div class="first-design-plan-wrap"><div class="first-design-plan-meta"><strong>${plan.source === 'measured_plan' ? `${width.toFixed(2)} × ${depth.toFixed(2)} m` : 'Relative layout'}</strong><span>${plan.source === 'measured_plan' ? 'From saved measured plan' : 'Exact dimensions unavailable'}</span></div><div class="first-design-plan" data-layout-board style="--room-ratio:${ratio}">${plan.openings.map(item => `<span class="first-design-opening ${item.kind}" data-edge="${item.edge}" style="--start:${item.start};--size:${item.end - item.start}" title="${item.kind.replace('_', ' ')}"></span>`).join('')}${draft.layout.placements.map((item, index) => {
      const w = Math.min(.8, item.widthM / width), h = Math.min(.8, item.depthM / depth);
      return `<button class="first-design-placement ${item.id === selectedPlacementId ? 'selected' : ''}" data-placement="${escape(item.id)}" style="--x:${item.x};--y:${item.y};--w:${w};--h:${h};--rotate:${item.rotationDeg}deg" aria-label="Edit ${escape(item.label)} at ${Math.round(item.x * 100)} percent across and ${Math.round(item.y * 100)} percent down"><span>${index + 1}</span><small>${escape(item.label)}</small></button>`;
    }).join('')}</div><p class="first-design-hint">Click the plan to move the selected item. Positions are stored proportionally; item footprints use meters.</p></div>`;
  }

  function placementEditor() {
    const item = selectedPlacement();
    const catalog = furnitureCatalog(room);
    return `<div class="first-design-catalog" aria-label="Furniture presets">${catalog.map(([type, label]) => `<button class="button secondary" data-add-item="${type}">${icon('plus')} ${escape(label)}</button>`).join('')}</div>${item ? `<div class="first-design-item-editor"><div><strong>${escape(item.label)}</strong><button class="text-button danger" data-action="remove-item">Remove</button></div><label>Across <input data-item-field="x" type="range" min="0" max="1" step=".01" value="${item.x}"/><output>${Math.round(item.x * 100)}%</output></label><label>Down <input data-item-field="y" type="range" min="0" max="1" step=".01" value="${item.y}"/><output>${Math.round(item.y * 100)}%</output></label><div class="first-design-size-fields"><label>Width <input data-item-field="widthM" type="number" min=".1" max="12" step=".05" value="${item.widthM}"/> m</label><label>Depth <input data-item-field="depthM" type="number" min=".1" max="12" step=".05" value="${item.depthM}"/> m</label><label>Orientation <select data-item-field="rotationDeg">${[0,45,90,135,180,225,270,315].map(value => `<option value="${value}" ${value === item.rotationDeg ? 'selected' : ''}>${value}°</option>`).join('')}</select></label></div></div>` : '<p class="first-design-hint">Add an item, then position, size, and orient it.</p>'}`;
  }

  function layoutStep() {
    return `<div class="first-design-layout-step"><section><h3>Actual room views</h3>${sourcePicker()}</section><section><h3>2D furniture layout</h3>${planBoard()}${placementEditor()}</section></div>`;
  }

  function styleStep() {
    return `<div class="first-design-style-step"><section><label for="first-design-brief">Style brief</label><textarea id="first-design-brief" maxlength="1200" rows="7" placeholder="Describe the mood, palette, materials, and practical needs…">${escape(draft.styleBrief)}</textarea><p class="first-design-hint">The measured plan and placement data stay fixed. This brief guides appearance and atmosphere.</p></section><section><div class="first-design-source-toolbar"><h3>Style references <span>optional</span></h3><button class="button secondary" data-action="upload-reference">${icon('plus')} Upload reference</button></div>${references.length ? `<div class="first-design-reference-grid">${references.map(reference => `<button data-reference="${escape(reference.id)}" aria-pressed="${draft.inspirationIds.includes(reference.id)}"><img src="${imageURL(reference.thumbnail || reference.blob)}" alt="${escape(reference.title)}"/><span>${escape(reference.title)}</span></button>`).join('')}</div>` : '<p class="first-design-empty-copy">No saved design inspiration yet. You can continue with the brief alone.</p>'}<p class="first-design-hint">References influence style only. Their room layout and furniture are ignored.</p></section></div>`;
  }

  function reviewStep() {
    const main = sources.find(source => source.id === draft.viewpointSourceId);
    return `<div class="first-design-summary"><section><h3>Main viewpoint</h3>${main ? `<img src="${imageURL(main.thumbnail || main.blob)}" alt="${escape(main.title)}"/><p>${escape(main.title)} · ${draft.selectedSourceIds.length} room ${draft.selectedSourceIds.length === 1 ? 'view' : 'views'}</p>` : ''}</section><section><h3>Layout</h3><p>${draft.layout.placements.length} placed ${draft.layout.placements.length === 1 ? 'item' : 'items'} · ${draft.plan.source === 'measured_plan' ? `${draft.plan.widthM.toFixed(2)} × ${draft.plan.depthM.toFixed(2)} m` : 'relative scale'}</p><ol>${draft.layout.placements.map(item => `<li>${escape(item.label)} · ${item.widthM.toFixed(2)} × ${item.depthM.toFixed(2)} m · ${item.rotationDeg}°</li>`).join('')}</ol></section><section><h3>Style</h3><p>${escape(draft.styleBrief)}</p><span>${draft.inspirationIds.length} selected style ${draft.inspirationIds.length === 1 ? 'reference' : 'references'}</span></section></div>`;
  }

  function progressView() {
    const main = sources.find(source => source.id === draft.viewpointSourceId);
    const active = Math.max(0, stageList.findIndex(([id]) => id === (saving ? 'saving' : result ? 'saving' : dialog.dataset.stage || 'analyzing')));
    return `<div class="first-design-generation"><div class="first-design-generation-placeholder">${main ? `<img src="${imageURL(main.thumbnail || main.blob)}" alt=""/>` : ''}<div aria-hidden="true"><i></i><i></i><i></i></div><span>${mode === 'mock' ? 'Mock preview' : 'AI design generation'}</span></div><p class="first-design-stage-description">${stageList[active][2]}</p><ol class="restyle-progress" aria-label="First design progress">${stageList.map(([id, label], index) => `<li data-state="${index < active ? 'complete' : index === active ? 'active' : 'pending'}" ${index === active ? 'aria-current="step"' : ''}><span class="restyle-step-indicator" aria-hidden="true"></span><span class="restyle-step-label">${label}</span><span class="restyle-step-state">${index < active ? 'Done' : index === active ? 'In progress' : 'Waiting'}</span></li>`).join('')}</ol><p class="restyle-live" role="status" aria-live="polite">${stageList[active][1]}…</p></div>`;
  }

  function resultView() {
    const main = sources.find(source => source.id === draft.viewpointSourceId);
    const output = rendered?.blob || resultFile(result);
    return `<p class="restyle-mock-note" ${result.mode === 'mock' ? '' : 'hidden'}>Mock preview · Local image adjustment. No AI generation or layout review.</p><div class="restyle-comparison"><figure><figcaption>Actual room · main viewpoint</figcaption><div class="restyle-preview"><img src="${imageURL(main.blob)}" alt="Actual room main viewpoint"/></div></figure><figure><figcaption>${result.mode === 'mock' ? 'Mock first design' : 'First design'}</figcaption><div class="restyle-preview"><img src="${imageURL(output)}" alt="Generated first design"/></div></figure></div>${styleSummary(result.designSpec.style, escape)}${reviewSummary(result.layoutReview, escape)}`;
  }

  function draw() {
    if (disposed || !dialog.open) return;
    release();
    const generating = Boolean(controller) || saving;
    const stepError = draft ? firstDesignStepError(draft) : '';
    const primaryDisabled = busy() || !configured() || Boolean(stepError);
    const title = loading ? 'Loading first design…' : generating ? 'Creating first design' : result ? result.designSpec.conceptName : 'Create first design';
    dialog.innerHTML = `<div class="first-design-shell"><header class="restyle-heading"><div><span class="first-design-eyebrow">${room ? escape(room.name) : 'Room'} · First design</span><h2 id="first-design-title">${escape(title)}</h2></div><button class="icon-button" data-action="close" aria-label="Close first design" ${saving ? 'disabled' : ''}>${icon('x')}</button></header>${!loading && !generating && !result ? `<ol class="first-design-steps" aria-label="First design steps">${['Layout','Style','Generate'].map((label, index) => `<li ${draft.step === index + 1 ? 'aria-current="step"' : ''}><button data-go-step="${index + 1}" ${index + 1 > draft.step ? 'disabled' : ''}><span>${index + 1}</span>${label}</button></li>`).join('')}</ol>` : ''}${loading ? '<p role="status">Loading saved draft…</p>' : generating ? progressView() : result ? resultView() : draft.step === 1 ? layoutStep() : draft.step === 2 ? styleStep() : reviewStep()}${config && !configured() ? `<div class="restyle-setup" role="status">${config.unavailable ? 'Generation needs the local app backend. Open the app with npm run dev or npm start.' : mode === 'mock' ? 'Restart the local app to enable Mock mode.' : 'Add OPENAI_API_KEY to .env.local to enable Real AI.'}<button class="text-button" data-action="recheck">Check again</button></div>` : ''}${error ? `<p class="restyle-error" role="alert">${escape(error)}</p>` : ''}<footer class="restyle-footer">${generating ? `<button class="button secondary" data-action="cancel" ${saving ? 'disabled' : ''}>${saving ? 'Saving…' : 'Cancel generation'}</button>` : result ? `<button class="button secondary" data-action="download">${icon('download')} Download</button>${saved ? `<button class="button primary" data-action="open-design">Open design</button>` : `<button class="button primary" data-action="retry-save">Retry save</button>`}` : draft ? `<button class="button secondary" data-action="${draft.step === 1 ? 'close' : 'back'}">${draft.step === 1 ? 'Cancel' : 'Back'}</button><button class="button primary" data-action="${draft.step === 3 ? 'generate' : 'next'}" ${primaryDisabled ? 'disabled' : ''}>${draft.step === 3 ? (mode === 'mock' ? 'Generate mock preview' : 'Generate first design') : 'Continue'}</button>` : ''}</footer><input type="file" data-room-upload accept="image/jpeg,image/png,image/webp,image/gif,image/avif" multiple hidden/><input type="file" data-reference-upload accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden/></div>`;
    refreshIcons();
  }

  async function checkConfig() {
    try { config = await client.status(); } catch { config = { configured: false, unavailable: true }; }
    draw();
  }

  async function reloadAssets({ selectSources = [], selectReference = null } = {}) {
    [sources, references] = await Promise.all([loadSources(room.id), loadReferences(room.id)]);
    draft = normalizeFirstDesignDraft(room, draft, sources, references);
    for (const id of selectSources) if (!draft.selectedSourceIds.includes(id)) draft.selectedSourceIds.push(id);
    if (!draft.viewpointSourceId && draft.selectedSourceIds.length) draft.viewpointSourceId = draft.selectedSourceIds[0];
    if (selectReference && !draft.inspirationIds.includes(selectReference)) draft.inspirationIds.push(selectReference);
    scheduleSave(); draw();
  }

  async function saveResult() {
    if (!result || saving || saved) return;
    saving = true; dialog.dataset.stage = 'saving'; error = ''; draw();
    try {
      if (result.mode === 'mock') await new Promise(resolve => setTimeout(resolve, mockSaveDelayMs));
      rendered ||= await readImage(resultFile(result));
      saved = await saveDesign({ roomId: room.id, draft: { ...draft, viewpoint: { sourceImageId: draft.viewpointSourceId, label: 'Selected room photo camera and framing' } }, sources, references, result, rendered });
      await clearDraft(room.id);
      await onSaved(saved);
    } catch (failure) {
      error = failure.name === 'QuotaExceededError' ? 'Device storage is full. Retry save or download the generated image.' : failure.message || 'Could not save this first design. Retry save or download it.';
    } finally { saving = false; draw(); }
  }

  async function generate() {
    if (busy() || result || !configured()) return;
    const failure = firstDesignStepError(draft, 1) || firstDesignStepError(draft, 2);
    if (failure) { error = failure; draw(); return; }
    controller = new AbortController();
    const operation = controller;
    dialog.dataset.stage = 'analyzing'; error = ''; draw();
    try {
      const input = await buildFirstDesignRequest({ room, draft, sources, references, requestId: crypto.randomUUID(), mode });
      const completed = await client.run(input, { signal: operation.signal, onProgress(stage) { dialog.dataset.stage = stage; draw(); } });
      operation.signal.throwIfAborted();
      if (mode === 'mock' && completed.mode !== 'mock') throw new Error('The backend did not return a Mock preview. Restart the local app and try again.');
      result = completed; controller = null; await saveResult();
    } catch (failure) {
      error = operation.signal.aborted || failure.code === 'cancelled' ? 'Generation cancelled. Your draft and selected images are ready to try again.' : failure.message || 'Could not create this first design.';
    } finally { if (controller === operation) controller = null; draw(); }
  }

  async function open(nextRoom) {
    if (busy()) return;
    opener = document.activeElement; room = nextRoom; loading = true; error = ''; result = rendered = saved = null; selectedPlacementId = null; revision++;
    if (!dialog.open) dialog.showModal();
    draw();
    const token = revision;
    try {
      [sources, references] = await Promise.all([loadSources(room.id), loadReferences(room.id)]);
      const stored = await getDraft(room.id);
      if (token !== revision) return;
      draft = normalizeFirstDesignDraft(room, stored, sources, references);
      selectedPlacementId = draft.layout.placements[0]?.id || null;
    } catch (failure) { if (token === revision) { draft = blankFirstDesignDraft(room); error = failure.message || 'Could not load the saved draft.'; } }
    finally { if (token === revision) { loading = false; mode = getAIMode(); draw(); checkConfig(); } }
  }

  dialog.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close' && !saving) { controller?.abort(); dialog.close(); return; }
    if (action === 'cancel') { controller?.abort(); return; }
    if (action === 'recheck') { checkConfig(); return; }
    if (busy()) return;
    const step = Number(event.target.closest('[data-go-step]')?.dataset.goStep);
    if (step && step <= draft.step) { draft.step = step; error = ''; scheduleSave(); draw(); return; }
    const sourceId = event.target.closest('[data-source-toggle]')?.dataset.sourceToggle;
    if (sourceId) {
      const selected = draft.selectedSourceIds.includes(sourceId);
      draft.selectedSourceIds = selected ? draft.selectedSourceIds.filter(id => id !== sourceId) : [...draft.selectedSourceIds, sourceId];
      if (draft.viewpointSourceId === sourceId && selected) draft.viewpointSourceId = draft.selectedSourceIds[0] || null;
      if (!draft.viewpointSourceId && !selected) draft.viewpointSourceId = sourceId;
      error = ''; scheduleSave(); draw(); return;
    }
    const addType = event.target.closest('[data-add-item]')?.dataset.addItem;
    if (addType) {
      const preset = furnitureCatalog(room).find(([type]) => type === addType);
      const item = { id: crypto.randomUUID(), itemType: preset[0], label: preset[1], x: .5, y: .5, widthM: preset[2], depthM: preset[3], rotationDeg: 0 };
      draft.layout.placements.push(item); selectedPlacementId = item.id; error = ''; scheduleSave(); draw(); return;
    }
    const placementId = event.target.closest('[data-placement]')?.dataset.placement;
    if (placementId) { selectedPlacementId = placementId; draw(); return; }
    const referenceId = event.target.closest('[data-reference]')?.dataset.reference;
    if (referenceId) { draft.inspirationIds = draft.inspirationIds.includes(referenceId) ? draft.inspirationIds.filter(id => id !== referenceId) : [...draft.inspirationIds, referenceId]; scheduleSave(); draw(); return; }
    if (action === 'remove-item' && selectedPlacementId) { draft.layout.placements = draft.layout.placements.filter(item => item.id !== selectedPlacementId); selectedPlacementId = draft.layout.placements[0]?.id || null; scheduleSave(); draw(); }
    if (action === 'upload-room') dialog.querySelector('[data-room-upload]').click();
    if (action === 'upload-reference') dialog.querySelector('[data-reference-upload]').click();
    if (action === 'back') { draft.step--; error = ''; scheduleSave(); draw(); }
    if (action === 'next') { const failure = firstDesignStepError(draft); if (failure) { error = failure; draw(); } else { draft.step++; error = ''; scheduleSave(); draw(); } }
    if (action === 'generate') generate();
    if (action === 'retry-save') saveResult();
    if (action === 'download' && result) { const url = URL.createObjectURL(rendered?.blob || resultFile(result)); const link = document.createElement('a'); link.href = url; link.download = `${result.mode === 'mock' ? 'mock-' : ''}first-design-${result.requestId}.png`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
    if (action === 'open-design' && saved) { dialog.close(); onOpen(saved); }
  }, events);

  dialog.addEventListener('change', async event => {
    if (busy()) return;
    if (event.target.name === 'first-design-viewpoint') { draft.viewpointSourceId = event.target.value; scheduleSave(); draw(); return; }
    if (event.target.matches('[data-room-upload]') && event.target.files.length) {
      loading = true; draw();
      try { const added = await addRoomPhotos(Array.from(event.target.files), room.id); await reloadAssets({ selectSources: added.map(item => item.id) }); notify(`${added.length} room ${added.length === 1 ? 'photo' : 'photos'} added`); }
      catch (failure) { error = failure.message || 'Could not add room photos.'; }
      finally { loading = false; draw(); }
    }
    if (event.target.matches('[data-reference-upload]') && event.target.files[0]) {
      loading = true; draw();
      try { validateImageFile(event.target.files[0]); const reference = await addStyleReference(event.target.files[0], room.id); await reloadAssets({ selectReference: reference.id }); notify('Style reference saved'); }
      catch (failure) { error = failure.message || 'Could not add the style reference.'; }
      finally { loading = false; draw(); }
    }
    if (event.target.matches('[data-item-field]')) {
      const item = selectedPlacement(); if (!item) return;
      const field = event.target.dataset.itemField; item[field] = Number(event.target.value); scheduleSave(); draw();
    }
  }, events);
  dialog.addEventListener('input', event => {
    if (event.target.id === 'first-design-brief') { draft.styleBrief = event.target.value; scheduleSave(); const button = dialog.querySelector('[data-action="next"]'); if (button) button.disabled = Boolean(firstDesignStepError(draft)); }
    if (event.target.matches('[data-item-field][type="range"]')) {
      const item = selectedPlacement(); if (!item) return; item[event.target.dataset.itemField] = Number(event.target.value); event.target.nextElementSibling.textContent = `${Math.round(Number(event.target.value) * 100)}%`; scheduleSave();
    }
  }, events);
  dialog.addEventListener('pointerdown', event => {
    const board = event.target.closest('[data-layout-board]');
    if (!board || event.target.closest('[data-placement]') || !selectedPlacement()) return;
    const rect = board.getBoundingClientRect();
    selectedPlacement().x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
    selectedPlacement().y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
    scheduleSave(); draw();
  }, events);
  dialog.addEventListener('cancel', event => { if (saving) event.preventDefault(); else controller?.abort(); }, events);
  dialog.addEventListener('close', () => { release(); opener?.isConnected && opener.focus({ preventScroll: true }); }, events);
  const unsubscribe = subscribeAIMode(next => { if (controller || saving) return; mode = next; config = null; draw(); if (dialog.open) checkConfig(); });

  return { open, get busy() { return busy(); }, get unsaved() { return Boolean(result && !saved); }, dispose() { disposed = true; revision++; controller?.abort(); lifecycle.abort(); unsubscribe(); release(); dialog.close(); } };
}
