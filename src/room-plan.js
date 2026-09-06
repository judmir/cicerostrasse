// Transcribed from the user's second drawing. Original room IDs stay stable:
// left room = Zimmer 1; right room = Zimmer 2; middle room = Zimmer 3.
// Dimensions are the drawing's dimension-chain labels, not new site measurements.
export const roomMeasurements = {
  kuche: { width: 2.17, depth: 4.06, area: 8.8, sourceName: 'Küche', door: { edge: 'top', start: .24, end: .58 }, window: { edge: 'bottom', start: .26, end: .96 }, fixtures: 'kitchen' },
  bad: { width: 1.46, depth: 4.06, area: 5.9, sourceName: 'Bad', door: { edge: 'top', start: .52, end: .94, reverse: true }, window: { edge: 'bottom', start: .08, end: .45 }, fixtures: 'bath' },
  raum2: { width: 2.93, depth: 4.06, area: 11.9, sourceName: 'Zimmer 3', door: { edge: 'top', start: .31, end: .61 }, window: { edge: 'bottom', start: .54, end: .86 } },
  raum1: { width: 3.45, depth: 5.85, area: 20.2, sourceName: 'Zimmer 2', door: { edge: 'left', start: .12, end: .27 }, window: { edge: 'bottom', start: .37, end: .83 } },
  raum3: { width: 4.52, depth: 4.67, area: 20.9, sourceName: 'Zimmer 1', door: { edge: 'right', start: .16, end: .34 }, balconyDoor: true, note: 'The lower width is labelled 4.40 m. The outline simplifies the entrance recess.' },
  flur: { width: 6.72, depth: 1.71, area: 11.3, sourceName: 'Flur', door: { edge: 'top', start: .18, end: .30, reverse: true }, hallway: true, note: 'Overall dimensions. Entrance recesses are simplified.' },
  loggia: { width: 4.40, depth: 1.37, area: 6.0, sourceName: 'Balkon', door: { edge: 'top', start: .53, end: .73, reverse: true }, balcony: true },
};

export function getRoomPlanMetrics(roomId) {
  const measurements = roomMeasurements[roomId];
  if (!measurements) throw new Error('Unknown room');
  // Uniform scale retains actual width/depth proportions in the sidebar.
  const scale = Math.min(170 / measurements.width, 270 / measurements.depth);
  return { ...measurements, scale, drawWidth: measurements.width * scale, drawDepth: measurements.depth * scale };
}

