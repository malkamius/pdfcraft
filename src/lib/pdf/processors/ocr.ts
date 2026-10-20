/**
 * OCR PDF Processor
 * Requirements: 5.1
 * 
 * Performs Optical Character Recognition on PDF pages.
 * Uses Tesseract.js for client-side OCR processing.
 */

import type {
  ProcessInput,
  ProcessOutput,
  ProgressCallback,
} from '@/types/pdf';
import { PDFErrorCode } from '@/types/pdf';
import { BasePDFProcessor } from '../processor';
import { loadPdfjs, loadPdfLib } from '../loader';
import { withBasePath } from '@/lib/utils/path';

/**
 * Supported OCR languages
 */
export type OCRLanguage = 'eng' | 'chi_sim' | 'chi_tra' | 'jpn' | 'kor' | 'spa' | 'fra' | 'deu' | 'por' | 'ara' | 'hun' | 'ori';

/**
 * OCR options
 */
export interface OCROptions {
  /** OCR language(s) */
  languages: OCRLanguage[];
  /** Legacy single language string (e.g. 'eng' or 'chi_sim+eng') */
  language?: string;
  /** Scale factor for rendering (higher = better OCR but slower) */
  scale: number;
  /** Specific pages to OCR (empty = all pages) */
  pages: number[];
  /** Output format */
  outputFormat: 'text' | 'searchable-pdf' | 'markdown' | 'json' | 'docx';
  /** Preserve original layout in text output */
  preserveLayout: boolean;
  /** Auto enhance contrast and sharpness before OCR (recommended for scans & receipts) */
  enhanceContrast?: boolean;
}

/**
 * Default options
 */
const DEFAULT_OPTIONS: OCROptions = {
  languages: ['eng'],
  scale: 2,
  pages: [],
  outputFormat: 'text',
  preserveLayout: false,
  enhanceContrast: true,
};

/**
 * Language display names
 */
export const OCR_LANGUAGE_NAMES: Record<OCRLanguage, string> = {
  eng: 'English',
  chi_sim: 'Chinese (Simplified)',
  chi_tra: 'Chinese (Traditional)',
  jpn: 'Japanese',
  kor: 'Korean',
  spa: 'Spanish',
  fra: 'French',
  deu: 'German',
  por: 'Portuguese',
  ara: 'Arabic',
  hun: 'Hungarian',
  ori: 'Odia (Oriya)',
};

// Tesseract worker type
type TesseractWorker = {
  setParameters: (parameters: Record<string, string>) => Promise<unknown>;
  loadLanguage?: (lang: string) => Promise<void>;
  initialize?: (lang: string) => Promise<void>;
  recognize: (image: string | HTMLCanvasElement, options?: any, output?: any) => Promise<{ data: { text: string; words?: any[]; blocks?: any[] } }>;
  terminate: () => Promise<void>;
};

/**
 * Read File or Blob as Uint8Array reliably across browsers, Node, and jsdom
 */
export async function readFileAsUint8Array(file: File | Blob): Promise<Uint8Array> {
  if (typeof (file as any).arrayBuffer === 'function') {
    try {
      const buf = await (file as any).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      // fallback to FileReader if arrayBuffer() throws
    }
  }

  if (typeof FileReader !== 'undefined') {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (reader.result instanceof ArrayBuffer) {
          resolve(new Uint8Array(reader.result));
        } else {
          resolve(new Uint8Array(0));
        }
      };
      reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
      reader.readAsArrayBuffer(file);
    });
  }

  throw new Error('Cannot read file bytes');
}

/**
 * Font metric fractions for Helvetica / standard sans fonts
 * Inspired by storytold-pdfcraft's text_layer model
 */
export const BOX_EM = 0.93;
export const DESCENT = 0.21;
export const CAP_HEIGHT = 0.718;
export const X_HEIGHT = 0.523;

/**
 * Word coordinate data in PDF space
 */
export interface OCRWordData {
  text: string;
  confidence: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  x: number;
  y: number;
  width: number;
  height: number;
  fontSize: number;
}

/**
 * Line coordinate and baseline data in PDF space
 */
export interface OCRLineData {
  text: string;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  baseline?: { x0: number; y0: number; x1: number; y1: number };
  pdfBaselineY: number;
  words: OCRWordData[];
}

/**
 * Determine the ink extent of a word (vertical reach of its glyphs above and below baseline).
 * A word bounding box is tight around visible ink.
 * - Words with ascenders or uppercase reach cap-height.
 * - Words with only x-height reach x-height.
 * - Words with descenders reach below the baseline.
 */
