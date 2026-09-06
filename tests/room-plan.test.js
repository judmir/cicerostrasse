import test from 'node:test';
import assert from 'node:assert/strict';
import { rooms, roomById } from '../src/rooms.js';
import { roomMeasurements, getRoomPlanMetrics, renderRoomPlan } from '../src/room-plan.js';

test('measurements preserve the original gallery IDs despite different room numbers', () => {
  assert.equal(roomMeasurements.raum3.sourceName, 'Zimmer 1');
  assert.equal(roomMeasurements.raum1.sourceName, 'Zimmer 2');
  assert.equal(roomMeasurements.raum2.sourceName, 'Zimmer 3');
  assert.deepEqual(Object.keys(roomMeasurements).sort(), rooms.map((room) => room.id).sort());
});

test('kitchen uses the supplied width, depth, and printed area', () => {
  const kitchen = getRoomPlanMetrics('kuche');
  assert.equal(kitchen.width, 2.17);
  assert.equal(kitchen.depth, 4.06);
  assert.equal(kitchen.area, 8.8);
  assert.equal(Number((kitchen.width * kitchen.depth).toFixed(1)), kitchen.area);
  const diagram = renderRoomPlan(roomById('kuche'));
  assert.match(diagram, /2\.17 m/);
  assert.match(diagram, /4\.06 m/);
  assert.match(diagram, /8\.8 m²/);
  assert.doesNotMatch(diagram, /NaN|undefined/);
});

test('every room keeps its measured proportions inside the diagram bounds', () => {
  for (const room of rooms) {
    const metrics = getRoomPlanMetrics(room.id);
    assert.ok(Math.abs(metrics.drawWidth / metrics.drawDepth - metrics.width / metrics.depth) < 1e-10);
    assert.ok(metrics.drawWidth <= 170.00001);
    assert.ok(metrics.drawDepth <= 270.00001);
    const diagram = renderRoomPlan(room);
    assert.match(diagram, /role="img"/);
    assert.doesNotMatch(diagram, /NaN|undefined/);
  }
  assert.throws(() => getRoomPlanMetrics('missing'), /Unknown room/);
});
