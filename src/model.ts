// Ticket data shape, limits, and validation for anything loaded from storage or files.

export const LIMITS = {
  short: 32, // serial, model, technician, part name
  codes: 64, // error codes field
  notes: 2000,
  printsMax: 9,
  qtyMax: 99,
  failureMax: 3, // failure level runs 0 to this
  parts: 30,
  fileBytes: 200_000,
  openTickets: 100, // open tickets kept in this browser
  filesPerLoad: 1000, // forms read from one folder or one batch of files
} as const;

// Control characters, bidi overrides/isolates and zero-width marks. They're invisible on screen
// but can make a serial look like another one, break file names, or hide text in a form.
const SINGLE_LINE_JUNK = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;
const MULTI_LINE_JUNK = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩﻿]/g;

/** Strips invisible and control characters. Notes keep line breaks and tabs; other fields don't. */
export function cleanText(s: string, multiline = false): string {
  return multiline ? s.replace(/\r\n?/g, '\n').replace(MULTI_LINE_JUNK, '') : s.replace(SINGLE_LINE_JUNK, '');
}

/** How serials are compared: case and surrounding spaces don't matter. */
export const serialKey = (s: string): string => cleanText(s).trim().toLowerCase();

const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;

export type Status = 'open' | 'passed' | 'failed';
export type PrintResult = '' | 'pass' | 'fail';

export interface PartLine {
  id: string;
  name: string;
  qty: number;
}

export interface Ticket {
  version: 1;
  id: string;
  serial: string;
  model: string;
  technician: string;
  openedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  status: Status;
  openedBy: 'scan' | 'manual';
  visual: { done: boolean };
  power: { powerOk: boolean; calibrationOk: boolean };
  repair: { errorCodes: string; errorsFixed: boolean; partsReplaced: boolean };
  testPrint: { result: PrintResult; count: number };
  parts: PartLine[];
  /** 0 to LIMITS.failureMax. */
  failureLevel: number;
  /** External pieces are missing but the unit works, so it sells as a lower tier. */
  downgrade: boolean;
  notes: string;
}

export const STEP_NAMES = ['Visual inspection', 'Power and calibration', 'Error codes and parts', 'Test print'] as const;

export function uid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const blankPart = (): PartLine => ({ id: uid(), name: '', qty: 1 });

export function newTicket(serial: string, openedBy: Ticket['openedBy'], technician: string): Ticket {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: uid(),
    serial: cleanText(serial).trim().slice(0, LIMITS.short),
    model: '',
    technician: cleanText(technician).trim().slice(0, LIMITS.short),
    openedAt: now,
    updatedAt: now,
    finishedAt: null,
    status: 'open',
    openedBy,
    visual: { done: false },
    power: { powerOk: false, calibrationOk: false },
    repair: { errorCodes: '', errorsFixed: false, partsReplaced: false },
    testPrint: { result: '', count: 0 },
    parts: [blankPart()],
    failureLevel: 0,
    downgrade: false,
    notes: '',
  };
}

/** Which of the four checklist steps are complete. */
export function stepsDone(t: Ticket): [boolean, boolean, boolean, boolean] {
  return [
    t.visual.done,
    t.power.powerOk && t.power.calibrationOk,
    t.repair.errorsFixed,
    t.testPrint.result !== '',
  ];
}

/** True while a ticket is still exactly as "New ticket by hand" made it. */
export function isBlank(t: Ticket): boolean {
  return (
    !t.serial.trim() &&
    !t.model.trim() &&
    !t.notes.trim() &&
    !t.repair.errorCodes.trim() &&
    !t.visual.done &&
    !t.power.powerOk &&
    !t.power.calibrationOk &&
    !t.repair.errorsFixed &&
    !t.repair.partsReplaced &&
    t.testPrint.result === '' &&
    t.testPrint.count === 0 &&
    t.failureLevel === 0 &&
    !t.downgrade &&
    t.parts.every((p) => !p.name.trim())
  );
}

/** Whole numbers only. Strings like "", "abc" or "-" give the fallback; "1e3" or "1.6" are read as numbers, then clamped. */
export function clampInt(v: unknown, min: number, max: number, fallback = min): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v.trim()) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const str = (v: unknown, max: number, multiline = false): string =>
  typeof v === 'string' ? (multiline ? cleanText(v, true) : cleanText(v).trim()).slice(0, max) : '';
const bool = (v: unknown): boolean => v === true;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
// Only full ISO timestamps (what the app writes). Loose strings like "1" or "May" are rejected.
const ISO_LIKE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,9})?)?(Z|[+-]\d{2}:\d{2})$/;
const iso = (v: unknown): string | null =>
  typeof v === 'string' && ISO_LIKE.test(v) && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;

/** Turns untrusted data (browser storage, a file someone opened) into a valid Ticket, or null. */
export function normalizeTicket(raw: unknown): Ticket | null {
  const r = obj(raw);
  if (typeof r.id !== 'string' || !SAFE_ID.test(r.id)) return null;
  const openedAt = iso(r.openedAt) ?? new Date().toISOString();
  const status: Status = r.status === 'passed' || r.status === 'failed' ? r.status : 'open';
  const v = obj(r.visual);
  const p = obj(r.power);
  const rp = obj(r.repair);
  const tp = obj(r.testPrint);
  const parts = Array.isArray(r.parts)
    ? r.parts.slice(0, LIMITS.parts).map((x): PartLine => {
        const o = obj(x);
        return {
          id: typeof o.id === 'string' && SAFE_ID.test(o.id) ? o.id : uid(),
          name: str(o.name, LIMITS.short),
          qty: clampInt(o.qty, 0, LIMITS.qtyMax, 1),
        };
      })
    : [];
  const updatedAt = iso(r.updatedAt) ?? openedAt;
  return {
    version: 1,
    id: r.id,
    serial: str(r.serial, LIMITS.short),
    model: str(r.model, LIMITS.short),
    technician: str(r.technician, LIMITS.short),
    openedAt,
    updatedAt,
    finishedAt: status === 'open' ? null : (iso(r.finishedAt) ?? updatedAt),
    status,
    openedBy: r.openedBy === 'scan' ? 'scan' : 'manual',
    visual: { done: bool(v.done) },
    power: { powerOk: bool(p.powerOk), calibrationOk: bool(p.calibrationOk) },
    repair: {
      errorCodes: str(rp.errorCodes, LIMITS.codes),
      errorsFixed: bool(rp.errorsFixed),
      partsReplaced: bool(rp.partsReplaced),
    },
    testPrint: {
      result: tp.result === 'pass' || tp.result === 'fail' ? tp.result : '',
      count: clampInt(tp.count, 0, LIMITS.printsMax, 0),
    },
    parts,
    // Forms saved before these fields existed read as level 0, not downgraded.
    failureLevel: clampInt(r.failureLevel, 0, LIMITS.failureMax, 0),
    downgrade: bool(r.downgrade),
    notes: str(r.notes, LIMITS.notes, true),
  };
}

export function parseTicketText(text: string): Ticket | null {
  try {
    return normalizeTicket(JSON.parse(text));
  } catch {
    return null;
  }
}
