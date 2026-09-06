import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const formats = new Set(['jpeg', 'png', 'webp', 'gif', 'heif']);
export class RestyleError extends Error {
  constructor(code, message, status = 400) { super(message); this.name = 'RestyleError'; this.code = code; this.status = status; }
}

export async function normalizeImage(input) {
  if (!input || typeof input.base64 !== 'string' || input.base64.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/]+={0,2}$/.test(input.base64) || input.base64.length % 4 !== 0) {
    throw new RestyleError('invalid_image', 'Choose a valid image smaller than 25 MB.');
  }
  const bytes = Buffer.from(input.base64, 'base64');
  if (!bytes.length || bytes.length > MAX_IMAGE_BYTES) throw new RestyleError('invalid_image', 'Choose an image smaller than 25 MB.');
  try {
    const image = sharp(bytes, { limitInputPixels: 40_000_000, failOn: 'error', animated: false });
    const metadata = await image.metadata();
    if (!formats.has(metadata.format) || (metadata.format === 'heif' && metadata.compression !== 'av1')) throw new Error('Unsupported image');
    // Decode, orient, strip metadata and flatten the first frame. No source pixels are cropped.
    const { data, info } = await image.rotate().resize({ width: 1536, height: 1536, fit: 'inside' })
      .flatten({ background: '#ffffff' }).png().toBuffer({ resolveWithObject: true });
    return { bytes: data, width: info.width, height: info.height };
  } catch {
    throw new RestyleError('invalid_image', 'This image could not be decoded. Use JPG, PNG, WebP, GIF, or AVIF, up to 40 megapixels.');
  }
}

export async function padSource(source) {
  const width = Math.max(512, Math.ceil(source.width / 16) * 16);
  const height = Math.max(512, Math.ceil(source.height / 16) * 16);
  const left = Math.floor((width - source.width) / 2);
  const top = Math.floor((height - source.height) / 2);
  const bytes = await sharp(source.bytes).extend({ left, top, right: width - source.width - left, bottom: height - source.height - top, background: '#808080' }).png().toBuffer();
  return { bytes, width, height, crop: { left, top, width: source.width, height: source.height } };
}

export async function decodeOutput(base64, padded) {
  if (typeof base64 !== 'string' || base64.length > 50 * 1024 * 1024 || !base64) throw new RestyleError('invalid_output', 'The image model did not return a usable image.', 502);
  try {
    const image = sharp(Buffer.from(base64, 'base64'), { limitInputPixels: 10_000_000, failOn: 'error' });
    const meta = await image.metadata();
    if (meta.format !== 'png' || meta.width !== padded.width || meta.height !== padded.height) throw new Error('Unexpected output dimensions');
    return await image.extract(padded.crop).png().toBuffer();
  } catch { throw new RestyleError('invalid_output', 'The rendered image had an unexpected format or size. Please try again.', 502); }
}
