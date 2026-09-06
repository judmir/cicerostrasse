import { readAIConfig } from './config.js';
import { createRunner } from './runner.js';
import { RestyleError, publicError } from './restyle.js';

const MAX_BODY = 72 * 1024 * 1024;
export function createAIMiddleware(runner) {
  return async (req, res, next) => {
    if (!['/api/ai/status', '/api/restyle'].includes(req.url?.split('?')[0])) return next();
    const errorResponse = (error) => {
      const safe = publicError(error);
      if (!res.headersSent) { res.writeHead(safe.status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify({ error: safe })); }
      else if (!res.destroyed) res.end(`${JSON.stringify({ type: 'error', error: safe })}\n`);
    };
    try {
      const host = req.headers.host || '';
      if (!/^(127\.0\.0\.1|localhost):\d+$/.test(host) ||
        (req.headers.origin && req.headers.origin !== `http://${host}`) ||
        (req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(req.headers['sec-fetch-site']))) {
        throw new RestyleError('forbidden', 'Only the local app can use this backend.', 403);
      }
      if (req.url.split('?')[0] === '/api/ai/status' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        res.end(JSON.stringify(runner.status())); return;
      }
      if (req.method !== 'POST' || req.url.split('?')[0] !== '/api/restyle') throw new RestyleError('method', 'Method not allowed.', 405);
      if (!req.headers['content-type']?.startsWith('application/json')) throw new RestyleError('invalid_request', 'Expected a JSON request.');
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BODY) throw new RestyleError('too_large', 'Choose images smaller than 25 MB each.', 413);
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString()); }
      catch { throw new RestyleError('invalid_request', 'Invalid Restyle request.'); }
      const controller = new AbortController();
      const disconnected = () => controller.abort();
      res.once('close', disconnected);
      const write = (event) => {
        if (res.destroyed) return;
        if (!res.headersSent) res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
        res.write(`${JSON.stringify(event)}\n`);
      };
      try {
        const result = await runner.start(input, { owner: req, signal: controller.signal, onProgress: (stage) => write({ type: 'progress', stage }) });
        write({ type: 'result', result });
        res.end();
      } finally { res.off('close', disconnected); }
    } catch (error) { errorResponse(error); }
  };
}

export function localAI() {
  let root;
  const runner = createRunner({ getConfig: () => readAIConfig(root) });
  const middleware = createAIMiddleware(runner);
  return {
    name: 'local-ai', configResolved(config) { root = config.root; },
    configureServer(server) { server.middlewares.use(middleware); },
    configurePreviewServer(server) { server.middlewares.use(middleware); },
  };
}
