// IndexedDB wrapper. Stores: songs (keyPath id), kv (app settings, key/value).
const DB_NAME = 'piano-trainer';
const DB_VER = 1;
const BACKUP_FORMAT = 1;

let dbp;
function db() {
  dbp = dbp || new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('songs')) d.createObjectStore('songs', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

async function run(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const tx = d.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req && req.result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const listSongs = () => run('songs', 'readonly', (s) => s.getAll());
export const getSong = (id) => run('songs', 'readonly', (s) => s.get(id));
export const putSong = (song) => run('songs', 'readwrite', (s) => s.put(song));
export const deleteSong = (id) => run('songs', 'readwrite', (s) => s.delete(id));

export const getKV = (key) => run('kv', 'readonly', (s) => s.get(key));
export const setKV = (key, val) => run('kv', 'readwrite', (s) => s.put(val, key));

async function blobToB64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

function b64ToBlob(b64, type) {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}

// One JSON object with every song (original file as base64) and every kv entry.
export async function exportAll() {
  const songs = await listSongs();
  const out = [];
  for (const s of songs) {
    const { file, ...rest } = s;
    out.push({ ...rest, file: await blobToB64(file), fileType: file.type });
  }
  const d = await db();
  const kv = await new Promise((resolve, reject) => {
    const res = {};
    const req = d.transaction('kv').objectStore('kv').openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve(res);
      res[c.key] = c.value;
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  return { app: 'piano-trainer', format: BACKUP_FORMAT, exported: new Date().toISOString(), songs: out, kv };
}

// Replaces all data with the backup's contents.
export async function importAll(data) {
  if (!data || data.app !== 'piano-trainer' || !Array.isArray(data.songs)) throw new Error('Not a Piano Trainer backup');
  const d = await db();
  await new Promise((resolve, reject) => {
    const tx = d.transaction(['songs', 'kv'], 'readwrite');
    const songs = tx.objectStore('songs');
    const kv = tx.objectStore('kv');
    songs.clear();
    kv.clear();
    for (const s of data.songs) {
      const { fileType, ...rest } = s;
      songs.put({ ...rest, file: b64ToBlob(s.file, fileType || '') });
    }
    for (const [k, v] of Object.entries(data.kv || {})) kv.put(v, k);
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
  return data.songs.length;
}
