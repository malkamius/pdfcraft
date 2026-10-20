'use client';

import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Undo2,
  Redo2,
  RotateCcw,
  Download,
  Printer,
  X,
  Sparkles,
  LayoutGrid,
  CheckCircle2,
  AlertCircle,
  FileText,
  Upload,
  ChevronDown,
  History,
  FileType,
  Image as ImageIcon,
  Clock,
  Loader2,
  Plus,
  Files,
  Trash2,
  ShieldAlert,
  Save,
  FolderOpen,
  Settings,
} from 'lucide-react';
import JSZip from 'jszip';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { StudioLeftRail } from './StudioLeftRail';
import { StudioToolDrawer } from './StudioToolDrawer';
import {
  executeStudioOperation,
  executeStudioExport,
  type StudioToolId,
  STUDIO_TOOLS,
  findStudioToolConfig,
  addStudioRecentTool,
} from './studio-processors';
import {
  isStudioDefaultPdfTool,
  setStudioDefaultPdfTool,
  isStudioDefaultStartup,
  setStudioDefaultStartup,
  subscribeDefaultToolSettings,
} from '@/lib/storage/default-tool';
import { saveBlobFile, isTauri, getSystemPrinters, printPdfFile, closeAppWindow } from '@/lib/tauri-bridge';
import { withBasePath } from '@/lib/utils/path';
import { getToolContent, type Locale } from '@/config/tool-content';
import type { Tool } from '@/types/tool';
import { ToolSelectionModal } from '@/components/common/ToolSelectionModal';
import {
  isPdfFile,
  getCompatibleToolsForFiles,
  filterFilesForTool,
  setPendingDroppedFiles,
  consumePendingDroppedFiles,
  subscribePendingDroppedFiles,
  getMimeTypeForFilename,
} from '@/lib/utils/file-tool-router';
import {
  type RecentFile,
  getRecentFiles,
  addRecentFile,
  removeRecentFile,
  clearRecentFiles,
  formatFileSize,
  formatDate,
} from '@/lib/storage/recent-files';
import {
  type AutoBackupMetadata,
  getAutoBackupsMetadata,
  saveAutoBackup,
  recoverAutoBackup,
  removeAutoBackup,
  clearAllAutoBackups,
  saveRecentFileBlob,
  getRecentFileBlob,
  removeRecentFileBlob,
  clearRecentFileBlobs,
  consumePendingStudioRecoveryId,
} from '@/lib/storage/auto-backup';

interface PDFStudioProps {
  locale?: string;
  className?: string;
  initialFile?: File | null;
}

interface HistoryItem {
  blob: Blob;
  name: string;
  action: string;
}

export interface StudioDocument {
  id: string;
  name: string;
  file: File;
  currentBlob: Blob;
  historyStack: HistoryItem[];
  redoStack: HistoryItem[];
  isModified?: boolean;
}

type PendingCloseAction =
  | { type: 'close-doc'; docId: string; docName: string }
  | { type: 'navigate'; href: string }
  | { type: 'tauri-close' };

function isDocModified(doc: StudioDocument): boolean {
  return doc.isModified ?? doc.historyStack.length > 0;
}

