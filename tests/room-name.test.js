import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { rooms, roomById, applyRoomNames, setRoomDisplayName, originalRoomName, validateRoomName } from '../src/rooms.js';
import { saveRoomName, listRoomNames, addImage, addInspiration, listImages, listInspirations } from '../src/storage.js';
import { renderRoomPlan } from '../src/room-plan.js';

test('room names persist separately without changing IDs, geometry, photos or inspiration', async () => {
  const room = roomById('raum3');
  const polygon = JSON.stringify(room.polygon);
  const blob = new Blob(['photo'], {type:'image/png'});
  const photo = await addImage({roomId: room.id, blob});
  const idea = await addInspiration({roomId: room.id, blob});
  await saveRoomName(room.id, '  Living & dining  ');
  const reloaded = await import('../src/storage.js?names-reload');
  applyRoomNames(await reloaded.listRoomNames());
  assert.equal(room.name, 'Living & dining');
  assert.equal(originalRoomName(room.id), 'Raum 3');
  assert.equal(JSON.stringify(room.polygon), polygon);
  assert.equal((await listImages(room.id))[0].id, photo.id);
  assert.equal((await listInspirations(room.id))[0].id, idea.id);
  assert.equal(rooms.find(r=>r.name==='Living & dining').id, 'raum3');
  await saveRoomName(room.id, null); applyRoomNames(await listRoomNames());
  assert.equal(room.name, 'Raum 3');
});

test('blank, oversized and multiline room names reject; markup is escaped in room SVG', async () => {
  for (const name of ['', '   ', 'x'.repeat(61), 'Desk\nRoom']) assert.throws(()=>validateRoomName(name));
  assert.throws(()=>saveRoomName('missing','Desk'),/valid room/);
  setRoomDisplayName('raum3','<img src=x onerror=alert(1)>');
  const html = renderRoomPlan(roomById('raum3'));
  assert.ok(html.includes('&lt;img'));
  assert.ok(!html.includes('<img src=x'));
  assert.ok(html.includes('floor plan</title>'));
  applyRoomNames([{roomId:'raum3',name:''},{roomId:'missing',name:'Unknown'}]);
  assert.equal(roomById('raum3').name,'Raum 3');
});
