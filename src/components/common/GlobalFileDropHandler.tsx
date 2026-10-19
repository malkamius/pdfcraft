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
} from '@/lib/utils/file-tool-router';
import { ToolSelectionModal } from './ToolSelectionModal';

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
    (incomingFiles: File[]) => {
      if (!incomingFiles || incomingFiles.length === 0) return;

      const compatibleTools = getCompatibleToolsForFiles(incomingFiles);
      if (compatibleTools.length === 0) return;

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
    [openToolWithFiles]
  );

  // Register as the global file drop router for child components (like FileUploader)
  useEffect(() => {
    return registerGlobalFileDropRouter(handleRoutedFiles);
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

      handleRoutedFiles(fileArray);
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
      showStudioOption={!isOnStudioPage}
    />
  );
};