export const PDFStudio: React.FC<PDFStudioProps> = ({
  locale = 'en',
  className = '',
  initialFile = null,
}) => {
  const router = useRouter();
  const validLocale = (locale as string) || 'en';
  const isZh = validLocale.toLowerCase().startsWith('zh');

  // Multi-document states
  const [documents, setDocuments] = useState<StudioDocument[]>(() => {
    if (initialFile) {
      return [
        {
          id: 'doc-init',
          name: initialFile.name,
          file: initialFile,
          currentBlob: initialFile,
          historyStack: [],
          redoStack: [],
          isModified: false,
        },
      ];
    }
    return [];
  });
  const [activeDocId, setActiveDocId] = useState<string | null>(() => {
    return initialFile ? 'doc-init' : null;
  });

  const documentsRef = useRef<StudioDocument[]>(documents);
  useEffect(() => {
    documentsRef.current = documents;
  }, [documents]);

  const activeDoc = useMemo(() => {
    return documents.find((d) => d.id === activeDocId) || documents[0] || null;
  }, [documents, activeDocId]);

  const file = activeDoc ? activeDoc.file : null;
  const currentBlob = activeDoc ? activeDoc.currentBlob : null;
  const historyStack = activeDoc ? activeDoc.historyStack : [];
  const redoStack = activeDoc ? activeDoc.redoStack : [];
  const hasAnyModifiedDocs = useMemo(() => documents.some(isDocModified), [documents]);

  const availableDocuments = useMemo(() => {
    if (!activeDoc) return [];
    return documents.filter((d) => d.id !== activeDoc.id);
  }, [documents, activeDoc]);

  const [pdfUrl, setPdfUrl] = useState<string | null>(null);

  // Studio UI states
  const [activeToolId, setActiveToolId] = useState<StudioToolId | null>(null);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(false);
  const [isApplying, setIsApplying] = useState<boolean>(false);
  const [applyProgress, setApplyProgress] = useState<number>(0);
  const [applyProgressMessage, setApplyProgressMessage] = useState<string>('');
  const activeAbortControllerRef = useRef<AbortController | null>(null);

  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [isExportMenuOpen, setIsExportMenuOpen] = useState<boolean>(false);
  const [isRecentBackupOpen, setIsRecentBackupOpen] = useState<boolean>(false);
  const [isOcrTextOpen, setIsOcrTextOpen] = useState<boolean>(false);
  const [ocrExportFormat, setOcrExportFormat] = useState<string>('searchable-pdf');
  const [ocrCopied, setOcrCopied] = useState<boolean>(false);
  const [isDefaultPdfTool, setIsDefaultPdfTool] = useState<boolean>(() => isStudioDefaultPdfTool());
  const [isDefaultStartup, setIsDefaultStartup] = useState<boolean>(() => isStudioDefaultStartup());
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);

  // Recent files & Auto-backup states
  const [recentFilesList, setRecentFilesList] = useState<RecentFile[]>([]);
  const [autoBackupsList, setAutoBackupsList] = useState<AutoBackupMetadata[]>([]);

  // Unsaved changes confirmation modal state
  const [pendingCloseAction, setPendingCloseAction] = useState<PendingCloseAction | null>(null);

  const ocrMeta = useMemo(() => {
    return (currentBlob as any)?.__metadata || null;
  }, [currentBlob]);

  // Feedback notifications
  const [notification, setNotification] = useState<{
    type: 'success' | 'error';
    message: string;
  } | null>(null);

  // Tool selection modal states for non-PDF dropped files
  const [toolModalFiles, setToolModalFiles] = useState<File[]>([]);
  const [toolModalTools, setToolModalTools] = useState<Tool[]>([]);
  const [isToolModalOpen, setIsToolModalOpen] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const multiFileInputRef = useRef<HTMLInputElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const refreshStorageLists = useCallback(() => {
    setRecentFilesList(getRecentFiles());
    setAutoBackupsList(getAutoBackupsMetadata());
  }, []);

  useEffect(() => {
    refreshStorageLists();
    if (initialFile) {
      addRecentFile(initialFile.name, initialFile.size, 'studio', 'PDF Studio');
      void saveRecentFileBlob(initialFile.name, initialFile).then(() => {
        refreshStorageLists();
      });
    }
  }, [initialFile, refreshStorageLists]);

  // Restore sidebar collapse state
  useEffect(() => {
    try {
      const saved = localStorage.getItem('pdfcraft_studio_sidebar_collapsed');
      if (saved !== null) {
        setIsSidebarCollapsed(saved === 'true');
      }
    } catch {}
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    setIsSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem('pdfcraft_studio_sidebar_collapsed', String(next));
      } catch {}
      return next;
    });
  }, []);

  // Sync default PDF tool and startup settings across tabs/windows
  useEffect(() => {
    return subscribeDefaultToolSettings(() => {
      setIsDefaultPdfTool(isStudioDefaultPdfTool());
      setIsDefaultStartup(isStudioDefaultStartup());
    });
  }, []);

  // Update object URL when currentBlob changes
  useEffect(() => {
    if (!currentBlob) {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
        setPdfUrl(null);
      }
      return;
    }

    const newUrl = URL.createObjectURL(currentBlob);
    setPdfUrl(newUrl);

    return () => {
      URL.revokeObjectURL(newUrl);
    };
  }, [currentBlob]);

  // Show auto-dismiss notifications
  const notify = useCallback((type: 'success' | 'error', message: string) => {
    setNotification({ type, message });
    setTimeout(() => {
      setNotification((curr) => (curr?.message === message ? null : curr));
    }, 3000);
  }, []);

  const handleToggleDefaultPdfTool = useCallback(
    (checked: boolean) => {
      setStudioDefaultPdfTool(checked);
      setIsDefaultPdfTool(checked);
      notify(
        'success',
        checked
          ? isZh
            ? '已将 PDF Studio 设为默认打开 PDF 文件的工具'
            : 'PDF Studio set as the default tool to open PDF files'
          : isZh
          ? '已取消 PDF Studio 默认工具设置，将恢复弹出工具选择'
          : 'PDF Studio is no longer the default PDF tool'
      );
    },
    [notify, isZh]
  );

  const handleToggleDefaultStartup = useCallback(
    (checked: boolean) => {
      setStudioDefaultStartup(checked);
      setIsDefaultStartup(checked);
      notify(
        'success',
        checked
          ? isZh
            ? '已将 PDF Studio 设为应用启动默认打开页面'
            : 'PDF Studio set as the default startup view'
          : isZh
          ? '应用启动将恢复默认显示经典工具网格'
          : 'PDF Studio is no longer the default startup view'
      );
    },
    [notify, isZh]
  );

  const handleSelectToolForDroppedFiles = useCallback(
    (tool: Tool, validFiles: File[]) => {
      setIsToolModalOpen(false);
      setPendingDroppedFiles(validFiles, tool.slug);
      router.push(`/${validLocale}/tools/${tool.slug}`);
    },
    [router, validLocale]
  );

  // Handle loading multiple files (or single file)
  const handleAddFiles = useCallback(
    (incomingFiles: FileList | File[]) => {
      const incomingArray = Array.from(incomingFiles);
      if (incomingArray.length === 0) return;

      const validPdfs = incomingArray.filter(
        (f) => isPdfFile(f) || f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf'
      );
      const nonPdfFiles = incomingArray.filter(
        (f) => !(isPdfFile(f) || f.name.toLowerCase().endsWith('.pdf') || f.type === 'application/pdf')
      );

      if (validPdfs.length > 0) {
        const newDocs: StudioDocument[] = validPdfs.map((f, idx) => ({
          id: `doc_${Date.now()}_${idx}_${Math.random().toString(36).slice(2, 7)}`,
          name: f.name,
          file: f,
          currentBlob: f,
          historyStack: [],
          redoStack: [],
          isModified: false,
        }));

        for (const f of validPdfs) {
          addRecentFile(f.name, f.size, 'studio', 'PDF Studio');
          void saveRecentFileBlob(f.name, f);
        }
        refreshStorageLists();

        setDocuments((prev) => {
          const toAdd: StudioDocument[] = [];
          let activeIdToSet: string | null = null;

          for (const newDoc of newDocs) {
            const existing = prev.find(
              (d) => d.name === newDoc.name && d.file.size === newDoc.file.size
            );
            if (existing) {
              if (!activeIdToSet) activeIdToSet = existing.id;
            } else {
              toAdd.push(newDoc);
              if (!activeIdToSet) activeIdToSet = newDoc.id;
            }
          }

          if (activeIdToSet) {
            setActiveDocId(activeIdToSet);
          }

          if (toAdd.length === 0) {
            return prev;
          }

          return [...prev, ...toAdd];
        });
        setActiveToolId(null);
        notify(
          'success',
          isZh
            ? `已成功载入 ${newDocs.length} 个 PDF 文档`
            : `Successfully loaded ${newDocs.length} PDF document(s)`
        );
      }

      if (nonPdfFiles.length > 0) {
        const compatibleTools = getCompatibleToolsForFiles(nonPdfFiles);
        if (compatibleTools.length === 1) {
          const targetTool = compatibleTools[0];
          const validFiles = filterFilesForTool(nonPdfFiles, targetTool);
          handleSelectToolForDroppedFiles(targetTool, validFiles);
          return;
        } else if (compatibleTools.length > 1) {
          setToolModalFiles(nonPdfFiles);
          setToolModalTools(compatibleTools);
          setIsToolModalOpen(true);
          return;
        } else if (validPdfs.length === 0) {
          notify('error', isZh ? '请选择有效的 PDF 文件' : 'Please select a valid PDF file');
          return;
        }
      }
    },
    [notify, isZh, handleSelectToolForDroppedFiles, refreshStorageLists]
  );

  // Recover an auto-backed-up document into Studio
  const handleRecoverAutoBackup = useCallback(
    async (backupId: string) => {
      try {
        const entry = await recoverAutoBackup(backupId);
        if (!entry) {
          notify('error', isZh ? '无法读取该自动备份数据' : 'Could not recover auto-backup data');
          return;
        }

        const baseBlob = entry.originalBlob || entry.blob;
        const originalFile = new File([baseBlob], entry.name, { type: 'application/pdf' });
        const actions =
          Array.isArray(entry.historyActions) && entry.historyActions.length > 0
            ? entry.historyActions
            : [entry.lastAction || (isZh ? '已恢复的修改' : 'Recovered edit')];

        const restoredHistory: HistoryItem[] = actions.map((act) => ({
          blob: baseBlob,
          name: entry.name,
          action: act,
        }));

        const recoveredDoc: StudioDocument = {
          id: entry.id,
          name: entry.name,
          file: originalFile,
          currentBlob: entry.blob,
          historyStack: restoredHistory,
          redoStack: [],
          isModified: true,
        };

        setDocuments((prev) => {
          const existingIdx = prev.findIndex((d) => d.id === entry.id);
          if (existingIdx >= 0) {
            const copy = [...prev];
            copy[existingIdx] = recoveredDoc;
            return copy;
          }
          return [...prev, recoveredDoc];
        });
        setActiveDocId(recoveredDoc.id);
        setActiveToolId(null);
        setIsRecentBackupOpen(false);
        notify(
          'success',
          isZh
            ? `已恢复未保存的自动备份文档「${entry.name}」`
            : `Recovered auto-backup document "${entry.name}"`
        );
      } catch (err: any) {
        notify(
          'error',
          err?.message || (isZh ? '恢复自动备份失败' : 'Failed to recover auto-backup')
        );
      }
    },
    [notify, isZh]
  );

  // Directly download/save an auto-backup file to disk
  const handleDownloadAutoBackup = useCallback(
    async (backupId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      try {
        const entry = await recoverAutoBackup(backupId);
        if (!entry) {
          notify('error', isZh ? '无法读取该自动备份数据' : 'Could not recover auto-backup data');
          return;
        }
        const fileName = entry.name.replace(/\.pdf$/i, '_recovered.pdf');
        const isDownloaded = await saveBlobFile(entry.blob, fileName);
        if (isDownloaded) {
          addRecentFile(fileName, entry.blob.size, 'studio', 'PDF Studio');
          await saveRecentFileBlob(fileName, entry.blob);
          await removeAutoBackup(backupId);
          refreshStorageLists();
          notify(
            'success',
            isZh ? `已保存自动备份文件「${fileName}」` : `Saved auto-backup as "${fileName}"`
          );
        }
      } catch (err: any) {
        notify('error', err?.message || (isZh ? '保存自动备份失败' : 'Failed to save auto-backup'));
      }
    },
    [notify, isZh, refreshStorageLists]
  );

  const handleDeleteAutoBackup = useCallback(
    async (backupId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      await removeAutoBackup(backupId);
      refreshStorageLists();
    },
    [refreshStorageLists]
  );

  const handleClearAutoBackups = useCallback(async () => {
    await clearAllAutoBackups();
    refreshStorageLists();
  }, [refreshStorageLists]);

  // Open a recent file in Studio
  const handleOpenRecentStudioFile = useCallback(
    async (recent: RecentFile) => {
      setIsRecentBackupOpen(false);
      try {
        const blob = await getRecentFileBlob(recent.name);
        if (blob) {
          const restoredFile = new File([blob], recent.name, {
            type: blob.type || 'application/pdf',
          });
          handleAddFiles([restoredFile]);
          return;
        }
      } catch {}

      if (recent.toolUsed && recent.toolUsed !== 'studio') {
        router.push(`/${validLocale}/tools/${recent.toolUsed}`);
        return;
      }

      notify(
        'error',
        isZh
          ? `未找到「${recent.name}」的本地缓存，请重新选择文件`
          : `Cached data for "${recent.name}" is unavailable. Please select the file from disk`
      );
      fileInputRef.current?.click();
    },
    [handleAddFiles, router, validLocale, notify, isZh]
  );

  const handleRemoveRecentStudioFile = useCallback(
    async (id: string, name: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      removeRecentFile(id);
      await removeRecentFileBlob(name);
      refreshStorageLists();
    },
    [refreshStorageLists]
  );

  const handleClearRecentStudioFiles = useCallback(async () => {
    clearRecentFiles();
    await clearRecentFileBlobs();
    refreshStorageLists();
  }, [refreshStorageLists]);

  // Consume any pending PDF files or pending auto-backup recovery routed to Studio on mount
  useEffect(() => {
    const pendingStudioFiles = consumePendingDroppedFiles('studio');
    if (pendingStudioFiles && pendingStudioFiles.length > 0) {
      handleAddFiles(pendingStudioFiles);
    }
    const pendingRecoveryId = consumePendingStudioRecoveryId();
    if (pendingRecoveryId) {
      void handleRecoverAutoBackup(pendingRecoveryId);
    }
  }, [handleAddFiles, handleRecoverAutoBackup]);

  // Subscribe to pending dropped files routed to Studio while already mounted
  useEffect(() => {
    const handlePending = (payload: { targetToolSlug?: string }) => {
      if (!payload.targetToolSlug || payload.targetToolSlug === 'studio') {
        const files = consumePendingDroppedFiles('studio');
        if (files && files.length > 0) {
          handleAddFiles(files);
        }
      }
    };
    return subscribePendingDroppedFiles(handlePending);
  }, [handleAddFiles]);

  const isClosingAppRef = useRef<boolean>(false);

  // Warn before browser tab close / reload when modified documents are open, and flush auto-backups
  useEffect(() => {
    if (!hasAnyModifiedDocs) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isClosingAppRef.current) return;

      const modifiedDocs = documentsRef.current.filter(isDocModified);
      if (modifiedDocs.length === 0) return;

      for (const doc of modifiedDocs) {
        void saveAutoBackup(doc);
      }

      // In Tauri desktop, onCloseRequested handles the custom modal prompt;
      // skip native beforeunload prevention so WebView2 does not block window exit.
      if (isTauri()) return;

      e.preventDefault();
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [hasAnyModifiedDocs]);

  // Intercept Tauri window close request when modified documents are open
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlistenClose: (() => void) | null = null;

    const setupTauriCloseGuard = async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const appWindow = getCurrentWebviewWindow();
        if (!active) return;

        unlistenClose = await appWindow.onCloseRequested((event) => {
          if (isClosingAppRef.current) {
            return;
          }
          const modifiedDocs = documentsRef.current.filter(isDocModified);
          if (modifiedDocs.length > 0) {
            event.preventDefault();
            for (const doc of modifiedDocs) {
              void saveAutoBackup(doc);
            }
            refreshStorageLists();
            setPendingCloseAction({ type: 'tauri-close' });
          }
        });

        if (!active && unlistenClose) {
          unlistenClose();
        }
      } catch (err) {
        console.error('Failed to setup Tauri close guard in Studio:', err);
      }
    };

    setupTauriCloseGuard();
    return () => {
      active = false;
      if (unlistenClose) unlistenClose();
    };
  }, [refreshStorageLists]);

  // Support Tauri native drag-and-drop in Studio
  useEffect(() => {
    if (!isTauri()) return;
    let active = true;
    let unlistenDrop: (() => void) | null = null;

    const setupTauriDrop = async () => {
      try {
        const { getCurrentWebviewWindow } = await import('@tauri-apps/api/webviewWindow');
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const appWindow = getCurrentWebviewWindow();
        if (!active) return;

        unlistenDrop = await appWindow.listen<{ paths: string[] }>('tauri://drag-drop', async (event) => {
          const paths = event.payload.paths;
          if (!paths || paths.length === 0) return;

          const fileObjects: File[] = [];
          for (const filePath of paths) {
            try {
              const bytes = await readFile(filePath);
              const name = filePath.split(/[/\\]/).pop() || 'file.pdf';
              const mimeType = getMimeTypeForFilename(name);
              const f = new (window as any).File([bytes], name, { type: mimeType }) as File;
              fileObjects.push(f);
            } catch (err) {
              console.error(`Tauri failed to read dragged file in Studio: ${filePath}`, err);
            }
          }
          if (fileObjects.length > 0) {
            handleAddFiles(fileObjects);
          }
        });

        if (!active && unlistenDrop) {
          unlistenDrop();
        }
      } catch (err) {
        console.error('Failed to setup Tauri drag-drop in Studio:', err);
      }
    };

    setupTauriDrop();
    return () => {
      active = false;
      if (unlistenDrop) unlistenDrop();
    };
  }, [handleAddFiles]);

  const handleLoadFile = useCallback(
    (selectedFile: File) => {
      handleAddFiles([selectedFile]);
    },
    [handleAddFiles]
  );

  const handleSelectDocument = useCallback((docId: string) => {
    setActiveDocId(docId);
    setActiveToolId(null);
  }, []);

  const removeDocumentDirectly = useCallback(
    (docId: string) => {
      setDocuments((prev) => {
        const remaining = prev.filter((d) => d.id !== docId);
        if (activeDocId === docId) {
          const closedIdx = prev.findIndex((d) => d.id === docId);
          const next = remaining[Math.min(closedIdx, remaining.length - 1)] || null;
          setActiveDocId(next ? next.id : null);
        }
        return remaining;
      });
    },
    [activeDocId]
  );

  const handleCloseDocument = useCallback(
    (docId: string, e?: React.MouseEvent) => {
      if (e) e.stopPropagation();
      const targetDoc = documents.find((d) => d.id === docId);
      if (!targetDoc) return;

      if (isDocModified(targetDoc)) {
        void saveAutoBackup(targetDoc).then(() => {
          refreshStorageLists();
        });
        setPendingCloseAction({
          type: 'close-doc',
          docId: targetDoc.id,
          docName: targetDoc.name,
        });
        return;
      }

      removeDocumentDirectly(docId);
    },
    [documents, removeDocumentDirectly, refreshStorageLists]
  );

  // Intercept navigation away from Studio when modified files are open
  const handleGuardedNavigate = useCallback(
    (e: React.MouseEvent, href: string) => {
      if (hasAnyModifiedDocs) {
        e.preventDefault();
        for (const doc of documents.filter(isDocModified)) {
          void saveAutoBackup(doc);
        }
        refreshStorageLists();
        setPendingCloseAction({ type: 'navigate', href });
      }
    },
    [hasAnyModifiedDocs, documents, refreshStorageLists]
  );

  // Handle "Save & Close" in the Unsaved Changes Modal
  const handleConfirmSaveAndClose = useCallback(async () => {
    if (!pendingCloseAction) return;

    try {
      if (pendingCloseAction.type === 'close-doc') {
        const targetDoc = documents.find((d) => d.id === pendingCloseAction.docId);
        if (!targetDoc) {
          setPendingCloseAction(null);
          return;
        }
        const fileName = targetDoc.name.replace(/\.pdf$/i, '_crafted.pdf');
        const isDownloaded = await saveBlobFile(targetDoc.currentBlob, fileName);
        if (!isDownloaded) {
          // User cancelled native save dialog; stay open
          return;
        }
        addRecentFile(fileName, targetDoc.currentBlob.size, 'studio', 'PDF Studio');
        await saveRecentFileBlob(fileName, targetDoc.currentBlob);
        await removeAutoBackup(targetDoc.id);
        refreshStorageLists();
        removeDocumentDirectly(targetDoc.id);
        setPendingCloseAction(null);
        notify(
          'success',
          isZh ? `已保存「${fileName}」并关闭文档` : `Saved "${fileName}" and closed document`
        );
        return;
      }

      // Navigate or Tauri window close with modified documents
      const modifiedDocs = documents.filter(isDocModified);
      for (const doc of modifiedDocs) {
        const fileName = doc.name.replace(/\.pdf$/i, '_crafted.pdf');
        const isDownloaded = await saveBlobFile(doc.currentBlob, fileName);
        if (!isDownloaded) {
          return;
        }
        addRecentFile(fileName, doc.currentBlob.size, 'studio', 'PDF Studio');
        await saveRecentFileBlob(fileName, doc.currentBlob);
        await removeAutoBackup(doc.id);
      }

      setDocuments((prev) => prev.map((d) => ({ ...d, isModified: false })));
      refreshStorageLists();
      const action = pendingCloseAction;
      setPendingCloseAction(null);

      if (action.type === 'navigate') {
        router.push(action.href);
      } else if (action.type === 'tauri-close') {
        isClosingAppRef.current = true;
        documentsRef.current = [];
        await closeAppWindow();
      }
    } catch (err: any) {
      notify(
        'error',
        err?.message || (isZh ? '保存文档失败' : 'Failed to save document before closing')
      );
    }
  }, [pendingCloseAction, documents, refreshStorageLists, removeDocumentDirectly, notify, isZh, router]);

  // Handle "Don't Save" in the Unsaved Changes Modal
  const handleConfirmDiscardAndClose = useCallback(async () => {
    if (!pendingCloseAction) return;

    const action = pendingCloseAction;
    setPendingCloseAction(null);

    if (action.type === 'close-doc') {
      const targetDoc = documents.find((d) => d.id === action.docId);
      if (targetDoc) {
        await saveAutoBackup(targetDoc);
        refreshStorageLists();
      }
      removeDocumentDirectly(action.docId);
      return;
    }

    const modifiedDocs = documents.filter(isDocModified);
    // Ensure auto-backup does not hang window exit if IndexedDB is slow
    await Promise.race([
      Promise.all(modifiedDocs.map((doc) => saveAutoBackup(doc))),
      new Promise<void>((resolve) => setTimeout(resolve, 150)),
    ]);
    refreshStorageLists();

    if (action.type === 'navigate') {
      router.push(action.href);
    } else if (action.type === 'tauri-close') {
      isClosingAppRef.current = true;
      documentsRef.current = [];
      await closeAppWindow();
    }
  }, [pendingCloseAction, documents, refreshStorageLists, removeDocumentDirectly, router]);

  // Handle Drag & Drop on Empty State and View Area
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        handleAddFiles(e.dataTransfer.files);
      }
    },
    [handleAddFiles]
  );

  // Cancel any ongoing in-place or export operation
  const handleCancelOperation = useCallback(() => {
    if (activeAbortControllerRef.current) {
      activeAbortControllerRef.current.abort();
      activeAbortControllerRef.current = null;
    }
    setIsApplying(false);
    setApplyProgress(0);
    setApplyProgressMessage('');
  }, []);

  // Apply a tool operation in-place on current active document
  const handleApplyTool = useCallback(
    async (toolId: StudioToolId, options: Record<string, any> = {}) => {
      if (!currentBlob || !file || !activeDoc) return;

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      setIsApplying(true);
      setApplyProgress(0);
      setApplyProgressMessage(isZh ? '正在就地处理文档...' : 'Processing document in-place...');
      try {
        const tempFile = new File([currentBlob], file.name, { type: 'application/pdf' });
        const onProgress = (prog: number, msg?: string) => {
          if (!abortController.signal.aborted) {
            setApplyProgress(prog);
            if (msg) {
              setApplyProgressMessage(msg);
            }
          }
        };
        const newBlob = await executeStudioOperation(
          tempFile,
          toolId,
          { ...options, onProgress, signal: abortController.signal }
        );

        if (abortController.signal.aborted) {
          return;
        }

        const toolConfig = findStudioToolConfig(toolId);
        const localizedContent = getToolContent(validLocale as Locale, toolId);
        const toolName = localizedContent?.title || toolConfig?.name || toolId;

        const updatedHistory: HistoryItem[] = [
          ...activeDoc.historyStack,
          { blob: activeDoc.currentBlob, name: activeDoc.name, action: toolName },
        ];
        const updatedDoc: StudioDocument = {
          ...activeDoc,
          currentBlob: newBlob,
          historyStack: updatedHistory,
          redoStack: [],
          isModified: true,
        };

        // Push current state to active document undo history
        setDocuments((prevDocs) =>
          prevDocs.map((doc) => (doc.id === activeDoc.id ? updatedDoc : doc))
        );

        // Automatically back up the modified document
        void saveAutoBackup(updatedDoc).then(() => {
          refreshStorageLists();
        });

        setActiveToolId(null); // Close drawer
        addStudioRecentTool(toolId);

        const newMeta = (newBlob as any)?.__metadata;
        if (newMeta) {
          const fmt = newMeta.requestedFormat || options.outputFormat || 'searchable-pdf';
          setOcrExportFormat(fmt);
          setIsOcrTextOpen(fmt === 'text' || fmt === 'markdown' || fmt === 'json');
        } else {
          setIsOcrTextOpen(false);
        }

        notify(
          'success',
          isZh
            ? `已就地应用「${toolName}」，可在左侧继续选择下一项操作`
            : `Applied "${toolName}" in-place. Select another action on the left`
        );
      } catch (err: any) {
        if (
          abortController.signal.aborted ||
          err?.message?.includes('cancelled') ||
          err?.message?.includes('Cancelled')
        ) {
          return;
        }
        notify(
          'error',
          err?.message || (isZh ? '操作应用失败，请检查参数' : 'Failed to apply operation. Please check options')
        );
      } finally {
        if (activeAbortControllerRef.current === abortController) {
          activeAbortControllerRef.current = null;
        }
        setIsApplying(false);
        setApplyProgress(0);
        setApplyProgressMessage('');
      }
    },
    [currentBlob, file, activeDoc, notify, validLocale, isZh, refreshStorageLists]
  );

  // Save/export in-memory OCR result in the selected format when user likes the results
  const handleSaveOcrResult = useCallback(
    async (formatOverride?: string) => {
      if (!currentBlob || !file || !activeDoc) return;
      const fmt = formatOverride || ocrExportFormat || 'searchable-pdf';
      const baseName = file.name.replace(/\.pdf$/i, '');

      try {
        if (fmt === 'searchable-pdf') {
          const filename = `${baseName}_searchable.pdf`;
          const isDownloaded = await saveBlobFile(currentBlob, filename);
          if (isDownloaded) {
            setDocuments((prev) =>
              prev.map((d) => (d.id === activeDoc.id ? { ...d, isModified: false } : d))
            );
            addRecentFile(filename, currentBlob.size, 'studio', 'PDF Studio');
            await saveRecentFileBlob(filename, currentBlob);
            await removeAutoBackup(activeDoc.id);
            refreshStorageLists();
            notify('success', isZh ? `已保存可搜索 PDF「${filename}」` : `Saved searchable PDF "${filename}"`);
          }
          return;
        }

        if (ocrMeta) {
          let targetBlob: Blob | null = null;
          let filename = `${baseName}_ocr.txt`;

          if (fmt === 'text' && typeof ocrMeta.rawText === 'string') {
            targetBlob = new Blob([ocrMeta.rawText], { type: 'text/plain;charset=utf-8' });
            filename = `${baseName}_ocr.txt`;
          } else if (fmt === 'markdown' && typeof ocrMeta.markdownText === 'string') {
            targetBlob = new Blob([ocrMeta.markdownText], { type: 'text/markdown;charset=utf-8' });
            filename = `${baseName}_ocr.md`;
          } else if (fmt === 'json' && typeof ocrMeta.jsonText === 'string') {
            targetBlob = new Blob([ocrMeta.jsonText], { type: 'application/json;charset=utf-8' });
            filename = `${baseName}_ocr.json`;
          } else if (fmt === 'docx' && Array.isArray(ocrMeta.pagesData)) {
            const { generateDocxOutput } = await import('@/lib/pdf/processors/ocr');
            targetBlob = await generateDocxOutput(ocrMeta.pagesData, file.name);
            filename = `${baseName}_ocr.docx`;
          }

          if (targetBlob) {
            const isDownloaded = await saveBlobFile(targetBlob, filename);
            if (isDownloaded) {
              setDocuments((prev) =>
                prev.map((d) => (d.id === activeDoc.id ? { ...d, isModified: false } : d))
              );
              await removeAutoBackup(activeDoc.id);
              refreshStorageLists();
              notify('success', isZh ? `已导出 OCR 结果「${filename}」` : `Exported OCR result "${filename}"`);
            }
            return;
          }
        }
      } catch (err: any) {
        notify('error', err?.message || (isZh ? '保存导出失败' : 'Failed to save and export OCR result'));
      }
    },
    [currentBlob, file, activeDoc, ocrExportFormat, ocrMeta, notify, isZh, refreshStorageLists]
  );

  // Handle export/convert operation without altering central PDF viewer
  const handleExportTool = useCallback(
    async (toolId: StudioToolId, options: Record<string, any> = {}) => {
      if (!currentBlob || !file) return;

      const abortController = new AbortController();
      activeAbortControllerRef.current = abortController;

      setIsApplying(true);
      setApplyProgress(0);
      setApplyProgressMessage(isZh ? '正在准备转换导出...' : 'Preparing export...');
      try {
        const tempFile = new File([currentBlob], file.name, { type: 'application/pdf' });
        const onProgress = (prog: number, msg?: string) => {
          if (!abortController.signal.aborted) {
            setApplyProgress(prog);
            if (msg) {
              setApplyProgressMessage(msg);
            }
          }
        };
        const { blob, filename } = await executeStudioExport(
          tempFile,
          toolId,
          { ...options, onProgress, signal: abortController.signal }
        );

        if (abortController.signal.aborted) {
          return;
        }

        await saveBlobFile(blob, filename);
        setActiveToolId(null);
        addStudioRecentTool(toolId);
        notify(
          'success',
          isZh
            ? `转换导出完成，已触发下载「${filename}」`
            : `Export completed, downloading "${filename}"`
        );
      } catch (err: any) {
        if (
          abortController.signal.aborted ||
          err?.message?.includes('cancelled') ||
          err?.message?.includes('Cancelled')
        ) {
          return;
        }
        notify('error', err?.message || (isZh ? '导出转换失败' : 'Export conversion failed'));
      } finally {
        if (activeAbortControllerRef.current === abortController) {
          activeAbortControllerRef.current = null;
        }
        setIsApplying(false);
        setApplyProgress(0);
        setApplyProgressMessage('');
      }
    },
    [currentBlob, file, notify, isZh, saveBlobFile]
  );

  // Undo last operation on active document
  const handleUndo = useCallback(() => {
    if (!activeDoc || activeDoc.historyStack.length === 0) return;

    const previousItem = activeDoc.historyStack[activeDoc.historyStack.length - 1];
    const newHistory = activeDoc.historyStack.slice(0, -1);
    const nextIsModified = newHistory.length > 0;

    const updatedDoc: StudioDocument = {
      ...activeDoc,
      currentBlob: previousItem.blob,
      historyStack: newHistory,
      redoStack: [
        ...activeDoc.redoStack,
        { blob: activeDoc.currentBlob, name: activeDoc.name, action: previousItem.action },
      ],
      isModified: nextIsModified,
    };

    setDocuments((prev) =>
      prev.map((doc) => (doc.id === activeDoc.id ? updatedDoc : doc))
    );

    if (nextIsModified) {
      void saveAutoBackup(updatedDoc).then(() => refreshStorageLists());
    } else {
      void removeAutoBackup(activeDoc.id).then(() => refreshStorageLists());
    }

    notify('success', isZh ? `已撤销「${previousItem.action}」` : `Undone "${previousItem.action}"`);
  }, [activeDoc, notify, isZh, refreshStorageLists]);

  // Redo operation on active document
  const handleRedo = useCallback(() => {
    if (!activeDoc || activeDoc.redoStack.length === 0) return;

    const nextItem = activeDoc.redoStack[activeDoc.redoStack.length - 1];
    const newRedo = activeDoc.redoStack.slice(0, -1);

    const updatedDoc: StudioDocument = {
      ...activeDoc,
      currentBlob: nextItem.blob,
      historyStack: [
        ...activeDoc.historyStack,
        { blob: activeDoc.currentBlob, name: activeDoc.name, action: nextItem.action },
      ],
      redoStack: newRedo,
      isModified: true,
    };

    setDocuments((prev) =>
      prev.map((doc) => (doc.id === activeDoc.id ? updatedDoc : doc))
    );

    void saveAutoBackup(updatedDoc).then(() => refreshStorageLists());

    notify('success', isZh ? `已重做「${nextItem.action}」` : `Redone "${nextItem.action}"`);
  }, [activeDoc, notify, isZh, refreshStorageLists]);

  // Revert all changes on active document back to initial version
  const handleRevert = useCallback(() => {
    if (!activeDoc || activeDoc.historyStack.length === 0) return;
    if (
      window.confirm(
        isZh
          ? `确定要放弃文档「${activeDoc.name}」的所有更改，还原到最初上传的版本吗？`
          : `Discard all changes to "${activeDoc.name}" and revert to the original version?`
      )
    ) {
      setDocuments((prev) =>
        prev.map((doc) => {
          if (doc.id === activeDoc.id) {
            return {
              ...doc,
              currentBlob: doc.file,
              historyStack: [],
              redoStack: [],
              isModified: false,
            };
          }
          return doc;
        })
      );
      void removeAutoBackup(activeDoc.id).then(() => refreshStorageLists());
      setActiveToolId(null);
      setIsHistoryOpen(false);
      notify(
        'success',
        isZh ? `已还原「${activeDoc.name}」至最初版本` : `Reverted "${activeDoc.name}" to original version`
      );
    }
  }, [activeDoc, notify, isZh, refreshStorageLists]);

  // Batch Export all opened documents as a single ZIP archive
  const handleExportAllZip = useCallback(async () => {
    if (documents.length === 0) return;
    setIsApplying(true);
    try {
      const zip = new JSZip();
      for (let i = 0; i < documents.length; i++) {
        const doc = documents[i];
        const cleanName = doc.name.replace(/\.pdf$/i, '');
        const filename = `${cleanName}_crafted.pdf`;
        zip.file(filename, doc.currentBlob);
      }
      const zipBlob = await zip.generateAsync({ type: 'blob' });
      const zipName = `pdfcraft_studio_batch_${Date.now()}.zip`;
      const isDownloaded = await saveBlobFile(zipBlob, zipName);
      if (isDownloaded) {
        setDocuments((prev) => prev.map((d) => ({ ...d, isModified: false })));
        for (const doc of documents) {
          await removeAutoBackup(doc.id);
        }
        refreshStorageLists();
        notify(
          'success',
          isZh
            ? `成功打包并导出全部 ${documents.length} 个文档`
            : `Packaged and exported all ${documents.length} documents`
        );
      }
    } catch (err: any) {
      notify('error', err?.message || (isZh ? '打包导出失败' : 'Failed to package export'));
    } finally {
      setIsApplying(false);
      setIsExportMenuOpen(false);
    }
  }, [documents, notify, isZh, refreshStorageLists]);

  // Export / Save final document
  const handleExport = useCallback(async () => {
    if (!currentBlob || !file || !activeDoc) return;

    try {
      const fileName = file.name.replace(/\.pdf$/i, '_crafted.pdf');
      const isDownloaded = await saveBlobFile(currentBlob, fileName);
      if (isDownloaded) {
        setDocuments((prev) =>
          prev.map((d) => (d.id === activeDoc.id ? { ...d, isModified: false } : d))
        );
        addRecentFile(fileName, currentBlob.size, 'studio', 'PDF Studio');
        await saveRecentFileBlob(fileName, currentBlob);
        await removeAutoBackup(activeDoc.id);
        refreshStorageLists();
        notify(
          'success',
          isZh ? `文档已保存并导出「${fileName}」` : `Document saved and exported as "${fileName}"`
        );
      }
    } catch (err: any) {
      notify('error', err?.message || (isZh ? '保存导出失败' : 'Failed to save and export document'));
    }
  }, [currentBlob, file, activeDoc, notify, isZh, refreshStorageLists]);

  // Print current in-memory document
  const handlePrint = useCallback(async () => {
    if (!currentBlob) return;

    try {
      if (isTauri()) {
        const printers = await getSystemPrinters();
        if (printers.length > 0) {
          await printPdfFile(currentBlob, printers[0].name);
          notify('success', isZh ? '已发送打印任务' : 'Print job sent');
          return;
        }
      }

      // Web fallback: trigger iframe print
      if (iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.print();
      } else {
        window.print();
      }
    } catch (err: any) {
      notify('error', err?.message || (isZh ? '打印触发失败' : 'Failed to trigger print'));
    }
  }, [currentBlob, notify, isZh]);

  // Keyboard shortcuts (Ctrl+Z, Ctrl+Y, Ctrl+S, Ctrl+P, Escape, /)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if (modKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      } else if (modKey && e.key.toLowerCase() === 's') {
        e.preventDefault();
        handleExport();
      } else if (modKey && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        handlePrint();
      } else if (e.key === 'Escape') {
        setActiveToolId(null);
        setIsHistoryOpen(false);
        setIsExportMenuOpen(false);
        setIsRecentBackupOpen(false);
        setPendingCloseAction(null);
      } else if (
        (modKey && e.key.toLowerCase() === 'k') ||
        (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA')
      ) {
        e.preventDefault();
        const searchInput = document.querySelector<HTMLInputElement>('input[data-testid="studio-tool-search"]');
        searchInput?.focus();
        searchInput?.select();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleUndo, handleRedo, handleExport, handlePrint]);

  return (
    <div
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
      className={`h-screen flex flex-col bg-[hsl(var(--color-background))] select-none ${className}`.trim()}
    >
      {/* Studio Header (Compact Toolbar - 52px) */}
      <header className="h-[52px] flex-shrink-0 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card)/0.9)] backdrop-blur-md px-4 flex items-center justify-between z-30 relative">
        {/* Left: Brand & File Info */}
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href={`/${locale}`}
            onClick={(e) => handleGuardedNavigate(e, `/${locale}`)}
            className="flex items-center gap-2 hover:opacity-80 transition-opacity shrink-0"
            title={isZh ? '返回首页' : 'Home'}
          >
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-gradient-to-br from-[hsl(var(--color-primary))] to-[hsl(var(--color-accent))] shadow-sm">
              <Sparkles className="h-4 w-4 text-white" />
            </div>
            <span className="font-bold text-sm tracking-tight hidden sm:inline text-[hsl(var(--color-foreground))]">
              PDFCraft <span className="text-[hsl(var(--color-primary))] font-medium">Studio</span>
            </span>
          </Link>

          {file && (
            <>
              <span className="text-[hsl(var(--color-border))] shrink-0">|</span>
              <div className="flex items-center gap-2">
                {/* History Badge button */}
                <button
                  type="button"
                  onClick={() => setIsHistoryOpen((prev) => !prev)}
                  className={`text-[10px] px-2 py-0.5 rounded-full font-medium flex-shrink-0 flex items-center gap-1 transition-all ${
                    historyStack.length > 0
                      ? 'bg-[hsl(var(--color-primary)/0.15)] text-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary)/0.25)]'
                      : 'bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))]'
                  }`}
                  title={isZh ? '查看操作历史记录' : 'View Action History'}
                >
                  <History className="w-2.5 h-2.5" />
                  <span>+{historyStack.length} {isZh ? '操作' : 'action(s)'}</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Center: Undo / Redo & Revert Controls */}
        {file && (
          <div className="flex items-center gap-1 bg-[hsl(var(--color-muted)/0.5)] p-1 rounded-xl border border-[hsl(var(--color-border)/0.6)]">
            <button
              onClick={handleUndo}
              disabled={historyStack.length === 0}
              className="p-1.5 rounded-lg text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-background))] disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              title={isZh ? '撤销 (Ctrl+Z)' : 'Undo (Ctrl+Z)'}
              aria-label="Undo"
            >
              <Undo2 className="w-4 h-4" />
            </button>
            <button
              onClick={handleRedo}
              disabled={redoStack.length === 0}
              className="p-1.5 rounded-lg text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-background))] disabled:opacity-30 disabled:hover:bg-transparent transition-all"
              title={isZh ? '重做 (Ctrl+Y)' : 'Redo (Ctrl+Y)'}
              aria-label="Redo"
            >
              <Redo2 className="w-4 h-4" />
            </button>
            {historyStack.length > 0 && (
              <>
                <div className="w-[1px] h-3.5 bg-[hsl(var(--color-border))] mx-1" />
                <button
                  onClick={handleRevert}
                  className="px-2 py-1 text-[11px] font-medium text-[hsl(var(--color-muted-foreground))] hover:text-red-500 rounded-lg hover:bg-[hsl(var(--color-background))] transition-all flex items-center gap-1"
                  title={isZh ? '恢复至初始未编辑版本' : 'Revert to Initial Version'}
                >
                  <RotateCcw className="w-3 h-3" />
                  <span className="hidden md:inline">{isZh ? '还原初始' : 'Revert'}</span>
                </button>
              </>
            )}
          </div>
        )}

        {/* Right: Actions & Mode Switch */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Recent Files & Auto-Backup Recovery Popover Button */}
          <div className="relative">
            <button
              type="button"
              data-testid="studio-recent-backups-btn"
              onClick={() => {
                refreshStorageLists();
                setIsRecentBackupOpen((prev) => !prev);
                setIsSettingsOpen(false);
                setIsExportMenuOpen(false);
                setIsHistoryOpen(false);
              }}
              className={`h-8 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-all ${
                autoBackupsList.length > 0
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400 hover:bg-amber-500/20'
                  : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-muted))]'
              }`}
              title={isZh ? '最近文件与自动备份恢复' : 'Recent Files & Auto-Backup Recovery'}
              aria-label={isZh ? '最近文件与自动备份恢复' : 'Recent Files & Auto-Backup Recovery'}
            >
              <Clock className="w-3.5 h-3.5" />
              <span className="hidden md:inline">{isZh ? '最近与备份' : 'Recent & Backups'}</span>
              {(autoBackupsList.length > 0 || recentFilesList.length > 0) && (
                <span
                  className={`text-[10px] font-bold px-1.5 py-0.2 rounded-full text-white ${
                    autoBackupsList.length > 0 ? 'bg-amber-500' : 'bg-[hsl(var(--color-primary))]'
                  }`}
                >
                  {autoBackupsList.length + recentFilesList.length}
                </span>
              )}
            </button>

            {isRecentBackupOpen && (
              <div
                data-testid="studio-recent-backups-popover"
                className="absolute right-0 top-10 w-80 max-h-[28rem] overflow-y-auto bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-[hsl(var(--color-border))]">
                  <span className="text-xs font-bold text-[hsl(var(--color-foreground))] flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[hsl(var(--color-primary))]" />
                    {isZh ? '最近文件与自动备份' : 'Recent Files & Auto-Backups'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsRecentBackupOpen(false)}
                    className="p-1 rounded-md text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-muted))]"
                    aria-label="Close recent and backups popover"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                {/* Section 1: Recover Auto-Backups */}
                <div className="mb-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <ShieldAlert className="w-3.5 h-3.5" />
                      {isZh ? '自动备份恢复' : 'Recover Auto-Backups'} ({autoBackupsList.length})
                    </span>
                    {autoBackupsList.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAutoBackups}
                        className="text-[10px] text-[hsl(var(--color-muted-foreground))] hover:text-red-500 flex items-center gap-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{isZh ? '清空' : 'Clear'}</span>
                      </button>
                    )}
                  </div>
                  {autoBackupsList.length === 0 ? (
                    <p className="text-[11px] text-[hsl(var(--color-muted-foreground))] py-2 px-2 rounded-lg bg-[hsl(var(--color-muted)/0.3)] text-center">
                      {isZh ? '暂无未保存的自动备份文件' : 'No unsaved auto-backup files'}
                    </p>
                  ) : (
                    <div className="space-y-1.5">
                      {autoBackupsList.map((backup) => (
                        <div
                          key={backup.id}
                          className="p-2 rounded-xl border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-colors flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => handleRecoverAutoBackup(backup.id)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className="text-xs font-semibold text-[hsl(var(--color-foreground))] truncate">
                              {backup.name}
                            </div>
                            <div className="text-[10px] text-[hsl(var(--color-muted-foreground))] flex items-center gap-1.5 mt-0.5">
                              <span>{formatFileSize(backup.modifiedSize)}</span>
                              <span>•</span>
                              <span>{formatDate(backup.updatedAt)}</span>
                              <span>•</span>
                              <span className="text-amber-600 dark:text-amber-400 font-semibold">
                                +{backup.actionCount} {isZh ? '修改' : 'edit(s)'}
                              </span>
                            </div>
                          </button>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              onClick={() => handleRecoverAutoBackup(backup.id)}
                              className="px-2 py-1 rounded-md bg-amber-500 text-white text-[10px] font-semibold hover:bg-amber-600 transition-colors"
                            >
                              {isZh ? '恢复' : 'Recover'}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDownloadAutoBackup(backup.id, e)}
                              className="p-1 rounded-md text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-muted))]"
                              title={isZh ? '直接保存备份文件' : 'Save backup to disk'}
                              aria-label={`Save backup ${backup.name}`}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteAutoBackup(backup.id, e)}
                              className="p-1 rounded-md text-[hsl(var(--color-muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--color-muted))]"
                              title={isZh ? '删除此备份' : 'Delete backup'}
                              aria-label={`Delete backup ${backup.name}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Section 2: Recent Files */}
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-[11px] font-semibold text-[hsl(var(--color-foreground))] flex items-center gap-1">
                      <FolderOpen className="w-3.5 h-3.5 text-[hsl(var(--color-primary))]" />
                      {isZh ? '最近打开的文件' : 'Recent Files'} ({recentFilesList.length})
                    </span>
                    {recentFilesList.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearRecentStudioFiles}
                        className="text-[10px] text-[hsl(var(--color-muted-foreground))] hover:text-red-500 flex items-center gap-0.5"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{isZh ? '清空' : 'Clear'}</span>
                      </button>
                    )}
                  </div>
                  {recentFilesList.length === 0 ? (
                    <p className="text-[11px] text-[hsl(var(--color-muted-foreground))] py-2 px-2 rounded-lg bg-[hsl(var(--color-muted)/0.3)] text-center">
                      {isZh ? '暂无最近文件记录' : 'No recent files'}
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {recentFilesList.map((item) => (
                        <div
                          key={item.id}
                          className="p-2 rounded-xl hover:bg-[hsl(var(--color-muted)/0.6)] transition-colors flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            onClick={() => handleOpenRecentStudioFile(item)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className="text-xs font-medium text-[hsl(var(--color-foreground))] truncate flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-[hsl(var(--color-primary))] shrink-0" />
                              <span className="truncate">{item.name}</span>
                            </div>
                            <div className="text-[10px] text-[hsl(var(--color-muted-foreground))] flex items-center gap-1.5 mt-0.5">
                              <span>{formatFileSize(item.size)}</span>
                              <span>•</span>
                              <span>{formatDate(item.processedAt)}</span>
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleRemoveRecentStudioFile(item.id, item.name, e)}
                            className="p-1 rounded-md text-[hsl(var(--color-muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--color-muted))]"
                            aria-label={`Remove recent ${item.name}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Studio Settings Popover Button */}
          <div className="relative">
            <button
              type="button"
              data-testid="studio-settings-btn"
              onClick={() => {
                setIsSettingsOpen((prev) => !prev);
                setIsRecentBackupOpen(false);
                setIsExportMenuOpen(false);
                setIsHistoryOpen(false);
              }}
              className={`h-8 px-2.5 rounded-lg border text-xs font-medium flex items-center gap-1.5 transition-all ${
                isSettingsOpen
                  ? 'border-[hsl(var(--color-primary))] bg-[hsl(var(--color-primary)/0.1)] text-[hsl(var(--color-primary))]'
                  : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-muted))]'
              }`}
              title={isZh ? 'Studio 设置' : 'Studio Settings'}
              aria-label={isZh ? 'Studio 设置' : 'Studio Settings'}
            >
              <Settings className="w-3.5 h-3.5" />
              <span className="hidden xl:inline">{isZh ? '设置' : 'Settings'}</span>
            </button>

            {isSettingsOpen && (
              <div
                data-testid="studio-settings-popover"
                className="absolute right-0 top-10 w-80 bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-2xl shadow-2xl p-4 z-50 animate-in fade-in zoom-in-95 duration-150"
              >
                <div className="flex items-center justify-between pb-2 mb-3 border-b border-[hsl(var(--color-border))]">
                  <span className="text-xs font-bold text-[hsl(var(--color-foreground))] flex items-center gap-1.5">
                    <Settings className="w-3.5 h-3.5 text-[hsl(var(--color-primary))]" />
                    {isZh ? 'Studio 首选项设置' : 'Studio Preferences'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setIsSettingsOpen(false)}
                    className="p-1 rounded-md text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-muted))]"
                    aria-label="Close studio settings popover"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>

                <div className="space-y-3.5">
                  {/* Option 1: Default tool to open PDF files with */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[hsl(var(--color-foreground))]">
                        {isZh ? '默认打开 PDF 工具' : 'Default Tool for PDF Files'}
                      </div>
                      <p className="text-[11px] text-[hsl(var(--color-muted-foreground))] mt-0.5 leading-relaxed">
                        {isZh
                          ? '从外部或其它页面打开 PDF 文件时，直接在 PDF Studio 中打开。在工具选择页拖放时仍可选择所有工具。'
                          : 'Directly open PDF files in PDF Studio from desktop or other pages. Dropping on the tool selection page still shows all tools.'}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                      <input
                        type="checkbox"
                        data-testid="studio-setting-default-pdf-toggle"
                        checked={isDefaultPdfTool}
                        onChange={(e) => handleToggleDefaultPdfTool(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-[hsl(var(--color-muted))] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[hsl(var(--color-primary))]"></div>
                    </label>
                  </div>

                  {/* Option 2: Default view on application startup */}
                  <div className="flex items-start justify-between gap-3 pt-3 border-t border-[hsl(var(--color-border)/0.6)]">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-[hsl(var(--color-foreground))]">
                        {isZh ? '应用启动时默认进入 Studio' : 'Open Studio on Application Startup'}
                      </div>
                      <p className="text-[11px] text-[hsl(var(--color-muted-foreground))] mt-0.5 leading-relaxed">
                        {isZh
                          ? '启动应用时默认直接进入 PDF Studio 工作台。您可以随时通过顶部按钮切换回经典网格。'
                          : 'Open directly into PDF Studio workspace on startup. You can always go back to the tool selection page anytime.'}
                      </p>
                    </div>
                    <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-0.5">
                      <input
                        type="checkbox"
                        data-testid="studio-setting-default-startup-toggle"
                        checked={isDefaultStartup}
                        onChange={(e) => handleToggleDefaultStartup(e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-9 h-5 bg-[hsl(var(--color-muted))] peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[hsl(var(--color-primary))]"></div>
                    </label>
                  </div>
                </div>
              </div>
            )}
          </div>

          {file ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handlePrint}
                title={isZh ? '打印文档 (Ctrl+P)' : 'Print Document (Ctrl+P)'}
                className="h-8 px-2.5 text-xs gap-1.5"
              >
                <Printer className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isZh ? '打印' : 'Print'}</span>
              </Button>

              {/* Split Export Button */}
              <div className="relative inline-flex items-center shadow-sm rounded-lg">
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleExport}
                  title={isZh ? '导出并保存最终 PDF (Ctrl+S)' : 'Save & Export Final PDF (Ctrl+S)'}
                  className="h-8 px-3 text-xs gap-1.5 rounded-r-none border-r border-white/20"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>{isZh ? '保存导出' : 'Save & Export'}</span>
                </Button>
                <button
                  type="button"
                  onClick={() => setIsExportMenuOpen((prev) => !prev)}
                  className="h-8 px-1.5 rounded-r-lg bg-[hsl(var(--color-primary))] text-white hover:bg-[hsl(var(--color-primary-hover))] transition-colors flex items-center justify-center border-l border-white/20"
                  title={isZh ? '更多导出格式' : 'More Export Formats'}
                  aria-label="More export formats"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>

                {/* Export Dropdown Popover */}
                {isExportMenuOpen && (
                  <div className="absolute right-0 top-10 w-56 bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-xl shadow-2xl p-1.5 z-50 animate-in fade-in zoom-in-95 duration-150">
                    <button
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        handleExport();
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs text-left rounded-lg hover:bg-[hsl(var(--color-muted))] text-[hsl(var(--color-foreground))] font-medium transition-colors"
                    >
                      <Download className="w-3.5 h-3.5 text-[hsl(var(--color-primary))]" />
                      <span>{isZh ? '保存修改后 PDF (Ctrl+S)' : 'Save Edited PDF (Ctrl+S)'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        handleExportTool('pdf-to-docx', {});
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs text-left rounded-lg hover:bg-[hsl(var(--color-muted))] text-[hsl(var(--color-foreground))] font-medium transition-colors"
                    >
                      <FileType className="w-3.5 h-3.5 text-blue-500" />
                      <span>{isZh ? '导出为 Word (.docx)' : 'Export as Word (.docx)'}</span>
                    </button>
                    <button
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        handleExportTool('pdf-to-image', { quality: 90 });
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs text-left rounded-lg hover:bg-[hsl(var(--color-muted))] text-[hsl(var(--color-foreground))] font-medium transition-colors"
                    >
                      <ImageIcon className="w-3.5 h-3.5 text-amber-500" />
                      <span>{isZh ? '导出为图片包 (.zip)' : 'Export as Images (.zip)'}</span>
                    </button>
                    {documents.length > 1 && (
                      <>
                        <div className="my-1 border-t border-[hsl(var(--color-border)/0.5)]" />
                        <button
                          onClick={handleExportAllZip}
                          className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs text-left rounded-lg hover:bg-[hsl(var(--color-muted))] text-emerald-600 dark:text-emerald-400 font-semibold transition-colors"
                        >
                          <Download className="w-3.5 h-3.5" />
                          <span>
                            {isZh
                              ? `打包导出全部文档 (${documents.length}篇 .zip)`
                              : `Export All Documents (${documents.length} files .zip)`}
                          </span>
                        </button>
                      </>
                    )}
                    <div className="my-1 border-t border-[hsl(var(--color-border)/0.5)]" />
                    <button
                      onClick={() => {
                        setIsExportMenuOpen(false);
                        handlePrint();
                      }}
                      className="w-full flex items-center gap-2.5 px-2.5 py-2 text-xs text-left rounded-lg hover:bg-[hsl(var(--color-muted))] text-[hsl(var(--color-foreground))] font-medium transition-colors"
                    >
                      <Printer className="w-3.5 h-3.5 text-zinc-400" />
                      <span>{isZh ? '原生打印 (Ctrl+P)' : 'Native Print (Ctrl+P)'}</span>
                    </button>
                  </div>
                )}
              </div>

              <button
                onClick={() => {
                  if (activeDoc) {
                    handleCloseDocument(activeDoc.id);
                  }
                }}
                className="p-1.5 rounded-lg text-[hsl(var(--color-muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--color-muted))] transition-colors ml-1"
                title={isZh ? '关闭文档' : 'Close document'}
                aria-label="Close file"
              >
                <X className="w-4 h-4" />
              </button>
            </>
          ) : (
            <Link
              href={`/${locale}`}
              onClick={(e) => handleGuardedNavigate(e, `/${locale}`)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[hsl(var(--color-border))] text-xs font-medium text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-muted))] transition-all"
              title={isZh ? '切换到经典工具网格模式' : 'Classic Tool Grid View'}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>{isZh ? '经典网格视图' : 'Classic Grid View'}</span>
            </Link>
          )}
        </div>

        {/* History Timeline Popover */}
        {isHistoryOpen && file && (
          <div className="absolute top-14 left-1/2 -translate-x-1/2 w-80 bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-2xl shadow-2xl p-3 z-50 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-2 mb-2 border-b border-[hsl(var(--color-border))]">
              <div className="flex items-center gap-1.5 text-xs font-bold text-[hsl(var(--color-foreground))]">
                <History className="w-3.5 h-3.5 text-[hsl(var(--color-primary))]" />
                <span>{isZh ? '操作历史时间线' : 'Operation Timeline'}</span>
              </div>
              <button
                onClick={() => setIsHistoryOpen(false)}
                className="p-1 rounded-md text-[hsl(var(--color-muted-foreground))] hover:bg-[hsl(var(--color-muted))]"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <div className="space-y-1.5 max-h-64 overflow-y-auto">
              <div className="flex items-center justify-between p-2 rounded-xl text-xs bg-[hsl(var(--color-muted)/0.3)]">
                <div className="flex items-center gap-2 truncate">
                  <FileText className="w-3.5 h-3.5 text-[hsl(var(--color-muted-foreground))] shrink-0" />
                  <span className="truncate font-medium">{file.name} ({isZh ? '初始' : 'Original'})</span>
                </div>
                {historyStack.length > 0 && (
                  <button
                    onClick={handleRevert}
                    className="text-[10px] text-[hsl(var(--color-primary))] font-semibold hover:underline"
                  >
                    {isZh ? '还原' : 'Revert'}
                  </button>
                )}
              </div>
              {historyStack.map((item, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between p-2 rounded-xl text-xs bg-[hsl(var(--color-muted)/0.5)] border border-[hsl(var(--color-border)/0.4)]"
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="w-4 h-4 rounded-full bg-[hsl(var(--color-primary)/0.2)] text-[hsl(var(--color-primary))] text-[10px] font-bold flex items-center justify-center shrink-0">
                      {idx + 1}
                    </span>
                    <span className="truncate font-semibold text-[hsl(var(--color-foreground))]">
                      {item.action}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </header>

      {/* Multi-Document Tabs Bar */}
      {documents.length > 0 && (
        <div className="h-10 flex-shrink-0 border-b border-[hsl(var(--color-border)/0.8)] bg-[hsl(var(--color-muted)/0.35)] px-3 flex items-center justify-between z-20">
          {/* Scrollable Document Tabs */}
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none py-1 flex-1 min-w-0 mr-2">
            {documents.map((doc) => {
              const isActive = doc.id === activeDoc?.id;
              const isModified = isDocModified(doc);
              return (
                <div
                  key={doc.id}
                  onClick={() => handleSelectDocument(doc.id)}
                  className={`group flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium cursor-pointer transition-all border shrink-0 max-w-[220px] select-none ${
                    isActive
                      ? 'bg-[hsl(var(--color-card))] text-[hsl(var(--color-primary))] border-[hsl(var(--color-border))] shadow-xs font-semibold'
                      : 'bg-transparent text-[hsl(var(--color-muted-foreground))] border-transparent hover:bg-[hsl(var(--color-card)/0.6)] hover:text-[hsl(var(--color-foreground))]'
                  }`}
                  title={isZh ? `文档: ${doc.name}${isModified ? ' (已修改)' : ''}` : `Document: ${doc.name}${isModified ? ' (Modified)' : ''}`}
                >
                  <FileText
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isActive ? 'text-[hsl(var(--color-primary))]' : 'text-[hsl(var(--color-muted-foreground))]'
                    }`}
                  />
                  <span className="truncate">{doc.name}</span>
                  {isModified && (
                    <span
                      data-testid={`unsaved-indicator-${doc.name}`}
                      className="w-1.5 h-1.5 rounded-full bg-[hsl(var(--color-primary))] shrink-0"
                      title={isZh ? '有尚未保存的修改' : 'Unsaved changes'}
                    />
                  )}
                  <button
                    type="button"
                    onClick={(e) => handleCloseDocument(doc.id, e)}
                    className="p-0.5 rounded-md hover:bg-[hsl(var(--color-muted))] text-[hsl(var(--color-muted-foreground))] hover:text-red-500 opacity-60 group-hover:opacity-100 transition-all ml-0.5"
                    title={isZh ? '关闭文档' : 'Close document'}
                    aria-label={`Close ${doc.name}`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {/* Right Action: Import More Documents */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => multiFileInputRef.current?.click()}
              className="flex items-center gap-1 px-2.5 py-1 rounded-lg border border-dashed border-[hsl(var(--color-border))] hover:border-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary)/0.08)] text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-primary))] text-xs font-medium transition-all"
              title={isZh ? '打开或导入更多 PDF (支持多选)' : 'Open or import more PDFs (multi-select)'}
            >
              <Plus className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{isZh ? '导入更多 PDF' : 'Import More PDFs'}</span>
            </button>
            <input
              ref={multiFileInputRef}
              type="file"
              multiple
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleAddFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />
            {documents.length > 1 && (
              <span className="text-[10px] font-medium text-[hsl(var(--color-muted-foreground))] px-1.5 py-0.5 rounded bg-[hsl(var(--color-muted))]">
                {isZh ? `共 ${documents.length} 个文档` : `${documents.length} Documents`}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main Workspace Body */}
      <div className="flex-1 flex overflow-hidden relative">
        {file && pdfUrl ? (
          <>
            {/* Left Rail Toolbar */}
            <StudioLeftRail
              activeToolId={activeToolId}
              onSelectTool={setActiveToolId}
              isCollapsed={isSidebarCollapsed}
              onToggleCollapse={toggleSidebarCollapse}
              disabled={isApplying}
              locale={validLocale}
              onQuickApply={(toolId) => handleApplyTool(toolId, {})}
            />

            {/* Center: Single Seamless PDF Viewer + In-Memory OCR Results Bar */}
            <main className="flex-1 flex flex-col relative bg-zinc-900/10 dark:bg-black/40 overflow-hidden">
              {ocrMeta && (
                <div
                  data-testid="studio-ocr-memory-bar"
                  className="flex-shrink-0 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card)/0.95)] backdrop-blur-md px-3 py-2 flex flex-wrap items-center justify-between gap-2 z-20"
                >
                  <div className="flex items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-bold text-[11px]">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      {isZh ? 'OCR 已在内存中打开' : 'OCR Open in Memory'}
                    </span>
                    <span className="text-[11px] text-[hsl(var(--color-muted-foreground))]">
                      {ocrMeta.totalWords ?? 0} {isZh ? '词' : 'words'} • {ocrMeta.avgConfidence ?? 92}% {isZh ? '置信度' : 'confidence'}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setIsOcrTextOpen((prev) => !prev)}
                      className={`px-2.5 py-1 rounded-lg border text-xs font-medium transition-all ${
                        isOcrTextOpen
                          ? 'border-[hsl(var(--color-primary))] bg-[hsl(var(--color-primary)/0.12)] text-[hsl(var(--color-primary))] font-semibold'
                          : 'border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-muted))]'
                      }`}
                    >
                      {isOcrTextOpen
                        ? isZh
                          ? '查看可搜索 PDF'
                          : 'View Searchable PDF'
                        : isZh
                        ? '预览识别文本'
                        : 'Preview Extracted Text'}
                    </button>

                    <select
                      aria-label={isZh ? 'OCR 导出格式' : 'OCR Export Format'}
                      value={ocrExportFormat}
                      onChange={(e) => setOcrExportFormat(e.target.value)}
                      className="px-2 py-1 rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-background))] text-xs text-[hsl(var(--color-foreground))]"
                    >
                      <option value="searchable-pdf">{isZh ? '可搜索 PDF (.pdf)' : 'Searchable PDF (.pdf)'}</option>
                      <option value="docx">{isZh ? 'Word 文档 (.docx)' : 'Word (.docx)'}</option>
                      <option value="text">{isZh ? '纯文本 (.txt)' : 'Plain Text (.txt)'}</option>
                      <option value="markdown">{isZh ? 'Markdown (.md)' : 'Markdown (.md)'}</option>
                      <option value="json">{isZh ? 'JSON 数据 (.json)' : 'JSON Data (.json)'}</option>
                    </select>

                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleSaveOcrResult()}
                      className="h-7 px-2.5 text-xs gap-1"
                    >
                      <Download className="w-3.5 h-3.5" />
                      <span>{isZh ? '满意并保存导出' : 'Save & Export OCR'}</span>
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex-1 relative overflow-hidden">
                <iframe
                  ref={iframeRef}
                  src={withBasePath(`/pdfjs-viewer/viewer.html?file=${encodeURIComponent(pdfUrl)}`)}
                  className="w-full h-full border-0 absolute inset-0"
                  title={file.name}
                />

                {/* In-Memory Extracted Text / Markdown / JSON Preview Overlay */}
                {ocrMeta && isOcrTextOpen && (
                  <div className="absolute inset-0 bg-[hsl(var(--color-background)/0.96)] backdrop-blur-md z-10 flex flex-col p-4 overflow-hidden animate-in fade-in duration-150">
                    <div className="flex items-center justify-between pb-3 mb-3 border-b border-[hsl(var(--color-border))]">
                      <div className="flex items-center gap-2">
                        <FileText className="w-4 h-4 text-[hsl(var(--color-primary))]" />
                        <span className="text-xs font-bold text-[hsl(var(--color-foreground))]">
                          {isZh ? '内存 OCR 文本预览 (未保存至磁盘)' : 'In-Memory OCR Text Preview (Not saved to disk yet)'}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={async () => {
                            const textToCopy =
                              ocrExportFormat === 'markdown'
                                ? ocrMeta.markdownText
                                : ocrExportFormat === 'json'
                                ? ocrMeta.jsonText
                                : ocrMeta.rawText;
                            if (!textToCopy) return;
                            try {
                              await navigator.clipboard.writeText(textToCopy);
                              setOcrCopied(true);
                              setTimeout(() => setOcrCopied(false), 2000);
                            } catch {}
                          }}
                          className="px-2.5 py-1 rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] hover:bg-[hsl(var(--color-muted))] text-xs font-medium text-[hsl(var(--color-foreground))]"
                        >
                          {ocrCopied ? (isZh ? '已复制 ✓' : 'Copied ✓') : isZh ? '复制文本' : 'Copy Text'}
                        </button>
                        <button
                          type="button"
                          onClick={() => setIsOcrTextOpen(false)}
                          className="px-2.5 py-1 rounded-lg border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted))] text-xs text-[hsl(var(--color-muted-foreground))]"
                        >
                          {isZh ? '返回 PDF 预览' : 'Back to PDF View'}
                        </button>
                      </div>
                    </div>
                    <pre className="flex-1 p-4 rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-muted)/0.3)] overflow-auto text-xs font-mono text-[hsl(var(--color-foreground))] whitespace-pre-wrap leading-relaxed select-text">
                      {ocrExportFormat === 'markdown'
                        ? ocrMeta.markdownText || ocrMeta.rawText
                        : ocrExportFormat === 'json'
                        ? ocrMeta.jsonText || ocrMeta.rawText
                        : ocrMeta.rawText || (isZh ? '(未检测到文本)' : '(No text detected)')}
                    </pre>
                  </div>
                )}

                {/* Processing Overlay Feedback */}
                {isApplying && (
                  <div
                    data-testid="studio-processing-overlay"
                    className="absolute inset-0 bg-background/60 backdrop-blur-xs z-30 flex flex-col items-center justify-center animate-in fade-in duration-200"
                  >
                    <div className="flex flex-col items-center gap-3 p-6 rounded-2xl bg-[hsl(var(--color-card)/0.95)] border border-[hsl(var(--color-border))] shadow-2xl min-w-[280px] max-w-sm w-full mx-4">
                      <Loader2 className="w-8 h-8 text-[hsl(var(--color-primary))] animate-spin" />
                      <div className="text-center w-full">
                        <div className="flex items-center justify-between gap-3 mb-1.5">
                          <p className="text-xs font-bold text-[hsl(var(--color-foreground))] truncate flex-1 text-left">
                            {applyProgressMessage || (isZh ? '正在就地处理文档...' : 'Processing document in-place...')}
                          </p>
                          <span className="text-xs font-bold text-[hsl(var(--color-primary))] shrink-0">
                            {Math.round(applyProgress)}%
                          </span>
                        </div>
                        {/* Progress bar */}
                        <div className="w-full h-1.5 bg-[hsl(var(--color-muted))] rounded-full overflow-hidden mb-2">
                          <div
                            className="h-full bg-[hsl(var(--color-primary))] transition-all duration-200 ease-out rounded-full"
                            style={{ width: `${Math.max(0, Math.min(100, applyProgress))}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-[hsl(var(--color-muted-foreground))] mb-3">
                          {isZh ? '100% 浏览器内存安全运行，零网络上传' : '100% Client-side safe, zero network upload'}
                        </p>
                        {/* Cancel Button */}
                        <button
                          type="button"
                          onClick={handleCancelOperation}
                          data-testid="studio-processing-cancel-btn"
                          className="inline-flex items-center justify-center px-4 py-1.5 text-xs font-medium text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-muted)/0.5)] rounded-lg transition-colors border border-[hsl(var(--color-border)/0.8)] cursor-pointer"
                        >
                          {isZh ? '取消操作' : 'Cancel Operation'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </main>

            {/* Right: Context Tool Parameter Drawer */}
            <StudioToolDrawer
              toolId={activeToolId}
              onClose={() => setActiveToolId(null)}
              onApply={(tid: StudioToolId, opts: Record<string, any>) => handleApplyTool(tid, opts)}
              onExport={(tid: StudioToolId, opts: Record<string, any>) => handleExportTool(tid, opts)}
              isApplying={isApplying}
              applyProgress={applyProgress}
              applyProgressMessage={applyProgressMessage}
              locale={validLocale}
              availableDocuments={availableDocuments}
            />
          </>
        ) : (
          /* Empty Workspace Welcome & Import Screen */
          <div
            onDragOver={(e) => e.preventDefault()}
            onDrop={handleDrop}
            className="flex-1 flex flex-col items-center justify-center p-6 text-center overflow-y-auto"
          >
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="application/pdf,.pdf"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files.length > 0) {
                  handleAddFiles(e.target.files);
                  e.target.value = '';
                }
              }}
            />

            <div className="max-w-md w-full p-8 rounded-3xl border-2 border-dashed border-[hsl(var(--color-border))] bg-[hsl(var(--color-card)/0.4)] backdrop-blur-md flex flex-col items-center shadow-xl hover:border-[hsl(var(--color-primary))] transition-all duration-300 group">
              <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-[hsl(var(--color-primary)/0.2)] to-[hsl(var(--color-accent))] text-[hsl(var(--color-primary))] flex items-center justify-center mb-6 group-hover:scale-110 transition-transform">
                <Upload className="w-8 h-8" />
              </div>

              <h2 className="text-xl font-bold text-[hsl(var(--color-foreground))] mb-2">
                {isZh ? '导入 PDF 开启 Studio 工作台' : 'Import PDF to Launch Studio Workspace'}
              </h2>
              <p className="text-xs text-[hsl(var(--color-muted-foreground))] mb-6 leading-relaxed">
                {isZh
                  ? '无需在不同工具页面反复跳转和重新上传。在单一视图中就地旋转、加水印、压缩、签名、提取页面，一气呵成。'
                  : 'No more jumping between tools or re-uploading. Rotate, watermark, compress, sign, and organize pages seamlessly in a single in-place view.'}
              </p>

              <div className="flex flex-col sm:flex-row gap-3 w-full">
                <Button
                  variant="primary"
                  size="md"
                  onClick={() => fileInputRef.current?.click()}
                  className="flex-1 gap-2 shadow-lg shadow-[hsl(var(--color-primary)/0.2)] text-xs font-semibold py-2.5"
                >
                  <FileText className="w-4 h-4" />
                  <span>{isZh ? '选择 PDF 文件 (支持多选)' : 'Select PDF Files (Multi-Select)'}</span>
                </Button>

                <Link
                  href={`/${locale}`}
                  className="flex-1 flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl border border-[hsl(var(--color-border))] text-xs font-semibold text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-muted))] transition-all"
                >
                  <LayoutGrid className="w-4 h-4" />
                  <span>{isZh ? '返回所有工具' : 'Back to All Tools'}</span>
                </Link>
              </div>

              <div className="mt-4 pt-3 border-t border-[hsl(var(--color-border)/0.5)] w-full flex flex-col sm:flex-row items-center justify-center gap-3 text-xs text-[hsl(var(--color-muted-foreground))]">
                <label className="inline-flex items-center gap-2 cursor-pointer hover:text-[hsl(var(--color-foreground))] transition-colors select-none">
                  <input
                    type="checkbox"
                    data-testid="studio-welcome-default-pdf-toggle"
                    checked={isDefaultPdfTool}
                    onChange={(e) => handleToggleDefaultPdfTool(e.target.checked)}
                    className="rounded border-[hsl(var(--color-border))] text-[hsl(var(--color-primary))] focus:ring-[hsl(var(--color-primary))]"
                  />
                  <span>{isZh ? '设为默认打开 PDF 的工具' : 'Set as default tool to open PDF files'}</span>
                </label>
                <span className="hidden sm:inline text-[hsl(var(--color-border))]">•</span>
                <label className="inline-flex items-center gap-2 cursor-pointer hover:text-[hsl(var(--color-foreground))] transition-colors select-none">
                  <input
                    type="checkbox"
                    data-testid="studio-welcome-default-startup-toggle"
                    checked={isDefaultStartup}
                    onChange={(e) => handleToggleDefaultStartup(e.target.checked)}
                    className="rounded border-[hsl(var(--color-border))] text-[hsl(var(--color-primary))] focus:ring-[hsl(var(--color-primary))]"
                  />
                  <span>{isZh ? '应用启动时默认进入 Studio' : 'Open Studio on application startup'}</span>
                </label>
              </div>

              <div className="mt-4 flex items-center gap-4 text-[11px] text-[hsl(var(--color-muted-foreground)/0.7)]">
                <span>{isZh ? '支持拖拽多个 PDF 至此' : 'Drag & drop multiple PDFs here'}</span>
                <span>•</span>
                <span>{isZh ? '全本地纯离线处理' : '100% Offline & Private'}</span>
                <span>•</span>
                <span>{isZh ? '多标签快速切换' : 'Multi-Tab Document Switch'}</span>
              </div>
            </div>

            {/* Recent Files & Recover Auto-Backup Lists on Welcome Screen */}
            {(autoBackupsList.length > 0 || recentFilesList.length > 0) && (
              <div className="max-w-3xl w-full mt-6 grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
                {/* Auto-Backup Recovery List */}
                <div
                  data-testid="studio-auto-backup-list"
                  className="p-4 rounded-2xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card)/0.7)] backdrop-blur-md shadow-sm flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <ShieldAlert className="w-4 h-4 text-amber-500" />
                      <h3 className="text-xs font-bold text-[hsl(var(--color-foreground))]">
                        {isZh ? '恢复自动备份文件' : 'Recover Auto-Backup Files'}
                      </h3>
                      {autoBackupsList.length > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
                          {autoBackupsList.length}
                        </span>
                      )}
                    </div>
                    {autoBackupsList.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearAutoBackups}
                        className="text-[11px] text-[hsl(var(--color-muted-foreground))] hover:text-red-500 flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{isZh ? '清空备份' : 'Clear All'}</span>
                      </button>
                    )}
                  </div>

                  {autoBackupsList.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-6 text-xs text-[hsl(var(--color-muted-foreground))]">
                      {isZh ? '暂无待恢复的自动备份文件' : 'No auto-backup files to recover'}
                    </div>
                  ) : (
                    <ul className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {autoBackupsList.map((backup) => (
                        <li
                          key={backup.id}
                          className="p-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10 transition-all flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-semibold text-[hsl(var(--color-foreground))] truncate">
                              {backup.name}
                            </div>
                            <div className="text-[11px] text-[hsl(var(--color-muted-foreground))] flex items-center gap-1.5 mt-0.5">
                              <span>{formatFileSize(backup.modifiedSize)}</span>
                              <span>•</span>
                              <span>{formatDate(backup.updatedAt)}</span>
                              <span>•</span>
                              <span className="text-amber-600 dark:text-amber-400 font-medium">
                                +{backup.actionCount} {isZh ? '项修改' : 'edit(s)'} ({backup.lastAction})
                              </span>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              data-testid={`recover-backup-${backup.id}`}
                              onClick={() => handleRecoverAutoBackup(backup.id)}
                              className="px-2.5 py-1 rounded-lg bg-amber-500 hover:bg-amber-600 text-white text-xs font-semibold transition-colors"
                            >
                              {isZh ? '恢复' : 'Recover'}
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDownloadAutoBackup(backup.id, e)}
                              className="p-1.5 rounded-lg text-[hsl(var(--color-muted-foreground))] hover:text-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-muted))] transition-colors"
                              title={isZh ? '直接保存备份' : 'Save backup'}
                              aria-label={`Save backup ${backup.name}`}
                            >
                              <Download className="w-3.5 h-3.5" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => handleDeleteAutoBackup(backup.id, e)}
                              className="p-1.5 rounded-lg text-[hsl(var(--color-muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--color-muted))] transition-colors"
                              title={isZh ? '删除备份' : 'Delete backup'}
                              aria-label={`Delete backup ${backup.name}`}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                {/* Recent Files List */}
                <div
                  data-testid="studio-recent-files-list"
                  className="p-4 rounded-2xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card)/0.7)] backdrop-blur-md shadow-sm flex flex-col"
                >
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-[hsl(var(--color-primary))]" />
                      <h3 className="text-xs font-bold text-[hsl(var(--color-foreground))]">
                        {isZh ? '最近打开的文件' : 'Recent Files'}
                      </h3>
                      {recentFilesList.length > 0 && (
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[hsl(var(--color-primary)/0.15)] text-[hsl(var(--color-primary))]">
                          {recentFilesList.length}
                        </span>
                      )}
                    </div>
                    {recentFilesList.length > 0 && (
                      <button
                        type="button"
                        onClick={handleClearRecentStudioFiles}
                        className="text-[11px] text-[hsl(var(--color-muted-foreground))] hover:text-red-500 flex items-center gap-1 transition-colors"
                      >
                        <Trash2 className="w-3 h-3" />
                        <span>{isZh ? '清空记录' : 'Clear All'}</span>
                      </button>
                    )}
                  </div>

                  {recentFilesList.length === 0 ? (
                    <div className="flex-1 flex items-center justify-center py-6 text-xs text-[hsl(var(--color-muted-foreground))]">
                      {isZh ? '暂无最近打开的文件' : 'No recent files'}
                    </div>
                  ) : (
                    <ul className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                      {recentFilesList.map((recent) => (
                        <li
                          key={recent.id}
                          className="p-2 rounded-xl border border-transparent hover:border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-muted)/0.5)] transition-all flex items-center justify-between gap-2"
                        >
                          <button
                            type="button"
                            data-testid={`open-recent-${recent.name}`}
                            onClick={() => handleOpenRecentStudioFile(recent)}
                            className="flex-1 min-w-0 text-left"
                          >
                            <div className="text-xs font-medium text-[hsl(var(--color-foreground))] truncate flex items-center gap-1.5">
                              <FileText className="w-3.5 h-3.5 text-[hsl(var(--color-primary))] shrink-0" />
                              <span className="truncate">{recent.name}</span>
                            </div>
                            <div className="text-[11px] text-[hsl(var(--color-muted-foreground))] flex items-center gap-1.5 mt-0.5">
                              <span>{formatFileSize(recent.size)}</span>
                              <span>•</span>
                              <span>{formatDate(recent.processedAt)}</span>
                              {recent.toolName && (
                                <>
                                  <span>•</span>
                                  <span>{recent.toolName}</span>
                                </>
                              )}
                            </div>
                          </button>
                          <button
                            type="button"
                            onClick={(e) => handleRemoveRecentStudioFile(recent.id, recent.name, e)}
                            className="p-1.5 rounded-lg text-[hsl(var(--color-muted-foreground))] hover:text-red-500 hover:bg-[hsl(var(--color-muted))] transition-colors shrink-0"
                            aria-label={`Remove recent ${recent.name}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Unsaved Changes Confirmation Modal */}
      {pendingCloseAction && (
        <div
          data-testid="unsaved-changes-modal"
          role="dialog"
          aria-modal="true"
          aria-labelledby="unsaved-changes-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-xs p-4 animate-in fade-in duration-150"
        >
          <div className="w-full max-w-md rounded-2xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] p-6 shadow-2xl">
            <div className="flex items-start gap-3">
              <div className="p-2.5 rounded-xl bg-amber-500/15 text-amber-500 shrink-0">
                <AlertCircle className="w-6 h-6" />
              </div>
              <div className="flex-1 min-w-0">
                <h3
                  id="unsaved-changes-title"
                  className="text-base font-bold text-[hsl(var(--color-foreground))]"
                >
                  {isZh ? '是否先保存您的修改？' : 'Save Changes Before Closing?'}
                </h3>
                <p className="mt-1.5 text-xs text-[hsl(var(--color-muted-foreground))] leading-relaxed">
                  {pendingCloseAction.type === 'close-doc'
                    ? isZh
                      ? `文档「${pendingCloseAction.docName}」有未保存的更改。在关闭前是否要先保存您的修改？`
                      : `Document "${pendingCloseAction.docName}" has unsaved changes. Would you like to save your changes before closing?`
                    : isZh
                    ? `当前有 ${documents.filter(isDocModified).length} 个已修改的文档尚未保存。在离开前是否要先保存您的修改？`
                    : `You have ${documents.filter(isDocModified).length} modified document(s) with unsaved changes. Would you like to save your changes first?`}
                </p>
                <p className="mt-2 text-[11px] text-amber-600 dark:text-amber-400 flex items-center gap-1">
                  <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                  <span>
                    {isZh
                      ? '已为您自动备份修改内容，以防意外关闭丢失。'
                      : 'Modified files are also auto-backed up in case of unexpected closure.'}
                  </span>
                </p>
              </div>
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                data-testid="unsaved-modal-cancel"
                onClick={() => setPendingCloseAction(null)}
                className="text-xs"
              >
                {isZh ? '取消' : 'Cancel'}
              </Button>
              <Button
                variant="outline"
                size="sm"
                data-testid="unsaved-modal-discard"
                onClick={handleConfirmDiscardAndClose}
                className="text-xs text-red-600 hover:text-red-700 border-red-500/30 hover:bg-red-500/10"
              >
                {isZh ? '不保存直接关闭' : "Don't Save"}
              </Button>
              <Button
                variant="primary"
                size="sm"
                data-testid="unsaved-modal-save"
                onClick={handleConfirmSaveAndClose}
                className="text-xs gap-1.5"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isZh ? '保存并关闭' : 'Save & Close'}</span>
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Tool Selection Modal for Non-PDF Files */}
      <ToolSelectionModal
        isOpen={isToolModalOpen}
        onClose={() => setIsToolModalOpen(false)}
        files={toolModalFiles}
        tools={toolModalTools}
        locale={validLocale}
        onSelectTool={handleSelectToolForDroppedFiles}
      />

      {/* Toast Notification */}
      {notification && (
        <div
          role="status"
          className={`fixed bottom-6 right-6 px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2.5 text-xs font-medium z-50 animate-in fade-in slide-in-from-bottom-4 duration-300 ${
            notification.type === 'success'
              ? 'bg-emerald-600 text-white shadow-emerald-600/20'
              : 'bg-red-600 text-white shadow-red-600/20'
          }`}
        >
          {notification.type === 'success' ? (
            <CheckCircle2 className="w-4 h-4 flex-shrink-0" />
          ) : (
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
          )}
          <span>{notification.message}</span>
        </div>
      )}
    </div>
  );
};
