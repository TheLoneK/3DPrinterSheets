// Tickets page: scan to open tickets, work through the checklist, autosave, finish and save to a folder.
import { LIMITS, STEP_NAMES, blankPart, clampInt, newTicket, stepsDone, uid, type PartLine, type Ticket } from './model.js';
import { OPEN_KEY, addFinished, loadOpen, loadTech, saveOpen, saveTech } from './store.js';
import { byId, el, startClock, toast } from './dom.js';
import { fmtDateTime, fmtDuration, fmtTime } from './format.js';
import { chooseFolder, folderSupported, getSaveFolder, saveTicket, type SaveResult } from './folder.js';

let tickets: Ticket[] = loadOpen();
let activeId: string | null = tickets[0]?.id ?? null;
let saveTimer: number | undefined;

const scanInput = byId<HTMLInputElement>('scan');
const railList = byId('rail-list');
const railCount = byId('rail-count');
const ticketHost = byId('ticket');
const folderName = byId('folder-name');
const folderBtn = byId<HTMLButtonElement>('folder-btn');

const active = (): Ticket | null => tickets.find((t) => t.id === activeId) ?? null;

/* ---------- saving ---------- */

function persist(): void {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  if (!saveOpen(tickets)) {
    toast('Autosave failed: browser storage is full or blocked. Save this ticket to a folder.', 'fail');
    setSaveState('Not saved');
    return;
  }
  const t = active();
  if (t) setSaveState(`Autosaved ${fmtTime(t.updatedAt, true)}`);
}

function changed(): void {
  const t = active();
  if (!t) return;
  t.updatedAt = new Date().toISOString();
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(persist, 300);
  setSaveState('Saving…');
  refreshRailItem(t);
  refreshSteps(t);
  const updated = ticketHost.querySelector('[data-updated]');
  if (updated) updated.textContent = fmtTime(t.updatedAt);
}

function setSaveState(text: string): void {
  const node = document.getElementById('save-state');
  if (node) node.textContent = text;
}

function flush(): void {
  if (saveTimer !== undefined) persist();
}

/* ---------- opening tickets ---------- */

function openFromScan(raw: string): void {
  let code = raw.trim();
  if (!code) return;
  if (code.length > LIMITS.short) {
    toast(`That code is longer than ${LIMITS.short} characters, so it was cut to fit. Check the serial.`, 'warn');
    code = code.slice(0, LIMITS.short);
  }
  const existing = tickets.find((t) => t.serial.toLowerCase() === code.toLowerCase());
  if (existing) {
    select(existing.id);
    flashRail(existing.id);
    toast(`${existing.serial} already has an open ticket.`, 'warn');
    return;
  }
  const t = newTicket(code, 'scan', loadTech());
  tickets.push(t);
  activeId = t.id;
  persist();
  renderRail(t.id);
  renderTicket();
}

function openManual(): void {
  const t = newTicket('', 'manual', loadTech());
  tickets.push(t);
  activeId = t.id;
  persist();
  renderRail(t.id);
  renderTicket();
  document.getElementById('f-serial')?.focus();
}

function select(id: string): void {
  flush();
  activeId = id;
  renderRail();
  renderTicket();
}

/* ---------- rail ---------- */

function progressBar(t: Ticket): HTMLElement {
  const done = stepsDone(t);
  const count = done.filter(Boolean).length;
  return el(
    'span',
    { class: 'segs', title: `${count} of 4 steps done`, 'aria-label': `${count} of 4 steps done` },
    ...done.map((d) => el('span', { class: 'seg', 'data-on': d })),
  );
}

function railItem(t: Ticket, isNew = false): HTMLLIElement {
  const btn = el(
    'button',
    { type: 'button', class: 'rail-btn', 'aria-current': t.id === activeId ? 'true' : null },
    el('span', { class: 'rail-serial' }, t.serial || 'No serial yet'),
    el('span', { class: 'rail-model' }, t.model || 'Model not set'),
    el('span', { class: 'rail-foot' }, el('span', {}, `Opened ${fmtTime(t.openedAt)}`), progressBar(t)),
  );
  btn.addEventListener('click', () => select(t.id));
  return el('li', { class: isNew ? 'rail-item is-new' : 'rail-item', 'data-id': t.id }, btn);
}

