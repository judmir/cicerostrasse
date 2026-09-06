import { sourceSnapshot, validateImageFile } from './storage.js';
import { imagePayload, resultFile } from './restyle-client.js';
import { styleSummary, geometrySummary } from './restyle-presenter.js';

const stages = [['extracting', 'Extracting style'], ['rendering', 'Rendering'], ['checking', 'Checking geometry'], ['saving', 'Saving']];
export function createRestyleWizard(dialog, { client, escape, readImage, saveVersion, onSaved, onView, getPhotos }) {
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  let photos = [], selectedId, inspiration, snapshot, result, rendered, saved;
  let step = 1, stage, error = '', config, controller, saving = false, opener, disposed = false;
  let urls = [];
  let previewRead = 0;
  let reading = false;
  let session = 0;
  const busy = () => Boolean(controller || saving || reading);
  const imageURL = (blob) => { const url = URL.createObjectURL(blob); urls.push(url); return url; };
  const selected = () => photos.find((photo) => photo.id === selectedId);
  const releaseURLs = () => { urls.forEach((url) => URL.revokeObjectURL(url)); urls = []; };

  function draw() {
    if (disposed || !dialog.open) return;
    const focused = dialog.contains(document.activeElement) ? document.activeElement?.dataset.action : null;
    releaseURLs();
    const source = snapshot || selected();
    const activeStage = stages.findIndex(([id]) => id === stage);
    const figure = (blob, title) => `<figure><figcaption>${escape(title)}</figcaption><div class="restyle-preview"><img src="${imageURL(blob)}" alt="${escape(title)}"/></div></figure>`;
    dialog.innerHTML = `<div class="restyle-shell">
      <header class="restyle-heading"><div><p class="restyle-eyebrow">${result ? (saved ? 'New version saved' : 'Your render is ready') : 'Restyle'}</p><h2 id="restyle-title">${result ? escape(result.spec.styleName) : step === 1 ? 'Choose a design' : 'Add inspiration'}</h2></div><button class="icon-button" data-action="close" aria-label="Close Restyle" ${saving ? 'disabled' : ''}>×</button></header>
      ${!result ? `<ol class="restyle-steps" aria-label="Wizard steps"><li ${step === 1 ? 'aria-current="step"' : ''}>1. Choose design</li><li ${step === 2 ? 'aria-current="step"' : ''}>2. Add inspiration</li></ol>` : ''}
      ${result ? `<div class="restyle-comparison">${figure(snapshot.blob, 'Source design')}${figure(rendered?.blob || resultFile(result), 'Restyled version')}</div>${geometrySummary(result.geometry, escape)}${styleSummary(result.spec, escape)}` : step === 1 ? `
        ${photos.length ? `<div class="restyle-designs" role="group" aria-label="Choose a saved design">${photos.map((photo) => `<button class="restyle-design" data-design="${escape(photo.id)}" aria-pressed="${photo.id === selectedId}"><img src="${imageURL(photo.thumbnail || photo.blob)}" alt=""/><span>${escape(photo.title)}</span></button>`).join('')}</div>` : '<p class="restyle-empty">Add an image to this room before restyling.</p>'}` : `
        <div class="restyle-comparison">${source ? figure(source.blob, 'Current design') : ''}<div class="restyle-inspiration"><p>Inspiration image</p>${inspiration ? `<div class="restyle-preview"><img src="${imageURL(inspiration)}" alt="Inspiration image"/></div><p class="restyle-filename">${escape(inspiration.name)}</p>` : '<div class="restyle-drop" data-drop>Drop one inspiration image here</div>'}
        <label class="button secondary restyle-file-button">${inspiration ? 'Change image' : 'Choose image'}<input type="file" data-inspiration accept="image/jpeg,image/png,image/webp,image/gif,image/avif" ${busy() ? 'disabled' : ''}/></label><p class="restyle-help">JPG, PNG, WebP, GIF, AVIF · up to 25 MB</p></div></div>
        <p class="restyle-help">Transfer colors, materials, textures, finishes, and lighting mood. Keep all shapes and positions fixed.</p><p class="restyle-help">Your selected images are sent to OpenAI when you press Restyle.</p>`}
      ${config && !config.configured ? `<div class="restyle-setup" role="status">${config.unavailable ? 'Restyle needs the local app backend. Open the app with npm run dev or npm start.' : 'Add OPENAI_API_KEY to your local .env.local file to enable Restyle.'}<button class="text-button" data-action="recheck" ${busy() ? 'disabled' : ''}>Check again</button></div>` : ''}
      ${stage && busy() ? `<ol class="restyle-progress" aria-label="Restyle progress">${stages.map(([id, label], index) => `<li class="${index < activeStage ? 'complete' : ''}" ${id === stage ? 'aria-current="step"' : ''}>${label}</li>`).join('')}</ol><p class="restyle-live" role="status" aria-live="polite">${stages[activeStage]?.[1] || 'Preparing images'}…</p>` : ''}
      ${error ? `<p class="restyle-error" role="alert">${escape(error)}</p>` : ''}
      <footer class="restyle-footer">${result ? `
        <button class="button secondary" data-action="download">Download</button>${saved ? `<button class="button secondary" data-action="again">Restyle this version</button><button class="button primary" data-action="view">View version</button>` : `<button class="button primary" data-action="save" ${busy() ? 'disabled' : ''}>${saving ? 'Saving…' : 'Retry save'}</button>`}` : controller ? '<button class="button secondary" data-action="cancel">Cancel Restyle</button>' : `<button class="button secondary" data-action="${step === 1 ? 'close' : 'back'}" ${busy() ? 'disabled' : ''}>${step === 1 ? 'Cancel' : 'Back'}</button><button class="button primary" data-action="${step === 1 ? 'next' : 'run'}" ${busy() || !selected() || (step === 2 && (!inspiration || !config?.configured)) ? 'disabled' : ''}>${step === 1 ? 'Continue' : reading ? 'Opening image…' : 'Restyle'}</button>`}</footer>
    </div>`;
    if (focused) dialog.querySelector(`[data-action="${focused}"]`)?.focus({ preventScroll: true });
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
      rendered ||= await readImage(resultFile(result));
      saved = await saveVersion({ source: snapshot, inspiration, result, rendered });
    } catch (failure) {
      error = failure.name === 'QuotaExceededError' ? 'Device storage is full. Free some space, then retry saving. You can download this render now.' : 'Could not save the version. Retry save or download your render.';
    } finally { saving = false; draw(); }
    if (saved) { await onSaved(saved).catch(() => {}); draw(); }
  }

  async function run() {
    if (busy() || result || !selected() || !inspiration || !config?.configured) return;
    snapshot = sourceSnapshot(selected());
    controller = new AbortController();
    const operation = controller;
    error = ''; stage = 'extracting'; draw();
    try {
      const input = { requestId: crypto.randomUUID(), source: await imagePayload(snapshot.blob), inspiration: await imagePayload(inspiration) };
      operation.signal.throwIfAborted();
      result = await client.run(input, { signal: operation.signal, onProgress(value) { stage = value; draw(); } });
      operation.signal.throwIfAborted();
      controller = null;
      await save();
    } catch (failure) {
      error = operation.signal.aborted || failure.code === 'cancelled' ? 'Restyle cancelled. Your images are ready to try again.' : failure.message || 'Could not complete Restyle.';
      if (!result) snapshot = null;
    } finally { if (controller === operation) controller = null; draw(); }
  }

  function download() {
    if (!result) return;
    const url = URL.createObjectURL(rendered?.blob || resultFile(result));
    const link = document.createElement('a'); link.href = url; link.download = `restyle-${result.requestId}.png`; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function open(items, preselectedId) {
    if (busy()) { if (!dialog.open) dialog.showModal(); draw(); return; }
    opener = document.activeElement;
    // A failed local save remains recoverable even after the dialog is closed.
    if (!result || saved) {
      photos = [...items]; selectedId = preselectedId || null; step = preselectedId ? 2 : 1;
      inspiration = snapshot = result = rendered = saved = null; stage = null; error = ''; config = null;
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
    if (action === 'recheck') checkConfig();
    if (busy()) return;
    if (action === 'next' && selected()) { step = 2; error = ''; draw(); dialog.querySelector('[data-inspiration]')?.focus(); }
    if (action === 'back') { step = 1; error = ''; draw(); }
    if (action === 'run') run();
    if (action === 'save') save();
    if (action === 'download') download();
    if (action === 'view' && saved) { dialog.close(); onView(saved); }
    if (action === 'again' && saved) open(getPhotos(saved.roomId), saved.id);
  }, events);
  dialog.addEventListener('change', (event) => { if (event.target.matches('[data-inspiration]')) setInspiration(Array.from(event.target.files)); }, events);
  dialog.addEventListener('dragover', (event) => { event.preventDefault(); event.stopPropagation(); }, events);
  dialog.addEventListener('drop', (event) => { event.preventDefault(); event.stopPropagation(); if (step === 2 && !result) setInspiration(Array.from(event.dataTransfer.files)); }, events);
  dialog.addEventListener('cancel', (event) => { if (saving) event.preventDefault(); else controller?.abort(); }, events);
  dialog.addEventListener('close', () => {
    controller?.abort(); previewRead++; reading = false; releaseURLs(); document.body.classList.remove('restyle-open');
    opener?.isConnected && opener.focus({ preventScroll: true });
  }, events);
  return { open, get busy() { return busy(); }, get unsaved() { return Boolean(result && !saved); },
    dispose() { disposed = true; controller?.abort(); lifecycle.abort(); releaseURLs(); dialog.close(); document.body.classList.remove('restyle-open'); },
  };
}
