import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { GlobalFileDropHandler } from '@/components/common/GlobalFileDropHandler';
import {
  peekPendingDroppedFiles,
  clearPendingDroppedFiles,
} from '@/lib/utils/file-tool-router';
import * as tauriBridge from '@/lib/tauri-bridge';

const mockPush = vi.fn();
let mockPathname = '/en';

vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
  }),
  usePathname: () => mockPathname,
}));

describe('GlobalFileDropHandler - Open With & File Routing', () => {
  let openFilesCallback: ((paths: string[]) => void) | null = null;

  beforeEach(() => {
    vi.clearAllMocks();
    clearPendingDroppedFiles();
    mockPathname = '/en';
    openFilesCallback = null;

    vi.spyOn(tauriBridge, 'listenForOpenFiles').mockImplementation(async (cb) => {
      openFilesCallback = cb;
      return () => {
        openFilesCallback = null;
      };
    });
  });

  it('shows opening options modal when a PDF file is passed via Open With at cold start', async () => {
    const dummyPdf = new File(['%PDF-1.4 test'], 'contract.pdf', {
      type: 'application/pdf',
    });

    vi.spyOn(tauriBridge, 'getCliOpenFiles').mockResolvedValue(['C:\\Users\\test\\contract.pdf']);
    vi.spyOn(tauriBridge, 'createFilesFromFilePaths').mockResolvedValue([dummyPdf]);

    render(<GlobalFileDropHandler locale="en" />);

    // ToolSelectionModal should appear with opening options
    await waitFor(() => {
      expect(screen.getByTestId('tool-selection-modal')).toBeInTheDocument();
    });

    expect(screen.getByText('contract.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-studio')).toBeInTheDocument();
    expect(screen.getByText(/Open in PDF Studio/i)).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-edit-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-merge-pdf')).toBeInTheDocument();

    // Clicking "Open in PDF Studio" routes to Studio with pending file
    fireEvent.click(screen.getByTestId('select-tool-studio'));

    expect(mockPush).toHaveBeenCalledWith('/en/studio');
    const pending = peekPendingDroppedFiles();
    expect(pending?.targetToolSlug).toBe('studio');
    expect(pending?.files).toEqual([dummyPdf]);
  });

  it('routes to selected tool when a tool card is clicked in opening options modal', async () => {
    const dummyPdf = new File(['%PDF-1.4 test'], 'contract.pdf', {
      type: 'application/pdf',
    });

    vi.spyOn(tauriBridge, 'getCliOpenFiles').mockResolvedValue(['C:\\Users\\test\\contract.pdf']);
    vi.spyOn(tauriBridge, 'createFilesFromFilePaths').mockResolvedValue([dummyPdf]);

    render(<GlobalFileDropHandler locale="en" />);

    await waitFor(() => {
      expect(screen.getByTestId('tool-selection-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('select-tool-merge-pdf'));

    expect(mockPush).toHaveBeenCalledWith('/en/tools/merge-pdf');
    const pending = peekPendingDroppedFiles();
    expect(pending?.targetToolSlug).toBe('merge-pdf');
    expect(pending?.files).toEqual([dummyPdf]);
  });

  it('routes directly without modal when a single-tool file is opened via Open With', async () => {
    const psdFile = new File(['dummy psd'], 'artwork.psd', {
      type: 'image/vnd.adobe.photoshop',
    });

    vi.spyOn(tauriBridge, 'getCliOpenFiles').mockResolvedValue(['C:\\Users\\test\\artwork.psd']);
    vi.spyOn(tauriBridge, 'createFilesFromFilePaths').mockResolvedValue([psdFile]);

    render(<GlobalFileDropHandler locale="en" />);

    await waitFor(() => {
      expect(mockPush).toHaveBeenCalledWith('/en/tools/psd-to-pdf');
    });

    expect(screen.queryByTestId('tool-selection-modal')).not.toBeInTheDocument();
    const pending = peekPendingDroppedFiles();
    expect(pending?.targetToolSlug).toBe('psd-to-pdf');
    expect(pending?.files).toEqual([psdFile]);
  });

  it('shows opening options when another file is opened while the app is already running (hot start)', async () => {
    const dummyPdf = new File(['%PDF-1.4 test'], 'invoice.pdf', {
      type: 'application/pdf',
    });

    vi.spyOn(tauriBridge, 'getCliOpenFiles').mockResolvedValue([]);
    vi.spyOn(tauriBridge, 'createFilesFromFilePaths').mockResolvedValue([dummyPdf]);

    render(<GlobalFileDropHandler locale="en" />);

    // Initially modal is not open
    expect(screen.queryByTestId('tool-selection-modal')).not.toBeInTheDocument();
    expect(openFilesCallback).not.toBeNull();

    // Hot start: second instance triggers single-instance listener with paths
    await openFilesCallback!(['C:\\Users\\test\\invoice.pdf']);

    await waitFor(() => {
      expect(screen.getByTestId('tool-selection-modal')).toBeInTheDocument();
    });

    expect(screen.getByText('invoice.pdf')).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-studio')).toBeInTheDocument();
  });

  it('shows opening options modal when a multi-tool file is dropped onto the window', async () => {
    vi.spyOn(tauriBridge, 'getCliOpenFiles').mockResolvedValue([]);

    render(<GlobalFileDropHandler locale="en" />);

    const pngFile = new File(['dummy png'], 'screenshot.png', {
      type: 'image/png',
    });

    fireEvent.drop(window, {
      dataTransfer: {
        files: [pngFile],
      },
    });

    await waitFor(() => {
      expect(screen.getByTestId('tool-selection-modal')).toBeInTheDocument();
    });

    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-png-to-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-image-to-pdf')).toBeInTheDocument();
  });
});