function renderRail(newId?: string): void {
  railCount.textContent = String(tickets.length);
  if (!tickets.length) {
    railList.replaceChildren(el('li', { class: 'rail-empty' }, 'No open tickets.'));
    return;
  }
  railList.replaceChildren(...tickets.map((t) => railItem(t, t.id === newId)));
  railList.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function railNode(id: string): HTMLLIElement | null {
  return railList.querySelector<HTMLLIElement>(`li[data-id="${CSS.escape(id)}"]`);
}

function refreshRailItem(t: Ticket): void {
  railNode(t.id)?.replaceWith(railItem(t));
}

function flashRail(id: string): void {
  const node = railNode(id);
  if (!node) return;
  node.classList.remove('is-flash');
  void node.offsetWidth;
  node.classList.add('is-flash');
}

/* ---------- form building blocks ---------- */

function textInput(
  value: string,
  max: number,
  set: (v: string) => void,
  attrs: Record<string, string | boolean> = {},
): HTMLInputElement {
  const input = el('input', { type: 'text', maxlength: max, autocomplete: 'off', spellcheck: 'false', ...attrs });
  input.value = value;
  input.addEventListener('input', () => {
    set(input.value.slice(0, max));
    changed();
  });
  return input;
}

function field(label: string, control: HTMLElement, id: string): HTMLElement {
  control.id = id;
  return el('div', { class: 'field' }, el('label', { for: id }, label), control);
}

function check(label: string, checked: boolean, set: (v: boolean) => void, hint?: string): HTMLElement {
  const id = `c-${uid()}`;
  const box = el('input', { type: 'checkbox', id, checked });
  box.addEventListener('change', () => {
    set(box.checked);
    changed();
  });
  return el(
    'label',
    { class: 'check', for: id },
    box,
    el('span', { class: 'check-text' }, label, hint ? el('small', {}, hint) : null),
  );
}

function counter(
  value: number,
  min: number,
  max: number,
  set: (v: number) => void,
  name: string,
  id?: string,
): HTMLElement {
  const dec = el('button', { type: 'button', class: 'count-btn', 'aria-label': `Decrease ${name}` }, '−');
  const inc = el('button', { type: 'button', class: 'count-btn', 'aria-label': `Increase ${name}` }, '+');
  const input = el('input', {
    type: 'number',
    class: 'count-input',
    min,
    max,
    step: 1,
    inputmode: 'numeric',
    id: id ?? null,
    'aria-label': id ? null : name,
  });
  const paint = (v: number): void => {
    dec.setAttribute('aria-disabled', String(v <= min));
    inc.setAttribute('aria-disabled', String(v >= max));
  };
  const apply = (raw: unknown): void => {
    const v = clampInt(raw, min, max, min);
    if (input.value !== String(v)) input.value = String(v);
    paint(v);
    set(v);
    changed();
  };
  input.value = String(value);
  paint(value);
  dec.addEventListener('click', () => {
    const v = clampInt(input.value, min, max, min);
    if (v > min) apply(v - 1);
  });
  inc.addEventListener('click', () => {
    const v = clampInt(input.value, min, max, min);
    if (v < max) apply(v + 1);
  });
  input.addEventListener('input', () => {
    if (input.value !== '') apply(input.value);
  });
  input.addEventListener('blur', () => {
    if (input.value === '') apply(min);
  });
  return el('div', { class: 'counter' }, dec, input, inc);
}

function step(index: number, done: boolean, ...body: HTMLElement[]): HTMLLIElement {
  return el(
    'li',
    { class: done ? 'step is-done' : 'step', 'data-step': index },
    el(
      'h3',
      { class: 'step-title' },
      el('span', { class: 'step-marker', 'aria-hidden': 'true' }, String(index + 1)),
      STEP_NAMES[index],
      el('span', { class: 'sr-only', 'data-step-state': true }, done ? ' (done)' : ''),
    ),
    el('div', { class: 'step-body' }, ...body),
  );
}

function refreshSteps(t: Ticket): void {
  const done = stepsDone(t);
  ticketHost.querySelectorAll<HTMLElement>('[data-step]').forEach((node) => {
    const d = done[Number(node.dataset.step)] ?? false;
    node.classList.toggle('is-done', d);
    const state = node.querySelector('[data-step-state]');
    if (state) state.textContent = d ? ' (done)' : '';
  });
}

function resultToggle(t: Ticket): HTMLElement {
  const make = (value: 'pass' | 'fail', text: string): HTMLButtonElement => {
    const b = el(
      'button',
      { type: 'button', class: `result-btn result-${value}`, 'aria-pressed': String(t.testPrint.result === value) },
      text,
    );
    b.addEventListener('click', () => {
      t.testPrint.result = t.testPrint.result === value ? '' : value;
      pass.setAttribute('aria-pressed', String(t.testPrint.result === 'pass'));
      fail.setAttribute('aria-pressed', String(t.testPrint.result === 'fail'));
      changed();
    });
    return b;
  };
  const pass = make('pass', 'Passed');
  const fail = make('fail', 'Failed');
  return el(
    'div',
    { class: 'field' },
    el('span', { class: 'field-label', id: 'result-label' }, 'Result'),
    el('div', { class: 'result', role: 'group', 'aria-labelledby': 'result-label' }, pass, fail),
  );
}

function partsEditor(t: Ticket): HTMLElement {
  const list = el('div', { class: 'parts' });
  const addBtn = el('button', { type: 'button', class: 'btn btn-quiet add-part' }, '+ Add part');

  const draw = (focusIndex?: number): void => {
    list.replaceChildren(...t.parts.map((p, i) => row(p, i)));
    addBtn.hidden = t.parts.length >= LIMITS.parts;
    if (focusIndex !== undefined) list.querySelectorAll<HTMLInputElement>('.part-name')[focusIndex]?.focus();
  };

  const add = (): void => {
    if (t.parts.length >= LIMITS.parts) {
      toast(`A ticket can list up to ${LIMITS.parts} parts.`, 'warn');
      return;
    }
    t.parts.push(blankPart());
    changed();
    draw(t.parts.length - 1);
  };

  const row = (p: PartLine, i: number): HTMLElement => {
    const name = textInput(p.name, LIMITS.short, (v) => (p.name = v), {
      class: 'part-name',
      placeholder: 'Part name or number',
      'aria-label': `Part ${i + 1} name`,
    });
    // Enter (or a scanner's trailing Enter) moves to the next part line, adding one if needed.
    name.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      if (i === t.parts.length - 1) add();
      else list.querySelectorAll<HTMLInputElement>('.part-name')[i + 1]?.focus();
    });
    const qty = counter(p.qty, 0, LIMITS.qtyMax, (v) => (p.qty = v), `quantity of part ${i + 1}`);
    const remove = el(
      'button',
      { type: 'button', class: 'icon-btn', 'aria-label': `Remove part ${i + 1}`, title: 'Remove this part' },
      '×',
    );
    remove.addEventListener('click', () => {
      t.parts.splice(i, 1);
      if (!t.parts.length) t.parts.push(blankPart());
      changed();
      draw(Math.min(i, t.parts.length - 1));
    });
    return el('div', { class: 'part-row' }, name, qty, remove);
  };

  addBtn.addEventListener('click', add);
  draw();
  return el(
    'section',
    { class: 'record', 'aria-labelledby': 'parts-title' },
    el('h3', { class: 'record-title', id: 'parts-title' }, 'Parts used'),
    el('div', { class: 'parts-head', 'aria-hidden': 'true' }, el('span', {}, 'Part'), el('span', {}, 'Qty')),
    list,
    addBtn,
  );
}

