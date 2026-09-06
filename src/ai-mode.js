const preferenceKey = 'cicero-restyle-mode';
const listeners = new Set();
let memoryMode = 'mock';
const storage = () => globalThis.localStorage || globalThis.window?.localStorage;

export function getAIMode() {
  try { return storage()?.getItem(preferenceKey) === 'real' ? 'real' : 'mock'; }
  catch { return memoryMode; }
}

export function setAIMode(mode) {
  if (!['mock', 'real'].includes(mode)) throw new Error('Choose Mock or Real AI.');
  memoryMode = mode;
  try { storage()?.setItem(preferenceKey, mode); } catch { /* Keep the in-memory choice. */ }
  listeners.forEach((listener) => listener(mode));
  return mode;
}

export function subscribeAIMode(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function createAIModeToggle(container, { isLocked = () => false, onLocked = () => {} } = {}) {
  const controller = new AbortController();
  const render = () => {
    const mode = getAIMode();
    container.querySelectorAll('[data-ai-mode]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.aiMode === mode));
      button.disabled = isLocked();
    });
    const description = container.querySelector('[data-ai-mode-description]');
    description.textContent = mode === 'mock' ? 'No API charges' : 'Uses API credits';
  };
  container.addEventListener('click', (event) => {
    const mode = event.target.closest('[data-ai-mode]')?.dataset.aiMode;
    if (!mode) return;
    if (isLocked()) { onLocked(); render(); return; }
    setAIMode(mode);
  }, { signal: controller.signal });
  const unsubscribe = subscribeAIMode(render);
  render();
  return { refresh: render, dispose() { unsubscribe(); controller.abort(); } };
}
