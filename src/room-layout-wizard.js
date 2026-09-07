import './room-layout-wizard.css';
import { roomMeasurements, renderRoomPlan } from './room-plan.js';
import { validateImageFile } from './storage.js';
import { buildFirstDesignRequest, roomPlanConstraint } from './first-design-wizard.js';
import { resultFile } from './restyle-client.js';
import { getAIMode, setAIMode, subscribeAIMode } from './ai-mode.js';

const rotations = [90, 180, 270, 360];

export const roomLayoutCatalog = [
  { id: 'bedroom', label: 'Bedroom', items: [['bed', 'Bed', 1.6, 2], ['nightstand', 'Nightstand', .5, .45], ['wardrobe', 'Wardrobe', 1.8, .62], ['dresser', 'Dresser', 1.2, .45]] },
  { id: 'kids', label: "Kids' room", items: [['single_bed', 'Single bed', .9, 2], ['bunk_bed', 'Bunk bed', 1, 2.1], ['crib', 'Crib', .7, 1.4], ['kids_desk', 'Kids desk', 1, .5], ['toy_storage', 'Toy storage', .8, .4]] },
  { id: 'kitchen', label: 'Kitchen', items: [['base_cabinets', 'Base cabinets', 2.2, .62], ['tall_cabinet', 'Tall cabinet', .65, .65], ['kitchen_island', 'Kitchen island', 1.8, .9], ['stool', 'Stool', .45, .45], ['fridge', 'Fridge', .6, .65]] },
  { id: 'living', label: 'Living room', items: [['sofa', 'Sofa', 2.1, .9], ['armchair', 'Armchair', .85, .85], ['coffee_table', 'Coffee table', 1.1, .6], ['wall_mounted_tv', 'Wall-mounted TV', 1.2, .1], ['tv_console', 'TV console', 1.6, .45], ['rug', 'Rug', 2, 1.5]] },
  { id: 'dining', label: 'Dining room', items: [['dining_table', 'Dining table', 1.6, .9], ['dining_chair', 'Dining chair', .5, .55], ['sideboard', 'Sideboard', 1.5, .45]] },
  { id: 'bathroom', label: 'Bathroom', items: [['vanity', 'Vanity', .9, .55], ['bathtub', 'Bathtub', .75, 1.7], ['shower', 'Shower', .9, .9], ['toilet', 'Toilet', .45, .7], ['cabinet', 'Storage cabinet', .6, .4]] },
  { id: 'office', label: 'Office', items: [['desk', 'Desk', 1.2, .6], ['office_chair', 'Office chair', .65, .65], ['bookcase', 'Bookcase', 1, .35], ['filing_cabinet', 'Filing cabinet', .45, .6]] },
  { id: 'hallway', label: 'Hallway', items: [['console', 'Console', 1.1, .35], ['bench', 'Bench', 1.1, .45], ['shoe_cabinet', 'Shoe cabinet', .8, .3], ['coat_rack', 'Coat rack', .5, .5]] },
  { id: 'outdoor', label: 'Outdoor', items: [['outdoor_table', 'Outdoor table', 1.2, .8], ['outdoor_chair', 'Outdoor chair', .65, .65], ['planter', 'Planter', .45, .45], ['lounge_chair', 'Lounge chair', .7, 1.55]] },
];
const presets = roomLayoutCatalog.flatMap(category => category.items);

const finite = (value, fallback) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function containPlacement(item, width, depth) {
  const rotationDeg = ((finite(item.rotationDeg, 0) % 360) + 360) % 360 || 360;
  const angle = (rotationDeg % 360) * Math.PI / 180;
  const cos = Math.abs(Math.cos(angle)), sin = Math.abs(Math.sin(angle));
  let widthM = clamp(finite(item.widthM, .5), .1, 12);
  let depthM = clamp(finite(item.depthM, .5), .1, 12);
  // The rotated bounding box must fit, not merely the unrotated footprint.
  const scale = Math.min(1, width / (cos * widthM + sin * depthM), depth / (sin * widthM + cos * depthM));
  widthM *= scale; depthM *= scale;
  const halfX = (cos * widthM + sin * depthM) / (2 * width);
  const halfY = (sin * widthM + cos * depthM) / (2 * depth);
  return { ...item, widthM, depthM, rotationDeg, x: clamp(finite(item.x, .5), halfX, 1 - halfX), y: clamp(finite(item.y, .5), halfY, 1 - halfY) };
}