function notesField(t: Ticket): HTMLElement {
  const area = el('textarea', { id: 'f-notes', maxlength: LIMITS.notes, rows: 5, placeholder: 'Anything the next person should know' });
  area.value = t.notes;
  const count = el('span', { class: 'char-count', 'aria-live': 'off' }, `${t.notes.length} / ${LIMITS.notes}`);
  area.addEventListener('input', () => {
    t.notes = area.value.slice(0, LIMITS.notes);
    count.textContent = `${t.notes.length} / ${LIMITS.notes}`;
    changed();
  });
  return el(
    'section',
    { class: 'record' },
    el('h3', { class: 'record-title' }, el('label', { for: 'f-notes' }, 'Notes')),
    area,
    count,
  );
}

/* ---------- ticket view ---------- */

function emptyState(): HTMLElement {
  const btn = el('button', { type: 'button', class: 'btn btn-ink' }, 'Start a ticket by hand');
  btn.addEventListener('click', openManual);
  return el(
    'div',
    { class: 'empty' },
    el('p', { class: 'empty-title' }, 'Scan a printer to open its ticket.'),
    el('p', {}, 'Each scan opens a new ticket, so you can scan a whole shelf back to back and fill them in after.'),
    btn,
  );
}

function renderTicket(): void {
  const t = active();
  if (!t) {
    ticketHost.replaceChildren(emptyState());
    return;
  }
  const done = stepsDone(t);

  const head = el(
    'header',
    { class: 't-head' },
    el(
      'div',
      { class: 't-ident' },
      field('Serial / barcode', textInput(t.serial, LIMITS.short, (v) => (t.serial = v), { class: 'mono' }), 'f-serial'),
      field('Printer model', textInput(t.model, LIMITS.short, (v) => (t.model = v)), 'f-model'),
      field(
        'Technician',
        textInput(t.technician, LIMITS.short, (v) => {
          t.technician = v;
          saveTech(v);
        }),
        'f-tech',
      ),
    ),
    el(
      'dl',
      { class: 't-times' },
      el('div', {}, el('dt', {}, 'Opened'), el('dd', {}, fmtDateTime(t.openedAt))),
      el('div', {}, el('dt', {}, 'On the bench'), el('dd', { 'data-elapsed': true }, fmtDuration(Date.now() - Date.parse(t.openedAt)))),
      el('div', {}, el('dt', {}, 'Last change'), el('dd', { 'data-updated': true }, fmtTime(t.updatedAt))),
      el('div', {}, el('dt', {}, 'Opened by'), el('dd', {}, t.openedBy === 'scan' ? 'Barcode scan' : 'Hand entry')),
    ),
  );

  const steps = el(
    'ol',
    { class: 'steps' },
    step(0, done[0], check('Visual inspection complete', t.visual.done, (v) => (t.visual.done = v), 'Frame, belts, nozzle, build plate, wiring and display')),
    step(
      1,
      done[1],
      check('Power checked', t.power.powerOk, (v) => (t.power.powerOk = v), 'Powers on, fans and heaters respond'),
      check('Calibration settings checked', t.power.calibrationOk, (v) => (t.power.calibrationOk = v)),
    ),
    step(
      2,
      done[2],
      field(
        'Error codes found',
        textInput(t.repair.errorCodes, LIMITS.codes, (v) => (t.repair.errorCodes = v), { class: 'mono', placeholder: 'Leave blank if none' }),
        'f-codes',
      ),
      check('Error codes cleared', t.repair.errorsFixed, (v) => (t.repair.errorsFixed = v), 'Tick this too if there were none'),
      check('Parts replaced', t.repair.partsReplaced, (v) => (t.repair.partsReplaced = v), 'List them under Parts used'),
    ),
    step(
      3,
      done[3],
      el(
        'div',
        { class: 'print-row' },
        resultToggle(t),
        field(
          'Prints run',
          counter(t.testPrint.count, 0, LIMITS.printsMax, (v) => (t.testPrint.count = v), 'prints run', 'f-prints'),
          'f-prints-wrap',
        ),
      ),
    ),
  );
  // field() put the id on the counter wrapper; point the label at the number input instead.
  steps.querySelector('label[for="f-prints-wrap"]')?.setAttribute('for', 'f-prints');

  const saveBtn = el('button', { type: 'button', class: 'btn' }, 'Save to folder');
  saveBtn.addEventListener('click', () => void saveCurrent(t));
  const deleteBtn = el('button', { type: 'button', class: 'btn btn-quiet btn-danger' }, 'Delete ticket');
  deleteBtn.addEventListener('click', () => deleteTicket(t));
  const failBtn = el('button', { type: 'button', class: 'btn btn-fail' }, 'Finish as failed');
  failBtn.addEventListener('click', () => void finish(t, 'failed'));
  const passBtn = el('button', { type: 'button', class: 'btn btn-pass' }, 'Finish as passed');
  passBtn.addEventListener('click', () => void finish(t, 'passed'));

  const actions = el(
    'footer',
    { class: 't-actions' },
    el('span', { id: 'save-state', class: 'save-state', role: 'status' }, `Autosaved ${fmtTime(t.updatedAt, true)}`),
    el('div', { class: 't-actions-left' }, deleteBtn, saveBtn),
    el('div', { class: 't-actions-right' }, failBtn, passBtn),
  );

  ticketHost.replaceChildren(
    el('article', { class: 'ticket', 'aria-label': `Ticket ${t.serial || 'without serial'}` }, head, steps, partsEditor(t), notesField(t), actions),
  );
}

