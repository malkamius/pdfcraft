import {
  AssetPlatformType,
  HostPlatform,
  ReleaseAsset,
  ReleaseInfo,
  UpdateCheckResult,
  UpdateSettings,
} from '@/types/updater';

export const GITHUB_REPO =
  process.env.NEXT_PUBLIC_UPDATE_REPO || 'malkamius/pdfcraft';
export const DEFAULT_CURRENT_VERSION =
  process.env.NEXT_PUBLIC_APP_VERSION || '0.1.2';

const STORAGE_KEY = 'pdfcraft_update_settings';
const DEFAULT_CHECK_INTERVAL_HOURS = 24;

/**
 * Resolves the running app version at runtime.
 * In desktop mode (Tauri), queries the runtime Tauri application version.
 * Falls back to DEFAULT_CURRENT_VERSION in browser or if Tauri is unavailable.
 */
export async function getRuntimeAppVersion(): Promise<string> {
  if (
    typeof window !== 'undefined' &&
    ('__TAURI__' in window || '__TAURI_INTERNALS__' in window)
  ) {
    try {
      const { getVersion } = await import('@tauri-apps/api/app');
      const ver = await getVersion();
      if (ver) {
        return ver.trim();
      }
    } catch {
      // Fallback to configured build version
    }
  }
  return DEFAULT_CURRENT_VERSION;
}

/**
 * Parses version numbers or tag strings into numeric components for comparison.
 * Handles SemVer (e.g. 0.1.1, 0.1.2, 1.2.3) and legacy date-based tags (e.g. 2026.10.19-abc, v2026.09.10).
 */
export function parseVersionParts(version: string): { numbers: number[]; raw: string } {
  const clean = version.trim().replace(/^v/i, '');
  // Extract major numeric segments (ignoring trailing git commit hashes)
  const baseVersion = clean.split('-')[0];
  const parts = baseVersion
    .split('.')
    .map((p) => {
      const n = parseInt(p, 10);
      return Number.isNaN(n) ? 0 : n;
    });

  return { numbers: parts, raw: clean };
}

/**
 * Compares two versions.
 * Returns `true` if `latestVersion` is strictly newer than `currentVersion`.
 * Handles SemVer (0.1.1, 0.1.2) as well as legacy date-based tags (v2026.10.19).
 */
export function compareVersions(
  currentVersion: string,
  latestVersion: string,
  releasePublishedAt?: string
): boolean {
  if (!latestVersion) return false;
  if (!currentVersion) return true;

  const cur = parseVersionParts(currentVersion);
  const lat = parseVersionParts(latestVersion);

  if (cur.raw === lat.raw) {
    return false;
  }

  // Local development or initial fallback version
  if ((cur.raw === '0.1.0' || cur.raw === '0.0.0') && lat.raw !== cur.raw) {
    return true;
  }

  const curIsDateBased = (cur.numbers[0] || 0) >= 2000;
  const latIsDateBased = (lat.numbers[0] || 0) >= 2000;

  // Migration from legacy date-based tag (e.g. v2026.10.19-e616a0c) to SemVer (e.g. v0.1.2)
  if (curIsDateBased && !latIsDateBased) {
    // Current is legacy date format, remote is SemVer.
    // Check if the release timestamp is newer than the date in the current version tag or build date
    const buildDateStr = process.env.NEXT_PUBLIC_BUILD_DATE;
    const curDate = new Date(Date.UTC(cur.numbers[0], (cur.numbers[1] || 1) - 1, cur.numbers[2] || 1));
    const curTime = !Number.isNaN(curDate.getTime()) ? curDate.getTime() : 0;
    const buildTime = buildDateStr ? new Date(buildDateStr).getTime() : 0;
    const effectiveCurTime = Math.max(curTime, Number.isNaN(buildTime) ? 0 : buildTime);

    if (releasePublishedAt && effectiveCurTime > 0) {
      const releaseTime = new Date(releasePublishedAt).getTime();
      if (!Number.isNaN(releaseTime)) {
        return releaseTime > effectiveCurTime;
      }
    }
    // If no verifiable release timestamp, treat SemVer release as an update
    return true;
  }

  if (!curIsDateBased && latIsDateBased) {
    return true;
  }

  // Compare numerical segments (SemVer vs SemVer, or Date-based vs Date-based)
  const maxLen = Math.max(cur.numbers.length, lat.numbers.length);
  for (let i = 0; i < maxLen; i++) {
    const curNum = cur.numbers[i] || 0;
    const latNum = lat.numbers[i] || 0;
    if (latNum > curNum) return true;
    if (latNum < curNum) return false;
  }

  // If numerical segments match but raw tags differ:
  if (cur.raw !== lat.raw) {
    const buildDateStr = process.env.NEXT_PUBLIC_BUILD_DATE;
    if (releasePublishedAt && buildDateStr) {
      const releaseTime = new Date(releasePublishedAt).getTime();
      const buildTime = new Date(buildDateStr).getTime();
      if (!Number.isNaN(releaseTime) && !Number.isNaN(buildTime)) {
        return releaseTime > buildTime;
      }
    }
    return true;
  }

  return false;
}

