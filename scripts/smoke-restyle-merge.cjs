// Run: RESTYLE_SMOKE_URL=http://127.0.0.1:5174 npx electron scripts/smoke-restyle-merge.cjs
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs');
const path = require('node:path');
const { tmpdir } = require('node:os');
const assert = require('node:assert/strict');

const url = process.env.RESTYLE_SMOKE_URL || 'http://127.0.0.1:5174';
const output = process.env.RESTYLE_SMOKE_OUTPUT || tmpdir();
const profile = mkdtempSync(path.join(tmpdir(), 'restyle-merge-smoke-'));
app.setPath('userData', profile);
app.setPath('sessionData', profile);
let win;
let finished = false;
function finish(code) {
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  win?.destroy();
  app.exit(code);
}
app.on('quit', () => rmSync(profile, { recursive: true, force: true }));
const timer = setTimeout(() => { console.error('Restyle smoke timed out'); finish(1); }, 60000);

app.whenReady().then(async () => {
  win = new BrowserWindow({ show: false, width: 1000, height: 850, useContentSize: true,
    webPreferences: { partition: 'restyle-merge-smoke', sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  // Prevent app initialization/storage and all backend/external requests.
  win.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    const request = new URL(details.url);
    callback({ cancel: ['http:', 'https:', 'ws:', 'wss:'].includes(request.protocol) &&
      (request.origin !== new URL(url).origin || request.pathname === '/src/main.js' || request.pathname.startsWith('/api/')) });
  });
  await win.loadURL(url);
  win.webContents.debugger.attach('1.3');
  const media = value => win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value }],
  });
  const run = code => win.webContents.executeJavaScript(`(async () => {
    const $ = selector => document.querySelector(selector);
    const check = (condition, message) => { if (!condition) throw new Error(message); };
    const wait = async (predicate, label) => {
      for (let i = 0; i < 200; i++) { if (predicate()) return; await new Promise(resolve => setTimeout(resolve, 20)); }
      throw new Error('Timed out: ' + label);
    };
    const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    ${code}
  })()`);
  await run(`
    for (const name of ['style', 'album', 'restyle', 'design-gallery', 'desktop', 'inspiration', 'room-name', 'plan-navigation']) {
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = '/src/' + name + '.css';
      await new Promise((resolve, reject) => { link.onload = resolve; link.onerror = reject; document.head.append(link); });
    }
    const { createRestyleWizard } = await import('/src/restyle-wizard.js');
    document.body.replaceChildren();
    const dialog = document.createElement('dialog'); dialog.className = 'restyle-dialog';
    dialog.setAttribute('aria-labelledby', 'restyle-title'); document.body.append(dialog);
    const fixture = async (inspiration) => {
      const canvas = document.createElement('canvas'); canvas.width = 480; canvas.height = 360;
      const c = canvas.getContext('2d');
      c.fillStyle = inspiration ? '#d5bfa3' : '#ccdce7'; c.fillRect(0, 0, 480, 360);
      c.fillStyle = inspiration ? '#855e43' : '#667e90'; c.fillRect(0, 250, 480, 110);
      c.fillStyle = inspiration ? '#49694e' : '#e6eff5'; c.fillRect(35, 35, 125, 160);
      c.fillStyle = inspiration ? '#a75736' : '#364e68'; c.fillRect(205, 170, 230, 95);
      c.fillStyle = '#f7edd9'; c.fillRect(220, 155, 85, 55); c.fillRect(325, 155, 85, 55);
      c.fillStyle = inspiration ? '#e4b84d' : '#8ba1b3'; c.beginPath(); c.ellipse(260, 300, 100, 26, 0, 0, Math.PI * 2); c.fill();
      return new File([await new Promise(resolve => canvas.toBlob(resolve, 'image/png'))], inspiration ? 'warm-inspiration.png' : 'cool-source.png', { type: 'image/png' });
    };
    window.smoke = { calls: 0, aborted: 0, saves: 0 };
    const source = await fixture(false), inspiration = await fixture(true);
    smoke.wizard = createRestyleWizard(dialog, {
      initialMode: 'mock', escape: value => String(value).replace(/[&<>"']/g, c => '&#' + c.charCodeAt(0) + ';'),
      client: { status: async () => ({ configured: false, mockAvailable: true }),
        run: (input, { signal, onProgress }) => {
          check(input.mode === 'mock', 'Must use mock mode');
          check(JSON.stringify(input.source) !== JSON.stringify(input.inspiration), 'Distinct inputs');
          smoke.calls++; smoke.progress = onProgress;
          return new Promise((resolve, reject) => signal.addEventListener('abort', () => {
            smoke.aborted++; reject(new DOMException('Cancelled', 'AbortError'));
          }, { once: true }));
        } },
      readImage: async blob => { const image = await createImageBitmap(blob); const size = { blob, width: image.width, height: image.height }; image.close(); return size; },
      saveVersion: async () => { smoke.saves++; throw new Error('Must not save'); },
      onSaved: async () => {}, onView: () => {}, getPhotos: () => [],
    });
    smoke.wizard.open([{ id: 'smoke-source', roomId: 'kuche', title: 'Cool source fixture', blob: source, width: 480, height: 360 }], 'smoke-source');
    const transfer = new DataTransfer(); transfer.items.add(inspiration);
    $('[data-inspiration]').files = transfer.files;
    $('[data-inspiration]').dispatchEvent(new Event('change', { bubbles: true }));
    await wait(() => $('[data-action="run"]')?.disabled === false, 'Uploaded inspiration ready');
    $('[data-action="run"]').click();
    await wait(() => smoke.calls === 1 && $('.restyle-merge'), 'Pending stub run');
    await Promise.all(Array.from(document.images, image => image.decode()));
  `);
  const reports = [];
  for (const [name, width, height] of [['desktop', 1000, 850], ['mobile', 390, 844]]) {
    win.setContentSize(width, height);
    await media('no-preference');
    await run('await frames();');
    const active = await run(`
      const animations = $('.restyle-merge').getAnimations({ subtree: true });
      check(animations.length >= 8, 'Expected CSS merge animations');
       check(animations.every(a => a instanceof CSSAnimation), 'CSS merge animations');
       const scan = animations.find(a => a.animationName === 'restyle-merge-scan');
       check(scan.playState === 'running', 'Loading scan running');
       const before = scan.currentTime;
      await new Promise(resolve => setTimeout(resolve, 100));
       check(scan.currentTime > before, 'Animation clock advances');
      smoke.animations = animations;
      return animations.map(a => a.animationName);
    `);
    const samples = [];
    for (const time of [0, 3000, 10000, 11200]) {
      const sample = await run(`
        for (const animation of smoke.animations) { animation.pause(); animation.currentTime = ${time}; }
        await frames();
        const read = selector => { const style = getComputedStyle($(selector)); return { transform: style.transform, opacity: Number(style.opacity), x: new DOMMatrixReadOnly(style.transform).m41 }; };
        return { source: read('.restyle-merge-source'), inspiration: read('.restyle-merge-inspiration'), blend: read('.restyle-merge-blend'), scanLeft: getComputedStyle($('.restyle-merge-scan')).left };
      `);
      samples.push(sample);
      await capture(`${name}-${time}ms`, width, height);
    }
    assert(samples[0].source.x < -70 && samples[0].inspiration.x > 70, `${name}: separated inputs`);
    assert(Math.abs(samples[1].source.x) < 1 && Math.abs(samples[1].inspiration.x) < 1, `${name}: converged inputs`);
    assert.equal(samples[0].blend.opacity, 0);
    assert.equal(samples[1].blend.opacity, 1);
    assert.equal(samples[0].source.opacity, 1);
    assert.equal(samples[0].inspiration.opacity, 1);
    assert.equal(samples[1].source.opacity, 0);
    assert.equal(samples[1].inspiration.opacity, 0);
    for (const sample of samples.slice(2)) {
      assert.equal(sample.source.opacity, 0, 'Source must not return after merging');
      assert.equal(sample.inspiration.opacity, 0, 'Inspiration must not return after merging');
      assert.equal(sample.blend.opacity, 1, 'Merged image stays visible');
    }
    assert.notEqual(samples[2].scanLeft, samples[3].scanLeft, 'Scan keeps moving after the intro finishes');
    await run(`
      const merge = $('.restyle-merge'); smoke.progress('rendering');
      check($('.restyle-merge') === merge, 'Stage update preserves animation DOM');
      check($('.restyle-progress [aria-current="step"]').textContent.includes('Rendering'), 'Rendering stage updates');
    `);
    await media('reduce');
    await run(`
      await frames();
      check(matchMedia('(prefers-reduced-motion: reduce)').matches, 'Reduced motion emulated');
      check($('.restyle-merge').getAnimations({ subtree: true }).length === 0, 'No reduced-motion animations');
      for (const el of [$('.restyle-merge'), ...$('.restyle-merge').querySelectorAll('*')]) check(getComputedStyle(el).animationName === 'none', 'Animation CSS none');
      for (const card of document.querySelectorAll('.restyle-merge-input')) {
        check(getComputedStyle(card).opacity === '1' && getComputedStyle(card).visibility === 'visible', 'Input visible');
        check(getComputedStyle(card.querySelector('span')).opacity === '1', 'Input label visible');
        const rect = card.getBoundingClientRect(), area = $('.restyle-generation-placeholder').getBoundingClientRect();
        check(rect.left >= area.left && rect.right <= area.right && rect.top >= area.top && rect.bottom <= area.bottom, 'Input fits placeholder');
      }
      check(getComputedStyle($('.restyle-merge-blend')).opacity === '0', 'Blend does not obscure reduced-motion inputs');
    `);
    await capture(`${name}-reduced-motion`, width, height);
    reports.push({ viewport: [width, height], active, samples, reducedMotion: 'passed' });
  }
  await media('no-preference');
  await run(`
    await frames();
    const animations = $('.restyle-merge').getAnimations({ subtree: true });
    $('[data-action="cancel"]').click();
    await wait(() => !$('.restyle-merge') && $('[data-action="run"]')?.disabled === false, 'Cancel restores inputs');
    check(smoke.aborted === 1 && smoke.calls === 1 && smoke.saves === 0, 'Stub aborted without saving');
    check($('.restyle-filename').textContent === 'warm-inspiration.png', 'Inspiration retained');
    check(document.querySelectorAll('.restyle-comparison img').length === 2, 'Both input previews restored');
    await Promise.all(Array.from(document.images, image => image.decode()));
    check(animations.every(a => a.playState === 'idle'), 'Removed merge animations cancelled');
    check($('.restyle-error').textContent.includes('cancelled'), 'Cancellation feedback');
  `);
  await capture('mobile-cancelled', 390, 844);
  await run('smoke.wizard.dispose();');
  console.log(JSON.stringify({ result: 'PASS', url, reports, cancellation: 'passed', profileCleanup: profile }, null, 2));
  finish(0);

  async function capture(name, width, height) {
    await run(`
      await frames();
      check(innerWidth === ${width} && innerHeight === ${height}, 'Exact viewport');
      const dialog = $('dialog'), rect = dialog.getBoundingClientRect();
      check(document.documentElement.scrollWidth <= innerWidth, 'No page horizontal overflow');
      check(dialog.scrollWidth <= dialog.clientWidth, 'No dialog horizontal overflow');
      check(rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight, 'Dialog fits viewport');
    `);
    const image = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {
      format: 'png', clip: { x: 0, y: 0, width, height, scale: 1 },
    });
    const destination = path.join(output, `restyle-merge-${name}.png`);
    writeFileSync(destination, Buffer.from(image.data, 'base64'));
    console.log('Screenshot: ' + destination);
  }
}).catch(error => { console.error(error); finish(1); });
