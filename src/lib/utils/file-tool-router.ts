import { getAllTools } from '@/config/tools';
import type { Tool } from '@/types/tool';

/**
 * Extension aliases that should be treated equivalently when matching tools
 */
const EXTENSION_ALIASES: Record<string, string[]> = {
  '.jpg': ['.jpg', '.jpeg'],
  '.jpeg': ['.jpeg', '.jpg'],
  '.tif': ['.tif', '.tiff'],
  '.tiff': ['.tiff', '.tif'],
  '.heic': ['.heic', '.heif'],
  '.heif': ['.heif', '.heic'],
  '.md': ['.md', '.markdown'],
  '.markdown': ['.markdown', '.md'],
  '.djvu': ['.djvu', '.djv'],
  '.djv': ['.djv', '.djvu'],
};

/**
 * Additional formats supported by specific tool components beyond the base config
 */
const EXTRA_TOOL_FORMATS: Record<string, string[]> = {
  'word-to-pdf': ['.odt'],
  'excel-to-pdf': ['.ods', '.csv'],
  'pptx-to-pdf': ['.odp'],
  'image-to-pdf': ['.heif', '.tif'],
  'merge-pdf': ['.tif', '.markdown'],
};

/**
 * Map MIME types to standard file extensions
 */
export const MIME_TO_EXTENSIONS: Record<string, string[]> = {
  'application/pdf': ['.pdf'],
  'image/jpeg': ['.jpg', '.jpeg'],
  'image/jpg': ['.jpg', '.jpeg'],
  'image/png': ['.png'],
  'image/webp': ['.webp'],
  'image/bmp': ['.bmp'],
  'image/x-ms-bmp': ['.bmp'],
  'image/tiff': ['.tiff', '.tif'],
  'image/svg+xml': ['.svg'],
  'image/heic': ['.heic', '.heif'],
  'image/heif': ['.heif', '.heic'],
  'image/vnd.adobe.photoshop': ['.psd', '.psb'],
  'application/x-photoshop': ['.psd', '.psb'],
  'text/plain': ['.txt'],
  'application/json': ['.json'],
  'text/markdown': ['.md', '.markdown'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['.docx'],
  'application/msword': ['.doc'],
  'application/vnd.oasis.opendocument.text': ['.odt'],
  'application/rtf': ['.rtf'],
  'text/rtf': ['.rtf'],
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'],
  'application/vnd.ms-excel': ['.xls'],
  'application/vnd.oasis.opendocument.spreadsheet': ['.ods'],
  'text/csv': ['.csv'],
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': ['.pptx'],
  'application/vnd.ms-powerpoint': ['.ppt'],
  'application/vnd.oasis.opendocument.presentation': ['.odp'],
  'application/vnd.ms-xpsdocument': ['.xps'],
  'application/oxps': ['.xps'],
  'application/epub+zip': ['.epub'],
  'application/x-mobipocket-ebook': ['.mobi', '.azw', '.azw3'],
  'image/vnd.djvu': ['.djvu', '.djv'],
  'image/x-djvu': ['.djvu', '.djv'],
  'application/x-fictionbook+xml': ['.fb2'],
  'message/rfc822': ['.eml'],
  'application/vnd.ms-outlook': ['.msg'],
  'application/x-cbz': ['.cbz'],
  'application/zip': ['.zip', '.cbz'],
  'application/x-zip-compressed': ['.zip', '.cbz'],
};

/**
 * Map file extensions to standard MIME types
 */
export const EXTENSION_TO_MIME: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.tiff': 'image/tiff',
  '.tif': 'image/tiff',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.psd': 'image/vnd.adobe.photoshop',
  '.psb': 'image/vnd.adobe.photoshop',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.doc': 'application/msword',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.rtf': 'application/rtf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls': 'application/vnd.ms-excel',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.csv': 'text/csv',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.odp': 'application/vnd.oasis.opendocument.presentation',
  '.xps': 'application/vnd.ms-xpsdocument',
  '.epub': 'application/epub+zip',
  '.mobi': 'application/x-mobipocket-ebook',
  '.azw': 'application/x-mobipocket-ebook',
  '.azw3': 'application/x-mobipocket-ebook',
  '.djvu': 'image/vnd.djvu',
  '.djv': 'image/vnd.djvu',
  '.fb2': 'application/x-fictionbook+xml',
  '.eml': 'message/rfc822',
  '.msg': 'application/vnd.ms-outlook',
  '.cbz': 'application/x-cbz',
  '.zip': 'application/zip',
};