/**
 * Categorizes a release asset by filename.
 * Accurately detects standalone portable .exe as well as .zip portable bundles and .msi installers.
 */
export function categorizeAsset(filename: string): AssetPlatformType {
  const lower = filename.toLowerCase();

  if (lower.includes('portable') && (lower.endsWith('.zip') || lower.endsWith('.exe'))) {
    return 'windows-portable';
  }
  if (lower.endsWith('.msi') || (lower.endsWith('.exe') && !lower.includes('portable'))) {
    return 'windows-installer';
  }
  if (lower.endsWith('.dmg')) {
    return 'macos-dmg';
  }
  if (lower.endsWith('.appimage')) {
    return 'linux-appimage';
  }
  if (lower.endsWith('.deb')) {
    return 'linux-deb';
  }
  if (lower.endsWith('.zip') || lower.endsWith('.tar.gz')) {
    return 'source';
  }
  return 'other';
}

/**
 * Detects the client host platform.
 */
export function detectPlatform(): HostPlatform {
  if (typeof window === 'undefined') return 'unknown';

  const userAgent = (navigator.userAgent || '').toLowerCase();
  const platform = (navigator.platform || '').toLowerCase();

  if (userAgent.includes('win') || platform.includes('win')) {
    return 'windows';
  }
  if (userAgent.includes('mac') || platform.includes('mac')) {
    return 'macos';
  }
  if (userAgent.includes('linux') || platform.includes('linux')) {
    return 'linux';
  }
  return 'unknown';
}

/**
 * Matches assets according to the current client platform.
 */
export function matchPlatformAssets(
  assets: ReleaseAsset[],
  platform: HostPlatform
): {
  primary?: ReleaseAsset;
  secondary?: ReleaseAsset;
  all: ReleaseAsset[];
} {
  const validAssets = assets.filter(
    (a) => a.platformType !== 'source' && a.platformType !== 'other'
  );

  let primary: ReleaseAsset | undefined;
  let secondary: ReleaseAsset | undefined;

  switch (platform) {
    case 'windows':
      primary = validAssets.find((a) => a.platformType === 'windows-installer') ||
                validAssets.find((a) => a.platformType === 'windows-portable');
      secondary = validAssets.find(
        (a) =>
          a !== primary &&
          (a.platformType === 'windows-portable' || a.platformType === 'windows-installer')
      );
      break;
    case 'macos':
      primary = validAssets.find((a) => a.platformType === 'macos-dmg');
      break;
    case 'linux':
      primary = validAssets.find((a) => a.platformType === 'linux-appimage') ||
                validAssets.find((a) => a.platformType === 'linux-deb');
      secondary = validAssets.find(
        (a) =>
          a !== primary &&
          (a.platformType === 'linux-deb' || a.platformType === 'linux-appimage')
      );
      break;
    default:
      primary = validAssets[0];
  }

  return {
    primary,
    secondary,
    all: validAssets,
  };
}

