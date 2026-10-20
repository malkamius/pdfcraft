'use client';

import React, { useMemo } from 'react';
import { marked } from 'marked';
import { sanitizeHtml } from '@/lib/utils/html-sanitizer';
import { openExternalUrl } from '@/lib/tauri-bridge';

export interface MarkdownViewerProps {
  /** Raw markdown content string */
  content?: string;
  /** Additional container CSS class names */
  className?: string;
  /** Optional custom handler when an external link is clicked */
  onLinkClick?: (url: string) => void;
}

/**
 * MarkdownViewer Component
 *
 * Renders GitHub Flavored Markdown (GFM) content safely with HTML sanitization
 * and external link interception for desktop Tauri environments.
 */
export const MarkdownViewer: React.FC<MarkdownViewerProps> = ({
  content = '',
  className = '',
  onLinkClick,
}) => {
  const html = useMemo(() => {
    if (!content || typeof content !== 'string') return '';
    try {
      // Strip leading UTF-8 BOM if present
      const cleanContent = content.replace(/^\uFEFF/, '');
      const rawHtml = marked.parse(cleanContent, {
        gfm: true,
        breaks: true,
        async: false,
      }) as string;

      return sanitizeHtml(rawHtml);
    } catch (err) {
      console.error('[MarkdownViewer] Failed to parse markdown:', err);
      return '';
    }
  }, [content]);

  // Intercept links inside rendered markdown so they open in the user's default browser
  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (e.target as HTMLElement).closest('a');
    if (!anchor) return;

    const href = anchor.getAttribute('href');
    if (!href) return;

    e.preventDefault();

    if (onLinkClick) {
      onLinkClick(href);
    } else {
      openExternalUrl(href);
    }
  };

  if (!html) {
    return (
      <div className={`text-xs text-[hsl(var(--color-muted-foreground))] italic ${className}`}>
        {content ? content : 'No changelog available.'}
      </div>
    );
  }

  return (
    <div
      className={`markdown-viewer select-text text-left leading-relaxed ${className}`}
      onClick={handleClick}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};

export default MarkdownViewer;
