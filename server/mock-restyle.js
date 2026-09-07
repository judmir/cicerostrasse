import { setTimeout as delay } from 'node:timers/promises';
import sharp from 'sharp';
import { normalizeImage, RestyleError } from './images.js';
import { firstDesignInputSchema } from './schema.js';

// Local simulation only. This module has no model client or network calls.
export async function runMockRestyle(input, { signal, onProgress = () => {}, wait = (ms, options) => delay(ms, undefined, options) } = {}) {
  if (!input || typeof input.requestId !== 'string' || !/^[a-zA-Z0-9-]{8,80}$/.test(input.requestId)) throw new RestyleError('invalid_request', 'Invalid Restyle request.');
  const operation = input.operation || 'restyle';
  if (!['restyle', 'refine', 'first_design'].includes(operation)) throw new RestyleError('invalid_request', 'Choose a valid image operation.');
  if (operation === 'first_design') {
    const parsed = firstDesignInputSchema.safeParse(input);
    if (!parsed.success) throw new RestyleError('invalid_first_design', 'The first-design request is incomplete or contains invalid room constraints.');
    input = parsed.data;
    const main = input.roomImages?.find((entry) => entry.role === 'main_view');
    if (!main || input.roomImages.filter((entry) => entry.role === 'main_view').length !== 1 || input.viewpoint?.sourceImageId !== main.id) throw new RestyleError('invalid_first_design', 'Choose exactly one main room viewpoint.');
    if (typeof input.styleBrief !== 'string' || input.styleBrief.trim().length < 3) throw new RestyleError('invalid_first_design', 'Add a style brief before generating.');
    signal?.throwIfAborted();
    const source = await normalizeImage(main.image);
    for (const entry of input.roomImages.filter((entry) => entry !== main)) await normalizeImage(entry.image);
    for (const entry of input.styleReferences || []) await normalizeImage(entry.image);
    const stage = async (name, duration) => { signal?.throwIfAborted(); onProgress(name); await wait(duration, { signal }); signal?.throwIfAborted(); };
    await stage('analyzing', 1500);
    const designSpec = {
      conceptName: 'Mock first design',
      style: { styleName: 'Mock material study', palette: [{ color: 'Warm ivory', hex: '#eee4d5', role: 'Example surface color' }], materials: [{ surface: 'woodwork', material: 'Example oak', texture: 'Fine grain', finish: 'Matte' }], lightingMood: { temperature: 'Warm', contrast: 'Soft', mood: 'Example style for testing' } },
      roomReading: { architecture: ['Uses the selected room photo only as a local test source'], daylight: [] },
      designIntent: input.styleBrief.trim(),
    };
    await stage('rendering', 5200);
    const bytes = await sharp(source.bytes).modulate({ saturation: .72, brightness: 1.03 }).tint('#e9dfd1').png().toBuffer();
    await stage('reviewing', 1500);
    return {
      requestId: input.requestId, mode: 'mock', operation,
      image: { base64: bytes.toString('base64'), mimeType: 'image/png', width: source.width, height: source.height },
      designSpec, layoutReview: { status: 'unchecked', findings: [], message: 'Mock preview: no AI layout review was performed.' },
      models: { reasoning: 'local-mock-design-v1', image: 'local-mock-image-v1' },
      prompt: 'Local mock: example first-design preview. No AI generation or spatial interpretation was performed.',
      providerIds: {}, createdAt: Date.now(),
    };
  }
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