/**
 * Retrieves update settings from localStorage.
 */
export function getUpdateSettings(): UpdateSettings {
  if (typeof window === 'undefined') {
    return {
      autoCheck: true,
      checkFrequencyHours: DEFAULT_CHECK_INTERVAL_HOURS,
      lastCheckedTimestamp: 0,
      ignoredVersions: [],
    };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return {
        autoCheck: true,
        checkFrequencyHours: DEFAULT_CHECK_INTERVAL_HOURS,
        lastCheckedTimestamp: 0,
        ignoredVersions: [],
      };
    }
    const parsed = JSON.parse(raw);
    return {
      autoCheck: parsed.autoCheck ?? true,
      checkFrequencyHours: parsed.checkFrequencyHours ?? DEFAULT_CHECK_INTERVAL_HOURS,
      lastCheckedTimestamp: parsed.lastCheckedTimestamp ?? 0,
      ignoredVersions: Array.isArray(parsed.ignoredVersions) ? parsed.ignoredVersions : [],
    };
  } catch {
    return {
      autoCheck: true,
      checkFrequencyHours: DEFAULT_CHECK_INTERVAL_HOURS,
      lastCheckedTimestamp: 0,
      ignoredVersions: [],
    };
  }
}

/**
 * Saves update settings to localStorage.
 */
export function saveUpdateSettings(settings: UpdateSettings): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore quota/storage errors
  }
}

/**
 * Sets automatic checking for updates on/off.
 */
export function setAutoCheck(enabled: boolean): void {
  const settings = getUpdateSettings();
  settings.autoCheck = enabled;
  saveUpdateSettings(settings);
}

/**
 * Checks whether it's time to run an automatic update check.
 */
export function shouldCheckUpdate(): boolean {
  if (process.env.NEXT_PUBLIC_DISABLE_UPDATE_CHECK === 'true') {
    return false;
  }
  const settings = getUpdateSettings();
  if (!settings.autoCheck) return false;

  const now = Date.now();
  const intervalMs = settings.checkFrequencyHours * 3600 * 1000;
  return now - settings.lastCheckedTimestamp >= intervalMs;
}

/**
 * Ignores a specific version so the user won't be prompted again.
 */
export function ignoreVersion(version: string): void {
  const settings = getUpdateSettings();
  if (!settings.ignoredVersions.includes(version)) {
    settings.ignoredVersions.push(version);
    saveUpdateSettings(settings);
  }
}

/**
 * Checks if a version is in the ignored list.
 */
export function isVersionIgnored(version: string): boolean {
  const settings = getUpdateSettings();
  return settings.ignoredVersions.includes(version);
}

const SESSION_SNOOZE_KEY = 'pdfcraft_update_snoozed_version';

/**
 * Checks if a specific version has been snoozed (reminded later) in the current browser/app session.
 */
export function isUpdateSnoozedInSession(version: string): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const snoozed = sessionStorage.getItem(SESSION_SNOOZE_KEY);
    return snoozed === version;
  } catch {
    return false;
  }
}

/**
 * Snoozes update reminders for a specific version during the current session.
 */
export function snoozeUpdateInSession(version: string): void {
  if (typeof window === 'undefined') return;
  try {
    sessionStorage.setItem(SESSION_SNOOZE_KEY, version);
  } catch {
    // ignore quota/storage issues
  }
}

export const GITHUB_RELEASE_ENDPOINTS = [
  `https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
  `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=1`,
  `https://gh-proxy.com/https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
  `https://mirror.ghproxy.com/https://api.github.com/repos/${GITHUB_REPO}/releases/latest`,
];

