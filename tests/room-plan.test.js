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

test('editor shares all architectural geometry and dimensions without duplicate sidebar IDs', () => {
  for (const room of rooms) {
    const sidebar = renderRoomPlan(room);
    const editor = renderRoomPlan(room, { editor: true });
    const architecture = html => [...html.matchAll(/<(?:line|path|rect|text)\b[^>]*>/g)]
      .map(m => m[0]).filter(tag => /class="room-(?:diagram-(?:floor|wall|gap|door|swing|window)|dimension-[^"]+)"/.test(tag));
    assert.deepEqual(architecture(editor), architecture(sidebar));
    assert.match(sidebar, /viewBox="0 0 280 370"/);
    assert.doesNotMatch(editor, /viewBox="0 0 280 370"/);
    assert.match(editor, /preserveAspectRatio="xMidYMid meet"/);
    for (const value of [roomMeasurements[room.id].width, roomMeasurements[room.id].depth]) assert.ok(editor.includes(`${value.toFixed(2)} m`));
    assert.match(editor, new RegExp(`scale\\(${getRoomPlanMetrics(room.id).scale}\\)`));
    assert.match(editor, /data-placements/);
    assert.doesNotMatch(editor, /room-diagram-fixture|room-diagram-name|figcaption|room-measurements/);
    const sidebarIds = [...sidebar.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
    assert.ok([...editor.matchAll(/\bid="([^"]+)"/g)].every(m => !sidebarIds.includes(m[1])));
  }
});