/**
 * Infer MIME type from filename
 */
export function getMimeTypeForFilename(filename: string): string {
  const lower = filename.toLowerCase();
  if (lower.endsWith('.fb2.zip')) {
    return 'application/x-fictionbook+xml';
  }
  const dotIdx = lower.lastIndexOf('.');
  if (dotIdx !== -1) {
    const ext = lower.slice(dotIdx);
    if (EXTENSION_TO_MIME[ext]) {
      return EXTENSION_TO_MIME[ext];
    }
  }
  return 'application/octet-stream';
}

/**
 * Get normalized candidate extensions (including aliases) for a File
 */
export function getFileExtensions(file: { name: string; type?: string }): string[] {
  const extensions = new Set<string>();
  const lowerName = (file.name || '').toLowerCase().trim();

  if (lowerName.endsWith('.fb2.zip')) {
    extensions.add('.fb2.zip');
    extensions.add('.fb2');
  } else {
    const dotIdx = lowerName.lastIndexOf('.');
    if (dotIdx !== -1 && dotIdx < lowerName.length - 1) {
      const rawExt = lowerName.slice(dotIdx);
      extensions.add(rawExt);
      const aliases = EXTENSION_ALIASES[rawExt];
      if (aliases) {
        aliases.forEach((a) => extensions.add(a));
      }
    }
  }

  if (file.type) {
    const mimeLower = file.type.toLowerCase();
    const mapped = MIME_TO_EXTENSIONS[mimeLower];
    if (mapped) {
      mapped.forEach((ext) => extensions.add(ext));
    }
  }

  return Array.from(extensions);
}

/**
 * Check if a given file is a PDF
 */
export function isPdfFile(file: { name: string; type?: string }): boolean {
  return getFileExtensions(file).includes('.pdf');
}

/**
 * Get all accepted extensions for a tool (including component-level extra formats)
 */
export function getToolAcceptedExtensions(tool: Tool): string[] {
  const base = tool.acceptedFormats.map((f) => f.toLowerCase());
  const extra = EXTRA_TOOL_FORMATS[tool.id] || [];
  return Array.from(new Set([...base, ...extra]));
}

/**
 * Check whether a tool supports a specific file
 */
export function doesToolSupportFile(tool: Tool, file: { name: string; type?: string }): boolean {
  const fileExts = getFileExtensions(file);
  if (fileExts.length === 0) return false;

  const toolExts = getToolAcceptedExtensions(tool);
  return fileExts.some((ext) => toolExts.includes(ext));
}

/**
 * Compute relevance score for sorting compatible tools for a given set of dropped files
 */
function scoreToolRelevance(tool: Tool, files: Array<{ name: string; type?: string }>): number {
  const toolExts = getToolAcceptedExtensions(tool);
  const allArePdf = files.length > 0 && files.every((f) => isPdfFile(f));

  if (allArePdf) {
    // For PDF files, prioritize popular PDF tools
    const popularOrder = [
      'edit-pdf',
      'merge-pdf',
      'split-pdf',
      'compress-pdf',
      'organize-pdf',
      'ocr-pdf',
      'sign-pdf',
      'pdf-to-docx',
      'pdf-to-jpg',
    ];
    const popIdx = popularOrder.indexOf(tool.id);
    if (popIdx !== -1) {
      return 1000 - popIdx * 10;
    }
    return 100;
  }

  let score = 0;

  // 1. Format-specific "X-to-pdf" converters (e.g. png-to-pdf for .png, word-to-pdf for .docx)
  if (tool.category === 'convert-to-pdf') {
    if (toolExts.length <= 3) {
      score += 500;
    } else {
      // General converter like image-to-pdf
      score += 400;
    }
  } else if (tool.id !== 'merge-pdf') {
    // Specialized tools that accept images/files (e.g. ocr-pdf, signature-ink-optimizer, passport-id-composer, photo-tiling-prepress)
    score += 300;
  } else {
    // merge-pdf is a broad multi-format tool; boost it if multiple files are dropped, otherwise keep it after dedicated tools
    score += files.length > 1 ? 350 : 200;
  }

  // Prefer tools that can accept the number of dropped files without truncating
  if (files.length > 1 && tool.maxFiles >= files.length) {
    score += 25;
  }

  return score;
}