/**
 * Fetches the latest release with multi-endpoint failover.
 * Tries official GitHub API first, falling back to mirror endpoints for global & domestic reliability.
 */
export async function fetchLatestRelease(): Promise<ReleaseInfo> {
  let lastError: Error | null = null;

  for (const endpoint of GITHUB_RELEASE_ENDPOINTS) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);

    try {
      const response = await fetch(endpoint, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
        },
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`API returned HTTP ${response.status}: ${response.statusText}`);
      }

      let data = await response.json();
      if (Array.isArray(data)) {
        if (data.length === 0) {
          throw new Error('No releases found in repository');
        }
        data = data[0];
      }

      const assets: ReleaseAsset[] = Array.isArray(data.assets)
        ? data.assets.map((asset: { name: string; size: number; browser_download_url: string }) => ({
            name: asset.name,
            downloadUrl: asset.browser_download_url,
            size: asset.size,
            platformType: categorizeAsset(asset.name),
            browserDownloadUrl: asset.browser_download_url,
            mirrorDownloadUrl: `https://gh-proxy.com/${asset.browser_download_url}`,
          }))
        : [];

      return {
        tag: data.tag_name || '',
        name: data.name || data.tag_name || '',
        publishedAt: data.published_at || '',
        htmlUrl: data.html_url || `https://github.com/${GITHUB_REPO}/releases`,
        body: data.body || '',
        assets,
      };
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      console.warn(`[Updater] Endpoint failed (${endpoint}):`, lastError.message);
    } finally {
      clearTimeout(timeoutId);
    }
  }

  throw lastError || new Error('Failed to fetch from all release endpoints');
}

export interface CheckUpdateOptions {
  force?: boolean;
  isDesktop?: boolean;
}

/**
 * Performs a check for software updates against the repository releases.
 *
 * @param optionsOrForce If true or options.force is true, skips interval and auto-check suppression and queries GitHub immediately.
 */
export async function checkUpdate(
  optionsOrForce: boolean | CheckUpdateOptions = false
): Promise<UpdateCheckResult> {
  const options: CheckUpdateOptions =
    typeof optionsOrForce === 'boolean'
      ? { force: optionsOrForce }
      : optionsOrForce;

  const currentVersion = await getRuntimeAppVersion();
  const settings = getUpdateSettings();

  // If automatic checking is disabled and this is a background check, skip
  if (!options.force && !settings.autoCheck) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      matchedAssets: { all: [] },
    };
  }

  const shouldBypassInterval = Boolean(options.force || options.isDesktop);

  if (process.env.NEXT_PUBLIC_DISABLE_UPDATE_CHECK === 'true' && !options.force) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      matchedAssets: { all: [] },
    };
  }

  if (!shouldBypassInterval && !shouldCheckUpdate()) {
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      matchedAssets: { all: [] },
    };
  }

  try {
    const release = await fetchLatestRelease();
    const latestVersion = release.tag;
    const hasUpdate = compareVersions(currentVersion, latestVersion, release.publishedAt);

    // Record check timestamp
    settings.lastCheckedTimestamp = Date.now();
    saveUpdateSettings(settings);

    const platform = detectPlatform();
    const matchedAssets = matchPlatformAssets(release.assets, platform);

    return {
      hasUpdate,
      currentVersion,
      latestVersion,
      release,
      matchedAssets,
    };
  } catch (error) {
    const rawError = error instanceof Error ? error.message : String(error);
    let friendlyError = rawError;
    if (rawError.includes('Failed to fetch') || rawError.includes('abort') || rawError.includes('NetworkError')) {
      friendlyError = `${rawError}: 无法连接至更新服务器（请检查网络连接、代理或客户端安全策略）`;
    }
    return {
      hasUpdate: false,
      currentVersion,
      latestVersion: currentVersion,
      matchedAssets: { all: [] },
      error: friendlyError,
    };
  }
}
