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

console.log(`[Tauri Dev] Synchronizing dev port ${port} across Next.js and Tauri devUrl...`);

// Write config to a temporary file to avoid shell argument quote-stripping issues on Windows
const devConfigFile = path.join(rootDir, 'src-tauri', 'tauri.dev.json');
const devConfigContent = JSON.stringify(
  {
    build: {
      devUrl: `http://localhost:${port}`,
    },
  },
  null,
  2
);

fs.writeFileSync(devConfigFile, devConfigContent, 'utf8');

const isWindows = process.platform === 'win32';
const tauriBin = path.join(rootDir, 'node_modules', '.bin', isWindows ? 'tauri.cmd' : 'tauri');

const args = ['dev', '--config', 'src-tauri/tauri.dev.json', ...process.argv.slice(2)];

const child = spawn(
  fs.existsSync(tauriBin) ? tauriBin : 'npx',
  fs.existsSync(tauriBin) ? args : ['tauri', ...args],
  {
    cwd: rootDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      PORT: String(port),
    },
    shell: isWindows,
  }
);

const cleanup = () => {
  try {
    if (fs.existsSync(devConfigFile)) {
      fs.unlinkSync(devConfigFile);
    }
  } catch {}
};

child.on('exit', (code, signal) => {
  cleanup();
  if (signal) {
    process.kill(process.pid, signal);
  } else {
    process.exit(code ?? 0);
  }
});

process.on('SIGINT', () => {
  cleanup();
  child.kill('SIGINT');
});

process.on('SIGTERM', () => {
  cleanup();
  child.kill('SIGTERM');
});
