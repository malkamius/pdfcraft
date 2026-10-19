/**
 * Auto-Backup & Recent File Blob Storage
 *
 * Automatically backs up modified PDF documents in Studio so they can be recovered
 * if the application or browser closes unexpectedly while modified files are open.
 * Also caches recent file blobs for one-click reopening.
 */

export interface AutoBackupMetadata {
  id: string;
  name: string;
  originalSize: number;
  modifiedSize: number;
  createdAt: string;
  updatedAt: string;
  lastAction: string;
  actionCount: number;
  historyActions: string[];
  ocrMetadata?: Record<string, any> | null;
}

export interface AutoBackupEntry extends AutoBackupMetadata {
  blob: Blob;
  originalBlob?: Blob;
}

const META_STORAGE_KEY = 'pdfcraft_auto_backups_meta';
const BLOB_FALLBACK_PREFIX = 'pdfcraft_auto_backup_blob_';
const RECENT_BLOB_FALLBACK_PREFIX = 'pdfcraft_recent_blob_';
const DB_NAME = 'pdfcraft_studio_storage';
const DB_VERSION = 1;
const STORE_BACKUPS = 'auto_backups';
const STORE_RECENT_BLOBS = 'recent_file_blobs';
const MAX_AUTO_BACKUPS = 10;
const MAX_RECENT_BLOBS = 10;
const MAX_LOCALSTORAGE_BLOB_BYTES = 1.5 * 1024 * 1024; // 1.5 MB fallback threshold

interface MemoryBackupRecord {
  metadata: AutoBackupMetadata;
  blob: Blob;
  originalBlob?: Blob;
}

const memoryAutoBackups = new Map<string, MemoryBackupRecord>();
const memoryRecentBlobs = new Map<string, Blob>();
let pendingStudioRecoveryId: string | null = null;

/**
 * Queue an auto-backup ID to be automatically recovered when PDFStudio mounts
 */
export function setPendingStudioRecoveryId(id: string | null): void {
  pendingStudioRecoveryId = id;
}

/**
 * Consume any queued auto-backup ID when PDFStudio mounts
 */
export function consumePendingStudioRecoveryId(): string | null {
  const id = pendingStudioRecoveryId;
  pendingStudioRecoveryId = null;
  return id;
}

function isLocalStorageAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const testKey = '__autobackup_test__';
    window.localStorage.setItem(testKey, testKey);
    window.localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

function isIndexedDBAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return typeof window.indexedDB !== 'undefined' && window.indexedDB !== null;
  } catch {
    return false;
  }
}

function openStudioDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!isIndexedDBAvailable()) {
      reject(new Error('IndexedDB not available'));
      return;
    }

    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onerror = () => {
        reject(new Error('Failed to open auto-backup IndexedDB'));
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_BACKUPS)) {
          db.createObjectStore(STORE_BACKUPS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_RECENT_BLOBS)) {
          db.createObjectStore(STORE_RECENT_BLOBS, { keyPath: 'name' });
        }
      };
    } catch (err) {
      reject(err);
    }
  });
}

async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  if (typeof blob.arrayBuffer === 'function') {
    const buf = await blob.arrayBuffer();
    return new Uint8Array(buf);
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(new Uint8Array(reader.result));
      } else {
        reject(new Error('Failed to read blob as ArrayBuffer'));
      }
    };
    reader.onerror = () => reject(reader.error || new Error('FileReader error'));
    reader.readAsArrayBuffer(blob);
  });
}

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, Array.from(chunk));
  }
  return typeof btoa === 'function' ? btoa(binary) : '';
}

