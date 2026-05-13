const DB_NAME = 'aituber-vision-bridge-v1';
const STORE = 'frames';
const DB_VERSION = 1;
const MAX_KEYS = 12;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
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

function idbReq<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('idb request failed'));
  });
}

function idbTxDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('idb tx failed'));
    tx.onabort = () => reject(tx.error ?? new Error('idb tx aborted'));
  });
}

async function pruneStore(db: IDBDatabase): Promise<void> {
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const keys = await idbReq(store.getAllKeys());
  if (Array.isArray(keys) && keys.length > MAX_KEYS) {
    const sorted = [...keys].sort();
    const toDelete = sorted.slice(0, Math.max(0, sorted.length - MAX_KEYS));
    for (const k of toDelete) {
      store.delete(k);
    }
  }
  await idbTxDone(tx);
}

export type StashedVisionFrame = {
  id: string;
  imageDataUrl: string;
  prompt: string;
  createdAt: number;
};

/**
 * Store a large data URL off the BroadcastChannel (clone limits) and return an id.
 */
export async function stashVisionFrame(payload: {
  imageDataUrl: string;
  prompt: string;
}): Promise<string> {
  const id = `vf_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rec: StashedVisionFrame = {
    id,
    imageDataUrl: payload.imageDataUrl,
    prompt: payload.prompt,
    createdAt: Date.now(),
  };
  store.put(rec, id);
  await idbTxDone(tx);
  await pruneStore(db);
  return id;
}

export async function takeVisionFrame(id: string): Promise<StashedVisionFrame | null> {
  const db = await openDb();
  const tx = db.transaction(STORE, 'readwrite');
  const store = tx.objectStore(STORE);
  const rec = (await idbReq(store.get(id))) as StashedVisionFrame | undefined;
  if (rec) {
    store.delete(id);
  }
  await idbTxDone(tx);
  return rec ?? null;
}
