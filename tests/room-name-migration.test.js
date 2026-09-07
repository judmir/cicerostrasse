import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

test('version 3 upgrade preserves all collections and adds room-name and initial-design stores', async()=>{
  await new Promise((resolve,reject)=>{const r=indexedDB.open('cicerostrasse-room-journal',3);r.onupgradeneeded=()=>{
    const db=r.result;const images=db.createObjectStore('images',{keyPath:'id'});for(const key of ['roomId','rootImageId','parentImageId'])images.createIndex(key,key);images.add({id:'version',roomId:'raum3',rootImageId:'source',parentImageId:'source',restyleId:'restyle'});
    db.createObjectStore('notes',{keyPath:'roomId'}).add({roomId:'raum3',text:'Retain'});
    db.createObjectStore('restyles',{keyPath:'requestId'}).add({requestId:'restyle',imageId:'version'});
    const ideas=db.createObjectStore('inspirations',{keyPath:'id'});ideas.createIndex('roomId','roomId');ideas.add({id:'idea',roomId:'raum3',blob:new Blob(['bytes'],{type:'image/png'}),createdAt:1});
  };r.onsuccess=()=>{r.result.close();resolve();};r.onerror=()=>reject(r.error);});
  const s=await import('../src/storage.js');
  const db=await s.openDatabase();
  assert.equal(db.version,5);
  assert.ok(db.objectStoreNames.contains('firstDesignDrafts'));
  assert.ok(db.objectStoreNames.contains('firstDesigns'));
  assert.deepEqual(await s.listRoomNames(),[]);
  assert.equal((await s.getImage('version')).rootImageId,'source');
  assert.equal(await s.getNotes('raum3'),'Retain');
  assert.equal((await s.getRestyleRecord('restyle')).imageId,'version');
  assert.equal(await (await s.listInspirations('raum3'))[0].blob.text(),'bytes');
});
