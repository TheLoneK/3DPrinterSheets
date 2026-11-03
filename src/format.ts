import type { Status, Ticket } from './model.js';

const pad = (n: number): string => String(n).padStart(2, '0');

export function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function fmtTime(iso: string, seconds = false): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    ...(seconds ? { second: '2-digit' } : {}),
  });
}

export function fmtShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

export function fmtDuration(ms: number): string {
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const d = Math.floor(h / 24);
  if (d > 0) return `${d} d ${h % 24} h`;
  if (h > 0) return `${h} h ${mins % 60} min`;
  return `${mins} min`;
}

export const STATUS_LABEL: Record<Status, string> = {
  open: 'In progress',
  passed: 'Passed',
  failed: 'Failed',
};

function fileStamp(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

const safeName = (s: string): string =>
  s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 32);

/** One file per ticket: saving again (or finishing) overwrites the same file. */
export function ticketFileName(t: Ticket): string {
  return `${safeName(t.serial) || 'no-serial'}_${fileStamp(t.openedAt)}.json`;
}
