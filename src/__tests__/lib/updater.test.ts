/**
 * Software Updater & Version Comparison Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  parseVersionParts,
  compareVersions,
  categorizeAsset,
  matchPlatformAssets,
  ignoreVersion,
  isVersionIgnored,
  snoozeUpdateInSession,
  isUpdateSnoozedInSession,
  saveUpdateSettings,
  shouldCheckUpdate,
  setAutoCheck,
  getUpdateSettings,
  checkUpdate,
  GITHUB_REPO,
} from '@/lib/updater';
import type { ReleaseAsset } from '@/types/updater';

describe('Software Updater', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  describe('parseVersionParts', () => {
    it('parses standard semver versions', () => {
      const parts = parseVersionParts('0.1.1');
      expect(parts.numbers).toEqual([0, 1, 1]);
      expect(parts.raw).toBe('0.1.1');
    });

    it('parses semver versions with leading v', () => {
      const parts = parseVersionParts('v0.1.2');
      expect(parts.numbers).toEqual([0, 1, 2]);
      expect(parts.raw).toBe('0.1.2');
    });

    it('parses date-based tags with leading v and commit hashes', () => {
      const parts = parseVersionParts('v2026.10.19-e616a0c');
      expect(parts.numbers).toEqual([2026, 10, 19]);
      expect(parts.raw).toBe('2026.10.19-e616a0c');
    });
  });

  describe('compareVersions', () => {
    it('detects newer SemVer version', () => {
      expect(compareVersions('0.1.1', '0.1.2')).toBe(true);
      expect(compareVersions('v0.1.1', 'v0.1.2')).toBe(true);
      expect(compareVersions('0.1.0', '0.2.0')).toBe(true);
      expect(compareVersions('1.0.0', '1.0.1')).toBe(true);
      expect(compareVersions('1.0.0', '1.0.0')).toBe(false);
      expect(compareVersions('0.1.2', '0.1.1')).toBe(false);
      expect(compareVersions('0.1.2', '0.1.2')).toBe(false);
    });

    it('detects update when local version is default 0.1.0 and remote is date-tagged or semver', () => {
      expect(compareVersions('0.1.0', 'v2026.09.12-6178132')).toBe(true);
      expect(compareVersions('0.0.0', 'v0.1.2')).toBe(true);
    });

    it('detects update when local version is legacy date tag and remote is newer SemVer', () => {
      // Installed app had v2026.10.19-e616a0c, remote is v0.1.2 published Oct 20
      expect(
        compareVersions('v2026.10.19-e616a0c', 'v0.1.2', '2026-10-20T03:02:40Z')
      ).toBe(true);
    });

    it('detects newer date-tagged version across days', () => {
      expect(compareVersions('v2026.09.10-abc', 'v2026.09.12-def')).toBe(true);
      expect(compareVersions('v2026.09.15-abc', 'v2026.09.12-def')).toBe(false);
    });

    it('detects update when date is the same but commit hash differs (same-day releases)', () => {
      expect(compareVersions('v2026.09.12-1111111', 'v2026.09.12-2222222')).toBe(true);
    });

    it('returns false when version tags are identical', () => {
      expect(compareVersions('v0.1.2', 'v0.1.2')).toBe(false);
      expect(compareVersions('0.1.2', '0.1.2')).toBe(false);
      expect(compareVersions('v2026.09.12-6178132', 'v2026.09.12-6178132')).toBe(false);
    });

    it('handles falsy or empty versions gracefully', () => {
      expect(compareVersions('', 'v0.1.2')).toBe(true);
      expect(compareVersions('v0.1.2', '')).toBe(false);
    });
  });

  describe('categorizeAsset & matchPlatformAssets', () => {
    it('categorizes assets correctly including standalone portable exe', () => {
      expect(categorizeAsset('PDFCraft-Portable.exe')).toBe('windows-portable');
      expect(categorizeAsset('PDFCraft-Windows-x64-Portable.zip')).toBe('windows-portable');
      expect(categorizeAsset('PDFCraft_0.1.2_x64_en-US.msi')).toBe('windows-installer');
      expect(categorizeAsset('PDFCraft-Setup.exe')).toBe('windows-installer');
      expect(categorizeAsset('PDFCraft.dmg')).toBe('macos-dmg');
      expect(categorizeAsset('PDFCraft.AppImage')).toBe('linux-appimage');
      expect(categorizeAsset('PDFCraft.deb')).toBe('linux-deb');
      expect(categorizeAsset('source-code.zip')).toBe('source');
    });

    it('matches Windows platform assets with installer and portable', () => {
      const assets: ReleaseAsset[] = [
        {
          name: 'PDFCraft_0.1.2_x64_en-US.msi',
          downloadUrl: 'https://example.com/installer.msi',
          size: 2048,
          platformType: 'windows-installer',
          browserDownloadUrl: 'https://example.com/installer.msi',
        },
        {
          name: 'PDFCraft-Portable.exe',
          downloadUrl: 'https://example.com/portable.exe',
          size: 1024,
          platformType: 'windows-portable',
          browserDownloadUrl: 'https://example.com/portable.exe',
        },
      ];

      const matched = matchPlatformAssets(assets, 'windows');
      expect(matched.primary?.platformType).toBe('windows-installer');
      expect(matched.secondary?.platformType).toBe('windows-portable');
    });
  });

  describe('ignore and snooze functionality', () => {
    it('correctly tracks ignored versions in localStorage', () => {
      expect(isVersionIgnored('v0.1.2')).toBe(false);
      ignoreVersion('v0.1.2');
      expect(isVersionIgnored('v0.1.2')).toBe(true);
      expect(isVersionIgnored('v0.1.3')).toBe(false);
    });

    it('correctly tracks snoozed versions in sessionStorage', () => {
      expect(isUpdateSnoozedInSession('v0.1.2')).toBe(false);
      snoozeUpdateInSession('v0.1.2');
      expect(isUpdateSnoozedInSession('v0.1.2')).toBe(true);
      expect(isUpdateSnoozedInSession('v0.1.3')).toBe(false);
    });
  });

  describe('settings and checkUpdate', () => {
    it('allows disabling automatic checking for updates', () => {
      setAutoCheck(false);
      expect(getUpdateSettings().autoCheck).toBe(false);
      expect(shouldCheckUpdate()).toBe(false);

      setAutoCheck(true);
      expect(getUpdateSettings().autoCheck).toBe(true);
      expect(shouldCheckUpdate()).toBe(true);
    });

    it('checks shouldCheckUpdate frequency correctly', () => {
      expect(shouldCheckUpdate()).toBe(true);

      const now = Date.now();
      saveUpdateSettings({
        autoCheck: true,
        checkFrequencyHours: 24,
        lastCheckedTimestamp: now,
        ignoredVersions: [],
      });
      expect(shouldCheckUpdate()).toBe(false);

      saveUpdateSettings({
        autoCheck: true,
        checkFrequencyHours: 24,
        lastCheckedTimestamp: now - 25 * 3600 * 1000,
        ignoredVersions: [],
      });
      expect(shouldCheckUpdate()).toBe(true);
    });

    it('fetches release and discovers update via mocked fetch', async () => {
      const mockGitHubResponse = {
        tag_name: 'v0.1.2',
        name: 'PDFCraft v0.1.2',
        published_at: '2026-10-20T03:02:40Z',
        html_url: 'https://github.com/malkamius/pdfcraft/releases/tag/v0.1.2',
        body: '## Release notes',
        assets: [
          {
            name: 'PDFCraft-Portable.exe',
            browser_download_url: 'https://example.com/portable.exe',
            size: 10485760,
          },
          {
            name: 'PDFCraft_0.1.2_x64_en-US.msi',
            browser_download_url: 'https://example.com/installer.msi',
            size: 10485760,
          },
        ],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });

      const result = await checkUpdate({ force: true });
      expect(result.latestVersion).toBe('v0.1.2');
      expect(result.matchedAssets.all.length).toBeGreaterThan(0);
    });

    it('skips background check when autoCheck is disabled', async () => {
      setAutoCheck(false);
      const fetchSpy = vi.fn();
      global.fetch = fetchSpy;

      const result = await checkUpdate(false);
      expect(result.hasUpdate).toBe(false);
      expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('still executes check when manually triggered (force: true) even if autoCheck is disabled', async () => {
      setAutoCheck(false);
      const mockGitHubResponse = {
        tag_name: 'v0.1.2',
        name: 'PDFCraft v0.1.2',
        published_at: '2026-10-20T03:02:40Z',
        html_url: 'https://github.com/malkamius/pdfcraft/releases/tag/v0.1.2',
        body: '## Release notes',
        assets: [],
      };
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => mockGitHubResponse,
      });

      const result = await checkUpdate({ force: true });
      expect(result.latestVersion).toBe('v0.1.2');
    });

    it('points to malkamius/pdfcraft by default instead of upstream', () => {
      expect(GITHUB_REPO).toBe('malkamius/pdfcraft');
    });
  });
});
