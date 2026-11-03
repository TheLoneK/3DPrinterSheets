// Saving forms to a folder the technician picks (File System Access API, Chrome/Edge),
// with a download fallback for browsers without it.
import { LIMITS, parseTicketText, type Ticket } from './model.js';
import { ticketFileName } from './format.js';

type Mode = 'read' | 'readwrite';

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: Mode }) => Promise<FileSystemDirectoryHandle>;
  }
  interface FileSystemHandle {
    queryPermission?(descriptor: { mode: Mode }): Promise<PermissionState>;
    requestPermission?(descriptor: { mode: Mode }): Promise<PermissionState>;
  }
}

export const folderSupported = typeof window.showDirectoryPicker === 'function';

// The chosen folder handle is kept in IndexedDB so it only has to be picked once.
function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('3dps', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function kvGet<T>(key: string): Promise<T | undefined> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const req = db.transaction('kv').objectStore('kv').get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

async function kvSet(key: string, value: unknown): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

async function kvDelete(key: string): Promise<void> {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

// Some private/guest browser windows kill the page when a stored folder handle is read back.
// A flag set before the read and cleared after it tells the next load that this happened,
// so the app stops remembering the folder in that browser instead of failing on every load.
const READ_GUARD = '3dps.folderReadGuard';
const NO_MEMORY = '3dps.folderNoMemory';
const flag = {
  get: (k: string): boolean => { try { return localStorage.getItem(k) !== null; } catch { return false; } },
  set: (k: string): void => { try { localStorage.setItem(k, '1'); } catch { /* ignore */ } },
  clear: (k: string): void => { try { localStorage.removeItem(k); } catch { /* ignore */ } },
};

let current: FileSystemDirectoryHandle | null | undefined;

export async function getSaveFolder(): Promise<FileSystemDirectoryHandle | null> {
  if (!folderSupported) return null;
  if (current !== undefined) return current;
  if (flag.get(NO_MEMORY)) return (current = null);
  if (flag.get(READ_GUARD)) {
    flag.set(NO_MEMORY);
    flag.clear(READ_GUARD);
    await kvDelete('folder').catch(() => undefined);
    return (current = null);
  }
  flag.set(READ_GUARD);
  try {
    current = (await kvGet<FileSystemDirectoryHandle>('folder')) ?? null;
  } catch {
    current = null;
  } finally {
    flag.clear(READ_GUARD);
  }
  return current;
}

/** Opens the folder picker. Returns null if the person closes it. */
export async function chooseFolder(remember = true, mode: Mode = 'readwrite'): Promise<FileSystemDirectoryHandle | null> {
  if (!window.showDirectoryPicker) return null;
  try {
    const handle = await window.showDirectoryPicker({ id: '3dps-forms', mode });
    if (remember) {
      current = handle;
      if (!flag.get(NO_MEMORY)) await kvSet('folder', handle).catch(() => undefined);
    }
    return handle;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

export async function hasPermission(handle: FileSystemHandle, mode: Mode, ask: boolean): Promise<boolean> {
  if (!handle.queryPermission) return true;
  if ((await handle.queryPermission({ mode })) === 'granted') return true;
  if (!ask || !handle.requestPermission) return false;
  return (await handle.requestPermission({ mode })) === 'granted';
}

export function ticketJson(t: Ticket): string {
  const clean: Ticket = { ...t, parts: t.parts.filter((p) => p.name.trim() !== '') };
  return JSON.stringify({ app: '3DPrinterSheets', ...clean }, null, 2);
}

export function downloadTicket(t: Ticket): string {
  const name = ticketFileName(t);
  const url = URL.createObjectURL(new Blob([ticketJson(t)], { type: 'application/json' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2000);
  return name;
}

export type SaveResult =
  | { where: 'folder'; folder: string; file: string }
  | { where: 'download'; file: string }
  | { where: 'cancelled' };

/** Saves into the remembered folder (asking for one the first time), or downloads the file. */
export async function saveTicket(t: Ticket): Promise<SaveResult> {
  if (folderSupported) {
    const handle = (await getSaveFolder()) ?? (await chooseFolder());
    if (!handle) return { where: 'cancelled' };
    if (await hasPermission(handle, 'readwrite', true)) {
      const file = ticketFileName(t);
      const fileHandle = await handle.getFileHandle(file, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(ticketJson(t));
      await writable.close();
      return { where: 'folder', folder: handle.name, file };
    }
  }
  return { where: 'download', file: downloadTicket(t) };
}

export interface FileEntry {
  ticket: Ticket;
  file: string;
}

export async function readFolder(handle: FileSystemDirectoryHandle): Promise<{ entries: FileEntry[]; skipped: number }> {
  const entries: FileEntry[] = [];
  let skipped = 0;
  for await (const item of handle.values()) {
    if (item.kind !== 'file' || !item.name.toLowerCase().endsWith('.json')) continue;
    const file = await (item as FileSystemFileHandle).getFile();
    const ticket = file.size <= LIMITS.fileBytes ? parseTicketText(await file.text()) : null;
    if (ticket) entries.push({ ticket, file: item.name });
    else skipped++;
  }
  return { entries, skipped };
}

export async function readFiles(files: Iterable<File>): Promise<{ entries: FileEntry[]; skipped: number }> {
  const entries: FileEntry[] = [];
  let skipped = 0;
  for (const file of files) {
    const ticket = file.size <= LIMITS.fileBytes ? parseTicketText(await file.text()) : null;
    if (ticket) entries.push({ ticket, file: file.name });
    else skipped++;
  }
  return { entries, skipped };
}
