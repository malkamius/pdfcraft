#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { cleanResourceCache } from './clean-resource-cache.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const iconsDir = path.join(rootDir, 'src-tauri', 'icons');
const publicDir = path.join(rootDir, 'public');
const outDir = path.join(rootDir, 'out');

// 1. Resolve source PNG
let sourcePng = process.argv[2];
if (!sourcePng) {
  const preferredPng = path.join(iconsDir, 'Hammer and Paper App Icon Transparent.png');
  const fallbackPng = path.join(iconsDir, 'icon.png');
  sourcePng = fs.existsSync(preferredPng) ? preferredPng : fallbackPng;
}

if (!fs.existsSync(sourcePng)) {
  console.error(`[update-icons] Source PNG not found: ${sourcePng}`);
  process.exit(1);
}

// 2. Resolve source ICO
let sourceIco = process.argv[3];
if (!sourceIco) {
  const preferredIco = path.join(iconsDir, 'Hammer and Paper App Icon Transparent.ico');
  if (fs.existsSync(preferredIco)) {
    sourceIco = preferredIco;
  }
}

console.log(`[update-icons] Generating app icon set from: ${path.relative(rootDir, sourcePng)}`);

// Execute tauri icon generation (using local CLI binary via npx)
const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
try {
  execFileSync(npxCmd, ['tauri', 'icon', `"${sourcePng}"`], {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env,
    shell: true,
  });
  console.log('[update-icons] Tauri icon generation completed.');
} catch (err) {
  console.error('[update-icons] Error running tauri icon:', err.message);
  process.exit(1);
}

// 3. If explicit ICO is provided, copy it to ensure multi-res transparent quality
if (sourceIco && fs.existsSync(sourceIco)) {
  const destIconIco = path.join(iconsDir, 'icon.ico');
  const destFavicon = path.join(publicDir, 'favicon.ico');
  fs.copyFileSync(sourceIco, destIconIco);
  fs.copyFileSync(sourceIco, destFavicon);
  console.log(`[update-icons] Copied ${path.relative(rootDir, sourceIco)} -> ${path.relative(rootDir, destIconIco)} & favicon.ico`);

  if (fs.existsSync(outDir)) {
    const outFavicon = path.join(outDir, 'favicon.ico');
    fs.copyFileSync(sourceIco, outFavicon);
  }
}

// 4. Invalidate and clean stale resource cache
console.log('[update-icons] Cleaning Windows resource file cache in target directory...');
cleanResourceCache();
console.log('[update-icons] Icon update and cache cleanup complete!');
