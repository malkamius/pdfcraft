'use client';

import React, { useState, useCallback, useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import type { Tool } from '@/types/tool';
import { getToolBySlug } from '@/config/tools';
import {
  getCompatibleToolsForFiles,
  filterFilesForTool,
  doesToolSupportFile,
  setPendingDroppedFiles,
  registerGlobalFileDropRouter,
  isPdfFile,
} from '@/lib/utils/file-tool-router';
import { isStudioDefaultPdfTool } from '@/lib/storage/default-tool';
import { ToolSelectionModal } from './ToolSelectionModal';
import {
  getCliOpenFiles,
  listenForOpenFiles,
  createFilesFromFilePaths,
} from '@/lib/tauri-bridge';

export interface GlobalFileDropHandlerProps {
  locale: string;
}

export const GlobalFileDropHandler: React.FC<GlobalFileDropHandlerProps> = ({ locale }) => {
  const router = useRouter();
  const pathname = usePathname();
  const [modalFiles, setModalFiles] = useState<File[]>([]);
  const [modalTools, setModalTools] = useState<Tool[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);

  const openToolWithFiles = useCallback(
    (tool: Tool, filesToLoad: File[]) => {
      setIsModalOpen(false);
      setPendingDroppedFiles(filesToLoad, tool.slug);
      router.push(`/${locale}/tools/${tool.slug}`);
    },
    [locale, router]
  );

  const openStudioWithFiles = useCallback(
    (pdfFiles: File[]) => {
      setIsModalOpen(false);
      setPendingDroppedFiles(pdfFiles, 'studio');
      router.push(`/${locale}/studio`);
    },
    [locale, router]
  );

  const handleRoutedFiles = useCallback(
    (incomingFiles: File[], source: 'cli-open' | 'drop' = 'drop') => {
      if (!incomingFiles || incomingFiles.length === 0) return;

      const compatibleTools = getCompatibleToolsForFiles(incomingFiles);
      if (compatibleTools.length === 0) return;

      const areAllPdfs = incomingFiles.length > 0 && incomingFiles.every((f) => isPdfFile(f));
      const isToolSelectionPage =
        !pathname ||
        pathname === '/' ||
        pathname === `/${locale}` ||
        pathname === `/${locale}/`;

      // If a PDF is dropped onto the tool selection page, it should always show the tool list that supports PDF.
      // Otherwise, if PDF Studio is set as the default tool to open PDF files with, route directly to Studio.
      const shouldBypassToStudio =
        isStudioDefaultPdfTool() &&
        areAllPdfs &&
        (source === 'cli-open' || !isToolSelectionPage);

      if (shouldBypassToStudio) {
        openStudioWithFiles(incomingFiles);
        return;
      }

      if (compatibleTools.length === 1) {
        const targetTool = compatibleTools[0];
        const validFiles = filterFilesForTool(incomingFiles, targetTool);
        openToolWithFiles(targetTool, validFiles);
        return;
      }

      setModalFiles(incomingFiles);
      setModalTools(compatibleTools);
      setIsModalOpen(true);
    },
    [locale, pathname, openStudioWithFiles, openToolWithFiles]
  );

  // Handle files passed via Windows "Open with" / command line / file association
  useEffect(() => {
    let unlisten: (() => void) | null = null;
    let isSubscribed = true;

    const loadPathsAndRoute = async (paths: string[]) => {
      if (!isSubscribed || !paths || paths.length === 0) return;
      try {
        const files = await createFilesFromFilePaths(paths);
        if (isSubscribed && files.length > 0) {
          handleRoutedFiles(files, 'cli-open');
        }
      } catch (err) {
        console.error('Failed to process opened files from Windows/CLI:', err);
      }
    };

    // 1. Initial files passed when the application was launched via "Open with"
    getCliOpenFiles().then((initialPaths) => {
      if (isSubscribed && initialPaths && initialPaths.length > 0) {
        loadPathsAndRoute(initialPaths);
      }
    });

    // 2. Files passed while the application is already running
    listenForOpenFiles((paths) => {
      loadPathsAndRoute(paths);
    }).then((cleanup) => {
      unlisten = cleanup;
    });

    return () => {
      isSubscribed = false;
      if (unlisten) {
        unlisten();
      }
    };
  }, [handleRoutedFiles]);

  // Register as the global file drop router for child components (like FileUploader)
  useEffect(() => {
    return registerGlobalFileDropRouter((files) => handleRoutedFiles(files, 'drop'));
  }, [handleRoutedFiles]);

  // Handle window-level drops outside specific dropzones
  useEffect(() => {
    const handleWindowDragOver = (e: DragEvent) => {
      const hasFiles =
        e.dataTransfer &&
        e.dataTransfer.types &&
        Array.from(e.dataTransfer.types).includes('Files');
      if (hasFiles) {
        e.preventDefault();
      }
    };

    const handleWindowDrop = (e: DragEvent) => {
      const files = e.dataTransfer?.files;
      if (!files || files.length === 0) return;

      e.preventDefault();
      const fileArray = Array.from(files);

      // If currently on a specific tool page and that tool supports all dropped files,
      // pass them directly to the current tool's FileUploader
      const toolMatch = pathname?.match(/\/tools\/([^/?#]+)/);
      if (toolMatch?.[1]) {
        const currentTool = getToolBySlug(toolMatch[1]);
        if (currentTool && fileArray.every((f) => doesToolSupportFile(currentTool, f))) {
          setPendingDroppedFiles(fileArray, currentTool.slug);
          return;
        }
      }

      handleRoutedFiles(fileArray, 'drop');
    };

    window.addEventListener('dragover', handleWindowDragOver);
    window.addEventListener('drop', handleWindowDrop);
    return () => {
      window.removeEventListener('dragover', handleWindowDragOver);
      window.removeEventListener('drop', handleWindowDrop);
    };
  }, [pathname, handleRoutedFiles]);

  const isOnStudioPage = Boolean(pathname?.includes('/studio'));

  return (
    <ToolSelectionModal
      isOpen={isModalOpen}
      onClose={() => setIsModalOpen(false)}
      files={modalFiles}
      tools={modalTools}
      locale={locale}
      onSelectTool={openToolWithFiles}
      onOpenInStudio={openStudioWithFiles}
      showStudioOption={true}
    />
  );
};