export function renderRoomPlan(room) {
  const m = getRoomPlanMetrics(room.id);
  const w = m.drawWidth;
  const h = m.drawDepth;
  const left = (260 - w) / 2 - 12;
  const top = (350 - h) / 2 + 4;
  const right = left + w;
  const bottom = top + h;
  const n = (number) => Number(number.toFixed(2));
  const line = (x1, y1, x2, y2, className = 'room-diagram-wall') => `<line x1="${n(x1)}" y1="${n(y1)}" x2="${n(x2)}" y2="${n(y2)}" class="${className}"/>`;
  const rect = (x, y, width, height, className = 'room-diagram-fixture', radius = 0) => `<rect x="${n(x)}" y="${n(y)}" width="${n(width)}" height="${n(height)}" rx="${radius}" class="${className}"/>`;
  const dimension = (value) => `${value.toFixed(2)} m`;

  function door({ edge, start, end, reverse = false }) {
    const vertical = edge === 'left' || edge === 'right';
    const edgeSize = vertical ? h : w;
    const startPos = start * edgeSize;
    const endPos = end * edgeSize;
    const size = endPos - startPos;
    const gap = vertical ? line(edge === 'left' ? left : right, top + startPos, edge === 'left' ? left : right, top + endPos, 'room-diagram-gap') : line(left + startPos, edge === 'top' ? top : bottom, left + endPos, edge === 'top' ? top : bottom, 'room-diagram-gap');
    let hingeX, hingeY, closedX, closedY, openX, openY;
    if (vertical) {
      hingeX = edge === 'left' ? left : right;
      hingeY = top + (reverse ? endPos : startPos);
      closedX = hingeX;
      closedY = top + (reverse ? startPos : endPos);
      openX = hingeX + (edge === 'left' ? size : -size);
      openY = hingeY;
    } else {
      hingeX = left + (reverse ? endPos : startPos);
      hingeY = edge === 'top' ? top : bottom;
      closedX = left + (reverse ? startPos : endPos);
      closedY = hingeY;
      openX = hingeX;
      openY = hingeY + (edge === 'top' ? size : -size);
    }
    const cross = (closedX - hingeX) * (openY - hingeY) - (closedY - hingeY) * (openX - hingeX);
    return gap + line(hingeX, hingeY, openX, openY, 'room-diagram-door') + `<path d="M ${n(closedX)} ${n(closedY)} A ${n(size)} ${n(size)} 0 0 ${cross > 0 ? 1 : 0} ${n(openX)} ${n(openY)}" class="room-diagram-swing"/>`;
  }

  let details = door(m.door);
  if (m.window) {
    const start = left + w * m.window.start;
    const end = left + w * m.window.end;
    details += line(start, bottom, end, bottom, 'room-diagram-gap');
    details += line(start, bottom - 2, end, bottom - 2, 'room-diagram-window') + line(start, bottom + 2, end, bottom + 2, 'room-diagram-window');
    details += line((start + end) / 2, bottom - 3, (start + end) / 2, bottom + 3, 'room-diagram-window');
  }
  if (m.balconyDoor) details += door({ edge: 'bottom', start: .56, end: .74, reverse: true });
  if (m.hallway) {
    for (const [start, end] of [[.09, .20], [.42, .51], [.68, .81]]) details += door({ edge: 'bottom', start, end });
    details += line(left, top + h * .4, left, bottom - 8, 'room-diagram-gap');
    details += line(right, top + h * .4, right, bottom - 8, 'room-diagram-gap');
  }
  if (m.fixtures === 'kitchen') {
    // Planned parallel runs, with the window end and entry kept clear.
    details += rect(left + w * .06, top + h * .22, w * .22, h * .65);
    details += rect(right - w * .28, top + h * .22, w * .22, h * .65);
    for (const cx of [.79, .88]) for (const cy of [.595, .63]) details += `<circle cx="${n(left + w * cx)}" cy="${n(top + h * cy)}" r="${n(w * .025)}" class="room-diagram-fixture"/>`;
  }
  if (m.fixtures === 'bath') {
    details += rect(left + w * .07, top + h * .32, w * .32, h * .40, 'room-diagram-fixture', 7);
    details += rect(left + w * .09, top + h * .16, w * .22, h * .10, 'room-diagram-fixture', 5);
    details += rect(left + w * .08, top + h * .78, w * .27, h * .09, 'room-diagram-fixture', 5);
  }
  if (m.balcony) details += line(left + 5, bottom - 6, right - 5, bottom - 6, 'room-diagram-window');

  return `<figure class="room-diagram"><svg viewBox="0 0 280 370" role="img" aria-labelledby="room-svg-title room-svg-desc">
    <title id="room-svg-title">${room.name} floor plan</title><desc id="room-svg-desc">${dimension(m.width)} wide by ${dimension(m.depth)} deep. Area on the supplied plan: ${m.area.toFixed(1)} square meters. Openings and fittings are schematic.</desc>
    <rect x="${n(left)}" y="${n(top)}" width="${n(w)}" height="${n(h)}" class="room-diagram-floor"/>
    ${line(left, top, right, top)}${line(right, top, right, bottom)}${line(right, bottom, left, bottom)}${line(left, bottom, left, top)}
    ${details}
    ${line(left, top - 12, left, top - 34, 'room-dimension-guide')}${line(right, top - 12, right, top - 34, 'room-dimension-guide')}
    ${line(left, top - 27, right, top - 27, 'room-dimension-line')}${line(left - 3, top - 24, left + 3, top - 30, 'room-dimension-line')}${line(right - 3, top - 24, right + 3, top - 30, 'room-dimension-line')}
    <text x="${n((left + right) / 2)}" y="${n(top - 37)}" text-anchor="middle" class="room-dimension-text">${dimension(m.width)}</text>
    ${line(right + 12, top, right + 33, top, 'room-dimension-guide')}${line(right + 12, bottom, right + 33, bottom, 'room-dimension-guide')}
    ${line(right + 26, top, right + 26, bottom, 'room-dimension-line')}${line(right + 23, top + 3, right + 29, top - 3, 'room-dimension-line')}${line(right + 23, bottom + 3, right + 29, bottom - 3, 'room-dimension-line')}
    <text transform="translate(${n(right + 43)} ${n((top + bottom) / 2)}) rotate(-90)" text-anchor="middle" class="room-dimension-text">${dimension(m.depth)}</text>
    <text x="${n(left + w * .58)}" y="${n(top + h * .47)}" text-anchor="middle" class="room-diagram-name">${room.name}</text>
  </svg><figcaption>2D room plan</figcaption></figure>
  <dl class="room-measurements"><div><dt>Dimensions</dt><dd>${m.width.toFixed(2)} × ${m.depth.toFixed(2)} m</dd></div><div><dt>Area on plan</dt><dd>${m.area.toFixed(1)} m²</dd></div></dl>
  <p class="measurement-source">${m.sourceName !== room.name ? `${m.sourceName} in the supplied drawing. ` : ''}Dimensions from the plan; openings and fittings are schematic.${m.note ? ` ${m.note}` : ''}</p>`;
}
