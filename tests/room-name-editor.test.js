import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { createRoomNameEditor } from '../src/room-name-editor.js';
const tick = () => new Promise(r=>setTimeout(r,0));
test('room name editor handles validation, retry, reset, Escape and pending navigation', async()=>{
  const dom=new JSDOM('<button id="rename-room">Rename</button><div id="editor"></div>');
  globalThis.document=dom.window.document;globalThis.AbortController=dom.window.AbortController;
  const box=document.querySelector('#editor');let fail=true, resolveSave;const saved=[];
  const editor=createRoomNameEditor(box,{getRoom:()=>({id:'raum3',name:'Raum 3'}),save:async(id,name)=>{saved.push([id,name]);if(fail)throw new Error('Offline');if(name===null)await new Promise(r=>{resolveSave=r;});},onSaved(){},escape:String,refreshIcons(){}});
  const submit=()=>box.querySelector('form').dispatchEvent(new dom.window.Event('submit',{bubbles:true,cancelable:true}));
  editor.open();assert.equal(document.activeElement.id,'room-name-input');
  box.querySelector('input').value='  ';submit();assert.match(box.textContent,/Enter a room name/);assert.equal(saved.length,0);
  box.querySelector('input').value='Living room';submit();await tick();assert.match(box.textContent,/previous name is unchanged/);assert.equal(box.querySelector('input').value,'Living room');
  fail=false;submit();await tick();assert.equal(box.hidden,true);assert.equal(document.activeElement.id,'rename-room');
  editor.open();box.dispatchEvent(new dom.window.KeyboardEvent('keydown',{key:'Escape',bubbles:true}));assert.equal(box.hidden,true);
  editor.open();box.querySelector('[data-name-reset]').click();assert.equal(editor.busy,true);editor.hide();assert.equal(box.hidden,true);resolveSave();await tick();assert.deepEqual(saved.at(-1),['raum3',null]);assert.equal(editor.busy,false);
  editor.dispose();dom.window.close();
});
