const DB_NAME = 'aituber-react-vrm-avatars';
const STORE = 'kv';
const KEY = 'custom-vrm-v1';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onerror = () => reject(req.error ?? new Error('indexedDB open failed'));
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

export async function loadStoredVrmBuffer(): Promise<ArrayBuffer | null> {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const r = tx.objectStore(STORE).get(KEY);
      r.onerror = () => reject(r.error ?? new Error('get failed'));
      r.onsuccess = () => {
        const v = r.result;
        resolve(v instanceof ArrayBuffer ? v : null);
      };
    });
  } catch {
    return null;
  }
}

export async function saveVrmBuffer(buffer: ArrayBuffer): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.onerror = () => reject(tx.error ?? new Error('tx failed'));
    tx.oncomplete = () => resolve();
    tx.objectStore(STORE).put(buffer, KEY);
  });
}

export async function clearStoredVrm(): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.onerror = () => reject(tx.error ?? new Error('tx failed'));
      tx.oncomplete = () => resolve();
      tx.objectStore(STORE).delete(KEY);
    });
  } catch {
    // ignore
  }
}
