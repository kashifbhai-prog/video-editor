import type { AutosaveInterval, PersistedMediaMeta, SavedProject } from '../types';

// ---------------------------------------------------------------------------
// Persistence layer.
//  * Project metadata (document, settings) -> localStorage (small JSON).
//  * Media blobs + metadata                  -> IndexedDB (large binary data).
// ---------------------------------------------------------------------------

const DB_NAME = 'reelforge-studio';
const DB_VERSION = 1;
const MEDIA_STORE = 'media';
const PROJECT_KEY = 'reelforge:project';
const PREFS_KEY = 'reelforge:prefs';

export interface StoredMediaRecord {
  id: string;
  meta: PersistedMediaMeta;
  blob: Blob;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is not available in this browser.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(MEDIA_STORE)) {
        db.createObjectStore(MEDIA_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Failed to open IndexedDB.'));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function runTx<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void,
): Promise<T | undefined> {
  return openDb().then(
    (db) =>
      new Promise<T | undefined>((resolve, reject) => {
        const tx = db.transaction(MEDIA_STORE, mode);
        const req = fn(tx.objectStore(MEDIA_STORE));
        let result: T | undefined;
        if (req) req.onsuccess = () => (result = req.result);
        tx.oncomplete = () => resolve(result);
        tx.onerror = () => reject(tx.error ?? new Error('Storage transaction failed.'));
        tx.onabort = () => reject(tx.error ?? new Error('Storage transaction aborted.'));
      }),
  );
}

export const mediaStorage = {
  put(record: StoredMediaRecord) {
    return runTx('readwrite', (s) => s.put(record)).then(() => undefined);
  },
  updateMeta(id: string, meta: PersistedMediaMeta) {
    return openDb().then(
      (db) =>
        new Promise<void>((resolve, reject) => {
          const tx = db.transaction(MEDIA_STORE, 'readwrite');
          const store = tx.objectStore(MEDIA_STORE);
          const get = store.get(id);
          get.onsuccess = () => {
            const rec = get.result as StoredMediaRecord | undefined;
            if (rec) store.put({ ...rec, meta });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        }),
    );
  },
  get(id: string) {
    return runTx<StoredMediaRecord>('readonly', (s) => s.get(id));
  },
  keys() {
    return runTx<IDBValidKey[]>('readonly', (s) => s.getAllKeys()).then((k) =>
      (k ?? []).map(String),
    );
  },
  delete(id: string) {
    return runTx('readwrite', (s) => s.delete(id)).then(() => undefined);
  },
  async deleteAllExcept(keep: Set<string>) {
    const keys = await mediaStorage.keys();
    await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => mediaStorage.delete(k)));
  },
  clear() {
    return runTx('readwrite', (s) => s.clear()).then(() => undefined);
  },
};

export const projectStorage = {
  load(): SavedProject | null {
    try {
      const raw = localStorage.getItem(PROJECT_KEY);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as SavedProject;
      if (parsed?.version !== 1 || !parsed.document) return null;
      return parsed;
    } catch {
      return null;
    }
  },
  save(project: SavedProject) {
    localStorage.setItem(PROJECT_KEY, JSON.stringify(project));
  },
  clear() {
    localStorage.removeItem(PROJECT_KEY);
  },
};

export interface Preferences {
  autosaveInterval: AutosaveInterval;
  timelineHeight: number;
  mediaViewMode: 'grid' | 'list';
}

export const prefsStorage = {
  load(): Partial<Preferences> {
    try {
      return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Partial<Preferences>;
    } catch {
      return {};
    }
  },
  save(prefs: Partial<Preferences>) {
    try {
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...prefsStorage.load(), ...prefs }));
    } catch {
      /* storage unavailable - preferences are optional */
    }
  },
};

export function downloadFile(filename: string, contents: string, type = 'application/json') {
  const blob = new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
