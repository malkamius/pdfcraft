/**
 * Storage helpers for user default tool preferences:
 * 1. Opening PDF files with PDF Studio by default (bypassing ToolSelectionModal)
 * 2. Launching PDF Studio as the default view on application startup
 */

export const DEFAULT_PDF_TOOL_STORAGE_KEY = 'pdfcraft_default_pdf_tool';
export const DEFAULT_STARTUP_VIEW_STORAGE_KEY = 'pdfcraft_default_startup_view';

/**
 * Returns whether PDF Studio is configured as the default tool to open PDF files with.
 */
export function isStudioDefaultPdfTool(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(DEFAULT_PDF_TOOL_STORAGE_KEY) === 'studio';
  } catch {
    return false;
  }
}

/**
 * Set or unset PDF Studio as the default tool to open PDF files with.
 */
export function setStudioDefaultPdfTool(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      localStorage.setItem(DEFAULT_PDF_TOOL_STORAGE_KEY, 'studio');
    } else {
      localStorage.removeItem(DEFAULT_PDF_TOOL_STORAGE_KEY);
    }
    window.dispatchEvent(
      new CustomEvent('pdfcraft_default_tool_changed', { detail: { isStudio: enabled } })
    );
  } catch {}
}

/**
 * Returns whether PDF Studio should open by default when the application starts up.
 */
export function isStudioDefaultStartup(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return localStorage.getItem(DEFAULT_STARTUP_VIEW_STORAGE_KEY) === 'studio';
  } catch {
    return false;
  }
}

/**
 * Set or unset PDF Studio as the default startup view when the application opens.
 */
export function setStudioDefaultStartup(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) {
      localStorage.setItem(DEFAULT_STARTUP_VIEW_STORAGE_KEY, 'studio');
    } else {
      localStorage.removeItem(DEFAULT_STARTUP_VIEW_STORAGE_KEY);
    }
    window.dispatchEvent(
      new CustomEvent('pdfcraft_default_startup_changed', { detail: { isStudio: enabled } })
    );
  } catch {}
}

/**
 * Subscribes to changes to default tool preferences across tabs and local events.
 */
export function subscribeDefaultToolSettings(callback: () => void): () => void {
  if (typeof window === 'undefined') return () => {};
  const handler = () => {
    try {
      callback();
    } catch (err) {
      console.error('Error in default tool setting listener:', err);
    }
  };

  window.addEventListener('pdfcraft_default_tool_changed', handler);
  window.addEventListener('pdfcraft_default_startup_changed', handler);
  window.addEventListener('storage', handler);

  return () => {
    window.removeEventListener('pdfcraft_default_tool_changed', handler);
    window.removeEventListener('pdfcraft_default_startup_changed', handler);
    window.removeEventListener('storage', handler);
  };
}
