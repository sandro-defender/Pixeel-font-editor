/** Minimal IndexedDB wrapper for the refresh-recovery snapshot. */
import type { SerializedProject } from './project';

const DB_NAME = 'pixeel-font-editor';
const DB_VERSION = 1;
const STORE = 'recovery';
const KEY = 'current';

export interface RecoveryRecord {
  savedAt: number;
  payload: SerializedProject;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB.'));
  });
}

export async function saveRecovery(payload: SerializedProject): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put({ savedAt: Date.now(), payload } satisfies RecoveryRecord, KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to save recovery snapshot.'));
    });
  } finally {
    db.close();
  }
}

export async function loadRecovery(): Promise<RecoveryRecord | null> {
  const db = await openDb();
  try {
    return await new Promise<RecoveryRecord | null>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(KEY);
      req.onsuccess = () => resolve((req.result as RecoveryRecord | undefined) ?? null);
      req.onerror = () => reject(req.error ?? new Error('Failed to read recovery snapshot.'));
    });
  } finally {
    db.close();
  }
}

export async function clearRecovery(): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('Failed to clear recovery snapshot.'));
    });
  } finally {
    db.close();
  }
}
