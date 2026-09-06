import { runRestyle, RestyleError } from './restyle.js';
import { runMockRestyle } from './mock-restyle.js';

// One active generation per local backend. Cancellation is shared by HTTP and IPC adapters.
export function createRunner({ getConfig, run = runRestyle, mockRun = runMockRestyle }) {
  let active;
  return {
    status: () => ({ configured: Boolean(getConfig().apiKey), mockAvailable: true }),
    cancel(owner, requestId) { if (active?.owner === owner && (!requestId || active.id === requestId)) active.controller.abort(); },
    async start(input, { owner, signal, onProgress } = {}) {
      const mode = input?.mode ?? 'real';
      if (!['mock', 'real'].includes(mode)) throw new RestyleError('invalid_mode', 'Choose Mock or Real AI.');
      if (active) throw new RestyleError('busy', 'Another Restyle is already running. Wait for it to finish.', 409);
      const controller = new AbortController();
      const operation = { owner, id: input?.requestId, controller };
      active = operation;
      try {
        const implementation = mode === 'mock' ? mockRun : run;
        const config = mode === 'mock' ? {} : getConfig();
        const result = await implementation(input, { ...config, onProgress, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
        return { ...result, mode };
      } finally { if (active === operation) active = null; }
    },
  };
}
