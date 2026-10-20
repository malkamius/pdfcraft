import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { findAvailablePort } from './port-utils.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const preferredPort = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;
const port = await findAvailablePort(preferredPort);

console.log(`[Dev] Starting Next.js dev server on port ${port}...`);

const nextBinPath = path.join(rootDir, 'node_modules', 'next', 'dist', 'bin', 'next');
const isWindows = process.platform === 'win32';

let child;
if (fs.existsSync(nextBinPath)) {
  child = spawn(process.execPath, [nextBinPath, 'dev', '--turbopack', '-p', String(port), ...process.argv.slice(2)], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
    },
  });
} else {
  const nextCmd = path.join(rootDir, 'node_modules', '.bin', isWindows ? 'next.cmd' : 'next');
  child = spawn(nextCmd, ['dev', '--turbopack', '-p', String(port), ...process.argv.slice(2)], {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
    },
    shell: isWindows,
  });
}

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
