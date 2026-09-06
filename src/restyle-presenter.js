export const geometryLabels = {
  no_changes_detected: 'No changes detected', changes_detected: 'Changes detected · Review needed',
  uncertain: 'Uncertain · Review needed', unchecked: 'Unchecked · Review needed',
};
export function styleSummary(spec, escape) {
  return `<details class="restyle-style"><summary>Style summary · ${escape(spec.styleName)}</summary>
    <div class="restyle-palette">${spec.palette.map((item) => `<span>${escape(item.color)} (${escape(item.hex)}) · ${escape(item.role)}</span>`).join('')}</div>
    <ul>${spec.materials.map((item) => `<li><strong>${escape(item.surface.replaceAll('_', ' '))}</strong>: ${escape(item.material)}, ${escape(item.texture)}, ${escape(item.finish)}</li>`).join('')}</ul>
    <p>${escape(spec.lightingMood.temperature)} · ${escape(spec.lightingMood.contrast)} · ${escape(spec.lightingMood.mood)}</p></details>`;
}
export function refinementSummary(instruction, escape) {
  return `<div class="restyle-refinement-summary"><span>You asked</span><p>${escape(instruction)}</p><small>Only this requested change should be introduced; compare the result before continuing.</small></div>`;
}
export function geometrySummary(geometry, escape) {
  return `<div class="geometry-note ${geometry.status === 'no_changes_detected' ? '' : 'needs-review'}"><strong>${escape(geometryLabels[geometry.status] || geometryLabels.unchecked)}</strong>
    ${geometry.findings?.length ? `<ul>${geometry.findings.map((item) => `<li>${escape(item.description)}</li>`).join('')}</ul>` : ''}
    ${geometry.message ? `<p>${escape(geometry.message)}</p>` : ''}
    <p>Compare the images to check shapes and positions. Automated checks can miss changes.</p></div>`;
}
