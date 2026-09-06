import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { normalizeImage, RestyleError } from './images.js';

// Local simulation only. This module has no model client or network calls.
export async function runMockRestyle(input, { signal, onProgress = () => {}, wait = (ms, options) => delay(ms, undefined, options) } = {}) {
  if (!input || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)) throw new RestyleError('invalid_request', 'Invalid Restyle request.');
  const operation = input.operation || 'restyle';
  if (!['restyle', 'refine'].includes(operation)) throw new RestyleError('invalid_request', 'Choose a valid image operation.');
  const instruction = operation === 'refine' ? String(input.instruction || '').trim().replace(/\s+/g, ' ') : null;
  if (operation === 'refine' && (instruction.length < 3 || instruction.length > 600)) throw new RestyleError('invalid_refinement', 'Describe one change in 3 to 600 characters.');
  signal?.throwIfAborted();
  const source = await normalizeImage(input.source);
  if (operation === 'restyle') await normalizeImage(input.inspiration);
  const stage = async (name, duration) => {
    signal?.throwIfAborted();
    onProgress(name);
    await wait(duration, { signal });
    signal?.throwIfAborted();
  };
  await stage('extracting', 1800);
  const spec = {
    styleName: operation === 'refine' ? `Mock refinement · ${instruction.length > 60 ? `${instruction.slice(0, 57)}…` : instruction}` : 'Mock preview · Warm finish',
    palette: [{ color: 'Warm ivory', hex: '#eee4d5', role: 'Example surface color' }],
    materials: [{ surface: 'woodwork', material: 'Example oak', texture: 'Fine grain', finish: 'Matte' }],
    lightingMood: { temperature: operation === 'refine' ? 'Preserved' : 'Warm', contrast: 'Soft', mood: operation === 'refine' ? 'Example targeted edit for testing' : 'Example style for testing' },
  };
  await stage('rendering', 6000);
  // A deterministic color adjustment gives the comparison a visible difference without cropping.
  const tone = operation === 'refine' ? [...instruction].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 3 : 0;
  const channels = [[1.04, 1, .94], [.96, 1.03, 1.05], [1.02, .97, 1.04]][tone];
  const bytes = await sharp(source.bytes).modulate({ saturation: operation === 'refine' ? .86 : .75 })
    .linear(channels, [3, 1, 0]).png().toBuffer();
  await stage('checking', 1800);
  return {
    requestId: input.requestId, mode: 'mock', operation, ...(instruction ? { instruction } : {}),
    image: { base64: bytes.toString('base64'), mimeType: 'image/png', width: source.width, height: source.height },
    spec,
    geometry: { status: 'unchecked', findings: [], message: 'Mock preview: no AI geometry check was performed.' },
    models: { reasoning: 'local-mock-style-v1', image: 'local-mock-image-v1' },
    prompt: operation === 'refine' ? `Local mock: example refinement for “${instruction}”. No AI generation or object detection was performed.` : 'Local mock: example style and warm color adjustment. No AI generation or style extraction.',
    providerIds: {}, createdAt: Date.now(),
  };
}
