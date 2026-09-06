// Production UI checks in a disposable Electron profile, with local image-link fixtures.
const { app, BrowserWindow } = require('electron');
const { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const profile = mkdtempSync(path.join(tmpdir(), 'cicero-inspiration-'));
app.setPath('userData', profile); app.setPath('sessionData', profile);
const root = path.join(__dirname, '..');
const bytes = readFileSync(path.join(root, 'public/original-floorplan.jpeg'));
const server = http.createServer((req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.url === '/page') { res.setHeader('Content-Type', 'text/html'); res.end('<h1>Page, not image</h1>'); return; }
  if (req.url === '/slow') return;
  res.setHeader('Content-Type', 'image/jpeg'); res.end(bytes);
});
let win;
const timer = setTimeout(() => { console.error('Inspiration smoke timed out'); app.exit(1); }, 60000);
app.whenReady().then(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  win = new BrowserWindow({ show: false, width: 1440, height: 960, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  win.webContents.on('console-message', (_event, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadFile(path.join(root, 'dist/index.html'), { hash: '/room/kuche/inspiration' });
  const run = code => win.webContents.executeJavaScript(`(async()=>{
    const $ = s => document.querySelector(s);
    const wait = async (predicate, label) => { for(let i=0;i<160;i++){ if(predicate()) return; await new Promise(r=>setTimeout(r,25)); } throw new Error(label + ': ' + document.body.textContent.slice(-2000)); };
    const field = (s,v) => { $(s).value=v; $(s).dispatchEvent(new Event('input',{bubbles:true})); };
    const file = () => new File([Uint8Array.from(atob(${JSON.stringify(bytes.toString('base64'))}),c=>c.charCodeAt(0))], 'Layout study.jpg', {type:'image/jpeg'});
    const records = async store => { const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('cicerostrasse-room-journal');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});return new Promise((resolve,reject)=>{const tx=db.transaction(store);const r=tx.objectStore(store).getAll();r.onsuccess=()=>{resolve(r.result);db.close();};r.onerror=()=>reject(r.error);}); };
    ${code}
  })()`);
  const capture = async (name, width, height) => {
    win.setContentSize(width, height);
    await run(`await wait(()=>$('#toast').hidden,'Toast settled'); window.scrollTo(0,0);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await Promise.all(Array.from(document.images).map(i=>i.decode().catch(()=>{})));`);
    const overflow = await run('return document.documentElement.scrollWidth > innerWidth;');
    assert.equal(overflow, false, `${name} must not overflow`);
    mkdirSync(path.join(root,'.impeccable/review'), {recursive:true});
    // Full document capture through CDP, including the mobile composer below the fold.
    if (!win.webContents.debugger.isAttached()) win.webContents.debugger.attach('1.3');
    const metrics = await win.webContents.debugger.sendCommand('Page.getLayoutMetrics');
    const result = await win.webContents.debugger.sendCommand('Page.captureScreenshot', {format:'png',captureBeyondViewport:true,clip:{x:0,y:0,width:width,height:Math.max(height,metrics.cssContentSize.height),scale:1}});
    writeFileSync(path.join(root,`.impeccable/review/${name}.png`),Buffer.from(result.data,'base64'));
  };
  await run(`await wait(()=>$('.inspiration-empty'), 'Empty collection'); if($('#gallery').hidden!==true)throw new Error('Sources visible in inspiration');`);
  await capture('desktop-empty',1440,960); await capture('mobile-empty',390,844);
  await run(`$('[data-inspiration-add]').click(); field('#inspiration-url','javascript:alert(1)'); $('[data-inspiration-load]').click(); await wait(()=>$('.inspiration-error').textContent.includes('http'), 'URL validation'); field('#inspiration-url',${JSON.stringify(base+'/page')}); $('[data-inspiration-load]').click(); await wait(()=>$('.inspiration-error').textContent.includes('Use a JPG'), 'Page validation'); field('#inspiration-url',${JSON.stringify(base+'/slow')}); $('[data-inspiration-load]').click(); await wait(()=>$('.inspiration-composer').getAttribute('aria-busy')==='true','Loading state'); $('[data-inspiration-cancel]').click(); if($('.inspiration-composer').getAttribute('aria-busy')!=='false')throw new Error('Cancel failed');`);
  await run(`field('#inspiration-url',${JSON.stringify(base+'/image')}); $('[data-inspiration-load]').click(); await wait(()=>$('.inspiration-draft-preview'), 'Link preview'); field('#inspiration-title','Layout study · linked image'); field('#inspiration-note','Fixture: explore a compact seating arrangement beside the window.'); $('.inspiration-composer').requestSubmit(); await wait(()=>document.querySelectorAll('[data-inspiration-item]').length===1,'Saved link');`);
  await run(`$('[data-inspiration-add]').click(); const dt=new DataTransfer(); dt.items.add(file()); $('[data-inspiration-file]').files=dt.files; $('[data-inspiration-file]').dispatchEvent(new Event('change',{bubbles:true})); await wait(()=>$('.inspiration-draft-preview'),'Upload preview'); field('#inspiration-title','Measured layout · uploaded image'); field('#inspiration-url','https://example.com/layout'); field('#inspiration-note','Fixture: leave a clear path between the door and balcony.'); $('.inspiration-composer').requestSubmit(); await wait(()=>document.querySelectorAll('[data-inspiration-item]').length===2,'Saved upload');`);
  await run(`const dt=new DataTransfer();dt.items.add(file());document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));await wait(()=>$('.inspiration-draft-preview'),'Clipboard preview');field('#inspiration-title','Pasted image');$('.inspiration-composer').requestSubmit();await wait(()=>document.querySelectorAll('[data-inspiration-item]').length===3,'Saved paste');const saved=await records('inspirations');if(saved.length!==3||saved.some(x=>x.roomId!=='kuche'||!x.blob.size))throw new Error('Persistence failed');if((await records('images')).length)throw new Error('Inspiration contaminated sources');`);
  await run(`$('[data-inspiration-edit]').click();field('#inspiration-note','Edited note survives reload.');$('.inspiration-composer').requestSubmit();await wait(()=>!$('.inspiration-composer'),'Edited');location.hash='/room/bad/inspiration';await wait(()=>$('.inspiration-empty')&&$('#room-title').textContent==='Bad','Room isolation');location.hash='/room/kuche/inspiration';await wait(()=>document.querySelectorAll('[data-inspiration-item]').length===3,'Return to room');`);
  await new Promise(resolve=>{win.webContents.once('did-finish-load',resolve);win.webContents.reload();});
  await run(`await wait(()=>document.querySelectorAll('[data-inspiration-item]').length===3,'Reload persistence');if(!document.body.textContent.includes('Edited note survives reload.'))throw new Error('Edit lost');$('[data-inspiration-view]').click();if(!$('.inspiration-viewer').open)throw new Error('Viewer');`);
  await win.webContents.sendInputEvent({type:'keyDown',keyCode:'Escape'}); await win.webContents.sendInputEvent({type:'keyUp',keyCode:'Escape'});
  await run(`await wait(()=>!$('.inspiration-viewer').open,'Escape closes viewer');$('[data-inspiration-delete]').click();if(document.activeElement!==$('[data-inspiration-keep]'))throw new Error('Delete focus');$('[data-inspiration-keep]').click();$('[data-inspiration-delete]').click();$('[data-inspiration-confirm]').click();await wait(()=>document.querySelectorAll('[data-inspiration-item]').length===2,'Deletion');`);
  await capture('desktop',1440,960);await capture('mobile',390,844);
  await run(`$('[data-inspiration-add]').click();`);
  await capture('desktop-composer',1440,960);await capture('mobile-composer',390,844);
  await run(`$('[data-inspiration-cancel]').click();$('#sources-link').click();await wait(()=>!$('#gallery').hidden,'Source tab');const dt=new DataTransfer();dt.items.add(file());document.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true}));if(!$('#inspiration-gallery').hidden)throw new Error('Paste leaked into sources');`);
  assert.deepEqual(errors,[]);
  console.log('Inspiration smoke passed: URL/file/clipboard, validation and cancellation, room isolation, edit/delete/viewer focus, reload persistence, source separation; desktop/mobile screenshots captured.');
  clearTimeout(timer);win.destroy();server.closeAllConnections();server.close();app.quit();
}).catch(error=>{console.error(error);clearTimeout(timer);server.closeAllConnections();server.close();app.exit(1);});
app.on('quit',()=>{try{rmSync(profile,{recursive:true,force:true});}catch{}});