/* ---------- actions ---------- */

function describeSave(res: SaveResult): string {
  if (res.where === 'folder') return `Saved to ${res.folder}/${res.file}`;
  if (res.where === 'download') return `Downloaded ${res.file}`;
  return '';
}

async function saveCurrent(t: Ticket): Promise<void> {
  flush();
  try {
    const res = await saveTicket(t);
    if (res.where === 'cancelled') {
      toast('No folder chosen, so nothing was saved.', 'warn');
      return;
    }
    toast(describeSave(res), 'info');
    void refreshFolder();
  } catch (err) {
    toast(`Couldn't save to the folder: ${(err as Error).message}`, 'fail');
  }
}

async function finish(t: Ticket, result: 'passed' | 'failed'): Promise<void> {
  flush();
  const warnings: string[] = [];
  const [visual, power, repair] = stepsDone(t);
  if (!t.serial.trim()) warnings.push('No serial or barcode is entered.');
  if (result === 'passed') {
    if (!visual) warnings.push('Visual inspection is not checked.');
    if (!power) warnings.push('Power and calibration are not both checked.');
    if (!repair) warnings.push('Error codes are not marked cleared.');
    if (t.testPrint.result === 'fail') warnings.push('The test print is marked failed.');
    if (t.testPrint.result === '') warnings.push('The test print has no result.');
  }
  if (warnings.length && !window.confirm(`Finish this ticket as ${result}?\n\n${warnings.join('\n')}`)) return;

  const now = new Date().toISOString();
  const finished: Ticket = { ...t, status: result, finishedAt: now, updatedAt: now };
  let res: SaveResult;
  try {
    res = await saveTicket(finished);
  } catch (err) {
    toast(`Couldn't save to the folder: ${(err as Error).message}. The ticket is still open.`, 'fail');
    return;
  }
  if (res.where === 'cancelled') {
    toast('Choose a save folder to finish the ticket. It is still open.', 'warn');
    return;
  }
  addFinished(finished);
  closeTicket(t.id);
  toast(`${t.serial || 'Ticket'} finished as ${result}. ${describeSave(res)}.`, result === 'passed' ? 'pass' : 'fail');
  void refreshFolder();
  scanInput.focus();
}

