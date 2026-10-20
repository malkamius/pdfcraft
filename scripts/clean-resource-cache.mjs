#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const targetDir = path.join(rootDir, 'src-tauri', 'target');

/**
 * Removes cached Windows resource files (resource.lib, resource.rc, resource.res, and resources/icon.ico)
 * and Cargo fingerprints for pdfcraft so a new build will immediately incorporate updated icons.
 */
export function cleanResourceCache() {
  if (!fs.existsSync(targetDir)) {
    console.log('[clean-resource-cache] No src-tauri/target directory found. Nothing to clean.');
    return;
  }

  let deletedCount = 0;

  function cleanInProfile(profileDir) {
    if (!fs.existsSync(profileDir)) return;

    // 1. Remove resource.lib, resource.rc, resource.res in build/pdfcraft-*/out
    const buildDir = path.join(profileDir, 'build');
    if (fs.existsSync(buildDir)) {
      try {
        for (const item of fs.readdirSync(buildDir)) {
          if (item.startsWith('pdfcraft-')) {
            const outDir = path.join(buildDir, item, 'out');
            for (const resName of ['resource.lib', 'resource.rc', 'resource.res']) {
              const resPath = path.join(outDir, resName);
              if (fs.existsSync(resPath)) {
                try {
                  fs.unlinkSync(resPath);
                  console.log(`[clean-resource-cache] Removed stale resource file: ${path.relative(rootDir, resPath)}`);
                  deletedCount++;
                } catch (e) {
                  console.warn(`[clean-resource-cache] Failed to remove ${resPath}:`, e.message);
                }
              }
            }
          }
        }
      } catch (e) {
        console.warn(`[clean-resource-cache] Error reading ${buildDir}:`, e.message);
      }
    }

    // 2. Remove resources/icon.ico (used by WiX MSI packager)
    const bundleIcon = path.join(profileDir, 'resources', 'icon.ico');
    if (fs.existsSync(bundleIcon)) {
      try {
        fs.unlinkSync(bundleIcon);
        console.log(`[clean-resource-cache] Removed cached bundle icon: ${path.relative(rootDir, bundleIcon)}`);
        deletedCount++;
      } catch (e) {
        console.warn(`[clean-resource-cache] Failed to remove ${bundleIcon}:`, e.message);
      }
    }

    // 3. Remove .fingerprint/pdfcraft-* to force Cargo to rerun build.rs & re-link
    const fpDir = path.join(profileDir, '.fingerprint');
    if (fs.existsSync(fpDir)) {
      try {
        for (const item of fs.readdirSync(fpDir)) {
          if (item.startsWith('pdfcraft-')) {
            const fpPath = path.join(fpDir, item);
            try {
              fs.rmSync(fpPath, { recursive: true, force: true });
              console.log(`[clean-resource-cache] Removed fingerprint: ${path.relative(rootDir, fpPath)}`);
              deletedCount++;
            } catch (e) {
              console.warn(`[clean-resource-cache] Failed to remove ${fpPath}:`, e.message);
            }
          }
        }
      } catch (e) {
        console.warn(`[clean-resource-cache] Error reading ${fpDir}:`, e.message);
      }
    }
  }

  try {
    for (const entry of fs.readdirSync(targetDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      if (entry.name === 'debug' || entry.name === 'release') {
        cleanInProfile(path.join(targetDir, entry.name));
      } else {
        // Target triple directories (e.g. x86_64-pc-windows-msvc)
        cleanInProfile(path.join(targetDir, entry.name, 'debug'));
        cleanInProfile(path.join(targetDir, entry.name, 'release'));
      }
    }
  } catch (e) {
    console.warn(`[clean-resource-cache] Error reading ${targetDir}:`, e.message);
  }

  console.log(`[clean-resource-cache] Cleaned ${deletedCount} cached resource item(s).`);
}

// Run if directly executed
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename)) {
  cleanResourceCache();
}
