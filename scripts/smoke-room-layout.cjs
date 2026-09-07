const { app, BrowserWindow } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const artifacts = '/var/folders/bj/t64mln250w70_9hgymm9bsl80000gn/T/opencode';
const profile = fs.mkdtempSync(path.join(artifacts, 'cicero-room-layout-'));
const screenshot = path.join(artifacts, 'room-layout.png');
app.setPath('userData', profile);
app.setPath('sessionData', profile);
const timer = setTimeout(() => { console.error('Room-layout smoke timed out'); app.exit(1); }, 120000);

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, width: 1440, height: 960,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  // This smoke seeds IndexedDB; never use configured cloud storage or create remote test data.
  await win.webContents.session.protocol.handle('https', () => new Response('{"message":"Remote services disabled for local smoke test"}', { status: 403, headers: { 'Content-Type': 'application/json' } }));
  const run = source => win.webContents.executeJavaScript(source);
  const settle = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const wait = condition => run(`(async () => {
    for (let i = 0; i < 600; i++) {
      if (${condition}) return;
      await new Promise(resolve => setTimeout(resolve, 25));
    }
    throw new Error('Timed out waiting for: ' + ${JSON.stringify(condition)} + '; dialog error: ' + (document.querySelector('#room-layout-dialog [data-error]')?.textContent || 'none'));
  })()`);
  const open = async () => {
    await wait("document.querySelector('#rename-room')?.disabled === false");
    await run("document.querySelector('#style-room').click()");
    await wait("document.querySelector('#room-layout-dialog')?.open && document.querySelector('[data-step-title]')");
    await settle();
  };
  const geometry = () => run(`(() => {
    const item = document.querySelector('[data-placement]');
    return {
      id: item.dataset.placement,
      transform: item.getAttribute('transform'),
      position: [item.transform.baseVal.getItem(0).matrix.e, item.transform.baseVal.getItem(0).matrix.f],
      fields: Object.fromEntries([...document.querySelectorAll('[data-field]')].map(input => [input.dataset.field, Number(input.value)]))
    };
  })()`);
  const drag = async (selector, dx, dy) => {
    const start = await run(`(() => {
      const node = document.querySelector(${JSON.stringify(selector)});
      node.scrollIntoView({ block: 'center' });
      const rect = node.getBoundingClientRect();
      const x = Math.round(rect.x + rect.width / 2), y = Math.round(rect.y + rect.height / 2);
      if (!node.contains(document.elementFromPoint(x, y))) throw new Error('Pointer target is obscured');
      return { x, y };
    })()`);
    await settle();
    win.webContents.sendInputEvent({ type: 'mouseMove', ...start });
    win.webContents.sendInputEvent({ type: 'mouseDown', ...start, button: 'left', clickCount: 1 });
    await settle();
    for (let step = 1; step <= 6; step++) {
      win.webContents.sendInputEvent({ type: 'mouseMove', x: start.x + Math.round(dx * step / 6), y: start.y + Math.round(dy * step / 6), modifiers: ['leftButtonDown'] });
      await settle();
    }
    win.webContents.sendInputEvent({ type: 'mouseUp', x: start.x + dx, y: start.y + dy, button: 'left', clickCount: 1 });
    await settle();
  };
  const overflow = async (width, modal) => {
    await settle();
    const result = await run(`(() => {
      const dialog = document.querySelector('#room-layout-dialog');
      const rect = dialog.getBoundingClientRect();
      return { viewport: innerWidth, page: document.documentElement.scrollWidth,
        body: document.body.scrollWidth, modal: dialog.scrollWidth, modalClient: dialog.clientWidth,
        left: rect.left, right: rect.right, open: dialog.open };
    })()`);
    assert.equal(result.viewport, width);
    assert.equal(result.open, modal);
    assert.ok(result.page <= width && result.body <= width, `Page overflow: ${JSON.stringify(result)}`);
    if (modal) {
      assert.ok(result.modal <= result.modalClient, `Modal overflow: ${JSON.stringify(result)}`);
      assert.ok(result.left >= 0 && result.right <= width, `Modal outside viewport: ${JSON.stringify(result)}`);
    }
    console.log(`${width}px ${modal ? 'page + modal' : 'page'}: no horizontal overflow`);
  };

  await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/room/raum3' });
  await wait("document.querySelector('#rename-room')?.disabled === false");
  await run(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#6b655c'; ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#b7ad99'; ctx.fillRect(60, 40, 300, 280); ctx.fillStyle = '#383b38'; ctx.fillRect(0, 340, 640, 140);
    window.smokeImage = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const db = await new Promise(resolve => { const r = indexedDB.open('cicerostrasse-room-journal', 5); r.onsuccess = () => resolve(r.result); });
    await new Promise((resolve, reject) => {
      const tx = db.transaction('images', 'readwrite');
      for (const [id, extra] of [['original-a', {}], ['original-b', {}], ['generated', { firstDesignId: 'generated' }], ['other-room', { roomId: 'bad' }]]) {
        tx.objectStore('images').put({ id, roomId: 'raum3', blob: window.smokeImage, title: id, createdAt: Date.now(), ...extra });
      }
      tx.oncomplete = resolve; tx.onerror = () => reject(tx.error);
    }); db.close();
  })()`);
  await open();
  assert.deepEqual(await run("[...document.querySelectorAll('[id]')].map(n => n.id).filter((id, i, ids) => ids.indexOf(id) !== i)"), [], 'Duplicate IDs');
  assert.equal(await run("getComputedStyle(document.querySelector('#room-layout-dialog')).backgroundColor"), 'rgb(28, 28, 31)');
  assert.notEqual(await run("document.querySelector('[data-plan]').getAttribute('viewBox')"), '0 0 280 370');
  assert.equal(await run("document.querySelectorAll('[data-placement]').length"), 0);
  assert.deepEqual(await run("[...document.querySelectorAll('[data-category][open]')].map(n => n.dataset.category)"), ['living']);
  await run("document.querySelector('[data-category=kids] summary').click(); document.querySelector('[data-add=sofa]').click()");
  assert.deepEqual(await run("[...document.querySelectorAll('[data-category][open]')].map(n => n.dataset.category)"), ['kids', 'living']);
  assert.equal(await run("document.querySelectorAll('[data-placement]').length"), 1);
  const initial = await geometry();
  assert.equal(initial.fields.widthM, 2.1);
  assert.equal(initial.fields.depthM, 0.9);
  assert.equal(initial.fields.rotationDeg, 360);
  await drag('[data-footprint]', 20, 15);
  const moved = await geometry();
  assert.ok(moved.position[0] > initial.position[0] + .1 && moved.position[1] > initial.position[1] + .1, 'Real pointer drag did not move the sofa');
  await drag('[data-resize]', 20, 15);
  const resized = await geometry();
  assert.ok(resized.fields.widthM > moved.fields.widthM + 0.1 && resized.fields.depthM > moved.fields.depthM + 0.1, 'Real pointer resize did not enlarge the sofa');
  assert.deepEqual(resized.position, moved.position);
  assert.deepEqual(await run("[...document.querySelector('[data-field=rotationDeg]').options].map(o => Number(o.value))"), [90, 180, 270, 360]);
  for (const angle of [180, 360]) {
    await run(`(() => { const control = document.querySelector('[data-field=rotationDeg]'); control.value = '${angle}'; control.dispatchEvent(new Event('change', { bubbles: true })); })()`);
    assert.equal((await geometry()).fields.rotationDeg, angle);
  }
  const finalLayout = await geometry();
  console.log('Room launcher, add sofa, real pointer drag and resize: passed');

  await run("document.querySelector('[data-save]').click()");
  await wait("!document.querySelector('#room-layout-dialog').open");
  await open();
  assert.deepEqual(await geometry(), finalLayout, 'Saved layout changed on reopen');
  await run("document.querySelector('[data-action=close]').click()");
  await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/room/raum3' });
  await open();
  assert.equal(await run("document.querySelectorAll('[data-placement]').length"), 1);
  assert.deepEqual(await geometry(), finalLayout, 'Saved layout did not persist across page reload');
  console.log('Save/reopen and full page reload persistence: passed');

  win.show(); win.focus();
  await run("document.querySelector('[data-action=next]').focus()");
  await settle();
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Return' });
  win.webContents.sendInputEvent({ type: 'char', keyCode: '\r' });
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Return' });
  await wait("document.querySelector('[data-source]')");
  assert.equal(await run("document.activeElement.hasAttribute('data-step-title')"), true);
  assert.deepEqual(await run("[...document.querySelectorAll('[data-source]')].map(n => n.dataset.source).sort()"), ['original-a', 'original-b']);
  await run("document.querySelector('[data-action=next]').click()");
  assert.match(await run("document.querySelector('[data-error]').textContent"), /Select at least/);
  await run("document.querySelectorAll('[data-source]').forEach(n => n.click()); document.querySelector('[data-action=next]').click()");
  await run(`(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('cicerostrasse-room-journal', 5); r.onsuccess = () => resolve(r.result); });
    const photo = await new Promise(resolve => { const r = db.transaction('images').objectStore('images').get('original-a'); r.onsuccess = () => resolve(r.result); }); db.close();
    window.smokeImage = photo.blob;
    const transfer = new DataTransfer(); transfer.items.add(new File([photo.blob], 'upload.png', { type: 'image/png' }));
    const input = document.querySelector('[data-reference-file]'); input.files = transfer.files; input.dispatchEvent(new Event('change', { bubbles: true }));
  })()`);
  await wait("document.querySelector('.rl-reference img')?.alt === 'upload.png' && !document.querySelector('[data-save]').disabled");
  await run(`(() => {
    const transfer = new DataTransfer(); transfer.items.add(new File([window.smokeImage], 'pasted.png', { type: 'image/png' }));
    document.querySelector('.rl-reference').dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  })()`);
  await wait("document.querySelector('.rl-reference img')?.alt === 'pasted.png' && !document.querySelector('[data-save]').disabled");
  await run("const instructions = document.querySelector('[data-instructions]'); instructions.value = 'Warm oak, soft light. Keep the windows clear.'; instructions.dispatchEvent(new Event('input', { bubbles: true })); document.querySelector('[data-save]').click()");
  await wait("!document.querySelector('#room-layout-dialog').open");
  await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/room/raum3' });
  await open();
  assert.equal(await run("document.querySelector('.rl-reference img').alt"), 'pasted.png');
  assert.match(await run("document.querySelector('[data-instructions]').value"), /Warm oak/);
  assert.equal(await run("document.querySelector('[data-save]').textContent"), 'Save & close');
  assert.equal(await run("document.querySelector('[data-action=generate]').textContent"), 'Style with AI');
  await run("document.querySelector('[data-action=back]').click()");
  assert.equal(await run("document.querySelectorAll('[data-source]:checked').length"), 2);
  await run("document.querySelector('[data-step=\"1\"]').click()");
  assert.deepEqual(await geometry(), finalLayout);
  await run("document.querySelector('[data-save]').click()");
  await wait("!document.querySelector('#room-layout-dialog').open");
  await open();
  console.log('Keyboard Next, source isolation, multi-select, upload/paste replacement and full draft reload: passed');

  for (const width of [1440, 390, 320]) {
    await run("document.querySelector('[data-save]').click()");
    await wait("!document.querySelector('#room-layout-dialog').open");
    win.setContentSize(width, 960);
    await overflow(width, false);
    await open();
    await run("document.querySelectorAll('[data-category]').forEach(n => { n.open = true; })");
    await overflow(width, true);
    await run("document.querySelector('#room-layout-dialog').scrollTop = 0");
    await settle();
    fs.writeFileSync(path.join(artifacts, `room-layout-${width}.png`), (await win.webContents.capturePage()).toPNG());
    if (width < 760) {
      await run("document.querySelector('[data-save]').scrollIntoView({ block: 'end' })");
      await settle();
      assert.equal(await run("(() => { const r = document.querySelector('[data-save]').getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; })()"), true);
      fs.writeFileSync(path.join(artifacts, `room-layout-${width}-controls.png`), (await win.webContents.capturePage()).toPNG());
    }
    for (const step of [2, 3]) {
      await run(`document.querySelector('[data-step="${step}"]').click()`);
      await overflow(width, true);
      await run("document.querySelector('#room-layout-dialog').scrollTop = 0");
      await new Promise(resolve => setTimeout(resolve, 200));
      fs.writeFileSync(path.join(artifacts, `room-layout-${width}-step-${step}.png`), (await win.webContents.capturePage()).toPNG());
    }
    await run("document.querySelector('[data-step=\"1\"]').click()");
  }
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  assert.equal(await run("getComputedStyle(document.querySelector('.rl-stage')).animationName"), 'none');
  win.webContents.debugger.detach();
  console.log('Reduced-motion animation opt-out: passed');
  await run("document.querySelector('[data-save]').click()");
  await wait("!document.querySelector('#room-layout-dialog').open");
  for (const width of [1440, 390, 320]) {
    win.setContentSize(width, width < 760 ? 844 : 960);
    for (const roomId of ['raum3', 'raum1', 'raum2', 'kuche', 'bad', 'flur', 'loggia']) {
      await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: `/room/${roomId}` });
      await open();
      await overflow(width, true);
      const bounds = await run(`(() => {
        const svg = document.querySelector('[data-plan]');
        const box = svg.viewBox.baseVal, drawing = svg.getBBox();
        const floor = svg.querySelector('.room-diagram-floor').getBoundingClientRect();
        const frame = svg.getBoundingClientRect(), matrix = svg.getScreenCTM();
        return { inside: drawing.x >= box.x && drawing.y >= box.y && drawing.x + drawing.width <= box.x + box.width && drawing.y + drawing.height <= box.y + box.height,
          uniform: Math.abs(matrix.a - matrix.d) < .0001,
          fill: Math.max(floor.width / frame.width, floor.height / frame.height),
          headingHidden: document.querySelector('[data-step-title]').classList.contains('rl-sr-only'),
          helpHidden: getComputedStyle(document.querySelector('#rl-plan-help')).clipPath === 'inset(50%)',
          focused: document.activeElement.hasAttribute('data-step-title') };
      })()`);
      assert.ok(bounds.inside, `${roomId}: diagram or labels clipped`);
      assert.ok(bounds.uniform && bounds.fill > .65, `${roomId}: plan too small or stretched: ${JSON.stringify(bounds)}`);
      assert.ok(bounds.headingHidden && bounds.helpHidden && bounds.focused);
      await run("document.querySelector('#room-layout-dialog').scrollTop = 0");
      await new Promise(resolve => setTimeout(resolve, 200));
      fs.writeFileSync(path.join(artifacts, `room-layout-${width}-${roomId}.png`), (await win.webContents.capturePage()).toPNG());
      await run("document.querySelector('[data-action=close]').click()");
    }
  }
  console.log('All seven room aspect ratios: tight bounds, dimensions, uniform scaling and accessible hidden text passed at 1440/390/320px');
  await win.loadFile(path.join(__dirname, '../dist/index.html'), { hash: '/room/raum3' });
  await open();
  win.setContentSize(1440, 960);
  await run("document.querySelector('#room-layout-dialog').scrollTop = 0");
  await settle();
  const image = await win.webContents.capturePage();
  assert.ok(!image.isEmpty(), 'Screenshot was empty');
  fs.writeFileSync(screenshot, image.toPNG());
  await run("document.querySelector('[data-save]').click()");
  await wait("!document.querySelector('#room-layout-dialog').open");
  // Exercise the actual HTTP pipeline using an isolated browser profile and Mock only.
  await win.loadURL(`${process.env.ROOM_LAYOUT_SMOKE_URL || 'http://127.0.0.1:5174'}/#/room/raum3`);
  await wait("document.querySelector('#rename-room')?.disabled === false");
  await run(`(async () => {
    localStorage.setItem('cicero-restyle-mode', 'mock');
    const { addImage, saveFirstDesignDraft } = await import('/src/storage.js');
    const canvas = document.createElement('canvas'); canvas.width = 640; canvas.height = 480;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#837b72'; ctx.fillRect(0, 0, 640, 480);
    ctx.fillStyle = '#b7ad99'; ctx.fillRect(60, 40, 300, 280); ctx.fillStyle = '#383b38'; ctx.fillRect(0, 340, 640, 140);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const photo = await addImage({ roomId: 'raum3', blob, title: 'Smoke room', filename: 'room.png' });
    await saveFirstDesignDraft({ roomId: 'raum3', layoutWizardStep: 3, selectedSourceIds: [photo.id], viewpointSourceId: photo.id,
      styleBrief: 'Warm oak', layoutReferenceBlob: blob, layoutReferenceName: 'Style only',
      layout: { version: 1, placements: [{ id: 'sofa', itemType: 'sofa', label: 'Sofa', x: .5, y: .5, widthM: 2.1, depthM: .9, rotationDeg: 360 }] } });
  })()`);
  await open();
  await wait("document.querySelector('[data-action=generate]')?.disabled === false");
  await run("document.querySelector('[data-action=generate]').click()");
  await wait("document.querySelector('.rl-generating')");
  assert.match(await run("document.querySelector('.rl-generation').textContent"), /Mock/);
  await wait("document.querySelector('.rl-generation [role=status]')?.textContent.includes('Generating image')");
  await wait("document.querySelector('.rl-generating img')?.naturalWidth > 0");
  assert.match(await run("document.querySelector('.rl-generation').textContent"), /Selected source photo, not generated output/);
  assert.equal(await run("document.querySelector('.rl-dots, .rl-silhouette, .rl-result')"), null);
  assert.equal(await run("getComputedStyle(document.querySelector('.rl-generating img')).filter"), 'blur(3px) brightness(0.55)');
  for (const width of [1440, 390, 320]) {
    win.setContentSize(width, width < 760 ? 844 : 960); await overflow(width, true);
    const before = await run(`(() => {
      const scan = document.querySelector('.rl-generating .restyle-merge-scan');
      const animation = scan.getAnimations()[0];
      animation.pause();
      const style = getComputedStyle(scan);
      if (style.animationName !== 'restyle-merge-scan' || style.width !== '2px' || style.animationDirection !== 'alternate' || style.animationTimingFunction !== 'ease-in-out' || style.animationIterationCount !== 'infinite' || style.animationDelay !== '0s') throw new Error('Expected shared continuous pingpong scan without startup delay');
      const frames = animation.effect.getKeyframes();
      if (frames.length !== 2 || frames[0].left !== '0px' || frames[1].left !== 'calc(100% - 2px)') throw new Error('Expected shared in-frame endpoints');
      const duration = animation.effect.getTiming().duration;
      const bounds = scan.parentElement.getBoundingClientRect();
      if (getComputedStyle(scan.parentElement).overflow !== 'hidden') throw new Error('Sweep must be clipped');
      for (const cycle of [0, 1, 2]) {
        const direction = cycle % 2 === 0 ? 1 : -1;
        let previous;
        for (const fraction of [0, .25, .5, .75, 1]) {
          animation.currentTime = duration * (cycle + fraction);
          const rect = scan.getBoundingClientRect();
          if (previous !== undefined && (rect.left - previous) * direction <= 0) throw new Error('Scan must alternate left-right-left-right');
          if (rect.left < bounds.left - .1 || rect.right > bounds.right + .1) throw new Error('Scan must remain inside the frame');
          previous = rect.left;
        }
      }
      for (const turn of [1, 2]) {
        const positions = [-1, 0, 1].map(offset => {
          animation.currentTime = duration * turn + offset;
          return scan.getBoundingClientRect().left;
        });
        const edge = turn === 1 ? bounds.right - 2 : bounds.left;
        if (positions.some(left => Math.abs(left - edge) > .1)) throw new Error('Scan jumped or disappeared at a turnaround');
      }
      animation.currentTime = 900;
      animation.play();
      return scan.getBoundingClientRect().left;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(await run("document.querySelector('.rl-generating .restyle-merge-scan').getBoundingClientRect().left") > before, 'Sweep must move left to right');
    const returning = await run(`(() => {
      const scan = document.querySelector('.rl-generating .restyle-merge-scan');
      const animation = scan.getAnimations()[0];
      animation.currentTime = animation.effect.getTiming().duration + 900;
      return scan.getBoundingClientRect().left;
    })()`);
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.ok(await run("document.querySelector('.rl-generating .restyle-merge-scan').getBoundingClientRect().left") < returning, 'Sweep must move right to left');
    fs.writeFileSync(path.join(artifacts, `room-layout-generation-${width}.png`), (await win.webContents.capturePage()).toPNG());
  }
  win.webContents.debugger.attach('1.3');
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
  for (const width of [1440, 390, 320]) {
    win.setContentSize(width, width < 760 ? 844 : 960); await overflow(width, true);
    assert.equal(await run("getComputedStyle(document.querySelector('.rl-generating .restyle-merge-scan')).animationName"), 'none');
    assert.equal(await run("document.querySelector('.rl-generating').getAnimations({ subtree: true }).length"), 0);
    assert.equal(await run("(() => { const scan = document.querySelector('.rl-generating .restyle-merge-scan'); return Math.abs(parseFloat(getComputedStyle(scan).left) - scan.parentElement.clientWidth / 2) < 1 && getComputedStyle(scan).opacity === '0.5'; })()"), true, 'Reduced-motion scan stays centered and dimmed');
    fs.writeFileSync(path.join(artifacts, `room-layout-generation-${width}-reduced.png`), (await win.webContents.capturePage()).toPNG());
  }
  await win.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
  win.webContents.debugger.detach();
  win.setContentSize(1440, 960); await settle();
  fs.writeFileSync(path.join(artifacts, 'room-layout-generation.png'), (await win.webContents.capturePage()).toPNG());
  assert.equal(await run("document.querySelector('progress') !== null && !document.querySelector('progress').closest('[hidden]')"), false);
  await wait("document.querySelector('.rl-result')");
  for (const width of [1440, 390, 320]) {
    win.setContentSize(width, 960); await overflow(width, true);
  }
  win.setContentSize(1440, 960); await settle();
  fs.writeFileSync(path.join(artifacts, 'room-layout-result.png'), (await win.webContents.capturePage()).toPNG());
  await run("document.querySelector('[data-action=save-design]').click()");
  await wait("document.querySelector('[data-action=open-design]')");
  await run("document.querySelector('[data-action=open-design]').click()");
  await wait("!document.querySelector('#room-layout-dialog').open && document.querySelector('[data-source-preview]')");
  assert.match(await run("document.querySelector('#design-title').textContent"), /Mock first design/);
  assert.equal(await run("document.querySelector('.design-context-label').textContent"), 'Versions');
  await win.reload();
  await wait("document.querySelector('[data-source-preview]')");
  assert.match(await run("document.querySelector('#design-title').textContent"), /Mock first design/);
  await run("document.querySelector('[data-source-preview]').click()");
  await wait("document.querySelector('#image-dialog').open");
  assert.match(await run("document.querySelector('#image-dialog-title').textContent"), /First design.*Mock preview/);
  assert.equal(await run("document.querySelector('[data-action=replace]').hidden"), true);
  console.log('Mock HTTP generation, animated progress, save, generated-root navigation, reload and viewer provenance: passed');
  console.log(`Room-layout smoke passed. Screenshot: ${screenshot}`);
  clearTimeout(timer);
  win.destroy();
  app.quit();
}).catch(error => { console.error(error); clearTimeout(timer); app.exit(1); });
app.on('quit', () => fs.rmSync(profile, { recursive: true, force: true }));