function deleteTicket(t: Ticket): void {
  if (!window.confirm(`Delete the ticket for ${t.serial || 'this printer'}? Anything not saved to a folder is lost.`)) return;
  closeTicket(t.id);
  toast('Ticket deleted.', 'info');
}

function closeTicket(id: string): void {
  const index = tickets.findIndex((x) => x.id === id);
  tickets = tickets.filter((x) => x.id !== id);
  activeId = tickets[Math.min(Math.max(index, 0), tickets.length - 1)]?.id ?? null;
  persist();
  renderRail();
  renderTicket();
}

async function refreshFolder(): Promise<void> {
  if (!folderSupported) {
    folderName.textContent = 'Downloads (this browser can’t pick a folder)';
    folderBtn.hidden = true;
    return;
  }
  const handle = await getSaveFolder();
  folderName.textContent = handle ? handle.name : 'Not chosen yet';
  folderBtn.textContent = handle ? 'Change' : 'Choose folder';
}

/* ---------- wiring ---------- */

scanInput.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== 'Tab') return;
  if (!scanInput.value.trim()) return;
  e.preventDefault();
  const code = scanInput.value;
  scanInput.value = '';
  openFromScan(code);
  scanInput.focus();
});

byId('new-ticket').addEventListener('click', openManual);

folderBtn.addEventListener('click', async () => {
  try {
    const handle = await chooseFolder();
    if (handle) toast(`Forms will save to ${handle.name}.`, 'info');
  } catch (err) {
    toast(`Couldn't use that folder: ${(err as Error).message}`, 'fail');
  }
  void refreshFolder();
});

// Esc from anywhere returns to the scan box. Typing while nothing is focused goes to the scan box,
// so a scan isn't lost if someone clicked on empty space first.
document.addEventListener('keydown', (e) => {
  if (e.defaultPrevented) return;
  if (e.key === 'Escape') {
    if (document.activeElement !== scanInput) {
      scanInput.focus();
      scanInput.select();
    }
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey || e.key.length !== 1 || e.key === ' ') return;
  const target = e.target as HTMLElement | null;
  if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
  scanInput.focus();
});

// Another tab changed the open tickets: pick up its version.
window.addEventListener('storage', (e) => {
  if (e.key !== OPEN_KEY) return;
  tickets = loadOpen();
  if (!active()) activeId = tickets[0]?.id ?? null;
  renderRail();
  renderTicket();
});

window.addEventListener('pagehide', flush);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

window.setInterval(() => {
  const t = active();
  const node = ticketHost.querySelector('[data-elapsed]');
  if (t && node) node.textContent = fmtDuration(Date.now() - Date.parse(t.openedAt));
}, 30_000);

// The reader links back here with #t=<id> after reopening a saved form.
const wanted = new URLSearchParams(location.hash.slice(1)).get('t');
if (wanted && tickets.some((t) => t.id === wanted)) activeId = wanted;
if (wanted) history.replaceState(null, '', location.pathname + location.search);

startClock(byId('clock'));
renderRail();
renderTicket();
void refreshFolder();
scanInput.focus();
