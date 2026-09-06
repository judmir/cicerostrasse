import { runRestyle, RestyleError } from './restyle.js';

// One active generation per local backend. Cancellation is shared by HTTP and IPC adapters.
export function createRunner({ getConfig, run = runRestyle }) {
  let active;
  return {
    status: () => ({ configured: Boolean(getConfig().apiKey) }),
    cancel(owner, requestId) { if (active?.owner === owner && (!requestId || active.id === requestId)) active.controller.abort(); },
    async start(input, { owner, signal, onProgress } = {}) {
      if (active) throw new RestyleError('busy', 'Another Restyle is already running. Wait for it to finish.', 409);
      const controller = new AbortController();
      const operation = { owner, id: input?.requestId, controller };
      active = operation;
      try {
        return await run(input, { ...getConfig(), onProgress, signal: signal ? AbortSignal.any([signal, controller.signal]) : controller.signal });
      } finally { if (active === operation) active = null; }
    },
  };
}
