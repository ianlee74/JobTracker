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
// One link per person; single-person databases stored theirs under the bare
// legacy key, which is still read as a fallback for any person.
const LEGACY_KEY = 'standard-resume';
const keyFor = (personId) => `standard-resume-${personId}`;

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
export function saveResumeLink(personId, handle, managedPath) {
  return op('readwrite', s => s.put({ handle, managedPath, name: handle.name, synced_at: Date.now() }, keyFor(personId)));
}

export async function getResumeLink(personId) {
  return (await op('readonly', s => s.get(keyFor(personId))))
    ?? op('readonly', s => s.get(LEGACY_KEY));
}

export async function clearResumeLink(personId) {
  const own = await op('readonly', s => s.get(keyFor(personId)));
  await op('readwrite', s => s.delete(keyFor(personId)));
  // Only clear the legacy entry when it was the link in use for this person.
  if (!own) await op('readwrite', s => s.delete(LEGACY_KEY));
}

// Re-read the original and push it to the server if the link is usable.
// `interactive` allows a permission prompt (needs a user gesture). Returns:
// 'synced' | 'unchanged' | 'no-link' | 'not-in-use' | 'permission' | 'unreadable'
export async function syncResumeFromLink({ personId, interactive = false } = {}) {
  const link = await getResumeLink(personId);
  if (!link?.handle) return 'no-link';
  const settings = await fetchSettings(personId);
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
  const { path } = await uploadResumeFile(personId, file);
  // Written under the per-person key, migrating a legacy-keyed link as a side
  // effect (the legacy entry is deleted once its replacement is stored).
  await op('readwrite', s => s.put({ ...link, managedPath: path, last_modified: file.lastModified, synced_at: Date.now() }, keyFor(personId)));
  await op('readwrite', s => s.delete(LEGACY_KEY));
  return 'synced';
}
