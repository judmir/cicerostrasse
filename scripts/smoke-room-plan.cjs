const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cicero-room-plan-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const timer = setTimeout(() => { console.error('Room-plan smoke timed out'); app.exit(1); }, 30000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 960,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/room/raum3' });
  await win.webContents.executeJavaScript(`(async () => {
    const wait = async (check) => {
      for (let i = 0; i < 160; i++) {
        if (check()) return;
        await new Promise(resolve => setTimeout(resolve, 25));
      }
      throw new Error('Room page did not update');
    };
    const plan = () => document.querySelector('#room-plan-content');
    await wait(() => !document.querySelector('#rename-room').disabled);
    for (const [id, dimensions] of Object.entries({ raum3: '4.52 × 4.67 m', kuche: '2.17 × 4.06 m', bad: '1.46 × 4.06 m', raum2: '2.93 × 4.06 m', raum1: '3.45 × 5.85 m', flur: '6.72 × 1.71 m', loggia: '4.40 × 1.37 m' })) {
      location.hash = '/room/' + id;
      await wait(() => plan().textContent.includes(dimensions));
      if (!plan().querySelector('svg')?.getBoundingClientRect().width || !plan().querySelector('.room-measurements')) throw new Error('Missing room plan: ' + id);
    }
    document.querySelector('#rename-room').click();
    const input = document.querySelector('#room-name-input');
    input.value = 'Renamed balcony';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.room-name-form').requestSubmit();
    await wait(() => plan().querySelector('title').textContent === 'Renamed balcony floor plan');
    document.querySelector('#inspiration-link').click();
    await wait(() => !document.querySelector('#inspiration-gallery').hidden);
    if (!plan().querySelector('svg').getBoundingClientRect().width) throw new Error('Plan missing on inspiration tab');
  })()`);
  for (const width of [1440, 390, 320]) {
    win.setContentSize(width, 960);
    await win.webContents.executeJavaScript(`new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))`);
    await win.webContents.executeJavaScript(`(() => {
      const plan = document.querySelector('.room-plan-sidebar').getBoundingClientRect();
      const gallery = document.querySelector('.room-gallery-content').getBoundingClientRect();
      if (document.documentElement.scrollWidth > innerWidth) throw new Error('Horizontal overflow at ' + innerWidth);
      if (innerWidth > 800 ? plan.left < gallery.right : plan.bottom > gallery.top) throw new Error('Incorrect plan placement');
    })()`);
  }
  console.log('Room-plan smoke passed: all rooms, dimensions, renaming, inspiration, desktop and mobile layout.');
  clearTimeout(timer);
  win.destroy();
  app.quit();
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
