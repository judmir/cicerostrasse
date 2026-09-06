// Coordinates follow the supplied 1206 × 525 drawing. They are proportions,
// not a measured survey. In Three.js, image Y maps to world Z.
export const PLAN_WIDTH = 1206;
export const PLAN_HEIGHT = 525;
export const rooms = [
  { id: 'raum3', name: 'Raum 3', type: 'Room', icon: 'sofa', number: '01', color: '#e9e5dc', center: [194, 222], polygon: [[24, 20], [390, 20], [390, 394], [24, 394]], description: 'The left-hand room, with direct access to the loggia.', connections: ['Flur', 'Loggia'] },
  { id: 'raum1', name: 'Raum 1', type: 'Room', icon: 'bed-double', number: '02', color: '#e7e5e0', center: [1055, 288], polygon: [[930, 20], [1185, 20], [1185, 475], [930, 475]], description: 'The large room on the right, opening onto the hallway.', connections: ['Flur'] },
  { id: 'raum2', name: 'Raum 2', type: 'Room', icon: 'armchair', number: '03', color: '#eee8dc', center: [810, 302], polygon: [[690, 155], [930, 155], [930, 475], [690, 475]], description: 'The middle room, between the bathroom and Raum 1.', connections: ['Flur'] },
  { id: 'kuche', name: 'Küche', type: 'Kitchen', icon: 'cooking-pot', number: '04', color: '#e1e8f4', center: [481, 303], polygon: [[390, 155], [560, 155], [560, 475], [390, 475]], description: 'A separate kitchen off the hallway, with a window toward the lower side of the plan.', connections: ['Flur'] },
  { id: 'bad', name: 'Bad', type: 'Bathroom', icon: 'bath', number: '05', color: '#e0ecec', center: [625, 298], polygon: [[560, 155], [690, 155], [690, 475], [560, 475]], description: 'The bathroom sits beside the kitchen. The source plan shows a bathtub, basin, and toilet.', connections: ['Flur'] },
  { id: 'flur', name: 'Flur', type: 'Hallway', icon: 'door-open', number: '06', color: '#efede7', center: [660, 85], polygon: [[390, 20], [930, 20], [930, 155], [390, 155]], description: 'The entrance and central hallway connect all five interior rooms.', connections: ['Raum 1', 'Raum 2', 'Raum 3', 'Küche', 'Bad'] },
  { id: 'loggia', name: 'Loggia', type: 'Outdoor space', icon: 'flower-2', number: '07', color: '#e1e9dd', center: [194, 452], polygon: [[24, 405], [380, 405], [380, 515], [24, 515]], description: 'The recessed outdoor space is reached through Raum 3.', connections: ['Raum 3'] },
];

export const roomById = (id) => rooms.find((room) => room.id === id);
export const worldPoint = ([x, y]) => [(x - PLAN_WIDTH / 2) / 100, (y - PLAN_HEIGHT / 2) / 100];

// Real gaps are left for the doors and windows visible in the source drawing.
export const walls = [
  [18, 12, 490, 12], [555, 12, 1193, 12],
  [18, 12, 18, 518], [1193, 12, 1193, 484],
  [18, 518, 382, 518], [382, 401, 382, 518],
  [390, 12, 390, 80], [390, 146, 390, 484],
  [930, 12, 930, 75], [930, 141, 930, 484],
  [390, 155, 452, 155], [511, 155, 637, 155],
  [679, 155, 770, 155], [834, 155, 930, 155],
  [560, 155, 560, 480], [690, 155, 690, 480],
  [18, 396, 101, 396], [299, 396, 390, 396],
  [390, 484, 446, 484], [618, 484, 812, 484],
  [886, 484, 1021, 484], [1135, 484, 1193, 484],
];

export const windows = [
  [102, 396, 220, 396], [295, 396, 299, 396],
  [446, 484, 618, 484], [812, 484, 886, 484], [1021, 484, 1135, 484],
];

export const doors = [
  { hinge: [555, 12], radius: 65, from: Math.PI / 2, to: Math.PI },
  { hinge: [390, 80], radius: 66, from: Math.PI / 2, to: Math.PI },
  { hinge: [930, 75], radius: 66, from: 0, to: Math.PI / 2 },
  { hinge: [452, 155], radius: 59, from: 0, to: Math.PI / 2 },
  { hinge: [679, 155], radius: 42, from: Math.PI / 2, to: Math.PI },
  { hinge: [770, 155], radius: 64, from: 0, to: Math.PI / 2 },
  { hinge: [295, 396], radius: 70, from: Math.PI, to: Math.PI * 1.5 },
];
