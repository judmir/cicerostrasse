import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';

const server = await createServer();
await server.listen();
server.printUrls();
const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RENDERER_URL: server.resolvedUrls.local[0] },
});
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => close(code ?? 0));
child.on('error', async (error) => { console.error(error); await close(1); });
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
