/** Storage: IndexedDB (same schema as Notes 26.10.x, so backups move freely), backups and PIN hashing. */
import type { Attachment, Note } from './types';

let db: IDBDatabase | null = null;
type Store = 'notes' | 'prefs';

export function openDb() {
  return new Promise<void>((resolve, reject) => {
    if (!window.indexedDB) return reject(Error('IndexedDB indisponible'));
    const req = indexedDB.open('NotesAppDB', 1);
    req.onupgradeneeded = () => (['notes', 'prefs'] as Store[]).forEach(s => {
      if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: 'id' });
    });
    req.onsuccess = () => { db = req.result; resolve(); };
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(Error('IndexedDB bloquée'));
  });
}

function tx<T>(store: Store, mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    const t = db!.transaction(store, mode), req = run(t.objectStore(store));
    t.oncomplete = () => resolve(req.result);
    t.onerror = t.onabort = () => reject(t.error);
  });
}
export const getAll = <T,>(store: Store) => tx<T[]>(store, 'readonly', s => s.getAll());
export const putNote = (n: Note) => tx('notes', 'readwrite', s => s.put(n));
export const deleteNote = (id: number) => tx('notes', 'readwrite', s => s.delete(id));
export const putPref = (id: string, data: unknown) => tx('prefs', 'readwrite', s => s.put({ id, data }));

export async function storageInfo() {
  const s = navigator.storage;
  if (!s?.estimate) return null;
  try {
    const [est, persisted] = await Promise.all([s.estimate(), s.persisted?.() ?? false]);
    return { used: est.usage || 0, persisted: !!persisted };
  } catch { return null; }
}

/* ---------- Notes from storage or backups ---------- */
export function normalizeNote(raw: Record<string, unknown>): Note {
  const { att, ...n } = raw as Record<string, any>;
  return {
    folder: '', by: 'me', created: Date.now(), updated: Date.now(),
    ...n,
    id: Number(n.id), title: String(n.title || ''), body: String(n.body || ''),
    pinned: !!n.pinned, locked: !!n.locked, sealedOnly: !!n.sealed,
    atts: (Array.isArray(n.atts) ? n.atts : att ? [att] : []).filter((a: Attachment) => a && a.type),
    versions: Array.isArray(n.versions) ? n.versions : [],
  };
}

function dataUrlToBlob(url: string) {
  const comma = url.indexOf(','), head = url.slice(0, comma), data = url.slice(comma + 1);
  const type = (head.match(/^data:([^;,]+)/) || [])[1] || 'application/octet-stream';
  const raw = /;base64/.test(head) ? atob(data) : decodeURIComponent(data);
  return new Blob([Uint8Array.from(raw, c => c.charCodeAt(0))], { type });
}
/** Turns a backup attachment (data: URL) back into a Blob attachment. */
export function attFromBackup(a: Attachment): Attachment | null {
  if (!a?.type) return null;
  if (a.blob instanceof Blob) return a;
  if (typeof a.url === 'string' && a.url.startsWith('data:'))
    try {
      const blob = dataUrlToBlob(a.url), rest = { ...a };
      delete rest.url;
      return { ...rest, blob, size: blob.size };
    } catch { /* unreadable: dropped */ }
  return null;
}
export const readDataUrl = (b: Blob) => new Promise<string>((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(r.result as string);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(b);
});
async function attToBackup(a: Attachment): Promise<Attachment> {
  if (!a.blob) return a;
  const { blob, ...rest } = a;
  return { ...rest, url: await readDataUrl(blob) };
}

/**
 * Builds a plain backup as a Blob piece by piece.
 * Hidden notes are deliberately excluded: this legacy JSON format is not encrypted,
 * so exporting their contents would defeat the point of the hidden-notes protection.
 * The Markdown vault export has the same safety rule unless the hidden vault is open.
 */
export async function backupBlob(notes: Note[], folders: string[], folderColors: Record<string, number>) {
  const safeNotes = notes.filter(n => !n.locked);
  let out = new Blob([JSON.stringify({
    app: 'notes', version: 1, exported: new Date().toISOString(), folders, folderColors,
    hiddenNotesExcluded: notes.length - safeNotes.length,
  }).slice(0, -1) + ',"notes":[']);
  for (const [i, n] of safeNotes.entries()) {
    const atts = await Promise.all(n.atts.map(attToBackup)), { sealed: _s, sealedOnly: _o, ...plain } = n;
    out = new Blob([out, (i ? ',' : '') + JSON.stringify({ ...plain, atts })]);
  }
  return new Blob([out, ']}'], { type: 'application/json' });
}

/* ---------- PIN (PBKDF2-SHA256, 600k iterations, salted) ---------- */
export const canHash = () => !!window.crypto?.subtle;
const hex = (b: ArrayBuffer) => Array.from(new Uint8Array(b), x => x.toString(16).padStart(2, '0')).join('');
async function pbkdf2(pin: string, salt: string, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  return hex(await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: Uint8Array.from(salt.match(/../g)!, h => parseInt(h, 16)), iterations }, key, 256));
}
export const PIN_SCHEME = 'pbkdf2:600000:';
export async function hashPin(pin: string) {
  const salt = hex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  return PIN_SCHEME + salt + ':' + (await pbkdf2(pin, salt, 6e5));
}
export async function checkPin(pin: string, stored: string | null) {
  const [scheme, a, b, c] = (stored || '').split(':');
  if (scheme === 'pbkdf2') return canHash() && (await pbkdf2(pin, b, +a)) === c;
  if (scheme === 'sha256') return canHash() && hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode('notes-pin:' + pin))) === a;
  return scheme === 'plain' && stored!.slice(6) === pin;
}
