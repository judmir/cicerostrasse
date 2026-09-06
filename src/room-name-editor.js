import { originalRoomName, validateRoomName } from './rooms.js';

export function createRoomNameEditor(container, { getRoom, save, onSaved, escape, icon, refreshIcons }) {
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  let target, busy = false;
  const $ = selector => container.querySelector(selector);
  const opener = () => document.querySelector('#rename-room');
  function close() { if (busy) return; container.hidden = true; container.innerHTML = ''; target = null; opener()?.focus(); }
  function showError(message) { $('#room-name-error').textContent = message; $('#room-name-input').setAttribute('aria-invalid', 'true'); $('#room-name-input').focus(); }
  async function commit(reset = false) {
    if (busy || !target) return;
    let value;
    try { value = reset ? null : validateRoomName($('#room-name-input').value); }
    catch (error) { showError(error.message); return; }
    const roomId = target.id;
    busy = true;
    container.querySelectorAll('button, input').forEach(el => { el.disabled = true; });
    $('#room-name-status').textContent = 'Saving room name…';
    $('#room-name-error').textContent = '';
    try {
      await save(roomId, value);
      onSaved(roomId, value);
      busy = false; close();
    } catch (error) {
      busy = false;
      container.querySelectorAll('button, input').forEach(el => { el.disabled = false; });
      $('#room-name-status').textContent = '';
      showError(error.name === 'QuotaExceededError' ? 'Device storage is full. Free some space and try again.' : 'Could not save the room name. Your previous name is unchanged. Try again.');
    }
  }
  container.addEventListener('submit', event => { event.preventDefault(); commit(); }, events);
  container.addEventListener('click', event => { if (event.target.closest('[data-name-cancel]')) close(); if (event.target.closest('[data-name-reset]')) commit(true); }, events);
  container.addEventListener('keydown', event => { if (event.key === 'Escape') { event.preventDefault(); close(); } }, events);
  container.addEventListener('input', () => { $('#room-name-error').textContent = ''; $('#room-name-input').removeAttribute('aria-invalid'); }, events);
  return {
    open() {
      if (busy) return;
      target = getRoom(); if (!target) return;
      container.hidden = false;
      container.innerHTML = `<form class="room-name-form" aria-label="Rename room"><div class="room-name-field"><label for="room-name-input">Room name</label><input id="room-name-input" value="${escape(target.name)}" aria-describedby="room-name-help room-name-error" autocomplete="off"/><p id="room-name-help">Up to 60 characters. Original name: ${escape(originalRoomName(target.id))}.</p></div><div class="room-name-buttons"><button class="button primary" type="submit">Save name</button><button class="button secondary" type="button" data-name-cancel>Cancel</button><button class="text-button" type="button" data-name-reset>Reset to original</button></div><p id="room-name-error" role="alert"></p><span id="room-name-status" role="status"></span></form>`;
      refreshIcons(); $('#room-name-input').focus(); $('#room-name-input').select();
    },
    hide() { container.hidden = true; if (!busy) { container.innerHTML = ''; target = null; } },
    get busy() { return busy; },
    dispose() { lifecycle.abort(); },
  };
}