/**
 * Find all compatible tools for a list of dropped files, sorted by relevance
 */
export function getCompatibleToolsForFiles(files: File[] | FileList): Tool[] {
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return [];

  const allTools = getAllTools();

  // First try tools that support ALL dropped files
  let matching = allTools.filter((tool) =>
    fileArray.every((file) => doesToolSupportFile(tool, file))
  );

  // If no single tool supports every dropped file (e.g., mixed incompatible types),
  // fall back to tools that support at least one of the dropped files
  if (matching.length === 0) {
    matching = allTools.filter((tool) =>
      fileArray.some((file) => doesToolSupportFile(tool, file))
    );
  }

  return matching.sort((a, b) => scoreToolRelevance(b, fileArray) - scoreToolRelevance(a, fileArray));
}

/**
 * Filter a list of files to those supported by the given tool
 */
export function filterFilesForTool(files: File[] | FileList, tool: Tool): File[] {
  const fileArray = Array.from(files);
  const supported = fileArray.filter((f) => doesToolSupportFile(tool, f));
  return supported.length > 0 ? supported : fileArray;
}

// ============================================================================
// In-Memory Pending Dropped Files Store (for cross-route handoff to tools/studio)
// ============================================================================

export interface PendingDroppedFilesPayload {
  files: File[];
  targetToolSlug?: string;
  timestamp: number;
}

type PendingFilesListener = (payload: PendingDroppedFilesPayload) => void;
type GlobalFileDropRouterHandler = (files: File[]) => void;

let pendingPayload: PendingDroppedFilesPayload | null = null;
const pendingListeners = new Set<PendingFilesListener>();
let globalRouterHandler: GlobalFileDropRouterHandler | null = null;

/**
 * Store dropped files to be automatically loaded by the target tool (or PDF Studio)
 */
export function setPendingDroppedFiles(files: File[] | FileList, targetToolSlug?: string): void {
  const fileArray = Array.from(files);
  if (fileArray.length === 0) return;

  pendingPayload = {
    files: fileArray,
    targetToolSlug,
    timestamp: Date.now(),
  };

  pendingListeners.forEach((listener) => {
    try {
      if (pendingPayload) {
        listener(pendingPayload);
      }
    } catch (err) {
      console.error('Error in pendingDroppedFiles listener:', err);
    }
  });
}

/**
 * Peek at the currently pending dropped files without consuming them
 */
export function peekPendingDroppedFiles(): PendingDroppedFilesPayload | null {
  if (!pendingPayload) return null;
  // Expire after 60 seconds to avoid stale files loading much later
  if (Date.now() - pendingPayload.timestamp > 60_000) {
    pendingPayload = null;
    return null;
  }
  return pendingPayload;
}

/**
 * Consume and clear pending dropped files if they match the optional targetToolSlug
 */
export function consumePendingDroppedFiles(targetToolSlug?: string): File[] | null {
  const current = peekPendingDroppedFiles();
  if (!current) return null;

  if (
    targetToolSlug &&
    current.targetToolSlug &&
    current.targetToolSlug !== targetToolSlug
  ) {
    return null;
  }

  const files = current.files;
  pendingPayload = null;
  return files;
}

/**
 * Clear any pending dropped files
 */
export function clearPendingDroppedFiles(): void {
  pendingPayload = null;
}

/**
 * Subscribe to pending dropped file events (useful when the target tool is already mounted)
 */
export function subscribePendingDroppedFiles(listener: PendingFilesListener): () => void {
  pendingListeners.add(listener);
  return () => {
    pendingListeners.delete(listener);
  };
}

/**
 * Register a global file drop router handler (mounted at app layout / studio level)
 */
export function registerGlobalFileDropRouter(handler: GlobalFileDropRouterHandler): () => void {
  globalRouterHandler = handler;
  return () => {
    if (globalRouterHandler === handler) {
      globalRouterHandler = null;
    }
  };
}

/**
 * Route dropped files through the global file drop handler if one is active
 */
export function routeDroppedFiles(files: File[] | FileList): boolean {
  const fileArray = Array.from(files);
  if (fileArray.length === 0 || !globalRouterHandler) {
    return false;
  }
  globalRouterHandler(fileArray);
  return true;
}
