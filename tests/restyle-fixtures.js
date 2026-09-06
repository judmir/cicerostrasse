export const spec = {
  styleName: 'Warm oak', palette: [{ color: 'Ivory', hex: '#eee9dc', role: 'Wall color' }],
  materials: [{ surface: 'woodwork', material: 'Oak', texture: 'Fine grain', finish: 'Matte' }],
  lightingMood: { temperature: 'Warm', contrast: 'Soft', mood: 'Calm' },
};
export const geometry = { status: 'no_changes_detected', findings: [] };
export const completed = (value) => ({ id: 'response-id', status: 'completed', output: [], output_text: JSON.stringify(value) });
export function resultFixture(requestId = 'restyle-test-request') {
  return { requestId, image: { base64: 'cG5n', mimeType: 'image/png', width: 100, height: 80 }, spec, geometry, models: { reasoning: 'gpt-6-astra', image: 'gpt-image-2' }, createdAt: Date.now() };
}