function base64ToUint8Array(base64: string): Uint8Array {
  if (typeof atob !== 'function' || !base64) return new Uint8Array(0);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Get all auto-backup metadata synchronously from localStorage / memory
 */
export function getAutoBackupsMetadata(): AutoBackupMetadata[] {
  const fromMemory = Array.from(memoryAutoBackups.values()).map((r) => r.metadata);

  if (!isLocalStorageAvailable()) {
    return fromMemory.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }

  try {
    const raw = window.localStorage.getItem(META_STORAGE_KEY);
    const parsed: AutoBackupMetadata[] = raw ? JSON.parse(raw) : [];
    const list = Array.isArray(parsed) ? parsed : [];

    // Merge any in-memory entries not yet in localStorage
    const map = new Map<string, AutoBackupMetadata>();
    for (const item of list) {
      map.set(item.id, item);
    }
    for (const mem of fromMemory) {
      map.set(mem.id, mem);
    }

    return Array.from(map.values()).sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  } catch {
    return fromMemory.sort(
      (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );
  }
}

function saveMetadataList(list: AutoBackupMetadata[]): void {
  if (!isLocalStorageAvailable()) return;
  try {
    window.localStorage.setItem(META_STORAGE_KEY, JSON.stringify(list.slice(0, MAX_AUTO_BACKUPS)));
  } catch {
    // Ignore quota errors
  }
}

/**
 * Save or update an auto-backup for a modified Studio document
 */
export async function saveAutoBackup(doc: {
  id: string;
  name: string;
  file: File | Blob;
  currentBlob: Blob;
  historyStack: { action: string; blob?: Blob }[];
}): Promise<AutoBackupMetadata> {
  const now = new Date().toISOString();
  const existingList = getAutoBackupsMetadata();
  const existing = existingList.find((item) => item.id === doc.id);

  const historyActions = doc.historyStack.map((h) => h.action);
  const lastAction =
    historyActions.length > 0 ? historyActions[historyActions.length - 1] : 'Modified';
  const ocrMetadata = (doc.currentBlob as any)?.__metadata || null;

  const metadata: AutoBackupMetadata = {
    id: doc.id,
    name: doc.name,
    originalSize: doc.file.size,
    modifiedSize: doc.currentBlob.size,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastAction,
    actionCount: doc.historyStack.length,
    historyActions,
    ocrMetadata,
  };

  // 1. Update in-memory store immediately
  memoryAutoBackups.set(doc.id, {
    metadata,
    blob: doc.currentBlob,
    originalBlob: doc.file,
  });

  // 2. Update metadata index in localStorage
  const filtered = existingList.filter((item) => item.id !== doc.id);
  const updatedList = [metadata, ...filtered].slice(0, MAX_AUTO_BACKUPS);
  saveMetadataList(updatedList);

  // Prune evicted backups from memory
  const keptIds = new Set(updatedList.map((i) => i.id));
  for (const key of Array.from(memoryAutoBackups.keys())) {
    if (!keptIds.has(key)) {
      memoryAutoBackups.delete(key);
    }
  }

  // 3. Persist binary data to localStorage fallback (if small) and IndexedDB
  try {
    const modifiedBytes = await blobToUint8Array(doc.currentBlob);
    const originalBytes = await blobToUint8Array(doc.file);

    if (
      isLocalStorageAvailable() &&
      modifiedBytes.byteLength <= MAX_LOCALSTORAGE_BLOB_BYTES
    ) {
      try {
        const b64 = uint8ArrayToBase64(modifiedBytes);
        window.localStorage.setItem(`${BLOB_FALLBACK_PREFIX}${doc.id}`, b64);
      } catch {
        // Ignore quota limits
      }
    }

    if (isIndexedDBAvailable()) {
      const db = await openStudioDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE_BACKUPS], 'readwrite');
        const store = tx.objectStore(STORE_BACKUPS);
        store.put({
          id: doc.id,
          metadata,
          modifiedBytes,
          originalBytes,
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    }
  } catch {
    // Non-fatal if binary persistence fails in restricted environments
  }

  return metadata;
}

/**
 * Recover a full AutoBackupEntry (including its PDF Blob) by ID
 */
export async function recoverAutoBackup(id: string): Promise<AutoBackupEntry | null> {
  // 1. Check in-memory store first
  const mem = memoryAutoBackups.get(id);
  if (mem) {
    if (mem.metadata.ocrMetadata && !(mem.blob as any).__metadata) {
      (mem.blob as any).__metadata = mem.metadata.ocrMetadata;
    }
    return {
      ...mem.metadata,
      blob: mem.blob,
      originalBlob: mem.originalBlob,
    };
  }

  const metaList = getAutoBackupsMetadata();
  const meta = metaList.find((m) => m.id === id);

  // 2. Check IndexedDB
  if (isIndexedDBAvailable()) {
    try {
      const db = await openStudioDb();
      const record = await new Promise<any>((resolve) => {
        const tx = db.transaction([STORE_BACKUPS], 'readonly');
        const store = tx.objectStore(STORE_BACKUPS);
        const req = store.get(id);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      });

      if (record && record.modifiedBytes) {
        const resolvedMeta: AutoBackupMetadata = record.metadata || meta;
        const modBytes =
          record.modifiedBytes instanceof Uint8Array
            ? record.modifiedBytes
            : new Uint8Array(record.modifiedBytes);
        const blob = new Blob([modBytes], { type: 'application/pdf' });
        if (resolvedMeta?.ocrMetadata) {
          (blob as any).__metadata = resolvedMeta.ocrMetadata;
        }
        let originalBlob: Blob | undefined;
        if (record.originalBytes) {
          const origBytes =
            record.originalBytes instanceof Uint8Array
              ? record.originalBytes
              : new Uint8Array(record.originalBytes);
          originalBlob = new Blob([origBytes], { type: 'application/pdf' });
        }
        if (resolvedMeta) {
          memoryAutoBackups.set(id, { metadata: resolvedMeta, blob, originalBlob });
          return {
            ...resolvedMeta,
            blob,
            originalBlob,
          };
        }
      }
    } catch {
      // Fall through to localStorage fallback
    }
  }

  // 3. Check localStorage base64 fallback
  if (meta && isLocalStorageAvailable()) {
    try {
      const b64 = window.localStorage.getItem(`${BLOB_FALLBACK_PREFIX}${id}`);
      if (b64) {
        const bytes = base64ToUint8Array(b64);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        if (meta.ocrMetadata) {
          (blob as any).__metadata = meta.ocrMetadata;
        }
        memoryAutoBackups.set(id, { metadata: meta, blob });
        return {
          ...meta,
          blob,
        };
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * Remove a specific auto-backup by ID
 */
export async function removeAutoBackup(id: string): Promise<void> {
  memoryAutoBackups.delete(id);

  if (isLocalStorageAvailable()) {
    try {
      const list = getAutoBackupsMetadata().filter((item) => item.id !== id);
      saveMetadataList(list);
      window.localStorage.removeItem(`${BLOB_FALLBACK_PREFIX}${id}`);
    } catch {
      // Ignore
    }
  }

  if (isIndexedDBAvailable()) {
    try {
      const db = await openStudioDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE_BACKUPS], 'readwrite');
        tx.objectStore(STORE_BACKUPS).delete(id);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch {
      // Ignore
    }
  }
}

/**
 * Clear all auto-backups
 */
export async function clearAllAutoBackups(): Promise<void> {
  const existing = getAutoBackupsMetadata();
  memoryAutoBackups.clear();
  pendingStudioRecoveryId = null;

  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(META_STORAGE_KEY);
      for (const item of existing) {
        window.localStorage.removeItem(`${BLOB_FALLBACK_PREFIX}${item.id}`);
      }
    } catch {
      // Ignore
    }
  }

  if (isIndexedDBAvailable()) {
    try {
      const db = await openStudioDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE_BACKUPS], 'readwrite');
        tx.objectStore(STORE_BACKUPS).clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch {
      // Ignore
    }
  }
}

/**
 * Cache a recent file's Blob so it can be reopened directly in Studio
 */
export async function saveRecentFileBlob(name: string, blob: Blob): Promise<void> {
  if (!name || !blob) return;
  memoryRecentBlobs.set(name, blob);

  // Enforce max size in memory
  if (memoryRecentBlobs.size > MAX_RECENT_BLOBS) {
    const oldestKey = memoryRecentBlobs.keys().next().value;
    if (oldestKey) memoryRecentBlobs.delete(oldestKey);
  }

  try {
    const bytes = await blobToUint8Array(blob);

    if (
      isLocalStorageAvailable() &&
      bytes.byteLength <= MAX_LOCALSTORAGE_BLOB_BYTES
    ) {
      try {
        const b64 = uint8ArrayToBase64(bytes);
        window.localStorage.setItem(`${RECENT_BLOB_FALLBACK_PREFIX}${name}`, b64);
      } catch {
        // Ignore quota limits
      }
    }

    if (isIndexedDBAvailable()) {
      const db = await openStudioDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE_RECENT_BLOBS], 'readwrite');
        tx.objectStore(STORE_RECENT_BLOBS).put({
          name,
          bytes,
          type: blob.type || 'application/pdf',
          updatedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    }
  } catch {
    // Non-fatal
  }
}

/**
 * Retrieve a cached recent file Blob by file name
 */
export async function getRecentFileBlob(name: string): Promise<Blob | null> {
  if (!name) return null;

  const mem = memoryRecentBlobs.get(name);
  if (mem) return mem;

  if (isIndexedDBAvailable()) {
    try {
      const db = await openStudioDb();
      const record = await new Promise<any>((resolve) => {
        const tx = db.transaction([STORE_RECENT_BLOBS], 'readonly');
        const req = tx.objectStore(STORE_RECENT_BLOBS).get(name);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
        tx.oncomplete = () => db.close();
      });

      if (record && record.bytes) {
        const bytes =
          record.bytes instanceof Uint8Array
            ? record.bytes
            : new Uint8Array(record.bytes);
        const blob = new Blob([bytes], { type: record.type || 'application/pdf' });
        memoryRecentBlobs.set(name, blob);
        return blob;
      }
    } catch {
      // Fall through
    }
  }

  if (isLocalStorageAvailable()) {
    try {
      const b64 = window.localStorage.getItem(`${RECENT_BLOB_FALLBACK_PREFIX}${name}`);
      if (b64) {
        const bytes = base64ToUint8Array(b64);
        const blob = new Blob([bytes.buffer as ArrayBuffer], { type: 'application/pdf' });
        memoryRecentBlobs.set(name, blob);
        return blob;
      }
    } catch {
      // Ignore
    }
  }

  return null;
}

/**
 * Remove a cached recent file Blob by file name
 */
export async function removeRecentFileBlob(name: string): Promise<void> {
  memoryRecentBlobs.delete(name);
  if (isLocalStorageAvailable()) {
    try {
      window.localStorage.removeItem(`${RECENT_BLOB_FALLBACK_PREFIX}${name}`);
    } catch {
      // Ignore
    }
  }
  if (isIndexedDBAvailable()) {
    try {
      const db = await openStudioDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE_RECENT_BLOBS], 'readwrite');
        tx.objectStore(STORE_RECENT_BLOBS).delete(name);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch {
      // Ignore
    }
  }
}

/**
 * Clear all cached recent file Blobs
 */
export async function clearRecentFileBlobs(): Promise<void> {
  const keys = Array.from(memoryRecentBlobs.keys());
  memoryRecentBlobs.clear();

  if (isLocalStorageAvailable()) {
    try {
      for (const k of keys) {
        window.localStorage.removeItem(`${RECENT_BLOB_FALLBACK_PREFIX}${k}`);
      }
    } catch {
      // Ignore
    }
  }

  if (isIndexedDBAvailable()) {
    try {
      const db = await openStudioDb();
      await new Promise<void>((resolve) => {
        const tx = db.transaction([STORE_RECENT_BLOBS], 'readwrite');
        tx.objectStore(STORE_RECENT_BLOBS).clear();
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch {
      // Ignore
    }
  }
}