export function getInkExtent(text: string): { top: number; bottom: number } {
  // If text contains non-ASCII (e.g. CJK, Arabic, etc.), use standard full em-box
  if (/[^\u0020-\u007E]/.test(text)) {
    return { top: 0.88, bottom: -0.12 };
  }

  // If text has no alphanumeric characters (e.g. punctuation, symbols)
  if (!/[a-zA-Z0-9]/.test(text)) {
    return { top: BOX_EM - DESCENT, bottom: -DESCENT };
  }

  // Tall characters: uppercase, numbers, ascenders (b, d, f, h, i, j, k, l, t) and tall punctuation
  const tall = /[A-Z0-9bdfhijklt!?/\\()[\]{}|'"#$%&@]/.test(text);
  // Characters with descenders below baseline (g, j, p, q, y, etc.)
  const low = /[gjpqy()[\]{}|_]/.test(text);

  return {
    top: tall ? CAP_HEIGHT : X_HEIGHT,
    bottom: low ? -DESCENT : 0.0,
  };
}

/**
 * Extract lines and words from Tesseract recognition output, computing unified line baselines.
 */
export function extractLinesAndWords(
  resultData: any,
  scale: number,
  pageHeight: number
): { lines: OCRLineData[]; words: OCRWordData[] } {
  const lines: OCRLineData[] = [];
  const allWords: OCRWordData[] = [];

  const rawBlocks = resultData?.blocks || [];
  let foundLinesInBlocks = false;

  for (const block of rawBlocks) {
    const paragraphs = block.paragraphs || [];
    for (const para of paragraphs) {
      const rawLines = para.lines || [];
      for (const line of rawLines) {
        if (!line.words || line.words.length === 0) continue;
        foundLinesInBlocks = true;

        const lineBbox = line.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
        const lineBottomPdf = pageHeight - (lineBbox.y1 / scale);
        const lineHeightPdf = (lineBbox.y1 - lineBbox.y0) / scale;

        // Determine line baseline in PDF space
        let pdfBaselineY: number;
        if (line.baseline && typeof line.baseline.y0 === 'number' && typeof line.baseline.y1 === 'number') {
          const baselineCanvasY = (line.baseline.y0 + line.baseline.y1) / 2;
          pdfBaselineY = pageHeight - (baselineCanvasY / scale);
        } else {
          // Standard typography baseline sits ~20% above the bottom of the line box
          pdfBaselineY = lineBottomPdf + Math.max(1, lineHeightPdf * 0.18);
        }

        const lineWords: OCRWordData[] = [];
        for (const w of line.words) {
          const text = (w.text || '').trim();
          if (!text) continue;

          const bbox = w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
          const pdfX = bbox.x0 / scale;
          const pdfY = pageHeight - (bbox.y1 / scale);
          const pdfWidth = (bbox.x1 - bbox.x0) / scale;
          const pdfHeight = (bbox.y1 - bbox.y0) / scale;
          const wordObj: OCRWordData = {
            text,
            confidence: typeof w.confidence === 'number' ? Math.round(w.confidence) : 90,
            bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 },
            x: pdfX,
            y: pdfY,
            width: pdfWidth,
            height: pdfHeight,
            fontSize: Math.max(5, pdfHeight * 0.85),
          };
          lineWords.push(wordObj);
          allWords.push(wordObj);
        }

        if (lineWords.length > 0) {
          lines.push({
            text: line.text || lineWords.map(w => w.text).join(' '),
            bbox: lineBbox,
            baseline: line.baseline,
            pdfBaselineY,
            words: lineWords,
          });
        }
      }
    }
  }

  // Fallback: if blocks didn't yield lines, check resultData.words
  if (!foundLinesInBlocks) {
    const rawWords = resultData?.words || [];
    const wordsConverted: OCRWordData[] = rawWords.map((w: any) => {
      const bbox = w.bbox || { x0: 0, y0: 0, x1: 0, y1: 0 };
      const pdfX = bbox.x0 / scale;
      const pdfY = pageHeight - (bbox.y1 / scale);
      const pdfWidth = (bbox.x1 - bbox.x0) / scale;
      const pdfHeight = (bbox.y1 - bbox.y0) / scale;
      return {
        text: (w.text || '').trim(),
        confidence: typeof w.confidence === 'number' ? Math.round(w.confidence) : 90,
        bbox: { x0: bbox.x0, y0: bbox.y0, x1: bbox.x1, y1: bbox.y1 },
        x: pdfX,
        y: pdfY,
        width: pdfWidth,
        height: pdfHeight,
        fontSize: Math.max(5, pdfHeight * 0.85),
      };
    }).filter((w: OCRWordData) => w.text.length > 0);

    // Group words into lines by vertical proximity
    const sortedWords = [...wordsConverted].sort((a, b) => {
      const yDiff = Math.abs(a.y - b.y);
      if (yDiff <= Math.max(4, Math.min(a.height, b.height) * 0.5)) {
        return a.x - b.x;
      }
      return b.y - a.y; // Higher PDF Y means higher on page
    });

    const groupedLines: OCRWordData[][] = [];
    for (const w of sortedWords) {
      let placed = false;
      for (const line of groupedLines) {
        const ref = line[0];
        const heightThreshold = Math.max(4, Math.min(ref.height, w.height) * 0.6);
        if (Math.abs(ref.y - w.y) <= heightThreshold) {
          line.push(w);
          placed = true;
          break;
        }
      }
      if (!placed) {
        groupedLines.push([w]);
      }
    }

    for (const lineWords of groupedLines) {
      lineWords.sort((a, b) => a.x - b.x);
      // Compute consensus baseline for line
      const avgY = lineWords.reduce((sum, w) => sum + w.y, 0) / lineWords.length;
      lines.push({
        text: lineWords.map(w => w.text).join(' '),
        bbox: {
          x0: Math.min(...lineWords.map(w => w.x * scale)),
          y0: Math.min(...lineWords.map(w => (pageHeight - w.y - w.height) * scale)),
          x1: Math.max(...lineWords.map(w => (w.x + w.width) * scale)),
          y1: Math.max(...lineWords.map(w => (pageHeight - w.y) * scale)),
        },
        pdfBaselineY: avgY,
        words: lineWords,
      });
      allWords.push(...lineWords);
    }
  }

  return { lines, words: allWords };
}

/**
 * Preprocess canvas pixels to enhance contrast and sharpness
 * Helps significantly with scanned receipts, faint text, and dark background noise
 */
