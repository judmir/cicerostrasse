// Runs the real production UI and sandboxed preload in an isolated, disposable profile.
// Model responses are mocked; this never reads a real API key or calls OpenAI.
const { app, BrowserWindow, ipcMain } = require('electron');
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const profile = mkdtempSync(path.join(tmpdir(), 'cicero-electron-smoke-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
let window;
const timeout = setTimeout(() => { console.error('Electron smoke test timed out.'); app.exit(1); }, 30_000);

app.whenReady().then(async () => {
  const [{ createRunner }, { runRestyle, publicError }, { spec, geometry, completed }, { default: sharp }] = await Promise.all([
    import('../server/runner.js'), import('../server/restyle.js'), import('../tests/restyle-fixtures.js'), import('sharp'),
  ]);
  let modelCalls = 0;
  const client = {
    responses: { create: async () => { modelCalls++; return completed(modelCalls === 1 ? spec : geometry); } },
    images: { edit: async (args) => { modelCalls++; return { data: [{ b64_json: Buffer.from(await args.image.arrayBuffer()).toString('base64') }] }; } },
  };
  const runner = createRunner({ getConfig: () => ({ apiKey: 'mock-only' }), run: (input, options) => runRestyle(input, { ...options, client }) });
  require('../electron/ai-ipc.cjs').registerAIHandlers({ ipcMain, runner, publicError, allowedSender: (sender) => sender === window?.webContents });
  window = new BrowserWindow({ show: false, width: 1200, height: 850, webPreferences: { preload: path.join(__dirname, '../electron/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const pageErrors = [];
  window.webContents.on('console-message', (_event, level, message) => { if (level >= 3) pageErrors.push(message); });
  await window.loadFile(path.join(__dirname, '../dist/index.html'));
  assert.deepEqual(await window.webContents.executeJavaScript('window.restyleAI.status()'), { configured: true });
  assert.equal(await window.webContents.executeJavaScript('typeof require'), 'undefined');
  const bytes = (await sharp({ create: { width: 16, height: 9, channels: 3, background: '#a98e72' } }).png().toBuffer()).toString('base64');
  await window.webContents.executeJavaScript(`(async () => {
    const blob = new Blob([Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0))], { type: 'image/png' });
    const db = await new Promise((resolve, reject) => { const r = indexedDB.open('cicerostrasse-room-journal', 2); r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error); });
    await new Promise((resolve, reject) => { const tx = db.transaction('images', 'readwrite'); tx.objectStore('images').add({ id: 'smoke-source', roomId: 'kuche', title: 'Smoke test design', blob, width: 16, height: 9, createdAt: 1, updatedAt: 1 }); tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); });
    db.close();
  })()`);
  // A hash-only loadFile navigation reuses the document and its already-loaded gallery.
  // Force an actual reload so the app reads the seeded record from IndexedDB.
  await new Promise((resolve) => { window.webContents.once('did-finish-load', resolve); window.webContents.reload(); });
  const outcome = await window.webContents.executeJavaScript(`(async () => {
    location.hash = '/room/kuche';
    const wait = async (predicate, label) => { for (let i = 0; i < 160; i++) { if (predicate()) return; await new Promise(r => setTimeout(r, 50)); } throw new Error(label + ': ' + document.body.textContent.slice(-2500)); };
    await wait(() => document.querySelector('[data-image="smoke-source"]'), 'Source gallery');
    document.querySelector('#start-restyle').click();
    document.querySelector('[data-design="smoke-source"]').click();
    document.querySelector('[data-action="next"]').click();
    const transfer = new DataTransfer();
    transfer.items.add(new File([Uint8Array.from(atob(${JSON.stringify(bytes)}), c => c.charCodeAt(0))], 'inspiration.png', { type: 'image/png' }));
    const input = document.querySelector('[data-inspiration]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => !document.querySelector('[data-action="run"]').disabled, 'Ready to restyle');
    document.querySelector('[data-action="run"]').click();
    await wait(() => document.querySelector('[data-action="view"]'), 'Saved result');
    const comparisonImages = document.querySelectorAll('#restyle-dialog .restyle-comparison img').length;
    const success = document.querySelector('#restyle-dialog').textContent.includes('New version saved');
    document.querySelector('[data-action="view"]').click();
    document.querySelector('#album-versions-open').click();
    await wait(() => document.querySelector('#album-versions .album-version-list'), 'Version history');
    return { success, comparisonImages, related: document.querySelectorAll('[data-version]').length, geometry: document.querySelector('#album-versions').textContent.includes('No changes detected') };
  })()`);
  assert.deepEqual(outcome, { success: true, comparisonImages: 2, related: 2, geometry: true });
  assert.equal(modelCalls, 3);
  assert.deepEqual(pageErrors, []);
  console.log('Electron smoke passed: sandboxed IPC, full wizard, 3 mocked model calls, saved version, comparison and history.');
  clearTimeout(timeout); window.destroy(); app.quit();
}).catch((error) => { console.error(error); clearTimeout(timeout); app.exit(1); });
app.on('quit', () => { try { rmSync(profile, { recursive: true, force: true }); } catch {} });
