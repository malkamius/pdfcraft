import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { UpdateModal } from '@/components/common/UpdateModal';
import { UpdateCheckResult } from '@/types/updater';
import * as tauriBridge from '@/lib/tauri-bridge';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string, values?: Record<string, any>) => {
    if (values && values.version) return `Version ${values.version}`;
    return key;
  },
}));

vi.mock('@/lib/tauri-bridge', () => ({
  openExternalUrl: vi.fn().mockResolvedValue(true),
  isTauri: vi.fn().mockReturnValue(false),
}));

describe('UpdateModal', () => {
  const mockAsset = {
    name: 'PDFCraft_0.1.2_x64_en-US.msi',
    size: 15000000,
    downloadUrl: 'https://github.com/malkamius/pdfcraft/releases/download/v0.1.2/installer.msi',
    browserDownloadUrl: 'https://github.com/malkamius/pdfcraft/releases/download/v0.1.2/installer.msi',
    platformType: 'windows-installer' as const,
  };

  const mockResultWithChangelog: UpdateCheckResult = {
    hasUpdate: true,
    currentVersion: '0.1.1',
    latestVersion: '0.1.2',
    release: {
      tag: 'v0.1.2',
      name: 'Release 0.1.2',
      publishedAt: '2026-10-19T20:00:00Z',
      htmlUrl: 'https://github.com/malkamius/pdfcraft/releases/tag/v0.1.2',
      body: `## What's Changed
* Added markdown viewer ([#42](https://github.com/malkamius/pdfcraft/pull/42))
* Fixed changelog display with **bold** and \`inline code\``,
      assets: [mockAsset],
    },
    matchedAssets: {
      primary: mockAsset,
      all: [mockAsset],
    },
    checkedAt: Date.now(),
  } as any;

  it('renders markdown changelog instead of raw markdown text', () => {
    render(
      <UpdateModal
        isOpen={true}
        onClose={vi.fn()}
        result={mockResultWithChangelog}
        loading={false}
        onRetry={vi.fn()}
      />
    );

    // Verify markdown header (h2) is rendered as HTML element rather than raw "## What's Changed"
    const heading = screen.getByRole('heading', { level: 2, name: "What's Changed" });
    expect(heading).toBeInTheDocument();

    // Verify formatted list items
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('inline code')).toBeInTheDocument();

    // Verify markdown link is rendered and interceptable
    const pullLink = screen.getByRole('link', { name: '#42' });
    expect(pullLink).toBeInTheDocument();
    expect(pullLink).toHaveAttribute('href', 'https://github.com/malkamius/pdfcraft/pull/42');

    fireEvent.click(pullLink);
    expect(tauriBridge.openExternalUrl).toHaveBeenCalledWith('https://github.com/malkamius/pdfcraft/pull/42');
  });

  it('renders changelog when up-to-date if release body exists', () => {
    const upToDateResult: UpdateCheckResult = {
      hasUpdate: false,
      currentVersion: '0.1.2',
      latestVersion: '0.1.2',
      release: {
        tag: 'v0.1.2',
        name: 'Release 0.1.2',
        publishedAt: '2026-10-19T20:00:00Z',
        htmlUrl: 'https://github.com/malkamius/pdfcraft/releases/tag/v0.1.2',
        body: '### Current Features\n- PDF Merge\n- PDF Split',
        assets: [],
      },
      matchedAssets: {
        all: [],
      },
      checkedAt: Date.now(),
    } as any;

    render(
      <UpdateModal
        isOpen={true}
        onClose={vi.fn()}
        result={upToDateResult}
        loading={false}
        onRetry={vi.fn()}
      />
    );

    expect(screen.getByRole('heading', { level: 3, name: 'Current Features' })).toHaveTextContent('Current Features');
    expect(screen.getByText('PDF Merge')).toBeInTheDocument();
  });
});