export function preprocessCanvas(canvas: HTMLCanvasElement): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  try {
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    const len = data.length;

    // 1. Calculate min and max luminance for linear contrast stretching
    let minLum = 255;
    let maxLum = 0;
    for (let i = 0; i < len; i += 4) {
      const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
      if (lum < minLum) minLum = lum;
      if (lum > maxLum) maxLum = lum;
    }

    const lumRange = maxLum - minLum;
    if (lumRange > 15 && lumRange < 240) {
      const scale = 255 / lumRange;
      for (let i = 0; i < len; i += 4) {
        const lum = (data[i] * 299 + data[i + 1] * 587 + data[i + 2] * 114) / 1000;
        // Stretch contrast
        const stretched = Math.min(255, Math.max(0, (lum - minLum) * scale));
        // Tone curve: darken text (< 135) and brighten paper background (> 180)
        let finalVal = stretched;
        if (stretched < 135) {
          finalVal = Math.max(0, stretched * 0.82);
        } else if (stretched > 180) {
          finalVal = Math.min(255, 180 + (stretched - 180) * 1.5);
        }
        data[i] = finalVal;
        data[i + 1] = finalVal;
        data[i + 2] = finalVal;
      }
      ctx.putImageData(imgData, 0, 0);
    }
  } catch {
    // Graceful fallback if getImageData is blocked or mocked
  }
}

/**
 * Generate clean Markdown text from OCR results preserving paragraphs and page breaks
 */
export function generateMarkdownOutput(
  pagesData: Array<{ pageNum: number; text: string; words: any[] }>,
  docTitle: string
): string {
  const sections: string[] = [
    `# ${docTitle.replace(/\.[^.]+$/, '')}`,
    `> *Extracted via PDFCraft OCR on ${new Date().toLocaleDateString()}*`,
    '',
  ];

  for (const p of pagesData) {
    sections.push(`## Page ${p.pageNum}\n`);
    const cleaned = (p.text || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter((line, idx, arr) => line.length > 0 || (idx > 0 && arr[idx - 1].length > 0))
      .join('\n\n');
    sections.push(cleaned || '*(No text detected on this page)*');
    sections.push('\n---\n');
  }

  return sections.join('\n');
}

/**
 * Generate structured JSON output with word bounding boxes and confidence metrics
 */
export function generateJsonOutput(
  pagesData: Array<{ pageNum: number; text: string; words: any[] }>,
  meta: {
    fileName: string;
    languages: string[];
    totalWords: number;
    totalChars: number;
    avgConfidence: number;
  }
): string {
  return JSON.stringify(
    {
      metadata: {
        ...meta,
        generatedAt: new Date().toISOString(),
        engine: 'PDFCraft OCR Engine v2',
      },
      pages: pagesData.map(p => ({
        pageNumber: p.pageNum,
        text: p.text,
        wordCount: p.words.length,
        words: p.words.map(w => ({
          text: w.text,
          confidence: w.confidence,
          bbox: {
            x: Math.round(w.x * 100) / 100,
            y: Math.round(w.y * 100) / 100,
            width: Math.round(w.width * 100) / 100,
            height: Math.round(w.height * 100) / 100,
          },
        })),
      })),
    },
    null,
    2
  );
}

/**
 * Detect file type by sniffing binary magic bytes first, then MIME/extension
 */
/**
 * Generate a standard Microsoft Word (.docx) file from OCR results using OpenXML packaged with JSZip
 */
export async function generateDocxOutput(
  pagesData: Array<{ pageNum: number; text: string; words: any[] }>,
  docTitle: string
): Promise<Blob> {
  const { default: JSZip } = await import('jszip');
  const zip = new JSZip();

  const escapeXml = (str: string) =>
    str.replace(/[<>&'"]/g, (c) => {
      switch (c) {
        case '<': return '&lt;';
        case '>': return '&gt;';
        case '&': return '&amp;';
        case '\'': return '&apos;';
        case '"': return '&quot;';
        default: return c;
      }
    });

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`
  );

  let bodyXml = '';
  const cleanTitle = docTitle.replace(/\.[^.]+$/, '');
  bodyXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="36"/></w:rPr><w:t>${escapeXml(cleanTitle)}</w:t></w:r></w:p>`;
  bodyXml += `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:i/><w:color w:val="666666"/><w:sz w:val="20"/></w:rPr><w:t>Extracted via PDFCraft OCR on ${escapeXml(new Date().toLocaleDateString())}</w:t></w:r></w:p>`;
  bodyXml += `<w:p/>`;

  for (let i = 0; i < pagesData.length; i++) {
    const p = pagesData[i];
    bodyXml += `<w:p><w:r><w:rPr><w:b/><w:color w:val="2B579A"/><w:sz w:val="26"/></w:rPr><w:t>Page ${p.pageNum}</w:t></w:r></w:p>`;

    const lines = (p.text || '').split(/\r?\n/);
    let currentParagraph = '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) {
        if (currentParagraph) {
          bodyXml += `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(currentParagraph)}</w:t></w:r></w:p>`;
          currentParagraph = '';
        }
      } else {
        currentParagraph = currentParagraph ? `${currentParagraph} ${line}` : line;
      }
    }

    if (currentParagraph) {
      bodyXml += `<w:p><w:r><w:rPr><w:sz w:val="22"/></w:rPr><w:t xml:space="preserve">${escapeXml(currentParagraph)}</w:t></w:r></w:p>`;
    }

    if (i < pagesData.length - 1) {
      bodyXml += `<w:p><w:r><w:br w:type="page"/></w:r></w:p>`;
    }
  }

  bodyXml += `<w:sectPr/>`;

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${bodyXml}
  </w:body>
