import { validateImageFile } from './storage.js';

function failure(error) { return Object.assign(new Error(error?.message || 'Could not complete Restyle.'), { code: error?.code }); }
export async function imagePayload(blob) {
  validateImageFile(blob);
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  return { base64: btoa(binary), mimeType: blob.type };
}

export function createRestyleClient({ bridge = globalThis.window?.restyleAI, fetchImpl = globalThis.fetch } = {}) {
  return {
    async status() {
      if (bridge) return bridge.status();
      const response = await fetchImpl('/api/ai/status');
      if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) return { configured: false, unavailable: true };
      return response.json();
    },
    async run(input, { signal, onProgress = () => {} } = {}) {
      signal?.throwIfAborted();
      if (bridge) {
        const unsubscribe = bridge.onProgress((event) => { if (event.requestId === input.requestId) onProgress(event.stage); });
        const cancel = () => bridge.cancel(input.requestId);
        signal?.addEventListener('abort', cancel, { once: true });
        try {
          const response = await bridge.run(input);
          signal?.throwIfAborted();
          if (response.error) throw failure(response.error);
          return response.result;
        } finally { unsubscribe(); signal?.removeEventListener('abort', cancel); }
      }
      const response = await fetchImpl('/api/restyle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input), signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw failure(body?.error || { message: 'The local Restyle backend is unavailable.' });
      }
      if (!response.headers.get('content-type')?.includes('application/x-ndjson') || !response.body) throw failure({ message: 'The local Restyle backend is unavailable.' });
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let pending = '';
      let result;
      function consume(line) {
        if (!line.trim()) return;
        const event = JSON.parse(line);
        if (event.type === 'progress') onProgress(event.stage);
        if (event.type === 'error') throw failure(event.error);
        if (event.type === 'result') result = event.result;
      }
      try {
        while (true) {
          const { value, done } = await reader.read();
          pending += decoder.decode(value, { stream: !done });
          let newline;
          while ((newline = pending.indexOf('\n')) !== -1) { consume(pending.slice(0, newline)); pending = pending.slice(newline + 1); }
          if (done) break;
        }
        consume(pending);
        signal?.throwIfAborted();
        if (!result || result.requestId !== input.requestId) throw failure({ message: 'The Restyle response was interrupted. Please try again.' });
        return result;
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
    },
  };
}

export function resultFile(result) {
  const data = Uint8Array.from(atob(result.image.base64), (character) => character.charCodeAt(0));
  return new File([data], `restyle-${result.requestId}.png`, { type: 'image/png' });
}
