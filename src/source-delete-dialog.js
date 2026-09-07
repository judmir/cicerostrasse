export function createSourceDeleteDialog(dialog, { escape, removeSource, removeFamily, restoreFocus }) {
  const lifecycle = new AbortController();
  const events = { signal: lifecycle.signal };
  let target, opener, previewURL, busy = false, disposed = false;
  const release = () => { if (previewURL) URL.revokeObjectURL(previewURL); previewURL = null; };
  const setBusy = (value) => {
    busy = value;
    dialog.querySelectorAll('button').forEach((button) => { button.disabled = value; });
    const confirm = dialog.querySelector('[data-confirm-delete]');
    if (confirm) confirm.textContent = value ? 'Deleting…' : target?.kind === 'family' ? 'Delete versions' : 'Delete source';
  };

  dialog.addEventListener('click', async (event) => {
    if (busy) return;
    if (event.target.closest('[data-keep-source]')) { dialog.close(); return; }
    if (!event.target.closest('[data-confirm-delete]') || !target) return;
    setBusy(true);
    const error = dialog.querySelector('[role="alert"]');
    error.hidden = true;
    try {
      if (target.kind === 'family') await removeFamily(target.rootId);
      else await removeSource(target.image.id);
      if (!disposed) dialog.close();
    } catch {
      if (!disposed) { error.textContent = `Could not delete ${target.kind === 'family' ? 'these versions' : 'this source'}. Please try again.`; error.hidden = false; }
    } finally { if (!disposed) setBusy(false); }
  }, events);
  dialog.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); }, events);
  dialog.addEventListener('close', () => {
    target = null; release();
    if (opener?.isConnected) opener.focus({ preventScroll: true });
    else restoreFocus?.();
  }, events);

  return {
    open(image, versionCount = 0) {
      if (busy || disposed || image.archivedSource) return;
      target = { kind: 'source', image }; opener = document.activeElement; release();
      previewURL = URL.createObjectURL(image.thumbnail || image.blob);
      dialog.innerHTML = `<h2 id="source-delete-title">Delete this source?</h2>
        <img class="source-delete-preview" src="${previewURL}" alt="${escape(image.title)}"/>
        <p class="source-delete-name">${escape(image.title)}</p>
        <p id="source-delete-description">${versionCount ? `The uploaded source will be deleted. Your ${versionCount} restyled ${versionCount === 1 ? 'version and its saved source snapshot will' : 'versions and their saved source snapshots will'} stay available.` : 'This source will be removed from your collection on this device. This cannot be undone.'}</p>
        <p role="alert" hidden></p><div class="source-delete-actions"><button class="button secondary" data-keep-source autofocus>Keep source</button><button class="button destructive" data-confirm-delete>Delete source</button></div>`;
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('[data-keep-source]').focus();
    },
    openFamily(family) {
      if (busy || disposed || !family?.versions?.length) return;
      const preview = family.versions[0];
      target = { kind: 'family', rootId: family.rootId }; opener = document.activeElement; release();
      previewURL = URL.createObjectURL(preview.thumbnail || preview.blob);
      const count = family.versions.length;
      dialog.innerHTML = `<h2 id="source-delete-title">Delete retained versions?</h2>
        <img class="source-delete-preview" src="${previewURL}" alt="${escape(preview.title)}"/>
        <p class="source-delete-name">${count} saved ${count === 1 ? 'version' : 'versions'}</p>
        <p id="source-delete-description">The original source is already deleted. ${count === 1 ? 'This version and its' : 'These versions and their'} saved comparison data will be permanently removed from this device. This cannot be undone.</p>
        <p role="alert" hidden></p><div class="source-delete-actions"><button class="button secondary" data-keep-source autofocus>Keep versions</button><button class="button destructive" data-confirm-delete>Delete versions</button></div>`;
      if (!dialog.open) dialog.showModal();
      dialog.querySelector('[data-keep-source]').focus();
    },
    get busy() { return busy; },
    dispose() { disposed = true; lifecycle.abort(); release(); dialog.close(); },
  };
}