export function normalizeRoomLayout(layout, width, depth) {
  if (layout && layout.version !== 1) throw new Error('This layout version is not supported. Its saved data has not been changed.');
  if (layout && !Array.isArray(layout.placements)) throw new Error('The saved layout could not be read. Its saved data has not been changed.');
  if ((layout?.placements.length || 0) > 40) throw new Error('This draft exceeds the 40-item limit. Its saved data has not been changed.');
  const ids = new Set();
  return { version: 1, placements: (layout?.placements || []).map(item => {
    if (!item || typeof item.id !== 'string' || !item.id || ids.has(item.id)) throw new Error('The saved layout contains invalid items. Its saved data has not been changed.');
    ids.add(item.id);
    return containPlacement({ id: item.id, itemType: String(item.itemType || 'item').slice(0, 80), label: String(item.label || 'Item').slice(0, 120), x: item.x, y: item.y, widthM: item.widthM, depthM: item.depthM, rotationDeg: item.rotationDeg }, width, depth);
  }) };
}

/** getDraft(roomId) and saveDraft(wholeDraft) may be synchronous or asynchronous. */
export function createRoomLayoutWizard(dialog, { escape, getDraft, saveDraft, listImages = async () => [], readImage, client, saveDesign, onSaved = async () => {}, onOpen = () => {} }) {
  const win = dialog.ownerDocument.defaultView;
  const lifecycle = new win.AbortController();
  const events = { signal: lifecycle.signal };
  let room, measurement, draft, selected, baseline, opener, gesture;
  let loading = false, saving = false, disposed = false, revision = 0, error = '';
  let step = 1, sources = [], reading = false, readRevision = 0, referenceRevision = 0;
  const urls = new Map();
  const expandedCategories = new Set(['living']);
  let catalogExpanded = true;
  let controller, result, resultBlob, rendered, saved, generationDraft, references = [], stage = '', mode = getAIMode(), config;
  const busy = () => Boolean(controller) || saving;
  const configured = () => mode === 'mock' ? config?.mockAvailable : config?.configured;
  const stages = { preparing: 'Preparing room photos and layout', analyzing: 'Analyzing room and style', rendering: 'Generating image', reviewing: 'Reviewing layout', processing: 'Preparing image preview', saving: 'Saving design' };
  const titles = ['Room layout', 'Room photos', 'Instructions'];
  const snapshot = () => JSON.stringify({ layout: draft.layout, selectedSourceIds: draft.selectedSourceIds, viewpointSourceId: draft.viewpointSourceId, styleBrief: draft.styleBrief, step, referenceRevision });
  const releaseURLs = () => { for (const url of urls.values()) win.URL.revokeObjectURL(url); urls.clear(); };
  const imageURL = blob => { if (!blob) return ''; if (!urls.has(blob)) urls.set(blob, win.URL.createObjectURL(blob)); return urls.get(blob); };
  const width = () => measurement?.width || 4;
  const depth = () => measurement?.depth || 4;
  const dirty = () => draft && (busy() || (result && !saved) || reading || snapshot() !== baseline);
  const active = () => draft?.layout.placements.find(item => item.id === selected);
  const editable = () => dialog.open && draft && !loading && !busy() && !result;
  const query = selector => dialog.querySelector(selector);
  dialog.classList.add('room-layout-dialog');
  dialog.setAttribute('aria-label', 'Room design draft');

  function close() {
    if (saving) return false;
    if (controller) { message('Cancel generation before closing.'); return false; }
    if (dirty() && !win.confirm('Discard unsaved changes and any unsaved generated image?')) return false;
    revision++; readRevision++; reading = false; gesture = null; releaseURLs(); result = resultBlob = rendered = saved = null; dialog.close(); opener?.focus();
    return true;
  }

  function board() {
    return renderRoomPlan(room, { editor: true });
  }

  function renderItems() {
    const layer = query('[data-placements]');
    if (!layer) return;
    layer.innerHTML = draft.layout.placements.map((item, index) => `<g data-placement="${escape(item.id)}" tabindex="0" role="button" aria-pressed="${item.id === selected}" aria-label="${escape(item.label)}; item ${index + 1}. Arrow keys move; Shift moves faster; R rotates; Delete removes." class="rl-item ${item.id === selected ? 'is-selected' : ''}" transform="translate(${item.x * width()} ${item.y * depth()}) rotate(${item.rotationDeg})">
      <rect data-footprint x="${-item.widthM / 2}" y="${-item.depthM / 2}" width="${item.widthM}" height="${item.depthM}" rx=".045"/>
      <circle class="rl-front" data-front cx="0" cy="${-item.depthM / 2 + Math.min(.1, item.depthM / 4)}" r=".045"><title>Front</title></circle>
      <text class="rl-item-number" text-anchor="middle" dominant-baseline="central">${index + 1}</text>
      <circle data-resize class="rl-resize" cx="${item.widthM / 2}" cy="${item.depthM / 2}" r=".11"><title>Drag to resize; numeric size controls are also available</title></circle>
    </g>`).join('');
    dialog.querySelectorAll('[data-add]').forEach(button => { button.disabled = draft.layout.placements.length >= 40; });
    query('[data-item-list]').innerHTML = `<option value="">Select an item</option>${draft.layout.placements.map((item, index) => `<option value="${escape(item.id)}" ${item.id === selected ? 'selected' : ''}>${index + 1}. ${escape(item.label)}</option>`).join('')}`;
  }

  function renderEditor() {
    const item = active();
    query('[data-editor]').innerHTML = item ? `<div class="rl-fields">${[['widthM', 'Width (m)', item.widthM], ['depthM', 'Depth (m)', item.depthM]].map(([field, label, value]) => `<label>${label}<input data-field="${field}" type="number" min=".1" max="12" step=".05" value="${Number(value.toFixed(3))}"/></label>`).join('')}<label>Rotation<select data-field="rotationDeg">${(!rotations.includes(item.rotationDeg) ? [item.rotationDeg, ...rotations] : rotations).map(value => `<option value="${value}" ${value === item.rotationDeg ? 'selected' : ''}>${value}&deg;</option>`).join('')}</select></label></div><button type="button" data-action="remove" class="rl-remove">Remove</button>` : '';
  }

  function message(text = '') {
    error = text;
    const target = query('[data-error]');
    if (target) { target.textContent = text; target.hidden = !text; }
  }

  function navigate(target) {
    if (reading || target < 1 || target > 3) return;
    if (target > step) {
      if (!draft.layout.placements.length) { message('Place at least one item to continue.'); query('[data-error]').focus(); return; }
      if (target === 3 && !draft.selectedSourceIds.length) { message('Select at least one room photo.'); query('[data-error]').focus(); return; }
    }
    gesture = null; step = target; draft.layoutWizardStep = step; message(); draw(); query('[data-step-title]').focus();
  }

  async function reference(file) {
    if (!file || !editable()) return;
    const token = ++readRevision, session = revision;
    reading = true; message(); draw();
    try {
      validateImageFile(file);
      const result = await readImage(file);
      if (disposed || session !== revision || token !== readRevision) return;
      releaseURLs(); draft.layoutReferenceBlob = result.blob; draft.layoutReferenceName = file.name || 'Pasted image'; referenceRevision++;
    } catch (failure) {
      if (session === revision && token === readRevision) error = failure.message || 'Could not read image. Try another file.';
    } finally {
      if (!disposed && session === revision && token === readRevision) { reading = false; draw(); query('[data-action="upload-reference"]')?.focus(); }
    }
  }

  function draw() {
    if (disposed || !dialog.open) return;
    if (controller || result) {
      const label = result?.mode === 'mock' || (!result && mode === 'mock') ? 'Mock preview' : 'Real AI';
      const source = sources.find(source => source.id === draft.viewpointSourceId);
      const sourceURL = controller && imageURL(source?.blob || source?.thumbnail);
      dialog.innerHTML = `<div class="rl-shell rl-generation"><header class="rl-header"><div><h2>${escape(room.name)}</h2><p class="rl-hint">${label}</p></div><button class="rl-close" data-action="close" aria-label="Close room layout" ${busy() ? 'disabled' : ''}>&times;</button></header>${controller ? `<div class="rl-generating" aria-hidden="true">${sourceURL ? `<img src="${escape(sourceURL)}" alt=""/>` : ''}<span class="restyle-merge-scan"></span></div>${sourceURL ? '<p class="rl-hint">Selected source photo, not generated output.</p>' : ''}<p role="status" aria-live="polite">${mode === 'mock' ? 'Mock simulation: ' : ''}${escape(stages[stage] || 'Waiting for backend')}</p>${mode === 'mock' ? '<p class="rl-hint">Local image adjustment, not AI furnishing or layout review.</p>' : ''}` : `<img class="rl-result" src="${escape(imageURL(rendered?.blob || resultFile(result)))}" alt="${label} room design"/><p>${escape(result.designSpec.conceptName)}</p><p class="rl-hint">${result.mode === 'mock' ? 'Local image adjustment only. No AI generation or layout review.' : escape(result.layoutReview?.message || 'AI layout review is not a geometric guarantee.')}</p><p class="rl-hint">${escape(result.layoutReview?.status || 'unchecked')}. The measured layout remains authoritative.</p>${result.layoutReview?.findings?.length ? `<ul>${result.layoutReview.findings.map(item => `<li>${escape(item.description)}</li>`).join('')}</ul>` : ''}`}
        <p data-error class="rl-error" role="alert" ${error ? '' : 'hidden'}>${escape(error)}</p><footer class="rl-footer">${controller ? '<button class="rl-secondary" data-action="cancel-generation">Cancel generation</button>' : saved ? '<button class="rl-primary" data-action="open-design">Open design</button>' : `<button class="rl-secondary" data-action="edit-design" ${saving ? 'disabled' : ''}>Edit inputs</button><button class="rl-secondary" data-action="retry-generation" ${saving ? 'disabled' : ''}>Retry generation${result.mode === 'mock' ? '' : ' (uses credits)'}</button><button class="rl-primary" data-action="save-design" ${saving ? 'disabled' : ''}>${saving ? 'Saving design...' : error ? 'Retry save' : 'Save design'}</button>`}</footer></div>`;
      return;
    }
    // Read live details state before replacing the step, including pending toggle events.
    catalogExpanded = query('[data-furniture-catalog]')?.open ?? catalogExpanded;
    dialog.querySelectorAll('[data-category]').forEach(node => {
      if (node.open) expandedCategories.add(node.dataset.category);
      else expandedCategories.delete(node.dataset.category);
    });
    dialog.innerHTML = `<div class="rl-shell"><header class="rl-header"><div><h2>${escape(room.name)}</h2><p class="rl-hint">Design draft</p></div><button type="button" class="rl-close" data-action="close" aria-label="Close room layout" ${saving ? 'disabled' : ''}>&times;</button></header>
      ${loading ? '<p class="rl-loading" role="status">Loading layout...</p>' : !draft ? `<div class="rl-loading"><p role="alert">${escape(error)}</p>${measurement ? '<button type="button" class="rl-secondary" data-action="retry-load">Retry loading</button>' : ''}</div>` : `
      <div class="rl-workspace"><nav class="rl-rail" aria-label="Draft steps">${titles.map((title, index) => `<button type="button" data-step="${index + 1}" class="${step === index + 1 ? 'is-current' : step > index + 1 ? 'is-complete' : ''}" ${step === index + 1 ? 'aria-current="step"' : ''} ${saving || reading || index + 1 > step + 1 ? 'disabled' : ''}><span class="rl-bullet">${index + 1}</span><span class="rl-step-label">${title}${step > index + 1 ? '<span class="rl-sr-only">, completed</span>' : ''}</span></button>`).join('')}</nav><section class="rl-stage"><h3 data-step-title tabindex="-1">Step ${step} / ${titles[step - 1]}</h3>
      ${step === 1 ? `<fieldset class="rl-content" ${saving ? 'disabled' : ''}><legend class="rl-sr-only">Room layout editor</legend>
        <section class="rl-canvas">${board()}<p id="rl-plan-help" class="rl-sr-only">Drag to move / corner to resize / dot marks front. Plan dimensions; openings are schematic. Verify clearances on site. ${escape(measurement.note || '')}</p></section>
        <aside class="rl-sidebar"><details class="rl-furniture" data-furniture-catalog ${catalogExpanded ? 'open' : ''}><summary><h3>Add furniture</h3></summary><div class="rl-categories">${roomLayoutCatalog.map(category => `<details class="rl-category" data-category="${category.id}" ${expandedCategories.has(category.id) ? 'open' : ''}><summary>${escape(category.label)}</summary><div class="rl-catalog">${category.items.map(([type, label]) => `<button type="button" data-add="${type}">+ ${escape(label)}</button>`).join('')}</div></details>`).join('')}</div></details><section class="rl-selection"><select data-item-list aria-label="Select placed furniture"></select><div data-editor></div></section></aside>
      </fieldset>` : step === 2 ? `<p class="rl-hint">Choose the original views to include.</p><fieldset class="rl-photos" ${saving ? 'disabled' : ''}><legend class="rl-sr-only">Room source photos</legend>${sources.length ? sources.map(source => `<label class="rl-photo"><img src="${escape(imageURL(source.thumbnail || source.blob))}" alt=""/><span><input type="checkbox" data-source="${escape(source.id)}" ${draft.selectedSourceIds.includes(source.id) ? 'checked' : ''}/>${escape(source.title || source.filename || 'Room photo')}</span></label>`).join('') : '<p class="rl-empty">No original room photos yet. Save & close, then add photos to this room.</p>'}</fieldset>` : `<fieldset class="rl-brief" ${saving ? 'disabled' : ''}><legend class="rl-sr-only">Design instructions and reference</legend><label for="rl-instructions">Instructions <span class="rl-hint">(optional)</span></label><textarea id="rl-instructions" data-instructions rows="5" maxlength="1200" placeholder="Materials, colors, details to keep...">${escape(draft.styleBrief)}</textarea><span>Reference image <span class="rl-hint">(optional)</span></span><div class="rl-reference" tabindex="0" aria-label="Reference image. Paste an image here or use Choose image.">${draft.layoutReferenceBlob ? `<img src="${escape(imageURL(draft.layoutReferenceBlob))}" alt="${escape(draft.layoutReferenceName || 'Design reference')}"/>` : '<p class="rl-hint">Upload or paste an image</p>'}<button type="button" class="rl-secondary" data-action="upload-reference">${draft.layoutReferenceBlob ? 'Replace image' : 'Choose image'}</button><input data-reference-file type="file" accept="image/jpeg,image/png,image/webp,image/gif,image/avif" hidden/>${draft.layoutReferenceBlob || reading ? '<button type="button" class="rl-remove" data-action="remove-reference">Remove</button>' : ''}<span role="status">${reading ? 'Reading image...' : ''}</span></div><p class="rl-hint">Saved with this draft only. No images will be generated.</p></fieldset>`}
      <p data-error class="rl-error" role="alert" tabindex="-1" ${error ? '' : 'hidden'}>${escape(error)}</p><footer class="rl-footer"><span class="rl-sr-only" role="status" data-save-status>${saving ? 'Saving draft...' : ''}</span>${step > 1 ? `<button type="button" class="rl-secondary" data-action="back" ${saving || reading ? 'disabled' : ''}>Back</button>` : ''}<button type="button" class="${step === 3 ? 'rl-primary' : 'rl-secondary'}" data-save data-action="save" ${saving || reading ? 'disabled' : ''}>${saving ? 'Saving...' : step === 3 ? 'Save draft' : 'Save & close'}</button>${step < 3 ? `<button type="button" class="rl-primary" data-action="next" ${saving || reading ? 'disabled' : ''}>Next</button>` : ''}</footer></section></div>`}</div>`;
    if (draft && !loading && step === 1) { query('[data-step-title]').classList.add('rl-sr-only'); renderItems(); renderEditor(); }
    if (draft && !loading && step === 2) query('.rl-stage > .rl-hint').textContent = 'Choose up to 8 actual room views. The first selected photo sets the output camera.';
    if (draft && !loading && step === 3) {
      query('.rl-brief > p:last-child').textContent = 'Reference guides appearance only, never room geometry.';
      const button = query('[data-save]');
      button.className = 'rl-secondary'; button.textContent = saving ? 'Saving...' : 'Save & close';
      query('.rl-footer').insertAdjacentHTML('beforeend', `<button class="rl-primary" data-action="generate" ${saving || reading || !configured() ? 'disabled' : ''}>Style with AI</button>`);
      query('.rl-brief').insertAdjacentHTML('beforeend', `<div class="rl-mode" role="group" aria-label="AI mode"><button type="button" class="rl-secondary" data-ai-mode="mock" aria-pressed="${mode === 'mock'}">Mock</button><button type="button" class="rl-secondary" data-ai-mode="real" aria-pressed="${mode === 'real'}">Real AI</button><span class="rl-hint">${mode === 'mock' ? 'No API charges. Preview only.' : 'Uses API credits.'}</span></div><p class="rl-hint" role="status">${!config ? 'Checking backend...' : configured() ? mode === 'mock' ? 'Mock available. Choose Real AI for actual generation.' : 'Real AI configured.' : mode === 'real' ? 'Real AI unavailable. Configure OPENAI_API_KEY on the backend, then check again.' : 'Local backend unavailable.'}</p><button type="button" class="rl-secondary" data-action="check-config">Check again</button>`);
    }
  }

  async function checkConfig() {
    const token = revision;
    try { const status = await client?.status(); if (token === revision) config = status || { unavailable: true }; }
    catch { if (token === revision) config = { unavailable: true }; }
    if (!disposed && token === revision && step === 3 && !busy() && !result) draw();
  }

  async function generate() {
    if (!editable() || reading || !configured()) return;
    const operation = new win.AbortController(); controller = operation;
    stage = 'preparing'; error = ''; gesture = null; draw();
    try {
      generationDraft = structuredClone(draft);
      generationDraft.plan = roomPlanConstraint(room);
      generationDraft.styleBrief = draft.styleBrief.trim() || 'Create a cohesive interior style for the specified furniture layout.';
      references = draft.layoutReferenceBlob ? [{ id: 'layout-reference', roomId: room.id, title: draft.layoutReferenceName || 'Style reference', blob: draft.layoutReferenceBlob }] : [];
      generationDraft.inspirationIds = references.map(item => item.id);
      generationDraft.viewpoint = { sourceImageId: draft.viewpointSourceId, label: 'Selected room photo camera and framing' };
      const input = await buildFirstDesignRequest({ room, draft: generationDraft, sources, references, requestId: win.crypto.randomUUID(), mode });
      operation.signal.throwIfAborted();
      const completed = await client.run(input, { signal: operation.signal, onProgress(value) { if (controller === operation && !operation.signal.aborted && stages[value]) { stage = value; draw(); } } });
      operation.signal.throwIfAborted();
      if ((completed.mode || 'real') !== mode || completed.requestId !== input.requestId || completed.operation !== 'first_design') throw new Error('Unexpected generation response. Your inputs are still here.');
      if (!completed.designSpec?.conceptName || !completed.layoutReview) throw new Error('The generation response is incomplete. Please retry.');
      resultBlob = resultFile(completed);
      result = completed;
      stage = 'processing'; draw();
      rendered = await readImage(resultBlob);
      operation.signal.throwIfAborted();
    } catch (failure) {
      if (operation.signal.aborted) { result = resultBlob = rendered = null; error = mode === 'mock' ? 'Generation cancelled. Your inputs are ready to retry. No API charges.' : 'Generation cancelled. Your inputs are ready to retry. Any API work already started may still incur charges.'; }
      else error = failure.message || 'Generation failed. Your inputs are ready to retry.';
    } finally { if (controller === operation) controller = null; draw(); }
  }

  async function saveResult() {
    if (!result || busy() || saved) return;
    saving = true; error = ''; draw();
    try {
      rendered ||= await readImage(resultBlob);
      saved = await saveDesign({ roomId: room.id, draft: generationDraft, sources, references, result, rendered });
      baseline = snapshot();
      await onSaved(saved);
    } catch (failure) { error = saved ? 'Design saved, but gallery refresh failed. Open design to retry navigation.' : `Could not save design. The generated image is still here. ${failure.message || 'Retry save.'}`; }
    finally { saving = false; draw(); }
  }

  function select(id, focus = false) {
    selected = id; renderItems(); renderEditor();
    if (focus) [...dialog.querySelectorAll('[data-placement]')].find(node => node.dataset.placement === id)?.focus();
  }

  function update(changes, pointer = false) {
    const item = active();
    if (!item) return;
    Object.assign(item, containPlacement({ ...item, ...changes }, width(), depth()));
    message();
    query('[data-save-status]').textContent = dirty() ? 'Unsaved layout changes' : 'Layout unchanged';
    if (!pointer) { renderItems(); renderEditor(); return; }
    // Keep the SVG and captured pointer target alive throughout the gesture.
    const node = [...dialog.querySelectorAll('[data-placement]')].find(node => node.dataset.placement === selected);
    node.setAttribute('transform', `translate(${item.x * width()} ${item.y * depth()}) rotate(${item.rotationDeg})`);
    const rect = node.querySelector('[data-footprint]');
    for (const [key, value] of Object.entries({ x: -item.widthM / 2, y: -item.depthM / 2, width: item.widthM, height: item.depthM })) rect.setAttribute(key, value);
    node.querySelector('[data-front]').setAttribute('cy', -item.depthM / 2 + Math.min(.1, item.depthM / 4));
    node.querySelector('[data-resize]').setAttribute('cx', item.widthM / 2);
    node.querySelector('[data-resize]').setAttribute('cy', item.depthM / 2);
    for (const input of dialog.querySelectorAll('[data-field]')) input.value = Number((item[input.dataset.field] * (['x', 'y'].includes(input.dataset.field) ? 100 : 1)).toFixed(3));
  }

  async function load() {
    const token = ++revision;
    loading = true; draft = null; error = ''; draw();
    try {
      if (!measurement) throw new Error('No measured floor plan is available for this room.');
      const [stored, images] = await Promise.all([getDraft(room.id), listImages(room.id)]);
      if (disposed || token !== revision) return;
      if (stored && stored.roomId !== room.id) throw new Error('The saved draft belongs to another room. Its data has not been changed.');
      const layout = normalizeRoomLayout(stored?.layout, width(), depth());
      draft = { roomId: room.id, step: 1, selectedSourceIds: [], viewpointSourceId: null, styleBrief: '', inspirationIds: [], ...structuredClone(stored || {}), layout };
      sources = images.filter(image => image.roomId === room.id && !image.restyleId && !image.firstDesignId && !image.parentImageId && image.sourceType !== 'first_design');
      draft.selectedSourceIds = [...new Set(draft.selectedSourceIds)].filter(id => sources.some(source => source.id === id));
      // Preserve the original wizard's camera choice in this UI's first-selected order.
      if (draft.selectedSourceIds.includes(draft.viewpointSourceId)) {
        draft.selectedSourceIds = [draft.viewpointSourceId, ...draft.selectedSourceIds.filter(id => id !== draft.viewpointSourceId)];
      }
      draft.viewpointSourceId = draft.selectedSourceIds[0] || null;
      // The existing wizard uses a different step order; keep its canonical step intact.
      step = Math.max(1, Math.min(3, Number(draft.layoutWizardStep) || 1));
      if (!layout.placements.length) step = 1;
      else if (!draft.selectedSourceIds.length && step === 3) step = 2;
      draft.layoutWizardStep = step;
      referenceRevision = 0; baseline = snapshot(); selected = layout.placements[0]?.id || null;
    } catch (failure) { if (token === revision) error = `Could not load layout. ${failure.message || 'Please retry.'}`; }
    finally { if (!disposed && token === revision) { loading = false; draw(); query('[data-step-title], [data-action="retry-load"]')?.focus(); } }
  }

  async function save() {
    if (!editable() || reading) return;
    gesture = null; saving = true; error = ''; draw();
    const token = revision;
    try {
      await saveDraft(structuredClone(draft));
      if (disposed || token !== revision) return;
      baseline = snapshot(); saving = false; close();
    } catch {
      if (disposed || token !== revision) return;
      saving = false; error = 'Could not save draft. Your edits are still here. Check device storage or connection, then retry.'; draw(); query('[data-save]')?.focus();
    }
  }

  dialog.addEventListener('click', event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close') { close(); return; }
    if (action === 'cancel-generation') { controller?.abort(); return; }
    if (action === 'save-design') { saveResult(); return; }
    if (action === 'open-design' && saved && !busy()) {
      Promise.resolve(onOpen(saved)).then(() => close()).catch(() => message('Could not open design. Try again.')); return;
    }
    if (['retry-generation', 'edit-design'].includes(action) && result && !busy() && !saved) {
      if (!win.confirm('Discard this generated image?')) return;
      result = resultBlob = rendered = null; releaseURLs(); error = ''; draw();
      if (action === 'retry-generation') generate();
      return;
    }
    if (action === 'retry-load' && !loading) { load(); return; }
    if (!editable()) return;
    const nextMode = event.target.closest('[data-ai-mode]')?.dataset.aiMode;
    if (nextMode) { setAIMode(nextMode); return; }
    if (action === 'check-config') { checkConfig(); return; }
    if (action === 'generate') { generate(); return; }
    if (action === 'save') { save(); return; }
    if (action === 'next' || action === 'back') { navigate(step + (action === 'next' ? 1 : -1)); return; }
    const targetStep = event.target.closest('[data-step]')?.dataset.step;
    if (targetStep) { navigate(Number(targetStep)); return; }
    if (action === 'upload-reference') { query('[data-reference-file]').click(); return; }
    if (action === 'remove-reference') { readRevision++; reading = false; releaseURLs(); draft.layoutReferenceBlob = null; draft.layoutReferenceName = ''; referenceRevision++; message(); draw(); query('[data-action="upload-reference"]').focus(); return; }
    const type = event.target.closest('[data-add]')?.dataset.add;
    if (type && draft.layout.placements.length < 40) {
      const preset = presets.find(item => item[0] === type);
      if (!preset) return;
      const id = win.crypto.randomUUID();
      draft.layout.placements.push(containPlacement({ id, itemType: type, label: preset[1], x: .5, y: .5, widthM: preset[2], depthM: preset[3], rotationDeg: 360 }, width(), depth()));
      select(id); update({}); query('[data-save-status]').textContent = 'Unsaved layout changes'; return;
    }
    if (action === 'remove' && active()) {
      draft.layout.placements = draft.layout.placements.filter(item => item.id !== selected);
      select(draft.layout.placements[0]?.id || null); message(); query('[data-save-status]').textContent = 'Unsaved layout changes'; query('[data-item-list]').focus(); return;
    }
    const node = event.target.closest('[data-placement]');
    if (node) select(node.dataset.placement, true);
  }, events);

  dialog.addEventListener('change', event => {
    if (!editable()) return;
    if (event.target.matches('[data-reference-file]')) { reference(event.target.files[0]); return; }
    if (event.target.matches('[data-source]')) {
      const id = event.target.dataset.source;
      if (!sources.some(source => source.id === id)) return;
      if (event.target.checked && draft.selectedSourceIds.length >= 8) { event.target.checked = false; message('Choose up to 8 room photos.'); return; }
      draft.selectedSourceIds = event.target.checked ? [...new Set([...draft.selectedSourceIds, id])] : draft.selectedSourceIds.filter(value => value !== id);
      if (!draft.selectedSourceIds.includes(draft.viewpointSourceId)) draft.viewpointSourceId = draft.selectedSourceIds[0] || null;
      message(); return;
    }
    if (event.target.matches('[data-item-list]')) { select(event.target.value); return; }
    const field = event.target.dataset.field;
    if (!field || !active()) return;
    const value = event.target.matches('select') ? Number(event.target.value) : event.target.valueAsNumber;
    if (!Number.isFinite(value)) { renderEditor(); query(`[data-field="${field}"]`)?.focus(); return; }
    update({ [field]: value / (['x', 'y'].includes(field) ? 100 : 1) });
    query(`[data-field="${field}"]`)?.focus();
  }, events);

  dialog.addEventListener('input', event => {
    if (editable() && event.target.matches('[data-instructions]')) { draft.styleBrief = event.target.value; message(); }
  }, events);
  dialog.addEventListener('paste', event => {
    if (!editable() || step !== 3) return;
    const file = [...(event.clipboardData?.items || [])].find(item => item.kind === 'file' && item.type.startsWith('image/'))?.getAsFile();
    if (file) { event.preventDefault(); event.stopPropagation(); reference(file); }
  }, events);

  dialog.addEventListener('keydown', event => {
    const node = event.target.closest('[data-placement]');
    if (!node || !editable()) return;
    const key = event.key;
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'r', 'R', 'Delete', 'Backspace', 'Enter', ' '].includes(key)) return;
    event.preventDefault(); selected = node.dataset.placement;
    if (key === 'Delete' || key === 'Backspace') { select(selected); query('[data-action="remove"]').click(); return; }
    const item = active(), distance = event.shiftKey ? .1 : .02;
    const changes = key === 'r' || key === 'R' ? { rotationDeg: rotations[(rotations.indexOf(item.rotationDeg) + 1) % rotations.length] } : key.startsWith('Arrow') ? { x: item.x + (key === 'ArrowRight' ? distance / width() : key === 'ArrowLeft' ? -distance / width() : 0), y: item.y + (key === 'ArrowDown' ? distance / depth() : key === 'ArrowUp' ? -distance / depth() : 0) } : {};
    update(changes); select(selected, true);
  }, events);

  function point(event) {
    // Invert the shared renderer's meter-to-SVG transform for pointer coordinates.
    const svg = query('[data-plan]'), matrix = query('[data-placements]').getScreenCTM?.();
    if (!matrix) return null;
    const p = svg.createSVGPoint(); p.x = event.clientX; p.y = event.clientY;
    return p.matrixTransform(matrix.inverse());
  }

  dialog.addEventListener('pointerdown', event => {
    const node = event.target.closest('[data-placement]');
    if (!node || !editable() || event.button !== 0 || gesture) return;
    const start = point(event); if (!start) return;
    event.preventDefault();
    const resize = Boolean(event.target.closest('[data-resize]'));
    select(node.dataset.placement, true);
    gesture = { pointerId: event.pointerId, start, item: { ...active() }, resize };
    query('[data-plan]').setPointerCapture?.(event.pointerId);
  }, events);

  dialog.addEventListener('pointermove', event => {
    if (!gesture || gesture.pointerId !== event.pointerId || !editable()) return;
    const p = point(event); if (!p) return;
    const { start, item, resize } = gesture;
    const dx = p.x - start.x, dy = p.y - start.y;
    if (resize) {
      const a = item.rotationDeg * Math.PI / 180;
      update({ widthM: Math.max(.1, item.widthM + 2 * (dx * Math.cos(a) + dy * Math.sin(a))), depthM: Math.max(.1, item.depthM + 2 * (-dx * Math.sin(a) + dy * Math.cos(a))) }, true);
    } else update({ x: item.x + dx / width(), y: item.y + dy / depth() }, true);
  }, events);

  function endGesture(event) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    const svg = query('[data-plan]');
    gesture = null;
    if (svg?.hasPointerCapture?.(event.pointerId)) svg.releasePointerCapture(event.pointerId);
  }
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) dialog.addEventListener(type, endGesture, events);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, events);
  win.addEventListener('beforeunload', event => { if (dirty() && dialog.open) { event.preventDefault(); event.returnValue = ''; } }, events);
  const unsubscribe = subscribeAIMode(next => { if (!busy() && !result) { mode = next; draw(); } });

  return {
    async open(nextRoom) {
      if (disposed || busy()) return;
      if (dialog.open && !close()) return;
      opener = dialog.ownerDocument.activeElement; room = nextRoom; measurement = roomMeasurements[room.id];
      draft = null; baseline = null; selected = null;
      result = resultBlob = rendered = saved = null; config = null; mode = getAIMode();
      dialog.showModal(); await load(); checkConfig();
    },
    dispose() {
      if (disposed) return true;
      if (dialog.open && !close()) return false;
      disposed = true; revision++; lifecycle.abort(); unsubscribe();
      dialog.classList.remove('room-layout-dialog');
      return true;
    },
  };
}
