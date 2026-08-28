import { fetchSettings, uploadResumeFile } from './api.js';

// A persistent link to the user's ORIGINAL standard-resume file, via the File
// System Access API (Chrome/Edge). Browsers never reveal real file paths, so
// the server can only keep a snapshot copy — but a stored FileSystemFileHandle
// lets this page re-read the original at any time and push the latest bytes to
// the server, keeping the snapshot in sync without the user re-providing it.
// The handle survives page reloads (IndexedDB); after a browser restart the
// first use may show a one-click permission prompt.

const DB_NAME = 'jobtracker';
const STORE = 'file-handles';
const KEY = 'standard-resume';

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function op(mode, fn) {
  return idb().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const req = fn(tx.objectStore(STORE));
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  })).catch(() => undefined); // storage blocked — the link just won't persist
}

export const supportsFilePicker = () => typeof window.showOpenFilePicker === 'function';

// managedPath: the server-side snapshot path this handle keeps in sync; the
// link is ignored if the user later points resume_path somewhere else.
export function saveResumeLink(handle, managedPath) {
  return op('readwrite', s => s.put({ handle, managedPath, name: handle.name, synced_at: Date.now() }, KEY));
}

export function getResumeLink() {
  return op('readonly', s => s.get(KEY));
}

export function clearResumeLink() {
  return op('readwrite', s => s.delete(KEY));
}

// Re-read the original and push it to the server if the link is usable.
// `interactive` allows a permission prompt (needs a user gesture). Returns:
// 'synced' | 'unchanged' | 'no-link' | 'not-in-use' | 'permission' | 'unreadable'
export async function syncResumeFromLink({ interactive = false } = {}) {
  const link = await getResumeLink();
  if (!link?.handle) return 'no-link';
  const settings = await fetchSettings();
  if (settings.resume_path !== link.managedPath) return 'not-in-use';
  let permission = await link.handle.queryPermission({ mode: 'read' });
  if (permission === 'prompt' && interactive) {
    permission = await link.handle.requestPermission({ mode: 'read' }).catch(() => 'denied');
  }
  if (permission !== 'granted') return 'permission';
  let file;
  try {
    file = await link.handle.getFile();
  } catch {
    return 'unreadable'; // original moved or deleted
  }
  if (link.last_modified === file.lastModified && settings.resume_exists) return 'unchanged';
  const { path } = await uploadResumeFile(file);
  await op('readwrite', s => s.put({ ...link, managedPath: path, last_modified: file.lastModified, synced_at: Date.now() }, KEY));
  return 'synced';
}
