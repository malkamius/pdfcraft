import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isStudioDefaultPdfTool,
  setStudioDefaultPdfTool,
  isStudioDefaultStartup,
  setStudioDefaultStartup,
  subscribeDefaultToolSettings,
  DEFAULT_PDF_TOOL_STORAGE_KEY,
  DEFAULT_STARTUP_VIEW_STORAGE_KEY,
} from '@/lib/storage/default-tool';

describe('default-tool storage helper', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  it('reports false when nothing is stored', () => {
    expect(isStudioDefaultPdfTool()).toBe(false);
    expect(isStudioDefaultStartup()).toBe(false);
  });

  it('sets and removes PDF Studio as default tool', () => {
    setStudioDefaultPdfTool(true);
    expect(localStorage.getItem(DEFAULT_PDF_TOOL_STORAGE_KEY)).toBe('studio');
    expect(isStudioDefaultPdfTool()).toBe(true);

    setStudioDefaultPdfTool(false);
    expect(localStorage.getItem(DEFAULT_PDF_TOOL_STORAGE_KEY)).toBeNull();
    expect(isStudioDefaultPdfTool()).toBe(false);
  });

  it('sets and removes PDF Studio as default startup view', () => {
    setStudioDefaultStartup(true);
    expect(localStorage.getItem(DEFAULT_STARTUP_VIEW_STORAGE_KEY)).toBe('studio');
    expect(isStudioDefaultStartup()).toBe(true);

    setStudioDefaultStartup(false);
    expect(localStorage.getItem(DEFAULT_STARTUP_VIEW_STORAGE_KEY)).toBeNull();
    expect(isStudioDefaultStartup()).toBe(false);
  });

  it('notifies subscribers when settings change', () => {
    const callback = vi.fn();
    const unsubscribe = subscribeDefaultToolSettings(callback);

    setStudioDefaultPdfTool(true);
    expect(callback).toHaveBeenCalledTimes(1);

    setStudioDefaultStartup(true);
    expect(callback).toHaveBeenCalledTimes(2);

    unsubscribe();

    setStudioDefaultPdfTool(false);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
