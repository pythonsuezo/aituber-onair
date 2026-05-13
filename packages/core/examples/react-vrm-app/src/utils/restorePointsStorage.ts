import type { AppBackupFileV1 } from './appBackup';

const DB_NAME = 'aituber-react-vrm-restore-points-v1';
const STORE = 'points';
const DB_VERSION = 1;
/** 大きな VRM を複数抱えると容量を食うため、保持数は控えめ */
const MAX_RESTORE_POINTS = 12;

export type RestorePointRecord = {
  id: string;
  label: string;
  createdAt: string;
  snapshot: AppBackupFileV1;
};

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

function newId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `rp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

export async function listRestorePoints(): Promise<RestorePointRecord[]> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).getAll();
      r.onerror = () => reject(r.error ?? new Error('getAll failed'));
      r.onsuccess = () => {
        const rows = (r.result || []) as RestorePointRecord[];
        rows.sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
        resolve(rows);
      };
    });
  } catch {
    return [];
  }
}

export async function saveRestorePoint(
  label: string,
  snapshot: AppBackupFileV1,
): Promise<RestorePointRecord> {
  const db = await openDb();
  const trimmedLabel = label.trim() || '復元ポイント';
  const record: RestorePointRecord = {
    id: newId(),
    label: trimmedLabel,
    createdAt: new Date().toISOString(),
    snapshot,
  };

  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.onerror = () => reject(tx.error ?? new Error('tx failed'));
    tx.oncomplete = () => resolve();
    const store = tx.objectStore(STORE);
    const req = store.getAll();
    req.onerror = () => reject(req.error ?? new Error('getAll failed'));
    req.onsuccess = () => {
      const existing = (req.result || []) as RestorePointRecord[];
      existing.sort(
        (a, b) =>
          new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
      );
      const overflow = existing.length + 1 - MAX_RESTORE_POINTS;
      for (let i = 0; i < overflow; i += 1) {
        const victim = existing[i];
        if (victim) {
          store.delete(victim.id);
        }
      }
      store.put(record);
    };
  });

  return record;
}

export async function deleteRestorePoint(id: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.onerror = () => reject(tx.error ?? new Error('tx failed'));
    tx.oncomplete = () => resolve();
    tx.objectStore(STORE).delete(id);
  });
}
