import * as THREE from 'three';
import { rooms, walls, windows, doors, worldPoint } from './rooms.js';
import { roomMeasurements } from './room-plan.js';

export function createRoomMesh(room) {
  const shape = new THREE.Shape();
  room.polygon.forEach((point, i) => {
    const [x, z] = worldPoint(point);
    if (i === 0) shape.moveTo(x, -z);
    else shape.lineTo(x, -z);
  });
  shape.closePath();
  const floor = new THREE.Mesh(new THREE.ShapeGeometry(shape), new THREE.MeshBasicMaterial({ color: '#f5f6f8' }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.012;
  floor.userData.roomId = room.id;
  return floor;
}

export function createFloorplan(container, onSelect) {
  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-8, 8, 5, -5, 0.1, 100);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setClearColor(0xffffff, 0);
  renderer.domElement.setAttribute('aria-label', 'Apartment floor plan. Click a room to open its gallery.');
  container.appendChild(renderer.domElement);
  camera.up.set(0, 0, -1);
  camera.position.set(0, 18, 0);
  camera.lookAt(0, 0, 0);
  const model = new THREE.Group();
  scene.add(model);

  const floors = [];
  const labels = [];
  const dimensionLabels = [];
  let hovered = null;
  let disposed = false;
  let visible = true;
  let labelCounts = {};

  function line(points, color = '#68778a', height = 0.035, opacity = 1) {
    const vectors = points.map((point) => {
      const [x, z] = worldPoint(point);
      return new THREE.Vector3(x, height, z);
    });
    const material = new THREE.LineBasicMaterial({ color, transparent: opacity < 1, opacity });
    const mesh = new THREE.Line(new THREE.BufferGeometry().setFromPoints(vectors), material);
    model.add(mesh);
    return mesh;
  }

  function box(x, y, width, depth, height, color, base = 0.025) {
    const material = new THREE.MeshBasicMaterial({ color });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width / 100, height, depth / 100), material);
    const [worldX, worldZ] = worldPoint([x, y]);
    mesh.position.set(worldX, base + height / 2, worldZ);
    model.add(mesh);
    return mesh;
  }

  function dimensionLabel(value, point, vertical = false) {
    const element = document.createElement('span');
    element.className = `plan-dimension-label${vertical ? ' vertical' : ''}`;
    element.textContent = `${value.toFixed(2)} m`;
    container.appendChild(element);
    const [x, z] = worldPoint(point);
    dimensionLabels.push({ element, position: new THREE.Vector3(x, 0.035, z) });
  }

  function horizontalDimension(start, end, baseline, startWall, endWall, value) {
    const direction = baseline < startWall ? -1 : 1;
    const color = '#b0bdcc';
    line([[start, baseline], [end, baseline]], color);
    for (const [x, wall] of [[start, startWall], [end, endWall]]) {
      line([[x, wall + direction * 15], [x, baseline + direction * 9]], '#d2dae4');
      line([[x - 6, baseline + 6], [x + 6, baseline - 6]], color);
    }
    dimensionLabel(value, [(start + end) / 2, baseline - 23]);
  }

  function verticalDimension(start, end, baseline, wall, value) {
    const direction = baseline < wall ? -1 : 1;
    const color = '#b0bdcc';
    line([[baseline, start], [baseline, end]], color);
    for (const y of [start, end]) {
      line([[wall + direction * 15, y], [baseline + direction * 9, y]], '#d2dae4');
      line([[baseline - 6, y + 6], [baseline + 6, y - 6]], color);
    }
    dimensionLabel(value, [baseline - 23, (start + end) / 2], true);
  }

  // Reproduce the dimension chains on the supplied measured drawing.
  // Anchor them to the existing trace, using the same values as room sidebars.
  horizontalDimension(24, 390, -75, 20, 20, roomMeasurements.raum3.width);
  horizontalDimension(390, 930, -75, 20, 20, roomMeasurements.flur.width);
  horizontalDimension(930, 1185, -75, 20, 20, roomMeasurements.raum1.width);
  horizontalDimension(24, 382, 610, 515, 515, roomMeasurements.loggia.width);
  horizontalDimension(390, 560, 610, 475, 475, roomMeasurements.kuche.width);
  horizontalDimension(560, 690, 610, 475, 475, roomMeasurements.bad.width);
  horizontalDimension(690, 930, 610, 475, 475, roomMeasurements.raum2.width);
  horizontalDimension(930, 1185, 610, 475, 475, roomMeasurements.raum1.width);
  verticalDimension(20, 394, -65, 24, roomMeasurements.raum3.depth);
  verticalDimension(394, 515, -65, 24, roomMeasurements.loggia.depth);
  verticalDimension(20, 155, 1270, 1185, roomMeasurements.flur.depth);
  verticalDimension(155, 475, 1270, 1185, roomMeasurements.kuche.depth);
  verticalDimension(20, 475, 1350, 1185, roomMeasurements.raum1.depth);

  for (const room of rooms) {
    const floor = createRoomMesh(room);
    model.add(floor);
    floors.push(floor);

    const label = document.createElement('button');
    label.className = 'plan-room-label';
    label.dataset.room = room.id;
    label.setAttribute('aria-label', `Open ${room.name} gallery`);
    const name = document.createElement('span');
    name.className = 'plan-room-name';
    name.textContent = room.name;
    const count = document.createElement('span');
    count.className = 'plan-room-count';
    count.textContent = '0 images';
    const area = document.createElement('span');
    area.className = 'plan-room-area';
    area.textContent = `${roomMeasurements[room.id].area.toFixed(1)} m²`;
    label.append(name, area, count);
    label.addEventListener('click', (event) => { event.stopPropagation(); onSelect(room.id); });
    label.addEventListener('pointerenter', () => { hovered = room.id; paint(); });
    label.addEventListener('pointerleave', () => { hovered = null; paint(); });
    label.addEventListener('focus', () => { hovered = room.id; paint(); });
    label.addEventListener('blur', () => { hovered = null; paint(); });
    container.appendChild(label);
    const [x, z] = worldPoint(room.center);
    labels.push({ room, element: label, count, position: new THREE.Vector3(x, 0.42, z) });
  }

  for (const [x1, y1, x2, y2] of walls) {
    const mesh = box((x1 + x2) / 2, (y1 + y2) / 2, Math.abs(x2 - x1) + 10, Math.abs(y2 - y1) + 10, 0.2, '#566273');
    mesh.userData.wall = true;
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#263444' }));
    mesh.add(edges);
  }
  for (const [x1, y1, x2, y2] of windows) {
    box((x1 + x2) / 2, y1, x2 - x1, 8, 0.07, '#d3e2ed');
    line([[x1, y1 - 2], [x2, y2 - 2]], '#728b9c', 0.12);
    line([[x1, y1 + 2], [x2, y2 + 2]], '#728b9c', 0.12);
    line([[(x1 + x2) / 2, y1 - 4], [(x1 + x2) / 2, y1 + 4]], '#728b9c', 0.12);
  }
  for (const door of doors) {
    const arc = [];
    for (let i = 0; i <= 32; i++) {
      const angle = door.from + (door.to - door.from) * i / 32;
      arc.push([door.hinge[0] + Math.cos(angle) * door.radius, door.hinge[1] + Math.sin(angle) * door.radius]);
    }
    line(arc, '#718094', 0.045, 0.8);
    const endpoint = ['390,80', '930,75'].includes(door.hinge.join(',')) ? arc[arc.length - 1] : arc[0];
    line([door.hinge, endpoint], '#526276', 0.05);
  }

  // Planned two-sided kitchen; both runs stop before the window end.
  box(419, 329.4, 37.4, 208, 0.16, '#f8f9fc');
  box(531, 329.4, 37.4, 208, 0.16, '#f8f9fc');
  box(538, 350, 36, 44, 0.17, '#edf0f6');
  for (const [x, y] of [[530, 340], [546, 340], [530, 359], [546, 359]]) {
    const circle = [];
    for (let i = 0; i <= 24; i++) circle.push([x + Math.cos(i / 24 * Math.PI * 2) * 5.5, y + Math.sin(i / 24 * Math.PI * 2) * 5.5]);
    line(circle, '#7a8798', 0.205);
  }
  // Bathroom fittings follow the supplied drawing.
  box(588, 321, 45, 122, 0.17, '#f9fcfc');
  line([[574, 268], [600, 268], [602, 351], [599, 365], [589, 372], [578, 365], [574, 351], [574, 268]], '#acbfc5', 0.205);
  box(581, 215, 28, 40, 0.16, '#f9fcfc');
  box(582, 411, 29, 30, 0.15, '#f9fcfc');

  function paint() {
    for (const floor of floors) {
      const room = rooms.find((item) => item.id === floor.userData.roomId);
      floor.material.color.set(room.id === hovered ? '#e5ecfa' : '#f5f6f8');
    }
    for (const label of labels) {
      label.element.classList.toggle('hovered', label.room.id === hovered);
      const count = labelCounts[label.room.id] || 0;
      label.count.textContent = `${count} ${count === 1 ? 'image' : 'images'}`;
      label.count.hidden = count === 0;
    }
    render();
  }

  function resize() {
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height);
    const aspect = width / height;
    // Include the outer dimension chains in the fitted view.
    const size = Math.max(8.0, 15.8 / aspect);
    camera.left = -size * aspect / 2;
    camera.right = size * aspect / 2;
    camera.top = size / 2;
    camera.bottom = -size / 2;
    camera.updateProjectionMatrix();
    render();
  }

  const pointer = new THREE.Vector2();
  const raycaster = new THREE.Raycaster();
  function hit(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(floors)[0]?.object.userData.roomId || null;
  }
  let down;
  renderer.domElement.addEventListener('pointerdown', (event) => { if (event.button === 0) down = [event.clientX, event.clientY]; });
  renderer.domElement.addEventListener('pointercancel', () => { down = null; });
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
    const id = hit(event);
    if (id) onSelect(id);
    down = null;
  });
  renderer.domElement.addEventListener('pointermove', (event) => {
    hovered = hit(event);
    renderer.domElement.style.cursor = hovered ? 'pointer' : 'default';
    paint();
  });
  renderer.domElement.addEventListener('pointerleave', () => { hovered = null; paint(); });
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  paint();

  function render() {
    if (disposed || !visible) return;
    renderer.render(scene, camera);
    const width = container.clientWidth;
    const height = container.clientHeight;
    for (const label of [...labels, ...dimensionLabels]) {
      const p = label.position.clone().project(camera);
      label.element.style.left = `${(p.x * 0.5 + 0.5) * width}px`;
      label.element.style.top = `${(-p.y * 0.5 + 0.5) * height}px`;
      label.element.hidden = p.z > 1 || p.x < -1 || p.x > 1 || p.y < -1 || p.y > 1;
    }
  }
  return {
    setCounts(counts) { labelCounts = counts; paint(); },
    setVisible(value) { visible = value; if (value) { hovered = null; resize(); paint(); } },
    resize,
    dispose() {
      disposed = true;
      observer.disconnect();
      scene.traverse((object) => { object.geometry?.dispose(); if (object.material) object.material.dispose(); });
      renderer.dispose();
      renderer.domElement.remove();
      labels.forEach((label) => label.element.remove());
      dimensionLabels.forEach((label) => label.element.remove());
    },
  };
}
