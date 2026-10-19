# PDFCraft Build Guide

This document provides complete instructions for building all supported PDFCraft targets, including desktop applications (Tauri v2 for Windows, macOS, and Linux), the web static export, the Docker container, and the browser extension.

---

## Table of Contents

- [Overview of Build Targets](#overview-of-build-targets)
- [Prerequisites](#prerequisites)
  - [1. Common Requirements](#1-common-requirements)
  - [2. Windows Desktop Prerequisites](#2-windows-desktop-prerequisites)
  - [3. Linux Desktop Prerequisites](#3-linux-desktop-prerequisites)
  - [4. macOS Desktop Prerequisites](#4-macos-desktop-prerequisites)
- [Initial Setup](#initial-setup)
- [Building for Windows (Tauri Desktop)](#building-for-windows-tauri-desktop)
  - [Development Mode (Live Reload)](#development-mode-live-reload)
  - [Build All Windows Installers (NSIS + MSI)](#build-all-windows-installers-nsis--msi)
  - [Build NSIS Installer (.exe) Only](#build-nsis-installer-exe-only)
  - [Build MSI Installer (.msi) Only](#build-msi-installer-msi-only)
  - [Build Standalone / Portable Executable (.exe)](#build-standalone--portable-executable-exe)
  - [Windows Output Locations](#windows-output-locations)
- [Building for Linux (Tauri Desktop)](#building-for-linux-tauri-desktop)
  - [Build Debian Package (.deb) and AppImage](#build-debian-package-deb-and-appimage)
  - [Linux Output Locations](#linux-output-locations)
- [Building for macOS (Tauri Desktop)](#building-for-macos-tauri-desktop)
  - [Build DMG & App Bundle](#build-dmg--app-bundle)
  - [macOS Output Locations](#macos-output-locations)
- [Building Web Static Export](#building-web-static-export)
  - [Standard Web Build](#standard-web-build)
  - [Subpath Web Build (e.g. `/pdfcraft/`)](#subpath-web-build-eg-pdfcraft)
  - [Local Static Preview](#local-static-preview)
- [Building Docker Image](#building-docker-image)
- [Packaging the Browser Extension](#packaging-the-browser-extension)
- [Environment Variables Reference](#environment-variables-reference)
- [Troubleshooting & FAQ](#troubleshooting--faq)

---

## Overview of Build Targets

| Target | Platform | Output Artifacts | Primary Command |
|---|---|---|---|
| **Windows Desktop** | Windows (x64) | NSIS Installer (`.exe`), MSI (`.msi`), Portable (`.exe` / `.zip`) | `npm run build:tauri` |
| **Linux Desktop** | Linux (x64) | Debian package (`.deb`), AppImage (`.AppImage`) | `npm run build:tauri` |
| **macOS Desktop** | macOS (Apple Silicon / Intel) | Disk image (`.dmg`), App bundle (`.app`, `.zip`) | `npm run build:tauri` |
| **Web Static Site** | Any / Web Host | Static HTML/CSS/JS/WASM directory (`out/`) | `npm run build` |
| **Docker** | Container hosts | Self-contained Nginx web container image | `docker build -t pdfcraft .` |
| **Extension** | Chromium / Firefox | Unpacked folder (`extension/`), Zip package | `Compress-Archive` / `zip` |

---

## Prerequisites

### 1. Common Requirements

All targets require:
- **Node.js**: v20.x or v22.x LTS recommended (minimum v18.17+).
- **npm**: Installed with Node.js.
- **Git**: Required for version tags based on commit hash and date.

Verify your environment:
```bash
node -v
npm -v
git --version
```

### 2. Windows Desktop Prerequisites

To compile the Tauri desktop application on Windows:

1. **Microsoft C++ Build Tools / Visual Studio**:
   - Install **Visual Studio 2022** (Community or Build Tools).
   - In the Visual Studio Installer, select the workload:
     - **Desktop development with C++**
   - Ensure the Windows 10/11 SDK is checked.
2. **Rust**:
   - Install via [rustup.rs](https://rustup.rs/):
     ```powershell
     # Using winget:
     winget install --id Rustlang.Rustup
     ```
   - Ensure the MSVC toolchain is default:
     ```powershell
     rustup default stable-x86_64-pc-windows-msvc
     rustc --version
     cargo --version
     ```
3. **Microsoft Edge WebView2**:
   - Pre-installed on Windows 10 (version 1803+) and Windows 11.
   - If missing, download the Evergreen Bootstrapper from [Microsoft WebView2](https://developer.microsoft.com/en-us/microsoft-edge/webview2/).
4. **WiX Toolset (Optional for MSI)**:
   - Tauri v2 can automatically download required dependencies or you can install WiX v3.14 via `winget install WiX`.

### 3. Linux Desktop Prerequisites

On Ubuntu/Debian-based distributions:
```bash
sudo apt-get update
sudo apt-get install -y \
  build-essential \
  curl \
  wget \
  file \
  libwebkit2gtk-4.1-dev \
  libssl-dev \
  libgtk-3-dev \
  libayatana-appindicator3-dev \
  librsvg2-dev \
  libxdo-dev \
  patchelf \
  libfuse2
```

Install Rust:
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
```

### 4. macOS Desktop Prerequisites

1. **Xcode Command Line Tools**:
   ```bash
   xcode-select --install
   ```
2. **Rust**:
   ```bash
   curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
   source "$HOME/.cargo/env"
   ```

---

## Initial Setup

Before running any build, install the npm project dependencies:

```bash
npm install
```

> **Note on automated asset hooks:**
> During `postinstall`, `predev`, and `prebuild`, PDFCraft automatically runs helper scripts to:
> 1. Sync PDF.js worker files (`scripts/sync-pdfjs-workers.js`)
> 2. Decompress LibreOffice WASM archives (`scripts/decompress-wasm.mjs`)
> 3. Verify PDF viewer files (`scripts/ensure-pdfjs-viewer-js.js`)
>
> You do **not** need to run these manually unless troubleshooting.

---

## Building for Windows (Tauri Desktop)

### Development Mode (Live Reload)

Runs the Next.js development server and launches the native Tauri desktop window with hot reloading:

```powershell
npm run dev:tauri
```
*Alternatively:* `npx tauri dev`

---

### Build All Windows Installers (NSIS + MSI)

This command builds the Next.js static frontend first (via `beforeBuildCommand`), then compiles the Rust backend and packages both NSIS (`.exe`) and MSI (`.msi`) installers:

```powershell
npm run build:tauri
```
*Alternatively with verbose output:*
```powershell
npx tauri build -v
```

---

### Build NSIS Installer (.exe) Only

NSIS produces a modern, single-file setup wizard (`.exe`):

```powershell
npx tauri build --bundles nsis
```

---

### Build MSI Installer (.msi) Only

Produces a Windows Installer package (`.msi`), ideal for enterprise deployment / GPO:

```powershell
npx tauri build --bundles msi
```

---

### Build Standalone / Portable Executable (.exe)

If you need a standalone `.exe` without generating an installer:

```powershell
npx tauri build --no-bundle
```

The compiled standalone executable will be located directly at:
```
src-tauri/target/release/pdfcraft.exe
```

#### Creating a Portable ZIP Package (Same as CI)

In PowerShell:
```powershell
# 1. Create bundle folder
New-Item -ItemType Directory -Force -Path "src-tauri\target\release\bundle\portable"

# 2. Copy the executable
Copy-Item "src-tauri\target\release\pdfcraft.exe" "src-tauri\target\release\bundle\portable\PDFCraft-Portable.exe"

# 3. Add portable indicator text file
@"
PDFCraft Portable Mode
All application data and cache will be stored in the 'data' folder alongside this file.
"@ | Out-File -Encoding utf8 "src-tauri\target\release\bundle\portable\portable.txt"

# 4. Zip the portable bundle
Compress-Archive -Path "src-tauri\target\release\bundle\portable\*" -DestinationPath "src-tauri\target\release\bundle\PDFCraft-Windows-x64-Portable.zip" -Force
```

---

### Windows Output Locations

After a successful build, files are found in:

| Package Type | Path |
|---|---|
| **NSIS Installer (.exe)** | `src-tauri/target/release/bundle/nsis/PDFCraft_<version>_x64-setup.exe` |
| **MSI Installer (.msi)** | `src-tauri/target/release/bundle/msi/PDFCraft_<version>_x64_en-US.msi` |
| **Direct Executable** | `src-tauri/target/release/pdfcraft.exe` |
| **Portable ZIP** | `src-tauri/target/release/bundle/PDFCraft-Windows-x64-Portable.zip` |

---

## Building for Linux (Tauri Desktop)

### Build Debian Package (.deb) and AppImage

On a Linux machine:

```bash
# Build all configured Linux targets (.deb and .AppImage)
npm run build:tauri

# Or build individual targets:
npx tauri build --bundles deb
npx tauri build --bundles appimage
```

### Linux Output Locations

| Package Type | Path |
|---|---|
| **Debian Package** | `src-tauri/target/release/bundle/deb/pdfcraft_<version>_amd64.deb` |
| **AppImage** | `src-tauri/target/release/bundle/appimage/PDFCraft_<version>_amd64.AppImage` |
| **Direct Binary** | `src-tauri/target/release/pdfcraft` |

> **Linux AppImage Note:**
> In CI, the AppImage is repacked using `appimagetool` to remove bundled `libwayland-client.so*` to ensure compatibility across distributions using different Mesa/Wayland versions.

---

## Building for macOS (Tauri Desktop)

### Build DMG & App Bundle

On a macOS machine:

```bash
# Ad-hoc sign for local use without Apple Developer Certificate
APPLE_SIGNING_IDENTITY="-" npm run build:tauri

# Or build DMG bundle only:
APPLE_SIGNING_IDENTITY="-" npx tauri build --bundles dmg
```

### macOS Output Locations

| Package Type | Path |
|---|---|
| **Apple Disk Image** | `src-tauri/target/release/bundle/dmg/PDFCraft_<version>_aarch64.dmg` |
| **macOS Application** | `src-tauri/target/release/bundle/macos/PDFCraft.app` |

---

## Building Web Static Export

PDFCraft can be built as a 100% static web application (`output: 'export'`), ready to be hosted on Vercel, Netlify, Cloudflare Pages, GitHub Pages, Apache, or Nginx.

### Standard Web Build

```bash
npm run build
```

This compiles Next.js pages and runs `postbuild` to decompress WASM modules and chunk large assets into the `out/` directory.

### Subpath Web Build (e.g. `/pdfcraft/`)

If deploying to a subfolder like `https://example.com/pdfcraft/`:

**PowerShell (Windows):**
```powershell
$env:BASE_PATH="/pdfcraft"; npm run build; Remove-Item Env:\BASE_PATH
```

**Bash (Linux / macOS):**
```bash
BASE_PATH="/pdfcraft" npm run build
```

### Local Static Preview

To verify the static build locally (note: proper COOP/COEP headers are needed for full LibreOffice WASM feature support):

```bash
# Using Node's serve
npx serve out

# Or test with the production Docker container (see below)
```

---

## Building Docker Image

PDFCraft provides a production multi-stage `Dockerfile` with Nginx and pre-configured security headers (including `SharedArrayBuffer` support).

### Build with Docker CLI

```bash
# Standard build:
docker build -t pdfcraft:latest .

# Build with custom subpath:
docker build --build-arg BASE_PATH=/pdfcraft -t pdfcraft:latest .
```

### Run Container

```bash
docker run -d -p 8080:80 --name pdfcraft pdfcraft:latest
```
Access at [http://localhost:8080](http://localhost:8080).

### Build & Run with Docker Compose

```bash
# Production mode:
docker compose --profile prod up --build -d

# Development mode (with live reload):
docker compose --profile dev up --build
```

---

## Packaging the Browser Extension

The `extension/` folder contains a Manifest V3 extension providing quick access to PDFCraft tools from any web page.

### 1. Test Unpacked in Browser
1. Open Chrome, Edge, or Brave and navigate to `chrome://extensions/`.
2. Toggle on **Developer mode** in the upper-right corner.
3. Click **Load unpacked**.
4. Select the `j:\repos\pdfcraft\extension` folder.

### 2. Package into a ZIP Archive

**Using PowerShell:**
```powershell
Compress-Archive -Path "extension\*" -DestinationPath "pdfcraft-extension.zip" -Force
```

**Using Bash / Linux:**
```bash
cd extension && zip -r ../pdfcraft-extension.zip . && cd ..
```

---

## Environment Variables Reference

When executing builds, the following environment variables can be provided:

| Variable | Default | Purpose |
|---|---|---|
| `TAURI_ENV` | `""` | Set to `"true"` when building Tauri to adjust asset prefixes. |
| `APP_VERSION` | Auto (git commit/date) | Custom version string injected into the UI (e.g. `v2026.10.19-abc1234`). |
| `BASE_PATH` | `""` | Subdirectory path prefix (e.g. `/pdfcraft`). Must start with `/`. |
| `DISABLE_UPDATE_CHECK`| `"false"` | Disable desktop application version update notifications when set to `"true"`. |
| `APPLE_SIGNING_IDENTITY` | `""` | Set to `"-"` on macOS for local ad-hoc code signing. |

---

## Troubleshooting & FAQ

### 1. Windows: `link.exe` or MSVC C++ compiler errors
- **Problem**: Cargo fails with `error: linker 'link.exe' not found`.
- **Solution**: Install Visual Studio Build Tools with the **Desktop development with C++** workload. If already installed, open "x64 Native Tools Command Prompt for VS 2022" or ensure Visual Studio's `bin` path is in your `PATH`.

### 2. Windows: NSIS build succeeds but MSI fails
- **Problem**: `npx tauri build` complains about WiX Toolset when building `.msi`.
- **Solution**: Either install WiX v3 (`winget install WiX`) or build NSIS specifically using `npx tauri build --bundles nsis`.

### 3. Missing WASM or PDF.js Worker errors in frontend build
- **Problem**: Errors like `soffice.wasm` missing or worker script not found.
- **Solution**: Run `npm run predev` or `npm run prebuild` manually to regenerate and unpack all WebAssembly and worker binaries:
  ```bash
  node scripts/sync-pdfjs-workers.js
  node scripts/decompress-wasm.mjs public
  node scripts/ensure-pdfjs-viewer-js.js public
  ```

### 4. Cross-compilation (Building Windows from Linux/Mac or vice-versa)
- Tauri relies on platform-native webview bindings (WebView2 on Windows, WebKitGTK on Linux, WebKit/Cocoa on macOS). Cross-compiling across OS boundaries locally is complex and generally unsupported.
- **Recommended**: Use GitHub Actions CI (`.github/workflows/build-tauri.yml`) which runs on native `windows-latest`, `ubuntu-latest`, and `macos-latest` runners to generate all platform binaries automatically.

### 5. Cleaning build caches
To do a fresh build from scratch:
```powershell
# Remove Next.js build cache
Remove-Item -Recurse -Force .next, out

# Remove Tauri / Cargo build cache
Remove-Item -Recurse -Force src-tauri\target
```
*(On Linux/macOS: `rm -rf .next out src-tauri/target`)*
