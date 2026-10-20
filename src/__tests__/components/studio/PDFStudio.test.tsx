import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import React from 'react';
import { PDFStudio } from '@/components/studio/PDFStudio';
import * as tauriBridge from '@/lib/tauri-bridge';
import * as studioProcessors from '@/components/studio/studio-processors';
import { clearPendingDroppedFiles, peekPendingDroppedFiles } from '@/lib/utils/file-tool-router';
import { clearAllAutoBackups, clearRecentFileBlobs } from '@/lib/storage/auto-backup';
import {
  DEFAULT_PDF_TOOL_STORAGE_KEY,
  DEFAULT_STARTUP_VIEW_STORAGE_KEY,
} from '@/lib/storage/default-tool';

const mockPush = vi.fn();

// Mock next/navigation
vi.mock('next/navigation', () => ({
  useRouter: () => ({
    push: mockPush,
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
}));

// Mock next/link
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: any) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

// Mock next-intl
vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

// Mock path util
vi.mock('@/lib/utils/path', () => ({
  withBasePath: (path: string) => path,
}));

// Mock tauri-bridge
vi.mock('@/lib/tauri-bridge', () => ({
  isTauri: vi.fn(() => false),
  saveBlobFile: vi.fn().mockResolvedValue(true),
  getSystemPrinters: vi.fn().mockResolvedValue([]),
  printPdfFile: vi.fn().mockResolvedValue(true),
  closeAppWindow: vi.fn().mockResolvedValue(undefined),
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;

describe('PDFStudio Component', () => {
  beforeEach(async () => {
    localStorage.clear();
    await clearAllAutoBackups();
    await clearRecentFileBlobs();
    clearPendingDroppedFiles();
    URL.createObjectURL = vi.fn(() => 'blob:mock-studio-url');
    URL.revokeObjectURL = vi.fn();
    vi.clearAllMocks();
  });

  afterEach(async () => {
    localStorage.clear();
    await clearAllAutoBackups();
    await clearRecentFileBlobs();
    clearPendingDroppedFiles();
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
    cleanup();
  });

  const createDummyPdfFile = (name = 'test-doc.pdf') => {
    return new File(['%PDF-1.4 dummy content'], name, { type: 'application/pdf' });
  };

  it('renders initial empty workspace with upload dropzone and classic grid switch link in Chinese', () => {
    render(<PDFStudio locale="zh" />);

    expect(screen.getByText(/PDFCraft/i)).toBeInTheDocument();
    expect(screen.getByText(/导入 PDF 开启 Studio 工作台/i)).toBeInTheDocument();
    expect(screen.getByText(/选择 PDF 文件/i)).toBeInTheDocument();
    expect(screen.getByText(/经典网格视图/i)).toBeInTheDocument();
  });

  it('defaults to English when locale prop is omitted or unsupported', () => {
    render(<PDFStudio />);

    expect(screen.getByText(/PDFCraft/i)).toBeInTheDocument();
    expect(screen.getByText(/Import PDF to Launch Studio Workspace/i)).toBeInTheDocument();
    expect(screen.getByText(/Select PDF Files/i)).toBeInTheDocument();
    expect(screen.getByText(/Back to All Tools/i)).toBeInTheDocument();
  });

  it('renders English UI when locale="en" with initialFile', () => {
    const file = createDummyPdfFile('my-invoice.pdf');
    render(<PDFStudio locale="en" initialFile={file} />);

    expect(screen.getByText('my-invoice.pdf')).toBeInTheDocument();
    expect(screen.getByText('Print')).toBeInTheDocument();
    expect(screen.getByText('Save & Export')).toBeInTheDocument();
  });

  it('renders central viewer and toolbar controls when loaded with initialFile', () => {
    const file = createDummyPdfFile('my-invoice.pdf');
    render(<PDFStudio locale="zh" initialFile={file} />);

    // Shows file name in header
    expect(screen.getByText('my-invoice.pdf')).toBeInTheDocument();

    // Undo and Redo buttons exist and disabled initially
    const undoBtn = screen.getByLabelText('Undo');
    const redoBtn = screen.getByLabelText('Redo');
    expect(undoBtn).toBeDisabled();
    expect(redoBtn).toBeDisabled();

    // Print and Export buttons
    expect(screen.getByText('打印')).toBeInTheDocument();
    expect(screen.getByText('保存导出')).toBeInTheDocument();

    // Iframe with viewer src and title matching file name
    const iframe = screen.getByTitle('my-invoice.pdf');
    expect(iframe).toBeInTheDocument();
    expect(iframe).toHaveAttribute('src', expect.stringContaining('viewer.html'));
  });

  it('collapses and expands left toolbar rail', () => {
    const file = createDummyPdfFile();
    render(<PDFStudio locale="zh" initialFile={file} />);

    const collapseBtn = screen.getByLabelText('Collapse sidebar');
    fireEvent.click(collapseBtn);

    // After collapsing, button should have Expand sidebar label
    expect(screen.getByLabelText('Expand sidebar')).toBeInTheDocument();

    // Expand again
    const expandBtn = screen.getByLabelText('Expand sidebar');
    fireEvent.click(expandBtn);
    expect(screen.getByLabelText('Collapse sidebar')).toBeInTheDocument();
  });

  it('opens tool drawer when clicking a tool icon on the left rail', () => {
    const file = createDummyPdfFile();
    render(<PDFStudio locale="zh" initialFile={file} />);

    // Click rotate tool (matches 旋转PDF in featured)
    const rotateBtn = screen.getAllByRole('button', { name: /旋转/i })[0];
    fireEvent.click(rotateBtn);

    // Tool drawer should open with Apply button and Cancel button
    expect(screen.getByText('应用更改')).toBeInTheDocument();
    expect(screen.getByText('取消')).toBeInTheDocument();

    // Click cancel in drawer
    const cancelBtn = screen.getByText('取消');
    fireEvent.click(cancelBtn);
    expect(screen.queryByText('应用更改')).not.toBeInTheDocument();
  });

  it('executes operation, updates history stack, enables undo and export', async () => {
    const mockOutputBlob = new Blob(['%PDF-1.4 modified'], { type: 'application/pdf' });
    vi.spyOn(studioProcessors, 'executeStudioOperation').mockResolvedValue(mockOutputBlob);

    const file = createDummyPdfFile('sample.pdf');
    render(<PDFStudio locale="zh" initialFile={file} />);

    // Open Rotate tool
    const rotateBtn = screen.getAllByRole('button', { name: /旋转/i })[0];
    fireEvent.click(rotateBtn);

    // Click Apply
    const applyBtn = screen.getByText('应用更改');
    fireEvent.click(applyBtn);

    // Wait for operation to complete
    await waitFor(() => {
      expect(studioProcessors.executeStudioOperation).toHaveBeenCalled();
    });

    // Undo button should now be enabled
    const undoBtn = screen.getByLabelText('Undo');
    await waitFor(() => {
      expect(undoBtn).not.toBeDisabled();
    });

    // Click Undo
    fireEvent.click(undoBtn);

    // Redo button should now be enabled
    const redoBtn = screen.getByLabelText('Redo');
    await waitFor(() => {
      expect(redoBtn).not.toBeDisabled();
    });

    // Export document
    const exportBtn = screen.getByText('保存导出');
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(tauriBridge.saveBlobFile).toHaveBeenCalled();
    });
  });

  it('filters tools by search query in the left rail', () => {
    const file = createDummyPdfFile();
    render(<PDFStudio locale="zh" initialFile={file} />);

    const searchInput = screen.getByPlaceholderText(/搜索全部 67\+ 工具/i);
    fireEvent.change(searchInput, { target: { value: '水印' } });

    // Should find matching tools
    expect(screen.getByText(/找到/i)).toBeInTheDocument();
    expect(screen.getByText(/添加水印/i)).toBeInTheDocument();
  });

  it('handles export convert tools without altering central PDF viewer', async () => {
    const mockExportBlob = new Blob(['dummy docx'], { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    vi.spyOn(studioProcessors, 'executeStudioExport').mockResolvedValue({
      blob: mockExportBlob,
      filename: 'sample_converted.docx',
    });

    const file = createDummyPdfFile('sample.pdf');
    render(<PDFStudio locale="zh" initialFile={file} />);

    // Filter for Word tool
    const searchInput = screen.getByPlaceholderText(/搜索全部 67\+ 工具/i);
    fireEvent.change(searchInput, { target: { value: 'Word' } });

    // Click PDF to Word
    const wordToolBtn = screen.getByRole('button', { name: /PDF转Word/i });
    fireEvent.click(wordToolBtn);

    // Drawer opens with export button
    const exportBtn = screen.getByText('开始导出');
    expect(exportBtn).toBeInTheDocument();
    fireEvent.click(exportBtn);

    await waitFor(() => {
      expect(studioProcessors.executeStudioExport).toHaveBeenCalled();
      expect(tauriBridge.saveBlobFile).toHaveBeenCalledWith(
        mockExportBlob,
        'sample_converted.docx'
      );
    });

    // Original iframe is still present and valid
    expect(screen.getByTitle('sample.pdf')).toBeInTheDocument();
  });

  it('toggles favorite tools and filters via favorites pill', () => {
    const file = createDummyPdfFile();
    render(<PDFStudio locale="zh" initialFile={file} />);

    // Find favorite button for rotate tool
    const favButtons = screen.getAllByTitle('添加收藏');
    expect(favButtons.length).toBeGreaterThan(0);
    fireEvent.click(favButtons[0]);

    // Check filter pill for favorites
    const favPill = screen.getByTestId('filter-pill-favorites');
    fireEvent.click(favPill);

    // Should show at least 1 tool in favorites
    expect(screen.getByText(/找到/i)).toBeInTheDocument();
  });

  it('opens history timeline popover and split export dropdown', async () => {
    const mockOutputBlob = new Blob(['%PDF-1.4 modified'], { type: 'application/pdf' });
    vi.spyOn(studioProcessors, 'executeStudioOperation').mockResolvedValue(mockOutputBlob);

    const file = createDummyPdfFile('history-doc.pdf');
    render(<PDFStudio locale="zh" initialFile={file} />);

    // Apply a tool to build history
    const rotateBtn = screen.getAllByRole('button', { name: /旋转/i })[0];
    fireEvent.click(rotateBtn);
    fireEvent.click(screen.getByText('应用更改'));

    await waitFor(() => {
      expect(studioProcessors.executeStudioOperation).toHaveBeenCalled();
    });

    // Open history popover
    const historyBadge = screen.getByTitle('查看操作历史记录');
    fireEvent.click(historyBadge);
    expect(screen.getByText('操作历史时间线')).toBeInTheDocument();

    // Open export dropdown
    const moreExportBtn = screen.getByLabelText('More export formats');
    fireEvent.click(moreExportBtn);
    expect(screen.getByText(/导出为 Word/i)).toBeInTheDocument();
    expect(screen.getByText(/导出为图片包/i)).toBeInTheDocument();
  });

  it('renders non-scrolling two-tier filter controls and toggles category filters', () => {
    const file = createDummyPdfFile();
    render(<PDFStudio locale="zh" initialFile={file} />);

    // Tier 1 pills
    expect(screen.getByTestId('filter-pill-all')).toBeInTheDocument();
    expect(screen.getByTestId('filter-pill-featured')).toBeInTheDocument();
    expect(screen.getByTestId('filter-pill-favorites')).toBeInTheDocument();
    expect(screen.getByTestId('filter-pill-recent')).toBeInTheDocument();

    // Tier 2 category pills
    const orgPill = screen.getByTestId('filter-pill-organize-manage');
    expect(orgPill).toBeInTheDocument();

    // Click category pill to filter
    fireEvent.click(orgPill);
    expect(screen.getByText(/找到/i)).toBeInTheDocument();

    // Click again to toggle back to all
    fireEvent.click(orgPill);
    expect(screen.getByText(/按大类浏览/i)).toBeInTheDocument();
  });

  it('supports multi-document tabs, switching active document, and batch ZIP export', async () => {
    const file1 = createDummyPdfFile('contract_part1.pdf');
    const file2 = createDummyPdfFile('contract_part2.pdf');

    render(<PDFStudio locale="zh" />);

    // Batch load multiple files via file input in empty workspace
    const uploadInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(uploadInput).toBeInTheDocument();

    fireEvent.change(uploadInput, {
      target: { files: [file1, file2] },
    });

    // Both tabs should now be rendered in the document tabs bar
    await waitFor(() => {
      expect(screen.getByText('contract_part1.pdf')).toBeInTheDocument();
      expect(screen.getByText('contract_part2.pdf')).toBeInTheDocument();
    });

    // Currently active viewer iframe should be the first document
    expect(screen.getByTitle('contract_part1.pdf')).toBeInTheDocument();

    // Click the second tab to switch active document
    const tab2 = screen.getByText('contract_part2.pdf');
    fireEvent.click(tab2);

    // Active viewer iframe should now switch to contract_part2.pdf
    await waitFor(() => {
      expect(screen.getByTitle('contract_part2.pdf')).toBeInTheDocument();
    });

    // Open export dropdown - should show batch export option for 2 documents
    const moreExportBtn = screen.getByLabelText('More export formats');
    fireEvent.click(moreExportBtn);
    expect(screen.getByText(/打包导出全部文档 \(2篇 \.zip\)/i)).toBeInTheDocument();

    // Open Merge PDF tool - drawer should show contract_part1.pdf as quick-add option
    const searchInput = screen.getByPlaceholderText(/搜索全部 67\+ 工具/i);
    fireEvent.change(searchInput, { target: { value: '合并' } });

    const mergeBtn = screen.getByTestId('tool-item-merge-pdf');
    fireEvent.click(mergeBtn);

    // Check quick add button exists for the other open document
    expect(screen.getByText(/快捷并入工作台中已打开的文档/i)).toBeInTheDocument();

    // Close the second tab
    const closeBtn2 = screen.getByLabelText('Close contract_part2.pdf');
    fireEvent.click(closeBtn2);

    // After closing tab 2, active document reverts to contract_part1.pdf
    await waitFor(() => {
      expect(screen.queryByTitle('contract_part2.pdf')).not.toBeInTheDocument();
      expect(screen.getByTitle('contract_part1.pdf')).toBeInTheDocument();
    });
  });

  it('renders rich parameters in tool drawer for extract-pages, decrypt-pdf, and n-up-pdf', async () => {
    const file = createDummyPdfFile('test-tools.pdf');
    render(<PDFStudio locale="zh" initialFile={file} />);

    const searchInput = screen.getByPlaceholderText(/搜索全部 67\+ 工具/i);

    // 1. Check extract-pages parameters
    fireEvent.change(searchInput, { target: { value: '提取页面' } });
    const extractBtn = screen.getByTestId('tool-item-extract-pages');
    fireEvent.click(extractBtn);

    expect(screen.getByText(/提取页码范围/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('1-3, 5')).toBeInTheDocument();

    // 2. Check decrypt-pdf parameters
    fireEvent.change(searchInput, { target: { value: '解密' } });
    const decryptBtn = screen.getByTestId('tool-item-decrypt-pdf');
    fireEvent.click(decryptBtn);

    expect(screen.getByText(/文档密码 \/ 口令/i)).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/若有打开密码请输入/i)).toBeInTheDocument();

    // 3. Check n-up-pdf parameters
    fireEvent.change(searchInput, { target: { value: '多页' } });
    const nUpBtn = screen.getByTestId('tool-item-n-up-pdf');
    fireEvent.click(nUpBtn);

    expect(screen.getByText(/每张纸拼排页数/i)).toBeInTheDocument();
    expect(screen.getByText('2-Up')).toBeInTheDocument();
    expect(screen.getByText('4-Up')).toBeInTheDocument();
  });

  it('runs OCR and opens results in memory without triggering save/export until the user chooses to save', async () => {
    const mockOcrPdfBlob = new Blob(['%PDF-1.4 searchable ocr'], { type: 'application/pdf' });
    (mockOcrPdfBlob as any).__metadata = {
      totalWords: 42,
      avgConfidence: 96,
      rawText: 'Recognized invoice text in memory',
      markdownText: '# Invoice\n\nRecognized invoice text in memory',
      jsonText: '{"text":"Recognized invoice text in memory"}',
      requestedFormat: 'searchable-pdf',
    };
    vi.spyOn(studioProcessors, 'executeStudioOperation').mockResolvedValue(mockOcrPdfBlob);

    const file = createDummyPdfFile('scan.pdf');
    render(<PDFStudio locale="en" initialFile={file} />);

    // Open OCR tool from left rail
    const searchInput = screen.getByTestId('studio-tool-search');
    fireEvent.change(searchInput, { target: { value: 'ocr' } });
    const ocrToolBtn = screen.getByTestId('tool-item-ocr-pdf');
    fireEvent.click(ocrToolBtn);

    // Click Apply Changes (runs in memory, does NOT call saveBlobFile)
    const applyBtn = screen.getByRole('button', { name: /Apply Changes/i });
    fireEvent.click(applyBtn);

    await waitFor(() => {
      expect(studioProcessors.executeStudioOperation).toHaveBeenCalledWith(
        expect.any(File),
        'ocr-pdf',
        expect.any(Object)
      );
    });

    // Should NOT have triggered save/export automatically
    expect(tauriBridge.saveBlobFile).not.toHaveBeenCalled();

    // In-memory OCR bar should appear with word count and confidence
    expect(screen.getByTestId('studio-ocr-memory-bar')).toBeInTheDocument();
    expect(screen.getByText(/OCR Open in Memory/i)).toBeInTheDocument();
    expect(screen.getByText(/42 words/i)).toBeInTheDocument();

    // User can preview the extracted text in memory
    fireEvent.click(screen.getByRole('button', { name: /Preview Extracted Text/i }));
    expect(screen.getByText('Recognized invoice text in memory')).toBeInTheDocument();

    // When the user likes the results, they can click Save & Export OCR
    fireEvent.click(screen.getByRole('button', { name: /Save & Export OCR/i }));
    await waitFor(() => {
      expect(tauriBridge.saveBlobFile).toHaveBeenCalledWith(
        mockOcrPdfBlob,
        'scan_searchable.pdf'
      );
    });
  });

  it('opens the proper tool window directly when a file supported by a single tool is dragged in', () => {
    render(<PDFStudio locale="en" />);

    const psdFile = new File(['dummy psd'], 'artwork.psd', {
      type: 'image/vnd.adobe.photoshop',
    });

    const studioHeading = screen.getByText(/Import PDF to Launch Studio Workspace/i);
    fireEvent.drop(studioHeading, {
      dataTransfer: {
        files: [psdFile],
      },
    });

    expect(mockPush).toHaveBeenCalledWith('/en/tools/psd-to-pdf');
    const pending = peekPendingDroppedFiles();
    expect(pending).not.toBeNull();
    expect(pending?.targetToolSlug).toBe('psd-to-pdf');
    expect(pending?.files).toEqual([psdFile]);
  });

  it('opens the tool selection modal with valid tools when an image supported by multiple tools is dragged in', () => {
    render(<PDFStudio locale="en" />);

    const pngFile = new File(['dummy png'], 'screenshot.png', {
      type: 'image/png',
    });

    const studioHeading = screen.getByText(/Import PDF to Launch Studio Workspace/i);
    fireEvent.drop(studioHeading, {
      dataTransfer: {
        files: [pngFile],
      },
    });

    // Modal should appear listing valid tools for .png
    const modal = screen.getByTestId('tool-selection-modal');
    expect(modal).toBeInTheDocument();
    expect(screen.getByText('screenshot.png')).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-png-to-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-image-to-pdf')).toBeInTheDocument();
    expect(screen.getByTestId('select-tool-ocr-pdf')).toBeInTheDocument();

    // Selecting a tool opens that tool window and queues the file
    fireEvent.click(screen.getByTestId('select-tool-png-to-pdf'));

    expect(mockPush).toHaveBeenCalledWith('/en/tools/png-to-pdf');
    const pending = peekPendingDroppedFiles();
    expect(pending?.targetToolSlug).toBe('png-to-pdf');
    expect(pending?.files).toEqual([pngFile]);
  });

  it('asks whether to save changes first when closing a modified document and supports Save & Close', async () => {
    const mockOutputBlob = new Blob(['%PDF-1.4 modified content'], { type: 'application/pdf' });
    vi.spyOn(studioProcessors, 'executeStudioOperation').mockResolvedValue(mockOutputBlob);

    const file = createDummyPdfFile('report.pdf');
    render(<PDFStudio locale="en" initialFile={file} />);

    // Modify document by applying Rotate tool
    const rotateBtn = screen.getAllByRole('button', { name: /Rotate/i })[0];
    fireEvent.click(rotateBtn);
    fireEvent.click(screen.getByRole('button', { name: /Apply Changes/i }));

    await waitFor(() => {
      expect(studioProcessors.executeStudioOperation).toHaveBeenCalled();
      expect(screen.getByTestId('unsaved-indicator-report.pdf')).toBeInTheDocument();
    });

    // Attempt to close the modified document tab
    const closeBtn = screen.getByLabelText('Close report.pdf');
    fireEvent.click(closeBtn);

    // Unsaved changes modal should appear asking if they want to save their changes first
    expect(screen.getByTestId('unsaved-changes-modal')).toBeInTheDocument();
    expect(screen.getByText(/Save Changes Before Closing\?/i)).toBeInTheDocument();
    expect(screen.getByText(/Document "report\.pdf" has unsaved changes/i)).toBeInTheDocument();

    // 1. Clicking Cancel keeps the document open
    fireEvent.click(screen.getByTestId('unsaved-modal-cancel'));
    expect(screen.queryByTestId('unsaved-changes-modal')).not.toBeInTheDocument();
    expect(screen.getByTitle('report.pdf')).toBeInTheDocument();

    // 2. Click close again and choose Save & Close
    fireEvent.click(closeBtn);
    expect(screen.getByTestId('unsaved-changes-modal')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('unsaved-modal-save'));

    await waitFor(() => {
      expect(tauriBridge.saveBlobFile).toHaveBeenCalledWith(
        mockOutputBlob,
        'report_crafted.pdf'
      );
      expect(screen.queryByTitle('report.pdf')).not.toBeInTheDocument();
    });
  });

  it('auto-backups modified files and allows recovering them from the Recover Auto-Backup list and reopening Recent Files', async () => {
    const mockOutputBlob = new Blob(['%PDF-1.4 backed-up edits'], { type: 'application/pdf' });
    vi.spyOn(studioProcessors, 'executeStudioOperation').mockResolvedValue(mockOutputBlob);

    const file = createDummyPdfFile('important-contract.pdf');
    render(<PDFStudio locale="en" initialFile={file} />);

    // Apply Rotate operation so the document becomes modified and auto-backed up
    const rotateBtn = screen.getAllByRole('button', { name: /Rotate/i })[0];
    fireEvent.click(rotateBtn);
    fireEvent.click(screen.getByRole('button', { name: /Apply Changes/i }));

    await waitFor(() => {
      expect(studioProcessors.executeStudioOperation).toHaveBeenCalled();
    });

    // Close without saving ("Don't Save") to return to the Studio welcome screen
    fireEvent.click(screen.getByLabelText('Close important-contract.pdf'));
    expect(screen.getByTestId('unsaved-changes-modal')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('unsaved-modal-discard'));

    // Welcome screen should now display both the Recover Auto-Backup Files list and Recent Files list
    await waitFor(() => {
      expect(screen.getByTestId('studio-auto-backup-list')).toBeInTheDocument();
      expect(screen.getByTestId('studio-recent-files-list')).toBeInTheDocument();
    });

    // Recover Auto-Backup list shows the modified file and edit count
    expect(screen.getByText(/\+1 edit\(s\)/i)).toBeInTheDocument();

    // Click Recover on the auto-backup entry
    const recoverBtn = screen.getByRole('button', { name: 'Recover' });
    fireEvent.click(recoverBtn);

    // Document should be restored into Studio with its unsaved changes and history intact
    await waitFor(() => {
      expect(screen.getByTitle('important-contract.pdf')).toBeInTheDocument();
      expect(screen.getByTestId('unsaved-indicator-important-contract.pdf')).toBeInTheDocument();
      expect(screen.getByText('+1 action(s)')).toBeInTheDocument();
    });

    // Also verify the Recent & Backups header popover opens and lists both sections
    fireEvent.click(screen.getByTestId('studio-recent-backups-btn'));
    expect(screen.getByTestId('studio-recent-backups-popover')).toBeInTheDocument();
    expect(screen.getByText(/Recent Files & Auto-Backups/i)).toBeInTheDocument();
  });

  it('closes the Tauri application window when clicking Don\'t Save on exit with modified files', async () => {
    let capturedCloseHandler: ((event: { preventDefault: () => void }) => Promise<void>) | null = null;
    vi.doMock('@tauri-apps/api/webviewWindow', () => ({
      getCurrentWebviewWindow: () => ({
        onCloseRequested: vi.fn(async (cb) => {
          capturedCloseHandler = cb;
          return () => {};
        }),
      }),
    }));
    vi.mocked(tauriBridge.isTauri).mockReturnValue(true);

    const mockOutputBlob = new Blob(['%PDF-1.4 modified content'], { type: 'application/pdf' });
    vi.spyOn(studioProcessors, 'executeStudioOperation').mockResolvedValue(mockOutputBlob);

    const file = createDummyPdfFile('exit-test.pdf');
    render(<PDFStudio locale="en" initialFile={file} />);

    await waitFor(() => {
      expect(capturedCloseHandler).not.toBeNull();
    });

    // Modify document
    const rotateBtn = screen.getAllByRole('button', { name: /Rotate/i })[0];
    fireEvent.click(rotateBtn);
    fireEvent.click(screen.getByRole('button', { name: /Apply Changes/i }));

    await waitFor(() => {
      expect(screen.getByTestId('unsaved-indicator-exit-test.pdf')).toBeInTheDocument();
    });

    // Simulate user clicking the Tauri window 'X' button
    const preventDefault = vi.fn();
    await capturedCloseHandler!({ preventDefault });
    expect(preventDefault).toHaveBeenCalled();

    // Unsaved changes modal should open
    await waitFor(() => {
      expect(screen.getByTestId('unsaved-changes-modal')).toBeInTheDocument();
    });

    // Click "Don't Save"
    fireEvent.click(screen.getByTestId('unsaved-modal-discard'));

    await waitFor(() => {
      expect(tauriBridge.closeAppWindow).toHaveBeenCalledTimes(1);
    });

    vi.mocked(tauriBridge.isTauri).mockReturnValue(false);
  });

  it('opens studio settings popover and toggles default tool for PDF files', async () => {
    render(<PDFStudio locale="en" />);

    // Click Settings button in studio header
    const settingsBtn = screen.getByTestId('studio-settings-btn');
    fireEvent.click(settingsBtn);

    expect(screen.getByTestId('studio-settings-popover')).toBeInTheDocument();
    expect(screen.getByText('Studio Preferences')).toBeInTheDocument();

    const pdfToggle = screen.getByTestId('studio-setting-default-pdf-toggle') as HTMLInputElement;
    expect(pdfToggle.checked).toBe(false);

    // Toggle on
    fireEvent.click(pdfToggle);
    expect(pdfToggle.checked).toBe(true);
    expect(localStorage.getItem(DEFAULT_PDF_TOOL_STORAGE_KEY)).toBe('studio');

    // Toggle off
    fireEvent.click(pdfToggle);
    expect(pdfToggle.checked).toBe(false);
    expect(localStorage.getItem(DEFAULT_PDF_TOOL_STORAGE_KEY)).toBeNull();
  });

  it('toggles default startup view in studio settings popover', async () => {
    render(<PDFStudio locale="en" />);

    fireEvent.click(screen.getByTestId('studio-settings-btn'));

    const startupToggle = screen.getByTestId('studio-setting-default-startup-toggle') as HTMLInputElement;
    expect(startupToggle.checked).toBe(false);

    // Toggle on
    fireEvent.click(startupToggle);
    expect(startupToggle.checked).toBe(true);
    expect(localStorage.getItem(DEFAULT_STARTUP_VIEW_STORAGE_KEY)).toBe('studio');

    // Toggle off
    fireEvent.click(startupToggle);
    expect(startupToggle.checked).toBe(false);
    expect(localStorage.getItem(DEFAULT_STARTUP_VIEW_STORAGE_KEY)).toBeNull();
  });

  it('toggles default options from the Studio welcome screen', async () => {
    render(<PDFStudio locale="en" />);

    const welcomePdfToggle = screen.getByTestId('studio-welcome-default-pdf-toggle') as HTMLInputElement;
    const welcomeStartupToggle = screen.getByTestId('studio-welcome-default-startup-toggle') as HTMLInputElement;

    expect(welcomePdfToggle.checked).toBe(false);
    expect(welcomeStartupToggle.checked).toBe(false);

    fireEvent.click(welcomePdfToggle);
    expect(welcomePdfToggle.checked).toBe(true);
    expect(localStorage.getItem(DEFAULT_PDF_TOOL_STORAGE_KEY)).toBe('studio');

    fireEvent.click(welcomeStartupToggle);
    expect(welcomeStartupToggle.checked).toBe(true);
    expect(localStorage.getItem(DEFAULT_STARTUP_VIEW_STORAGE_KEY)).toBe('studio');
  });
});

