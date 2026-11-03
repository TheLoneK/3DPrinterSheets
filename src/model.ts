// Ticket data shape, limits, and validation for anything loaded from storage or files.

export const LIMITS = {
  short: 32, // serial, model, technician, part name
  codes: 64, // error codes field
  notes: 2000,
  printsMax: 9,
  qtyMax: 99,
  parts: 30,
  fileBytes: 200_000,
} as const;

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
    serial: serial.slice(0, LIMITS.short),
    model: '',
    technician: technician.slice(0, LIMITS.short),
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

export function clampInt(v: unknown, min: number, max: number, fallback = min): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseInt(v, 10) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.slice(0, max) : '');
const bool = (v: unknown): boolean => v === true;
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const iso = (v: unknown): string | null =>
  typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null;

/** Turns untrusted data (browser storage, a file someone opened) into a valid Ticket, or null. */
export function normalizeTicket(raw: unknown): Ticket | null {
  const r = obj(raw);
  if (typeof r.id !== 'string' || !r.id) return null;
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
          id: typeof o.id === 'string' && o.id ? o.id.slice(0, 64) : uid(),
          name: str(o.name, LIMITS.short),
          qty: clampInt(o.qty, 0, LIMITS.qtyMax, 1),
        };
      })
    : [];
  return {
    version: 1,
    id: r.id.slice(0, 64),
    serial: str(r.serial, LIMITS.short),
    model: str(r.model, LIMITS.short),
    technician: str(r.technician, LIMITS.short),
    openedAt,
    updatedAt: iso(r.updatedAt) ?? openedAt,
    finishedAt: status === 'open' ? null : iso(r.finishedAt),
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
    notes: str(r.notes, LIMITS.notes),
  };
}

export function parseTicketText(text: string): Ticket | null {
  try {
    return normalizeTicket(JSON.parse(text));
  } catch {
    return null;
  }
}
