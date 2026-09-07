const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cicero-plan-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const timer = setTimeout(() => app.exit(1), 30000);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadFile(path.join(__dirname, '../dist/index.html'));
  const run = code => win.webContents.executeJavaScript(`(async () => {
    const $ = s => document.querySelector(s);
    const check = (value, label) => { if (!value) throw new Error(label); };
    const wait = async p => { for (let i = 0; i < 160; i++) { if (p()) return; await new Promise(r => setTimeout(r, 25)); } throw new Error('Navigation timed out'); };
    ${code}
  })()`);
  for (const width of [1440, 390]) {
    win.setContentSize(width, 900);
    await run(`
      location.hash = '/';
      await wait(() => $('#room-page').hidden);
      check(!$('.app-sidebar') && !$('.mobile-header') && !$('.plan-intro'), 'Dashboard chrome remains');
      check($('#plan-toggle').hidden && !$('#plan-navigation').hidden, 'Home must show only full plan');
      check(Boolean($('#floorplan canvas')), 'WebGL plan did not render');
      $('.plan-room-label[data-room="kuche"]').click();
      await wait(() => location.hash === '#/room/kuche' && !$('#room-page').hidden);
      check($('#plan-navigation').hidden, 'Room navigation should start collapsed');
      check($('[data-mini-room="kuche"]').classList.contains('is-selected'), 'Mini plan selection missing');
      $('#plan-toggle').click();
      check(!$('#plan-navigation').hidden && $('#plan-toggle').getAttribute('aria-expanded') === 'true', 'Expand failed');
      check($('.plan-room-label[data-room="kuche"]').getAttribute('aria-current') === 'page', 'Selected room missing');
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      check($('#plan-navigation').hidden && document.activeElement === $('#plan-toggle'), 'Escape must collapse and restore focus');
      $('#plan-toggle').click();
      $('.plan-room-label[data-room="bad"]').click();
      await wait(() => location.hash === '#/room/bad' && $('#plan-navigation').hidden);
      $('#plan-toggle').click();
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      check(document.documentElement.scrollWidth <= innerWidth, 'Horizontal overflow');
    `);
    fs.writeFileSync(path.join(os.tmpdir(), `cicero-plan-expanded-${width}.png`), (await win.webContents.capturePage()).toPNG());
    await run(`$('#plan-home').click(); await wait(() => $('#plan-toggle').hidden);`);
    fs.writeFileSync(path.join(os.tmpdir(), `cicero-plan-home-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  if (errors.length) throw new Error(errors.join('\n'));
  console.log('Plan navigation smoke passed: desktop/mobile home, room switching, selected room, collapse, Escape/focus, return home and no overflow.');
  clearTimeout(timer);
  win.destroy();
  app.quit();
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
