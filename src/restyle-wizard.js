import { sourceSnapshot, validateImageFile } from './storage.js';
import { imagePayload, resultFile } from './restyle-client.js';
import { styleSummary, refinementSummary, geometrySummary } from './restyle-presenter.js';
import { getAIMode, setAIMode, subscribeAIMode } from './ai-mode.js';

const restyleStages = [['extracting', 'Extracting style'], ['rendering', 'Rendering'], ['checking', 'Checking geometry'], ['saving', 'Saving']];
const refinementStages = [['extracting', 'Preparing edit'], ['rendering', 'Rendering'], ['checking', 'Checking changes'], ['saving', 'Saving']];
const restyleDescriptions = ['Reading colors, materials, and lighting.', 'Applying the style to your source design.', 'Comparing shapes, positions, and framing.', 'Adding the result to your saved versions.'];
const refinementDescriptions = ['Preparing your requested change.', 'Editing this exact version.', 'Checking for unexpected changes.', 'Adding the result to your edit thread.'];

export function createRestyleWizard(dialog, { client, escape, readImage, saveVersion, onSaved, onView, getPhotos, onStateChange = () => {}, initialMode, mockSaveDelayMs = 1000 }) {
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  let photos = [], selectedId, inspiration, instruction = '', snapshot, result, rendered, saved;
  let fixedSource = null;
  let flow = 'restyle';
  let step = 1, stage, error = '', config, controller, saving = false, opener, disposed = false;
  let urls = [];
  let previewRead = 0;
  let reading = false;
  let session = 0;
  let mode = initialMode === 'real' || initialMode === 'mock' ? initialMode : getAIMode();
  const busy = () => Boolean(controller || saving || reading);
  const refining = () => flow === 'refine';
  const stages = () => refining() ? refinementStages : restyleStages;
  const descriptions = () => refining() ? refinementDescriptions : restyleDescriptions;
  const configured = () => mode === 'mock' ? config?.mockAvailable : config?.configured;
  const imageURL = (blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
  const selected = () => photos.find((photo) => photo.id === selectedId);
  const releaseURLs = () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls = []; };
  const currentSource = () => snapshot || selected();

  function updateGeneration() {
    const generationStages = stages();
    const activeStage = Math.max(0, generationStages.findIndex(([id]) => id === stage));
    dialog.querySelectorAll('.restyle-progress li').forEach((item, index) => {
      const active = index === activeStage;
      item.dataset.state = index < activeStage ? 'complete' : active ? 'active' : 'pending';
      if (active) item.setAttribute('aria-current', 'step');
      else item.removeAttribute('aria-current');
      item.querySelector('.restyle-step-state').textContent = index < activeStage ? 'Done' : active ? 'In progress' : 'Waiting';
    });
    dialog.querySelector('.restyle-generation-description').textContent = `${mode === 'mock' ? 'Simulation · ' : ''}${descriptions()[activeStage]}`;
    const live = dialog.querySelector('.restyle-live');
    const announcement = `${generationStages[activeStage][1]}…`;
    if (live.textContent !== announcement) live.textContent = announcement;
    dialog.querySelector('[data-action="close"]').disabled = saving;
    const cancel = dialog.querySelector('[data-action="cancel"]');
    cancel.disabled = saving;
    cancel.textContent = saving ? 'Saving…' : `Cancel ${refining() ? 'refinement' : 'Restyle'}`;
  }

  function figure(blob, title) {
    return `<figure><figcaption>${escape(title)}</figcaption><div class="restyle-preview"><img src="${imageURL(blob)}" alt="${escape(title)}"/></div></figure>`;
  }

  function generationInputs(source) {
    if (refining()) return `<div class="restyle-generation-inputs restyle-generation-refinement"><span><img src="${imageURL(source.blob)}" alt=""/>Current version</span><b>→</b><span class="restyle-generation-request">${escape(instruction)}</span></div>`;
    const sourceURL = imageURL(source.blob), inspirationURL = imageURL(inspiration);
    return `<div class="restyle-merge">
      <div class="restyle-merge-input restyle-merge-source"><img src="${sourceURL}" alt=""/><span>Source</span></div>
      <span class="restyle-merge-plus">+</span>
      <div class="restyle-merge-input restyle-merge-inspiration"><img src="${inspirationURL}" alt=""/><span>Inspiration</span></div>
      <div class="restyle-merge-blend"><img src="${sourceURL}" alt=""/><img class="restyle-merge-overlay" src="${inspirationURL}" alt=""/><span class="restyle-merge-scan"></span></div>
    </div>`;
  }

  function refinementComposer(source) {
    return `<div class="restyle-refinement-workspace">
      <div class="restyle-refinement-source">${figure(source.blob, 'Current version')}</div>
      <div class="restyle-refinement-composer">
        <label for="restyle-instruction">What should change?</label>
        <textarea id="restyle-instruction" data-refinement-instruction rows="5" maxlength="600" placeholder="For example: Make the walls a warmer white. Keep everything else the same.">${escape(instruction)}</textarea>
        <p class="restyle-help">Describe one change. Everything else stays the same.</p>
      </div>
    </div>`;
  }

  function resultView() {
    const resultInstruction = result.instruction || instruction;
    const outputLabel = result.mode === 'mock' ? 'Mock preview' : refining() ? 'Refined version' : 'Restyled version';
    const mockNote = result.mode === 'mock'
      ? '<p class="restyle-mock-note">Mock preview · Local color adjustment. No AI generation or geometry check.</p>'
      : '';
    return `${mockNote}<div class="restyle-comparison">${figure(snapshot.blob, refining() ? 'Previous version' : 'Source design')}${figure(rendered?.blob || resultFile(result), outputLabel)}</div>${refining() ? refinementSummary(resultInstruction, escape) : styleSummary(result.spec, escape)}${geometrySummary(result.geometry, escape)}`;
  }

  function setupView(source) {
    if (refining()) return source ? refinementComposer(source) : '<p class="restyle-empty">Choose a saved version before refining it.</p>';
    if (step === 1) {
      return photos.length
        ? `<div class="restyle-designs" role="group" aria-label="Choose a saved design">${photos.map((photo) => `<button class="restyle-design" data-design="${escape(photo.id)}" aria-pressed="${photo.id === selectedId}"><img src="${imageURL(photo.thumbnail || photo.blob)}" alt=""/><span>${escape(photo.title)}</span></button>`).join('')}</div>`
        : '<p class="restyle-empty">Add an image to this room before restyling.</p>';
    }
    return `<div class="restyle-comparison">${source ? figure(source.blob, 'Current design') : ''}<div class="restyle-inspiration"><p>Inspiration image</p>${inspiration ? `<div class="restyle-preview"><img src="${imageURL(inspiration)}" alt="Inspiration image"/></div><p class="restyle-filename">${escape(inspiration.name)}</p>` : '<div class="restyle-drop" data-drop>Drop or paste one inspiration image here</div>'}
      <label class="button secondary restyle-file-button">${inspiration ? 'Change image' : 'Choose image'}<input type="file" data-inspiration accept="image/jpeg,image/png,image/webp,image/gif,image/avif" ${busy() ? 'disabled' : ''}/></label><p class="restyle-help">Or paste with ⌘V / Ctrl+V. Up to 25 MB.</p></div></div>
      <div class="restyle-instructions">
        <label for="restyle-style-instruction">Restyling instructions <span>(optional)</span></label>
        <textarea id="restyle-style-instruction" data-restyle-instruction rows="3" maxlength="2000" aria-describedby="restyle-instruction-help" placeholder="For example: Use the warm wood and soft lighting from the inspiration, but keep the sofa green and make the walls cream.">${escape(instruction)}</textarea>
        <p id="restyle-instruction-help" class="restyle-help">Tell the AI what to take from the inspiration and what to keep. Layout and furniture shapes stay the same. Up to 2,000 characters.</p>
      </div>
      <p class="restyle-help">${mode === 'mock' ? 'Mock applies a local color adjustment only; it does not interpret your instructions. No AI or API charges.' : 'Transfers style while keeping the layout. Selected images and instructions are sent to OpenAI when you press Restyle.'}</p>`;
  }

  function modeSelector() {
    return `<div class="restyle-mode-selector" role="group" aria-label="AI mode"><span>Generation mode</span><div><button data-action="mode-mock" aria-pressed="${mode === 'mock'}" ${busy() ? 'disabled' : ''}>Mock</button><button data-action="mode-real" aria-pressed="${mode === 'real'}" ${busy() ? 'disabled' : ''}>Real AI</button></div><small>${mode === 'mock' ? 'No API charges' : 'Uses API credits'}</small></div>`;
  }

  function draw() {
    if (disposed || !dialog.open) return;
    const generating = Boolean(controller || saving);
    onStateChange({ busy: busy(), mode });
    if (generating && urls.length && dialog.querySelector('.restyle-generation')) { updateGeneration(); return; }
    const focused = dialog.contains(document.activeElement) ? document.activeElement?.dataset.action : null;
    releaseURLs();
    const source = currentSource();
    const heading = generating
      ? `Creating your ${refining() ? 'refinement' : 'restyle'}`
      : result ? (refining() ? 'Refinement ready' : result.spec.styleName)
        : refining() ? 'Refine this version' : step === 1 ? 'Choose a design' : 'Add inspiration';
    const saveStatus = !generating && result ? (saved ? 'New version saved' : 'Not saved yet') : '';
    const generation = generating && source ? `<div class="restyle-generation">
      <div class="restyle-generation-placeholder" aria-hidden="true">${generationInputs(source)}</div>
      <p class="restyle-generation-description"></p>
      <ol class="restyle-progress" aria-label="${refining() ? 'Refinement' : 'Restyle'} progress">${stages().map(([, label]) => `<li><span class="restyle-step-indicator" aria-hidden="true"></span><span class="restyle-step-label">${label}</span><span class="restyle-step-state"></span></li>`).join('')}</ol>
      <p class="restyle-live" role="status" aria-live="polite" aria-atomic="true"></p>
    </div>` : '';
    const primaryDisabled = busy() || !selected() || !configured() || (!refining() && (step === 2 && !inspiration)) || (refining() && instruction.trim().length < 3);
    const primaryLabel = refining() ? (mode === 'mock' ? 'Test refinement' : 'Generate refinement') : step === 1 ? 'Continue' : reading ? 'Opening image…' : mode === 'mock' ? 'Test Restyle' : 'Restyle';
    dialog.innerHTML = `<div class="restyle-shell ${refining() ? 'restyle-refinement-shell' : ''}">
      <header class="restyle-heading"><div><h2 id="restyle-title">${escape(heading)}</h2>${saveStatus ? `<p class="restyle-save-status" role="status">${saveStatus}</p>` : ''}</div><button class="icon-button" data-action="close" aria-label="Close ${refining() ? 'refinement' : 'Restyle'}" ${saving ? 'disabled' : ''}><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg></button></header>
      ${!generating && !result && !fixedSource && !refining() ? `<ol class="restyle-steps" aria-label="Wizard steps"><li ${step === 1 ? 'aria-current="step"' : ''}>1. Choose design</li><li ${step === 2 ? 'aria-current="step"' : ''}>2. Add inspiration</li></ol>` : ''}
      ${generating ? `${generation}${modeSelector()}` : result ? resultView() : `${setupView(source)}${modeSelector()}`}
      ${config && !configured() ? `<div class="restyle-setup" role="status">${config.unavailable ? 'Restyle needs the local app backend. Open the app with npm run dev or npm start.' : mode === 'mock' ? 'Restart the local app with npm run dev or npm start to enable Mock mode.' : 'Add OPENAI_API_KEY to your local .env.local file to enable Real AI.'}<button class="text-button" data-action="recheck" ${busy() ? 'disabled' : ''}>Check again</button></div>` : ''}
      ${error ? `<p class="restyle-error" role="alert">${escape(error)}</p>` : ''}
      <footer class="restyle-footer">${generating ? '<button class="button secondary" data-action="cancel">Cancel</button>' : result ? `
        <button class="button secondary" data-action="download">Download</button>${saved ? `${refining() ? '' : '<button class="button secondary" data-action="refine">Fine-tune this version</button>'}<button class="button secondary" data-action="again">${refining() ? 'Continue refining' : fixedSource ? 'Create another version' : 'Restyle this version'}</button><button class="button primary" data-action="view">${fixedSource || refining() ? 'Back to versions' : 'View version'}</button>` : `<button class="button primary" data-action="save" ${busy() ? 'disabled' : ''}>${saving ? 'Saving…' : 'Retry save'}</button>`}` : `<button class="button secondary" data-action="${step === 1 || fixedSource || refining() ? 'close' : 'back'}" ${busy() ? 'disabled' : ''}>${step === 1 || fixedSource || refining() ? 'Cancel' : 'Back'}</button><button class="button primary" data-action="${!refining() && step === 1 ? 'next' : 'run'}" ${primaryDisabled ? 'disabled' : ''}>${primaryLabel}</button>`}</footer>
    </div>`;
    if (generating) updateGeneration();
    if (focused) (dialog.querySelector(`[data-action="${focused}"]`) || dialog.querySelector(`[data-action="${generating ? 'cancel' : 'close'}"]`))?.focus({ preventScroll: true });
  }

  async function checkConfig() {
    const current = session;
    try { const status = await client.status(); if (current === session) config = status; }
    catch { if (current === session) config = { configured: false, unavailable: true }; }
    draw();
  }

  async function setInspiration(files) {
    if (controller || saving) return;
    if (files.length !== 1) { error = 'Choose exactly one inspiration image.'; draw(); return; }
    const token = ++previewRead;
    reading = true; error = ''; draw();
    try {
      validateImageFile(files[0]);
      await readImage(files[0]);
      if (token === previewRead) inspiration = files[0];
    } catch (failure) { if (token === previewRead) error = failure.message || 'Could not open this image.'; }
    finally { if (token === previewRead) { reading = false; draw(); } }
  }

  async function save() {
    if (!result || saving || saved) return;
    saving = true; stage = 'saving'; error = ''; draw();
    try {
      if (result.mode === 'mock') await new Promise((resolve) => setTimeout(resolve, mockSaveDelayMs));
      rendered ||= await readImage(resultFile(result));
      saved = await saveVersion({ source: snapshot, inspiration: refining() ? null : inspiration, result, rendered });
    } catch (failure) {
      error = failure.name === 'QuotaExceededError' ? 'Device storage is full. Free some space, then retry saving. You can download this render now.' : 'Could not save the version. Retry save or download your render.';
    } finally { saving = false; draw(); }
    if (saved) { await onSaved(saved).catch(() => {}); draw(); }
  }

  async function run() {
    if (busy() || result || !selected() || !configured()) return;
    instruction = instruction.trim();
    if (!refining() && !inspiration) return;
    if (refining() && instruction.length < 3) { error = 'Describe the change you want to make.'; draw(); return; }
    snapshot = sourceSnapshot(selected());
    controller = new AbortController();
    const operation = controller;
    error = ''; stage = 'extracting'; draw();
    try {
      const input = { requestId: crypto.randomUUID(), mode, source: await imagePayload(snapshot.blob) };
      if (refining()) { input.operation = 'refine'; input.instruction = instruction; }
      else { input.inspiration = await imagePayload(inspiration); if (instruction) input.instruction = instruction; }
      operation.signal.throwIfAborted();
      const completed = await client.run(input, { signal: operation.signal, onProgress(value) { stage = value; draw(); } });
      operation.signal.throwIfAborted();
      if (mode === 'mock' && completed.mode !== 'mock') throw new Error('The backend did not return a Mock preview. Restart the local app and try again.');
      result = { ...completed, operation: completed.operation || (refining() ? 'refine' : 'restyle'), ...(instruction && !completed.instruction ? { instruction } : {}) };
      controller = null;
      await save();
    } catch (failure) {
      error = operation.signal.aborted || failure.code === 'cancelled' ? `${refining() ? 'Refinement' : 'Restyle'} cancelled. Your images are ready to try again.` : failure.message || `Could not complete ${refining() ? 'the refinement' : 'Restyle'}.`;
      if (!result) snapshot = null;
    } finally { if (controller === operation) controller = null; draw(); }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(rendered?.blob || resultFile(result));
    const link = document.createElement('a'); link.href = url; link.download = `${result.mode === 'mock' ? 'mock-' : ''}restyle-${result.requestId}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function open(items, preselectedId, { lockSource = false, flow: nextFlow = 'restyle' } = {}) {
    if (busy()) { if (!dialog.open) dialog.showModal(); draw(); return; }
    opener = document.activeElement;
    if (!result || saved) {
      flow = nextFlow === 'refine' ? 'refine' : 'restyle';
      mode = initialMode === 'real' || initialMode === 'mock' ? initialMode : getAIMode();
      photos = [...items]; selectedId = preselectedId || null; step = flow === 'refine' ? 2 : preselectedId ? 2 : 1;
      fixedSource = (lockSource || flow === 'refine') && selected() ? sourceSnapshot(selected()) : null;
      inspiration = null; instruction = ''; snapshot = result = rendered = saved = null; stage = null; error = ''; config = null;
    }
    session++;
    if (!dialog.open) dialog.showModal();
    document.body.classList.add('restyle-open'); draw();
    dialog.querySelector('[data-action="close"]')?.focus();
    checkConfig();
  }

  dialog.addEventListener('click', (event) => {
    const design = event.target.closest('[data-design]');
    if (design && !busy()) { selectedId = design.dataset.design; draw(); dialog.querySelector(`[data-design="${selectedId}"]`)?.focus(); return; }
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (action === 'close' && !saving) { controller?.abort(); dialog.close(); }
    if (action === 'cancel') controller?.abort();
    if (action === 'mode-mock' || action === 'mode-real') { setAIMode(action === 'mode-mock' ? 'mock' : 'real'); return; }
    if (action === 'recheck') checkConfig();
    if (busy()) return;
    if (action === 'next' && selected()) { step = 2; error = ''; draw(); dialog.querySelector('[data-inspiration]')?.focus(); }
    if (action === 'back' && !fixedSource && !refining()) { step = 1; error = ''; draw(); }
    if (action === 'run') { const editor = dialog.querySelector('[data-refinement-instruction], [data-restyle-instruction]'); if (editor) instruction = editor.value; run(); }
    if (action === 'save') save();
    if (action === 'download') download();
    if (action === 'view' && saved) { dialog.close(); onView(saved); }
    if (action === 'refine' && saved) open([saved], saved.id, { lockSource: true, flow: 'refine' });
    if (action === 'again' && saved) {
      const nextSource = refining() ? saved : fixedSource || saved;
      open([nextSource], nextSource.id, { lockSource: true, flow });
    }
  }, events);
  dialog.addEventListener('input', (event) => {
    if (!event.target.matches('[data-refinement-instruction], [data-restyle-instruction]')) return;
    instruction = event.target.value;
    const submit = dialog.querySelector('[data-action="run"]');
    if (submit) submit.disabled = busy() || !selected() || !configured() || (refining() ? instruction.trim().length < 3 : !inspiration);
  }, events);
  dialog.addEventListener('change', (event) => { if (event.target.matches('[data-inspiration]')) setInspiration(Array.from(event.target.files)); }, events);
  dialog.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); }, events);
  dialog.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); if (!refining() && step === 2 && !result) setInspiration(Array.from(event.dataTransfer.files)); }, events);
  dialog.ownerDocument.addEventListener('paste', (event) => {
    if (!dialog.open || refining() || step !== 2 || result || busy() || event.defaultPrevented) return;
    const clipboard = event.clipboardData;
    let files = Array.from(clipboard?.items || []).filter((item) => item.kind === 'file' && item.type.startsWith('image/')).map((item) => item.getAsFile()).filter(Boolean);
    if (!files.length) files = Array.from(clipboard?.files || []).filter((file) => file.type.startsWith('image/'));
    if (!files.length) return;
    event.preventDefault(); event.stopPropagation();
    setInspiration(files);
  }, events);
  dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); else controller?.abort(); }, events);
  dialog.addEventListener('close', () => {
    controller?.abort(); previewRead++; reading = false; releaseURLs(); document.body.classList.remove('restyle-open');
    opener?.isConnected && opener.focus({ preventScroll: true });
  }, events);
  const unsubscribeMode = subscribeAIMode((nextMode) => {
    if (initialMode || busy() || result) return;
    mode = nextMode; error = ''; draw();
  });
  return { open, get busy() { return busy(); }, get unsaved() { return Boolean(result && !saved); },
    dispose() { disposed = true; unsubscribeMode(); controller?.abort(); lifecycle.abort(); releaseURLs(); dialog.close(); document.body.classList.remove('restyle-open'); onStateChange({ busy: false, mode }); },
  };
}
