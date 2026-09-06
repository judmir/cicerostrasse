import test from 'node:test';
import assert from 'node:assert/strict';
import { Raycaster, Vector3 } from 'three';
import { createRoomMesh } from '../src/floorplan.js';
import { rooms, worldPoint } from '../src/rooms.js';

test('overhead clicks resolve all seven rooms and ignore space outside the apartment', () => {
  const floors = rooms.map(createRoomMesh);
  floors.forEach((mesh) => mesh.updateMatrixWorld(true));
  for (const room of rooms) {
    const [x, z] = worldPoint(room.center);
    const ray = new Raycaster(new Vector3(x, 18, z), new Vector3(0, -1, 0));
    const hits = ray.intersectObjects(floors);
    assert.equal(hits.length, 1, `${room.name} must belong to exactly one room`);
    assert.equal(hits[0].object.userData.roomId, room.id);
  }
  const outside = new Raycaster(new Vector3(20, 18, 20), new Vector3(0, -1, 0));
  assert.equal(outside.intersectObjects(floors).length, 0);
  floors.forEach((mesh) => { mesh.geometry.dispose(); mesh.material.dispose(); });
});
