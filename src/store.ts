// Browser storage for open tickets (autosave), recently finished tickets, and the last technician.
import { LIMITS, cleanText, normalizeTicket, type Ticket } from './model.js';

export const OPEN_KEY = '3dps.open.v1';
const FINISHED_KEY = '3dps.finished.v1';
const TECH_KEY = '3dps.technician';
const FINISHED_MAX = 50;

function read(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

const toTickets = (v: unknown): Ticket[] =>
  Array.isArray(v) ? v.map(normalizeTicket).filter((t): t is Ticket => t !== null) : [];

export const loadOpen = (): Ticket[] => toTickets(read(OPEN_KEY)).filter((t) => t.status === 'open');
export const saveOpen = (tickets: Ticket[]): boolean => write(OPEN_KEY, tickets);

export const loadFinished = (): Ticket[] => toTickets(read(FINISHED_KEY));

export function addFinished(t: Ticket): boolean {
  const list = loadFinished().filter((x) => x.id !== t.id);
  list.unshift(t);
  return write(FINISHED_KEY, list.slice(0, FINISHED_MAX));
}

export type ReopenResult = 'ok' | 'full' | 'storage';

/** Puts a saved form back into the open tickets list. */
export function reopen(t: Ticket): ReopenResult {
  const ticket: Ticket = { ...t, status: 'open', finishedAt: null, updatedAt: new Date().toISOString() };
  const open = loadOpen().filter((x) => x.id !== t.id);
  if (open.length >= LIMITS.openTickets) return 'full';
  open.push(ticket);
  return saveOpen(open) ? 'ok' : 'storage';
}

export function loadTech(): string {
  try {
    return cleanText(localStorage.getItem(TECH_KEY) ?? '').trim().slice(0, LIMITS.short);
  } catch {
    return '';
  }
}

export function saveTech(name: string): void {
  try {
    localStorage.setItem(TECH_KEY, cleanText(name).trim().slice(0, LIMITS.short));
  } catch {
    /* storage blocked; the field still works for this ticket */
  }
}
