/**
 * IndexedDB wrapper for the refresh-recovery snapshot.
 *
 * One connection is opened lazily and reused. It is dropped (and reopened on
 * the next call) when the browser asks for the database to be upgraded or
 * closed, or when an operation finds it already closed.
 */
import type { SerializedProject } from './project';

const DB_NAME = 'pixeel-font-editor';
const DB_VERSION = 1;
const STORE = 'recovery';
const KEY = 'current';

export interface RecoveryRecord {
  savedAt: number;
  payload: SerializedProject;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function dropConnection(): void {
  dbPromise = null;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this environment.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => {
      const db = req.result;
      // another tab wants to upgrade or delete the database: let go of our connection
      db.onversionchange = () => {
        db.close();
        dropConnection();
      };
      db.onclose = () => dropConnection();
      resolve(db);
    };
    req.onerror = () => {
      dropConnection();
      reject(req.error ?? new Error('Failed to open IndexedDB.'));
    };
    req.onblocked = () => {
      dropConnection();
      reject(new Error('The recovery database is locked by another Pixeel tab. Close other tabs and reload.'));
    };
  });
  return dbPromise;
}

/**
 * Run one request inside a transaction and resolve once the transaction has
 * committed (so writes are durable when the promise settles).
 */
async function runTx<T>(mode: IDBTransactionMode, op: (store: IDBObjectStore) => IDBRequest<T> | void, retry = true): Promise<T | undefined> {
  const db = await openDb();
  let tx: IDBTransaction;
  try {
    tx = db.transaction(STORE, mode);
  } catch (err) {
    // the cached connection was closed underneath us: reopen once
    dropConnection();
    if (retry) return runTx(mode, op, false);
    throw err;
  }
  return new Promise<T | undefined>((resolve, reject) => {
    let result: T | undefined;
    const req = op(tx.objectStore(STORE));
    if (req) {
      req.onsuccess = () => {
        result = req.result;
      };
    }
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error ?? new Error('IndexedDB request failed.'));
    tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted.'));
  });
}

export async function saveRecovery(payload: SerializedProject): Promise<void> {
  await runTx('readwrite', (store) => {
    store.put({ savedAt: Date.now(), payload } satisfies RecoveryRecord, KEY);
  });
}

export async function loadRecovery(): Promise<RecoveryRecord | null> {
  const rec = await runTx<RecoveryRecord | undefined>('readonly', (store) => store.get(KEY));
  return rec ?? null;
}

export async function clearRecovery(): Promise<void> {
  await runTx('readwrite', (store) => {
    store.delete(KEY);
  });
}
