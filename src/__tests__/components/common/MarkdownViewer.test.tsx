import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MarkdownViewer } from '@/components/common/MarkdownViewer';
import * as tauriBridge from '@/lib/tauri-bridge';

// Mock openExternalUrl
vi.mock('@/lib/tauri-bridge', () => ({
  openExternalUrl: vi.fn().mockResolvedValue(true),
}));

describe('MarkdownViewer', () => {
  it('renders markdown headers, bold text, code, and lists correctly', () => {
    const md = `
# Release v1.0.0
This is **bold** text and \`code\` inline.

### Features
- Item 1
- Item 2
`;
    render(<MarkdownViewer content={md} />);

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Release v1.0.0');
    expect(screen.getByRole('heading', { level: 3 })).toHaveTextContent('Features');
    expect(screen.getByText('bold')).toBeInTheDocument();
    expect(screen.getByText('code')).toBeInTheDocument();
    expect(screen.getByText('Item 1')).toBeInTheDocument();
    expect(screen.getByText('Item 2')).toBeInTheDocument();
  });

  it('strips leading UTF-8 BOM if present', () => {
    const mdWithBom = '\uFEFF## Release Notes\n* Fixed issue';
    render(<MarkdownViewer content={mdWithBom} />);

    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Release Notes');
    expect(screen.getByText('Fixed issue')).toBeInTheDocument();
  });

  it('renders links and intercepts click to open with openExternalUrl', () => {
    const md = 'Check out [Changelog](https://github.com/malkamius/pdfcraft/releases) for details.';
    render(<MarkdownViewer content={md} />);

    const link = screen.getByRole('link', { name: 'Changelog' });
    expect(link).toHaveAttribute('href', 'https://github.com/malkamius/pdfcraft/releases');

    fireEvent.click(link);
    expect(tauriBridge.openExternalUrl).toHaveBeenCalledWith('https://github.com/malkamius/pdfcraft/releases');
  });

  it('calls custom onLinkClick handler if provided', () => {
    const onLinkClick = vi.fn();
    const md = '[Custom Link](https://example.com)';
    render(<MarkdownViewer content={md} onLinkClick={onLinkClick} />);

    const link = screen.getByRole('link', { name: 'Custom Link' });
    fireEvent.click(link);

    expect(onLinkClick).toHaveBeenCalledWith('https://example.com');
  });

  it('sanitizes dangerous script tags and event handlers', () => {
    const dangerousMd = 'Hello <script>alert("xss")</script><img src="x" onerror="alert(1)" />';
    const { container } = render(<MarkdownViewer content={dangerousMd} />);

    expect(container.querySelector('script')).toBeNull();
    expect(container.innerHTML).not.toContain('onerror');
    expect(container.innerHTML).not.toContain('alert');
  });

  it('renders empty message fallback gracefully when content is empty', () => {
    render(<MarkdownViewer content="" />);
    expect(screen.getByText('No changelog available.')).toBeInTheDocument();
  });
});
