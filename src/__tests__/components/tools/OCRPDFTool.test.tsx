import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { OCRPDFTool } from '@/components/tools/ocr/OCRPDFTool';
import * as ocrModule from '@/lib/pdf/processors/ocr';

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => {
    const fn = (key: string) => {
      const translations: Record<string, string> = {
        'ocr.optionsTitle': 'OCR Parameter Configuration',
        'ocr.selectLang': 'Select Recognition Languages',
        'ocr.outputFormat': 'Output File Format',
        'ocr.formatSearchablePdf': 'Double-Layer Searchable PDF',
        'ocr.formatText': 'Extract Plain Text File (.txt)',
        'ocr.formatMarkdown': 'Structured Markdown (.md)',
        'ocr.formatJson': 'Structured JSON (.json)',
        'ocr.startOcr': 'Start OCR',
        'ocr.successTitle': 'OCR Processed Successfully',
      };
      return translations[key] || key;
    };
    fn.rich = (key: string) => key;
    return fn;
  },
  useLocale: () => 'en',
}));

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

// Mock FileUploader
vi.mock('@/components/tools/FileUploader', () => ({
  FileUploader: ({ onFilesSelected }: { onFilesSelected: (files: File[]) => void }) => (
    <button
      data-testid="mock-uploader"
      onClick={() => onFilesSelected([new File(['%PDF-1.4 mock content'], 'sample.pdf', { type: 'application/pdf' })])}
    >
      Upload PDF
    </button>
  ),
}));

// Mock ocrPDF
vi.mock('@/lib/pdf/processors/ocr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/pdf/processors/ocr')>();
  return {
    ...actual,
    ocrPDF: vi.fn().mockResolvedValue({
      success: true,
      result: new Blob(['mock result'], { type: 'application/pdf' }),
      filename: 'sample_ocr.pdf',
      metadata: { pageCount: 1, totalWords: 10, totalChars: 50, avgConfidence: 95 },
    }),
  };
});

describe('OCRPDFTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders upload component initially', () => {
    render(<OCRPDFTool />);
    expect(screen.getByTestId('mock-uploader')).toBeInTheDocument();
  });

  it('allows selecting each OCR output format and passes it to ocrPDF', async () => {
    render(<OCRPDFTool />);
    fireEvent.click(screen.getByTestId('mock-uploader'));

    // Verify format option buttons exist
    const pdfBtn = screen.getByRole('button', { name: /Double-Layer Searchable PDF/i });
    const textBtn = screen.getByRole('button', { name: /Extract Plain Text File/i });
    const mdBtn = screen.getByRole('button', { name: /Structured Markdown/i });
    const jsonBtn = screen.getByRole('button', { name: /Structured JSON/i });

    expect(pdfBtn).toBeInTheDocument();
    expect(textBtn).toBeInTheDocument();
    expect(mdBtn).toBeInTheDocument();
    expect(jsonBtn).toBeInTheDocument();

    // Default format is searchable-pdf
    expect(pdfBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');

    // Select text format
    fireEvent.click(textBtn);
    expect(textBtn).toHaveAttribute('aria-pressed', 'true');
    expect(pdfBtn).toHaveAttribute('aria-pressed', 'false');

    // Select JSON format
    fireEvent.click(jsonBtn);
    expect(jsonBtn).toHaveAttribute('aria-pressed', 'true');
    expect(textBtn).toHaveAttribute('aria-pressed', 'false');

    // Click Start OCR
    const startBtn = screen.getByRole('button', { name: /Start OCR/i });
    fireEvent.click(startBtn);

    await waitFor(() => {
      expect(ocrModule.ocrPDF).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          outputFormat: 'json',
        }),
        expect.any(Function)
      );
    });
  });
});
