import { normalizeInspirationURL, validateImageFile } from './storage.js';

// Fetch image bytes, never page markup. The saved Blob works offline after reload.
export async function imageFromURL(value, { signal, fetchImage = fetch } = {}) {
  const url = normalizeInspirationURL(value);
  if (!url) throw new Error('Enter an image URL first.');
  let response;
  try { response = await fetchImage(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' }); }
  catch (error) {
    if (signal?.aborted) throw error;
    throw new Error('This link could not be loaded. Copy the image itself and paste it here, or upload a file.');
  }
  if (!response.ok) throw new Error(`The image link returned ${response.status}. Check the link, or upload the image.`);
  const type = (response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const size = Number(response.headers.get('content-length'));
  validateImageFile({ type, size: size || 1 });
  const reader = response.body?.getReader();
  let blob;
  if (reader) {
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value: chunk } = await reader.read();
        if (done) break;
        total += chunk.byteLength;
        if (total > 25 * 1024 * 1024) throw new Error('Choose an image smaller than 25 MB.');
        chunks.push(chunk);
      }
      blob = new Blob(chunks, { type });
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
  } else { blob = await response.blob(); }
  validateImageFile(blob);
  return new File([blob], 'Linked inspiration', { type: blob.type });
}
