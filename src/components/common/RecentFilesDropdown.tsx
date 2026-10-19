/**
 * RecentFilesDropdown Component
 * Requirements: 10.4
 * 
 * Displays recent files history in a dropdown menu
 */

'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Clock, X, Trash2, FileText, ChevronDown, RotateCcw, ShieldAlert } from 'lucide-react';
import { useRecentFiles } from '@/lib/hooks/useRecentFiles';
import { formatFileSize, formatDate } from '@/lib/storage/recent-files';
import {
  type AutoBackupMetadata,
  getAutoBackupsMetadata,
  removeAutoBackup,
  clearAllAutoBackups,
  getRecentFileBlob,
  setPendingStudioRecoveryId,
} from '@/lib/storage/auto-backup';
import { setPendingDroppedFiles } from '@/lib/utils/file-tool-router';
import { Button } from '@/components/ui/Button';
import { type Locale } from '@/lib/i18n/config';

export interface RecentFilesDropdownProps {
  locale: Locale;
  translations: {
    title: string;
    empty: string;
    clearAll: string;
    processedWith: string;
  };
}

export const RecentFilesDropdown: React.FC<RecentFilesDropdownProps> = ({
  locale,
  translations,
}) => {
  const router = useRouter();
  const { recentFiles, removeFile, clearAll, isLoading } = useRecentFiles();
  const [autoBackups, setAutoBackups] = useState<AutoBackupMetadata[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLAnchorElement | null)[]>([]);

  const isZh = String(locale).toLowerCase().startsWith('zh');

  const refreshLists = useCallback(() => {
    setAutoBackups(getAutoBackupsMetadata());
  }, []);

  useEffect(() => {
    refreshLists();
  }, [refreshLists, isOpen]);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Close on escape key
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        setFocusedIndex(-1);
      }
    };

    if (isOpen) {
      document.addEventListener('keydown', handleEscape);
      return () => document.removeEventListener('keydown', handleEscape);
    }
  }, [isOpen]);

  // Focus item when focusedIndex changes
  useEffect(() => {
    if (focusedIndex >= 0 && itemRefs.current[focusedIndex]) {
      itemRefs.current[focusedIndex]?.focus();
    }
  }, [focusedIndex]);

  const handleButtonKeyDown = useCallback((event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      if (!isOpen) {
        setIsOpen(true);
      }
      if (recentFiles.length > 0) {
        setFocusedIndex(0);
      }
    }
  }, [isOpen, recentFiles.length]);

  const handleItemKeyDown = useCallback((event: React.KeyboardEvent, _index: number) => {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setFocusedIndex((prev) => (prev < recentFiles.length - 1 ? prev + 1 : 0));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setFocusedIndex((prev) => (prev > 0 ? prev - 1 : recentFiles.length - 1));
        break;
      case 'Home':
        event.preventDefault();
        setFocusedIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setFocusedIndex(recentFiles.length - 1);
        break;
      case 'Escape':
        event.preventDefault();
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
      case 'Tab':
        setIsOpen(false);
        setFocusedIndex(-1);
        break;
    }
  }, [recentFiles.length]);

  const handleRecoverBackup = useCallback(
    (backupId: string) => {
      setIsOpen(false);
      setFocusedIndex(-1);
      setPendingStudioRecoveryId(backupId);
      router.push(`/${locale}/studio`);
    },
    [locale, router]
  );

  const handleOpenRecentFile = useCallback(
    async (e: React.MouseEvent, file: { name: string; toolUsed: string }) => {
      const targetHref =
        file.toolUsed === 'studio' ? `/${locale}/studio` : `/${locale}/tools/${file.toolUsed}`;
      setIsOpen(false);
      setFocusedIndex(-1);

      try {
        const cachedBlob = await getRecentFileBlob(file.name);
        if (cachedBlob) {
          e.preventDefault();
          const restoredFile = new File([cachedBlob], file.name, {
            type: cachedBlob.type || 'application/pdf',
          });
          setPendingDroppedFiles(
            [restoredFile],
            file.toolUsed === 'studio' ? 'studio' : file.toolUsed
          );
          router.push(targetHref);
        }
      } catch {
        // Let standard Link navigation proceed
      }
    },
    [locale, router]
  );

  if (isLoading) {
    return null;
  }

  const totalBadgeCount = recentFiles.length + autoBackups.length;

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="ghost"
        size="sm"
        onClick={() => {
          setIsOpen(!isOpen);
          if (!isOpen && recentFiles.length > 0) {
            setFocusedIndex(0);
          } else {
            setFocusedIndex(-1);
          }
        }}
        onKeyDown={handleButtonKeyDown}
        aria-label={translations.title}
        aria-expanded={isOpen}
        aria-haspopup="true"
        className="flex items-center gap-1"
      >
        <Clock className="h-4 w-4" aria-hidden="true" />
        {totalBadgeCount > 0 && (
          <span
            className={`text-xs text-white rounded-full px-1.5 py-0.5 min-w-[18px] text-center ${
              autoBackups.length > 0 ? 'bg-amber-500' : 'bg-[hsl(var(--color-primary))]'
            }`}
          >
            {totalBadgeCount}
          </span>
        )}
        <ChevronDown className={`h-3 w-3 transition-transform ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
      </Button>

      {isOpen && (
        <div
          className="absolute right-0 top-full mt-2 w-80 max-h-96 overflow-auto rounded-[var(--radius-lg)] border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] shadow-lg z-50"
          role="menu"
          aria-label={translations.title}
        >
          {/* Auto-Backups Recovery Section */}
          {autoBackups.length > 0 && (
            <div className="border-b border-[hsl(var(--color-border))] bg-amber-500/5">
              <div className="flex items-center justify-between px-4 py-2.5 border-b border-[hsl(var(--color-border)/0.6)]">
                <h3 className="font-semibold text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1.5">
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{isZh ? '恢复自动备份文件' : 'Recover Auto-Backups'}</span>
                </h3>
                <button
                  onClick={async () => {
                    await clearAllAutoBackups();
                    refreshLists();
                  }}
                  className="text-[11px] text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-destructive))] transition-colors flex items-center gap-1"
                  aria-label={isZh ? '清空自动备份' : 'Clear auto-backups'}
                >
                  <Trash2 className="h-3 w-3" aria-hidden="true" />
                  <span>{isZh ? '清空' : 'Clear'}</span>
                </button>
              </div>
              <ul className="py-1" role="list">
                {autoBackups.map((backup) => (
                  <li
                    key={backup.id}
                    className="group px-4 py-2 hover:bg-[hsl(var(--color-muted))] transition-colors flex items-start justify-between gap-2"
                  >
                    <button
                      type="button"
                      onClick={() => handleRecoverBackup(backup.id)}
                      className="flex-1 min-w-0 text-left focus:outline-none"
                    >
                      <div className="flex items-center gap-1.5">
                        <RotateCcw className="h-3.5 w-3.5 text-amber-500 flex-shrink-0" aria-hidden="true" />
                        <span className="text-xs font-semibold text-[hsl(var(--color-foreground))] truncate">
                          {backup.name}
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[hsl(var(--color-muted-foreground))]">
                        <span>{formatFileSize(backup.modifiedSize)}</span>
                        <span>•</span>
                        <span>{formatDate(backup.updatedAt)}</span>
                        <span>•</span>
                        <span className="text-amber-600 dark:text-amber-400 font-medium">
                          +{backup.actionCount} {isZh ? '修改' : 'edit(s)'}
                        </span>
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={async (e) => {
                        e.stopPropagation();
                        await removeAutoBackup(backup.id);
                        refreshLists();
                      }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-destructive))] transition-all"
                      aria-label={`Remove backup ${backup.name}`}
                    >
                      <X className="h-3.5 w-3.5" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-[hsl(var(--color-border))]">
            <h3 className="font-medium text-sm text-[hsl(var(--color-foreground))]">
              {translations.title}
            </h3>
            {recentFiles.length > 0 && (
              <button
                onClick={() => {
                  clearAll();
                  setIsOpen(false);
                }}
                className="text-xs text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-destructive))] transition-colors flex items-center gap-1"
                aria-label={translations.clearAll}
              >
                <Trash2 className="h-3 w-3" aria-hidden="true" />
                {translations.clearAll}
              </button>
            )}
          </div>

          {/* Content */}
          {recentFiles.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-[hsl(var(--color-muted-foreground))]">
              <FileText className="h-8 w-8 mx-auto mb-2 opacity-50" aria-hidden="true" />
              {translations.empty}
            </div>
          ) : (
            <ul className="py-2" role="list">
              {recentFiles.map((file, index) => {
                const href =
                  file.toolUsed === 'studio'
                    ? `/${locale}/studio`
                    : `/${locale}/tools/${file.toolUsed}`;
                return (
                  <li
                    key={file.id}
                    className="group px-4 py-2 hover:bg-[hsl(var(--color-muted))] transition-colors"
                    role="menuitem"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <Link
                        ref={(el) => { itemRefs.current[index] = el; }}
                        href={href}
                        className="flex-1 min-w-0 focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-ring))] rounded-sm"
                        tabIndex={focusedIndex === index ? 0 : -1}
                        onClick={(e) => handleOpenRecentFile(e, file)}
                        onKeyDown={(e) => handleItemKeyDown(e, index)}
                      >
                        <div className="flex items-center gap-2">
                          <FileText className="h-4 w-4 text-[hsl(var(--color-primary))] flex-shrink-0" aria-hidden="true" />
                          <span className="text-sm font-medium text-[hsl(var(--color-foreground))] truncate">
                            {file.name}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-2 text-xs text-[hsl(var(--color-muted-foreground))]">
                          <span>{formatFileSize(file.size)}</span>
                          <span>•</span>
                          <span>{formatDate(file.processedAt)}</span>
                        </div>
                        <div className="mt-0.5 text-xs text-[hsl(var(--color-muted-foreground))]">
                          {translations.processedWith} {file.toolName || file.toolUsed}
                        </div>
                      </Link>
                      <button
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          removeFile(file.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 focus:opacity-100 p-1 text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-destructive))] focus:text-[hsl(var(--color-destructive))] transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-ring))] rounded-sm"
                        aria-label={`Remove ${file.name}`}
                        tabIndex={-1}
                      >
                        <X className="h-4 w-4" aria-hidden="true" />
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default RecentFilesDropdown;
