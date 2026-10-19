'use client';

import React, { useState, useMemo, useEffect } from 'react';
import { X, Search, Sparkles, ArrowRight, File as FileIcon } from 'lucide-react';
import type { Tool } from '@/types/tool';
import { getToolIcon } from '@/config/icons';
import { getToolContent, type Locale } from '@/config/tool-content';
import { filterFilesForTool, getFileExtensions, isPdfFile } from '@/lib/utils/file-tool-router';

export interface ToolSelectionModalProps {
  isOpen: boolean;
  onClose: () => void;
  files: File[];
  tools: Tool[];
  locale?: string;
  onSelectTool: (tool: Tool, validFiles: File[]) => void;
  onOpenInStudio?: (pdfFiles: File[]) => void;
  showStudioOption?: boolean;
}

function formatToolFallbackName(id: string): string {
  return id
    .split('-')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

export const ToolSelectionModal: React.FC<ToolSelectionModalProps> = ({
  isOpen,
  onClose,
  files,
  tools,
  locale = 'en',
  onSelectTool,
  onOpenInStudio,
  showStudioOption = false,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const validLocale = ((locale as string) || 'en') as Locale;
  const isZh = validLocale.toLowerCase().startsWith('zh');

  useEffect(() => {
    if (isOpen) {
      setSearchQuery('');
    }
  }, [isOpen, files]);

  // Close on Escape key
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const detectedExtensions = useMemo(() => {
    const exts = new Set<string>();
    files.forEach((f) => {
      const fileExts = getFileExtensions(f);
      if (fileExts.length > 0) {
        exts.add(fileExts[0].toUpperCase());
      }
    });
    return Array.from(exts);
  }, [files]);

  const pdfFiles = useMemo(() => files.filter((f) => isPdfFile(f)), [files]);

  const enrichedTools = useMemo(() => {
    return tools.map((tool) => {
      const content = getToolContent(validLocale, tool.id);
      const title = content?.title || formatToolFallbackName(tool.id);
      const description =
        content?.metaDescription ||
        tool.features
          .slice(0, 3)
          .map((f) => f.replace(/-/g, ' '))
          .join(' • ');
      return {
        tool,
        title,
        description,
      };
    });
  }, [tools, validLocale]);

  const filteredTools = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return enrichedTools;
    return enrichedTools.filter(
      ({ tool, title, description }) =>
        title.toLowerCase().includes(q) ||
        description.toLowerCase().includes(q) ||
        tool.id.toLowerCase().includes(q)
    );
  }, [enrichedTools, searchQuery]);

  if (!isOpen || files.length === 0) return null;

  return (
    <div
      data-testid="tool-selection-modal"
      role="dialog"
      aria-modal="true"
      aria-label={isZh ? '选择工具' : 'Select a Tool'}
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs animate-in fade-in duration-150"
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      <div className="relative w-full max-w-2xl max-h-[85vh] flex flex-col rounded-3xl bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 p-6 pb-4 border-b border-[hsl(var(--color-border)/0.7)]">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[hsl(var(--color-primary)/0.12)] text-[hsl(var(--color-primary))]">
                <Sparkles className="w-3 h-3" />
                {detectedExtensions.join(', ') || 'FILE'}
              </span>
              <span className="text-xs text-[hsl(var(--color-muted-foreground))]">
                {isZh
                  ? `${ tools.length } 个可用工具支持此格式`
                  : `${tools.length} compatible tools available`}
              </span>
            </div>
            <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))]">
              {isZh
                ? '选择要打开的工具窗口'
                : 'Choose a Tool to Open Your File'}
            </h2>
            {/* Dropped File Pills */}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {files.slice(0, 4).map((f, idx) => (
                <span
                  key={`${f.name}-${idx}`}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[hsl(var(--color-muted)/0.6)] border border-[hsl(var(--color-border)/0.6)] text-xs font-medium text-[hsl(var(--color-foreground))] max-w-[220px]"
                >
                  <FileIcon className="w-3 h-3 text-[hsl(var(--color-primary))] shrink-0" />
                  <span className="truncate">{f.name}</span>
                </span>
              ))}
              {files.length > 4 && (
                <span className="text-xs font-medium text-[hsl(var(--color-muted-foreground))] px-2 py-0.5">
                  +{files.length - 4} {isZh ? '更多' : 'more'}
                </span>
              )}
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label={isZh ? '关闭' : 'Close'}
            className="p-2 rounded-xl text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-muted))] transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search Input when there are more than 4 tools */}
        {tools.length > 4 && (
          <div className="px-6 pt-3 pb-1">
            <div className="relative">
              <Search className="w-4 h-4 text-[hsl(var(--color-muted-foreground))] absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={
                  isZh ? '搜索兼容的工具...' : 'Search compatible tools...'
                }
                className="w-full pl-10 pr-4 py-2 text-xs rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-foreground))] placeholder:text-[hsl(var(--color-muted-foreground))] focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-primary)/0.25)] focus:border-[hsl(var(--color-primary))]"
              />
            </div>
          </div>
        )}

        {/* Tool List */}
        <div className="flex-1 overflow-y-auto p-6 pt-4 space-y-2.5">
          {/* Optional Open in PDF Studio card for PDF files */}
          {showStudioOption && onOpenInStudio && pdfFiles.length > 0 && !searchQuery && (
            <button
              type="button"
              data-testid="select-tool-studio"
              onClick={() => onOpenInStudio(pdfFiles)}
              className="w-full p-4 rounded-2xl border-2 border-[hsl(var(--color-primary)/0.4)] bg-gradient-to-r from-[hsl(var(--color-primary)/0.1)] to-[hsl(var(--color-accent)/0.08)] hover:border-[hsl(var(--color-primary))] text-left transition-all flex items-center justify-between gap-4 group"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="w-11 h-11 rounded-xl bg-[hsl(var(--color-primary))] text-white flex items-center justify-center shrink-0 shadow-md">
                  <Sparkles className="w-5 h-5" />
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[hsl(var(--color-foreground))]">
                      {isZh ? '在 PDF Studio 工作台中打开' : 'Open in PDF Studio'}
                    </span>
                    <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-[hsl(var(--color-primary))] text-white">
                      {isZh ? '推荐工作台' : 'Workspace'}
                    </span>
                  </div>
                  <p className="text-xs text-[hsl(var(--color-muted-foreground))] truncate mt-0.5">
                    {isZh
                      ? '在单一视图中就地浏览、旋转、加水印、压缩、签名与管理页面'
                      : 'View, rotate, watermark, compress, sign, and organize in a single workspace'}
                  </p>
                </div>
              </div>
              <ArrowRight className="w-4 h-4 text-[hsl(var(--color-primary))] group-hover:translate-x-1 transition-transform shrink-0" />
            </button>
          )}

          {filteredTools.length === 0 ? (
            <div className="py-10 text-center text-xs text-[hsl(var(--color-muted-foreground))]">
              {isZh ? '未找到匹配的工具' : 'No matching tools found'}
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredTools.map(({ tool, title, description }, index) => {
                const IconComponent = getToolIcon(tool.icon);
                const isRecommended = index === 0 && !searchQuery;

                return (
                  <button
                    key={tool.id}
                    type="button"
                    data-testid={`select-tool-${tool.id}`}
                    onClick={() => {
                      const validFiles = filterFilesForTool(files, tool);
                      onSelectTool(tool, validFiles);
                    }}
                    className={`p-3.5 rounded-2xl border text-left transition-all flex items-start gap-3 group hover:shadow-md ${
                      isRecommended
                        ? 'border-[hsl(var(--color-primary)/0.6)] bg-[hsl(var(--color-primary)/0.05)] hover:border-[hsl(var(--color-primary))]'
                        : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-background)/0.6)] hover:border-[hsl(var(--color-primary)/0.5)] hover:bg-[hsl(var(--color-muted)/0.4)]'
                    }`}
                  >
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[hsl(var(--color-primary)/0.15)] to-[hsl(var(--color-accent)/0.1)] text-[hsl(var(--color-primary))] flex items-center justify-center shrink-0 group-hover:scale-105 transition-transform">
                      <IconComponent className="w-5 h-5" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-bold text-[hsl(var(--color-foreground))] group-hover:text-[hsl(var(--color-primary))] transition-colors truncate">
                          {title}
                        </span>
                        {isRecommended && (
                          <span className="px-1.5 py-0.5 text-[10px] font-bold rounded-md bg-[hsl(var(--color-primary)/0.15)] text-[hsl(var(--color-primary))] shrink-0">
                            {isZh ? '推荐' : 'Best Match'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-[hsl(var(--color-muted-foreground))] line-clamp-2 mt-0.5 leading-relaxed">
                        {description}
                      </p>
                    </div>
                    <ArrowRight className="w-4 h-4 text-[hsl(var(--color-muted-foreground))] group-hover:text-[hsl(var(--color-primary))] group-hover:translate-x-0.5 transition-all shrink-0 mt-1" />
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