</w:document>`;

  zip.file('word/document.xml', documentXml);

  return zip.generateAsync({
    type: 'blob',
    mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  });
}

export async function detectFileType(file: File | Blob): Promise<'pdf' | 'image' | 'unknown'> {
  try {
    let bytes: Uint8Array = new Uint8Array(0);

    // Try reading header bytes
    if (file.slice) {
      try {
        const slice = file.slice(0, 32);
        bytes = await readFileAsUint8Array(slice);
      } catch {
        // ignore
      }
    }

    if (bytes.length === 0) {
      try {
        const fullBytes = await readFileAsUint8Array(file);
        bytes = fullBytes.slice(0, 32);
      } catch {
        // ignore
      }
    }

    // PDF magic bytes: %PDF- (0x25 0x50 0x44 0x46)
    if (bytes.length >= 4 && bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 && bytes[3] === 0x46) {
      return 'pdf';
    }

    // PNG: 0x89 0x50 0x4E 0x47
    if (bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47) {
      return 'image';
    }

    // JPEG: 0xFF 0xD8 0xFF
    if (bytes.length >= 3 && bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF) {
      return 'image';
    }

    // WebP: RIFF....WEBP
    if (
      bytes.length >= 12 &&
      bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
      bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
    ) {
      return 'image';
    }

    // BMP: BM (0x42 0x4D)
    if (bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4D) {
      return 'image';
    }
  } catch {
    // ignore
  }

  // Fallbacks
  const fileName = (file as File).name || '';
  const fileType = file.type || '';
  if (fileType.includes('pdf') || fileName.toLowerCase().endsWith('.pdf')) {
    return 'pdf';
  }
  if (fileType.startsWith('image/') || /\.(png|jpe?g|webp|bmp|tiff?)$/i.test(fileName)) {
    return 'image';
  }

  return 'unknown';
}

/**
 * OCR PDF Processor
 * Performs OCR on PDF pages or images using Tesseract.js.
 */
export class OCRProcessor extends BasePDFProcessor {
  private tesseractWorker: TesseractWorker | null = null;
  private activePageInfo: {
    pageNum: number;
    pageIndex: number;
    totalToProcess: number;
    docTotalPages: number;
  } | null = null;

  protected override reset(): void {
    super.reset();
    this.activePageInfo = null;
  }

  override cancel(): void {
    super.cancel();
    void this.terminateTesseract();
  }

  /**
   * Process PDF or Image with OCR
   */
  async process(
    input: ProcessInput,
    onProgress?: ProgressCallback
  ): Promise<ProcessOutput> {
    this.reset();
    this.onProgress = onProgress;

    const { files, options } = input;
    const rawOptions = (options || {}) as any;

    // Resolve languages (support both languages array and language string)
    let languages: OCRLanguage[] = DEFAULT_OPTIONS.languages;
    if (Array.isArray(rawOptions.languages) && rawOptions.languages.length > 0) {
      languages = rawOptions.languages;
    } else if (typeof rawOptions.language === 'string' && rawOptions.language.trim()) {
      languages = rawOptions.language.split('+').map((s: string) => s.trim()) as OCRLanguage[];
    }

    const ocrOptions: OCROptions = {
      ...DEFAULT_OPTIONS,
      ...rawOptions,
      languages,
    };

    // Validate input files
    if (!files || files.length === 0) {
      return this.createErrorOutput(
        PDFErrorCode.INVALID_OPTIONS,
        'No PDF or image file found. Please provide a file to perform OCR on.',
        'Received 0 files.'
      );
    }

    if (files.length !== 1) {
      return this.createErrorOutput(
        PDFErrorCode.INVALID_OPTIONS,
        'Please provide exactly one PDF or image file.',
        `Received ${files.length} file(s).`
      );
    }

    const file = files[0];
    const detectedType = await detectFileType(file);

    if (detectedType === 'unknown') {
      return this.createErrorOutput(
        PDFErrorCode.FILE_TYPE_INVALID,
        'Invalid file type. Please upload a PDF or image file (PNG, JPG, WebP).',
        `Received: ${file.type || 'unknown'}, filename: ${file.name}`
      );
    }

    try {
      this.updateProgress(5, 'Loading libraries...');

      const pdfjs = await loadPdfjs();

      if (this.checkCancelled()) {
        return this.createErrorOutput(
          PDFErrorCode.PROCESSING_CANCELLED,
          'Processing was cancelled.'
        );
      }

      this.updateProgress(10, 'Initializing OCR engine...');

      // Initialize Tesseract
      await this.initializeTesseract(ocrOptions.languages);

      this.updateProgress(20, 'Loading document...');

      // If the input file is an image, convert it to a single-page PDF first
      let pdfBytesToLoad: Uint8Array;
      let effectiveFileForSearchable: File = file;

      if (detectedType === 'image') {
        const converted = await this.convertImageToPDF(file);
        pdfBytesToLoad = converted.pdfBytes;
        effectiveFileForSearchable = new File(
          [converted.pdfBytes as unknown as BlobPart],
          file.name.replace(/\.[^.]+$/, '') + '.pdf',
          { type: 'application/pdf' }
        );
      } else {
        pdfBytesToLoad = await readFileAsUint8Array(file);
      }

      // Load the PDF document into PDF.js
      const pdf = await pdfjs.getDocument({ data: pdfBytesToLoad }).promise;
      const totalPages = pdf.numPages;

      // Determine which pages to OCR
      const pagesToOCR = ocrOptions.pages.length > 0
        ? ocrOptions.pages.filter(p => p >= 1 && p <= totalPages)
        : Array.from({ length: totalPages }, (_, i) => i + 1);

      if (pagesToOCR.length === 0) {
        await this.terminateTesseract();
        return this.createErrorOutput(
          PDFErrorCode.INVALID_PAGE_RANGE,
          'No valid pages to OCR.',
          `PDF has ${totalPages} pages.`
        );
      }

      this.updateProgress(25, `Processing ${pagesToOCR.length} page(s)...`);

      const textResults: string[] = [];
      const ocrPagesData: Array<{ pageNum: number; words: OCRWordData[]; lines: OCRLineData[] }> = [];
      const progressPerPage = 70 / pagesToOCR.length;

      for (let i = 0; i < pagesToOCR.length; i++) {
        if (this.checkCancelled()) {
          await this.terminateTesseract();
          return this.createErrorOutput(
            PDFErrorCode.PROCESSING_CANCELLED,
            'Processing was cancelled.'
          );
        }

        const pageNum = pagesToOCR[i];
        this.activePageInfo = {
          pageNum,
          pageIndex: i,
          totalToProcess: pagesToOCR.length,
          docTotalPages: totalPages,
        };

        const pageBaseProgress = 25 + (i * progressPerPage);
        const pageLabel = pagesToOCR.length === totalPages
          ? `Page ${pageNum}/${totalPages}`
          : `Page ${pageNum}/${totalPages} (${i + 1}/${pagesToOCR.length})`;

        this.updateProgress(
          Math.round(pageBaseProgress),
          `${pageLabel} (0%)...`
        );

        try {
          const pageData = await this.ocrPage(pdf, pageNum, ocrOptions);
          textResults.push(`--- Page ${pageNum} ---\n${pageData.text}`);
          ocrPagesData.push({ pageNum, words: pageData.words, lines: pageData.lines });
          this.updateProgress(
            Math.min(94, Math.round(pageBaseProgress + progressPerPage)),
            `${pageLabel} (100%)`
          );
        } catch (error) {
          if (this.checkCancelled()) {
            await this.terminateTesseract();
            return this.createErrorOutput(
              PDFErrorCode.PROCESSING_CANCELLED,
              'Processing was cancelled.'
            );
          }
          throw new Error(`OCR failed on page ${pageNum}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }

      this.activePageInfo = null;

      await this.terminateTesseract();

      this.updateProgress(95, 'Generating output...');

      // Calculate summary metrics
      let totalWords = 0;
      let totalChars = 0;
      let confidenceSum = 0;
      let confidenceCount = 0;

      for (const p of ocrPagesData) {
        for (const w of p.words) {
          totalWords++;
          totalChars += (w.text || '').length;
          if (typeof w.confidence === 'number') {
            confidenceSum += w.confidence;
            confidenceCount++;
          }
        }
      }
      const avgConfidence = confidenceCount > 0 ? Math.round(confidenceSum / confidenceCount) : 92;

      // Generate output based on format
      let blob: Blob;
      let outputFilename: string;
      const baseName = file.name.replace(/\.(pdf|png|jpe?g|webp|bmp|tiff?)$/i, '');
      const fullText = textResults.join('\n\n');
      const pagesWithText = ocrPagesData.map((p, idx) => ({
        pageNum: p.pageNum,
        text: textResults[idx] ? textResults[idx].replace(/^--- Page \d+ ---\n/, '') : '',
        words: p.words,
      }));
      const mdText = generateMarkdownOutput(pagesWithText, file.name);
      const jsonText = generateJsonOutput(pagesWithText, {
        fileName: file.name,
        languages: ocrOptions.languages,
        totalWords,
        totalChars,
        avgConfidence,
      });

      if (ocrOptions.outputFormat === 'text') {
        blob = new Blob([fullText], { type: 'text/plain;charset=utf-8' });
        outputFilename = `${baseName}_ocr.txt`;
      } else if (ocrOptions.outputFormat === 'markdown') {
        blob = new Blob([mdText], { type: 'text/markdown;charset=utf-8' });
        outputFilename = `${baseName}_ocr.md`;
      } else if (ocrOptions.outputFormat === 'json') {
        blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
        outputFilename = `${baseName}_ocr.json`;
      } else if (ocrOptions.outputFormat === 'docx') {
        blob = await generateDocxOutput(pagesWithText, file.name);
        outputFilename = `${baseName}_ocr.docx`;
      } else {
        // For searchable PDF, create a PDF with the extracted text layer
        blob = await this.createSearchablePDF(effectiveFileForSearchable, ocrPagesData, ocrOptions);
        outputFilename = `${baseName}_searchable.pdf`;
      }

      this.updateProgress(100, 'Complete!');

      return this.createSuccessOutput(blob, outputFilename, {
        pageCount: pagesToOCR.length,
        languages: ocrOptions.languages,
        outputFormat: ocrOptions.outputFormat,
        totalWords,
        totalChars,
        avgConfidence,
        rawText: fullText,
        markdownText: mdText,
        jsonText,
        pagesData: pagesWithText,
      });

    } catch (error) {
      await this.terminateTesseract();
      if (this.checkCancelled()) {
        return this.createErrorOutput(
          PDFErrorCode.PROCESSING_CANCELLED,
          'Processing was cancelled.'
        );
      }
      return this.createErrorOutput(
        PDFErrorCode.PROCESSING_FAILED,
        'Failed to perform OCR on file.',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  /**
   * Convert an image File to a single-page PDFDocument and return its bytes
   */
  private async convertImageToPDF(file: File): Promise<{ pdfBytes: Uint8Array; pdfDoc: any }> {
    const pdfLib = await loadPdfLib();
    const pdfDoc = await pdfLib.PDFDocument.create();
    const bytes = await readFileAsUint8Array(file);

    let image;
    const isPng = bytes.length >= 4 && bytes[0] === 0x89 && bytes[1] === 0x50;
    if (isPng || file.type.includes('png') || file.name.toLowerCase().endsWith('.png')) {
      image = await pdfDoc.embedPng(bytes);
    } else {
      try {
        image = await pdfDoc.embedJpg(bytes);
      } catch {
        // In browser context, render onto canvas for formats like webp/bmp
        if (typeof document !== 'undefined') {
          const img = new Image();
          const blobUrl = URL.createObjectURL(file);
          await new Promise((resolve, reject) => {
            img.onload = resolve;
            img.onerror = reject;
            img.src = blobUrl;
          });
          URL.revokeObjectURL(blobUrl);

          const canvas = document.createElement('canvas');
          canvas.width = img.naturalWidth || img.width;
          canvas.height = img.naturalHeight || img.height;
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.drawImage(img, 0, 0);
            const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
            if (pngBlob) {
              const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
              image = await pdfDoc.embedPng(pngBytes);
            } else {
              throw new Error('Could not convert image to canvas blob');
            }
          } else {
            throw new Error('Canvas 2D context unavailable');
          }
        } else {
          throw new Error(`Unsupported image format: ${file.name}`);
        }
      }
    }

    const page = pdfDoc.addPage([image.width, image.height]);
    page.drawImage(image, {
      x: 0,
      y: 0,
      width: image.width,
      height: image.height,
    });

    const pdfBytes = await pdfDoc.save();
    return { pdfBytes: new Uint8Array(pdfBytes), pdfDoc };
  }

  /**
   * Initialize Tesseract worker with progress reporting
   */
  private async initializeTesseract(languages: OCRLanguage[]): Promise<void> {
    const Tesseract = await import('tesseract.js');
    const langString = languages && languages.length > 0 ? languages.join('+') : 'eng';

    const isEngOnly = !languages || languages.length === 0 || (languages.length === 1 && languages[0] === 'eng');

    const logger = (m: any) => {
      if (!m || !m.status) return;

      const progressVal = typeof m.progress === 'number' ? Math.max(0, Math.min(1, m.progress)) : 0;
      const percent = Math.round(progressVal * 100);

      if (m.status === 'recognizing text' && this.activePageInfo) {
        const { pageNum, pageIndex, totalToProcess, docTotalPages } = this.activePageInfo;
        const progressPerPage = 70 / Math.max(1, totalToProcess);
        const pageBaseProgress = 25 + (pageIndex * progressPerPage);
        const currentProgress = Math.min(94, Math.round(pageBaseProgress + (progressVal * progressPerPage)));
        const pageLabel = totalToProcess === docTotalPages
          ? `Page ${pageNum}/${docTotalPages}`
          : `Page ${pageNum}/${docTotalPages} (${pageIndex + 1}/${totalToProcess})`;

        this.updateProgress(
          currentProgress,
          `${pageLabel} (${percent}%)`
        );
      } else if (m.status === 'loading language traineddata') {
        this.updateProgress(
          10 + Math.round(progressVal * 10),
          `Downloading language data${percent > 0 ? ` (${percent}%)` : ''}...`
        );
      } else if (m.status === 'loading tesseract core' || m.status === 'loaded tesseract core' || m.status === 'initializing api') {
        this.updateProgress(
          10 + Math.round(progressVal * 10),
          `OCR: ${m.status}${percent > 0 ? ` (${percent}%)` : ''}`
        );
      } else if (!this.activePageInfo) {
        this.updateProgress(
          15 + Math.round(progressVal * 10),
          `OCR: ${m.status}${percent > 0 ? ` (${percent}%)` : ''}`
        );
      }
    };

    const workerOptions: any = {
      logger,
      workerPath: withBasePath('/workers/tesseract/worker.min.js'),
      corePath: withBasePath('/workers/tesseract/tesseract-core-lstm.wasm.js'),
      workerBlobURL: false,
    };

    if (isEngOnly) {
      workerOptions.langPath = withBasePath('/tessdata');
    }

    try {
      this.tesseractWorker = (await Tesseract.createWorker(langString, 1, workerOptions)) as unknown as TesseractWorker;
    } catch (localErr) {
      console.warn('Local Tesseract worker initialization failed, attempting fallback:', localErr);
      this.tesseractWorker = (await Tesseract.createWorker(langString, 1, {
        logger,
      })) as unknown as TesseractWorker;
    }
    // Pages can contain headings, paragraphs, columns, and captions. Tesseract's
    // single-block default can split large headings into incorrect text lines.
    await this.tesseractWorker.setParameters({ tessedit_pageseg_mode: Tesseract.PSM.AUTO });
  }

  /**
   * Terminate Tesseract worker
   */
  private async terminateTesseract(): Promise<void> {
    this.activePageInfo = null;
    if (this.tesseractWorker) {
      await this.tesseractWorker.terminate();
      this.tesseractWorker = null;
    }
  }

  /**
   * Perform OCR on a single page and return text with word coordinates
   */
  private async ocrPage(
    pdf: any,
    pageNum: number,
    options: OCROptions
  ): Promise<{ text: string; words: OCRWordData[]; lines: OCRLineData[] }> {
    if (!this.tesseractWorker) {
      throw new Error('Tesseract worker not initialized');
    }

    const page = await pdf.getPage(pageNum);
    const viewport = page.getViewport({ scale: options.scale });

    // Create canvas
    const canvas = document.createElement('canvas');
    canvas.width = viewport.width;
    canvas.height = viewport.height;

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Failed to get canvas context');
    }

    // Fill with white background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Render PDF page to canvas
    await page.render({
      canvas,
      canvasContext: ctx,
      viewport: viewport,
    }).promise;

    // Apply smart image contrast enhancement if enabled (reduces noise on receipts/scans)
    if (options.enhanceContrast !== false) {
      preprocessCanvas(canvas);
    }

    // Perform OCR with explicit blocks/hocr requests to ensure word coordinates are extracted
    await this.tesseractWorker.setParameters({
      user_defined_dpi: String(Math.round(72 * options.scale)),
    });
    const result = await (this.tesseractWorker as any).recognize(
      canvas,
      {},
      { text: true, blocks: true, hocr: true }
    );
    
    // Coordinate conversion from canvas space to PDF coordinate space (y-flipped)
    const pdfViewport = page.getViewport({ scale: 1.0 });
    const pageHeight = pdfViewport.height;

    const { lines, words } = extractLinesAndWords(result.data, options.scale, pageHeight);

    return {
      text: result.data.text || '',
      words,
      lines,
    };
  }

  /**
   * Create a searchable PDF with OCR transparent text layer and Unicode font embedding
   */
  private async createSearchablePDF(
    originalFile: File,
    ocrPagesData: Array<{ pageNum: number; words: OCRWordData[]; lines?: OCRLineData[] }>,
    options: OCROptions
  ): Promise<Blob> {
    const pdfLib = await loadPdfLib();

    // Load original PDF
    const fileBytes = await readFileAsUint8Array(originalFile);
    const pdfDoc = await pdfLib.PDFDocument.load(fileBytes);

    // Register fontkit and load Unicode font for non-Latin characters (Chinese, Japanese, Korean, etc.)
    let unicodeFont: any = null;
    const needsUnicodeFont = ocrPagesData.some(page =>
      page.words.some(word => /[^\u0020-\u007E]/.test(word.text || ''))
    );
    if (needsUnicodeFont) try {
      const fontkit = await import('@pdf-lib/fontkit');
      pdfDoc.registerFontkit(fontkit.default || fontkit);

      let fontBuffer: ArrayBuffer | null = null;
      if (typeof window !== 'undefined') {
        try {
          const res = await fetch(withBasePath('/fonts/NotoSansSC-Regular.ttf'));
          if (res.ok) {
            fontBuffer = await res.arrayBuffer();
          }
        } catch {
          // ignore
        }
      } else if (typeof process !== 'undefined' && process.versions && process.versions.node) {
        try {
          const fs = await import('fs');
          const path = await import('path');
          const localPath = path.resolve(process.cwd(), 'public/fonts/NotoSansSC-Regular.ttf');
          if (fs.existsSync(localPath)) {
            const fileBuf = fs.readFileSync(localPath);
            fontBuffer = fileBuf.buffer.slice(fileBuf.byteOffset, fileBuf.byteOffset + fileBuf.byteLength);
          }
        } catch {
          // ignore
        }
      }

      if (fontBuffer) {
        // Embed only glyphs used in the OCR layer, rather than the entire CJK font.
        unicodeFont = await pdfDoc.embedFont(fontBuffer, { subset: true });
      }
    } catch (fontErr) {
      console.warn('[OCR] Unicode font embedding not available, falling back to standard font', fontErr);
    }

    const standardFont = await pdfDoc.embedFont(pdfLib.StandardFonts.Helvetica);

    for (const pageData of ocrPagesData) {
      const pageIdx = pageData.pageNum - 1;
      if (pageIdx >= pdfDoc.getPageCount()) continue;

      const page = pdfDoc.getPage(pageIdx);
      const lines = (pageData.lines && pageData.lines.length > 0)
        ? pageData.lines
        : [{
            text: pageData.words.map(w => w.text).join(' '),
            bbox: { x0: 0, y0: 0, x1: 0, y1: 0 },
            pdfBaselineY: pageData.words[0]?.y ?? 0,
            words: pageData.words,
          }];

      const pageAny = page as any;
      const canUsePushOperators =
        Boolean(pdfLib.PDFOperator) &&
        Boolean(pdfLib.PDFOperatorNames) &&
        typeof pageAny.pushOperators === 'function' &&
        typeof pageAny.setOrEmbedFont === 'function';

      if (canUsePushOperators) {
        const { newFontKey: standardFontKey } = pageAny.setOrEmbedFont(standardFont);
        let unicodeFontKey: any = null;
        if (unicodeFont) {
          try {
            const res = pageAny.setOrEmbedFont(unicodeFont);
            unicodeFontKey = res.newFontKey;
          } catch {
            // ignore
          }
        }

        const ops: any[] = [];
        // Marked content /OCR and graphics state isolation
        if (pdfLib.PDFOperatorNames.BeginMarkedContent && pdfLib.PDFName) {
          ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.BeginMarkedContent, [pdfLib.PDFName.of('OCR')]));
        }
        ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.PushGraphicsState));
        ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.BeginText));
        // 3 Tr: PDF ISO 32000 standard text rendering mode 3 (Neither fill nor stroke = Invisible text)
        ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.SetTextRenderingMode, [pdfLib.asPDFNumber(3)]));

        for (const line of lines) {
          for (const w of line.words) {
            const text = (w.text || '').trim();
            if (!text) continue;

            const isNonAscii = /[^\u0020-\u007E]/.test(text);
            const fontToUse = (isNonAscii && unicodeFont) ? unicodeFont : standardFont;
            const fontKeyToUse = (isNonAscii && unicodeFontKey) ? unicodeFontKey : standardFontKey;

            let encodedText: any = null;
            try {
              encodedText = fontToUse.encodeText(text);
            } catch {
              if (fontToUse !== standardFont) {
                try {
                  encodedText = standardFont.encodeText(text.replace(/[^\u0020-\u007E]/g, '?'));
                } catch {
                  // ignore
                }
              } else {
                try {
                  encodedText = standardFont.encodeText(text.replace(/[^\u0020-\u007E]/g, '?'));
                } catch {
                  // ignore
                }
              }
            }
            if (!encodedText) continue;

            // Set font at size 1 for matrix-based em scaling
            ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.SetFontAndSize, [fontKeyToUse, pdfLib.asPDFNumber(1)]));

            const boxWidth = Math.max(0.5, w.width);
            const boxHeight = Math.max(0.5, w.height);

            let naturalWidth = 0;
            try {
              naturalWidth = fontToUse.widthOfTextAtSize(text, 1.0);
            } catch {
              naturalWidth = text.length * 0.5;
            }

            const { top, bottom } = getInkExtent(text);
            const span = Math.max(0.1, top - bottom);
            const em = Math.max(2, Math.min(120, boxHeight / span));
            let ax = naturalWidth > 0 ? (boxWidth / naturalWidth) : em;
            // Prevent extreme distortion for single punctuation/dots
            ax = Math.max(em * 0.25, Math.min(em * 3.5, ax));

            const ox = Math.max(0, w.x);
            // All words on the same line share the line's unified baseline so drag selection doesn't jitter
            const oy = Math.max(
              0,
              typeof line.pdfBaselineY === 'number' && !isNaN(line.pdfBaselineY)
                ? line.pdfBaselineY
                : (w.y - em * bottom)
            );

            ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.SetTextMatrix, [
              pdfLib.asPDFNumber(ax),
              pdfLib.asPDFNumber(0),
              pdfLib.asPDFNumber(0),
              pdfLib.asPDFNumber(em),
              pdfLib.asPDFNumber(ox),
              pdfLib.asPDFNumber(oy),
            ]));
            ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.ShowText, [encodedText]));
          }
        }

        ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.EndText));
        ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.PopGraphicsState));
        if (pdfLib.PDFOperatorNames.EndMarkedContent) {
          ops.push(pdfLib.PDFOperator.of(pdfLib.PDFOperatorNames.EndMarkedContent));
        }

        page.pushOperators(...ops);
      } else {
        // Fallback for mocked or minimal test environments: drawText with unified line baseline and width-matching size
        for (const line of lines) {
          for (const w of line.words) {
            const text = (w.text || '').trim();
            if (!text) continue;

            const isNonAscii = /[^\u0020-\u007E]/.test(text);
            const fontToUse = (isNonAscii && unicodeFont) ? unicodeFont : standardFont;

            let size = w.fontSize;
            try {
              const natWidth = fontToUse.widthOfTextAtSize(text, 1.0);
              if (natWidth > 0 && w.width > 0) {
                size = Math.max(4, Math.min(72, w.width / natWidth));
              }
            } catch {
              // fallback to w.fontSize
            }

            const oy = Math.max(
              0,
              typeof line.pdfBaselineY === 'number' && !isNaN(line.pdfBaselineY)
                ? line.pdfBaselineY
                : w.y
            );

            try {
              page.drawText(text, {
                x: Math.max(0, w.x),
                y: oy,
                size,
                font: fontToUse,
                color: pdfLib.rgb(0, 0, 0),
                opacity: 0.0,
              });
            } catch {
              if (fontToUse !== standardFont) {
                try {
                  const asciiOnly = text.replace(/[^\u0020-\u007E]/g, ' ');
                  if (asciiOnly.trim()) {
                    page.drawText(asciiOnly, {
                      x: Math.max(0, w.x),
                      y: oy,
                      size,
                      font: standardFont,
                      color: pdfLib.rgb(0, 0, 0),
                      opacity: 0.0,
                    });
                  }
                } catch {
                  // skip unencodable character safely
                }
              }
            }
          }
        }
      }
    }

    // Add metadata to indicate OCR was performed
    pdfDoc.setTitle(`${originalFile.name} (OCR)`);
    pdfDoc.setSubject('OCR processed document with invisible text layer');
    pdfDoc.setKeywords(['OCR', 'searchable', ...(options.languages || [])]);

    const pdfBytes = await pdfDoc.save({ useObjectStreams: true });
    return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
  }
}

/**
 * Create a new instance of the OCR processor
 */
export function createOCRProcessor(): OCRProcessor {
  return new OCRProcessor();
}

/**
 * Perform OCR on PDF (convenience function)
 */
export async function ocrPDF(
  file: File,
  options?: Partial<OCROptions>,
  onProgress?: ProgressCallback
): Promise<ProcessOutput> {
  const processor = createOCRProcessor();
  return processor.process(
    {
      files: [file],
      options: options || {},
    },
    onProgress
  );
}
