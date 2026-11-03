// Saved forms reader: open the save folder, individual files, or this browser's finished list.
import { LIMITS, STEP_NAMES, stepsDone, type Status, type Ticket } from './model.js';
import { loadFinished, loadOpen, reopen } from './store.js';
import { byId, el, startClock, toast } from './dom.js';
import { STATUS_LABEL, fmtDateTime, fmtDuration, fmtShortDate } from './format.js';
import {
  chooseFolder,
  folderSupported,
  getSaveFolder,
  hasPermission,
  readFiles,
  readFolder,
  saveTicket,
  type FileEntry,
} from './folder.js';

interface Entry {
  ticket: Ticket;
  file: string | null;
}

let entries: Entry[] = [];
let selectedId: string | null = null;
let filter: 'all' | Status = 'all';
let query = '';
let source: 'browser' | 'folder' | 'files' = 'browser';

const results = byId('results');
const detail = byId('detail');
const sourceLine = byId('source-line');
const openFolderBtn = byId<HTMLButtonElement>('open-folder');
const pickFolderBtn = byId<HTMLButtonElement>('pick-folder');
const fileInput = byId<HTMLInputElement>('file-input');
const recentBtn = byId<HTMLButtonElement>('show-recent');
const search = byId<HTMLInputElement>('search');

/* ---------- loading ---------- */

function setEntries(list: Entry[], from: typeof source, label: string): void {
  // Keep the newest copy if the same ticket shows up twice.
  const byTicket = new Map<string, Entry>();
  for (const e of list) {
    const prev = byTicket.get(e.ticket.id);
    if (!prev || Date.parse(e.ticket.updatedAt) > Date.parse(prev.ticket.updatedAt)) byTicket.set(e.ticket.id, e);
  }
  entries = [...byTicket.values()];
  source = from;
  sourceLine.textContent = label;
  selectedId = entries.some((e) => e.ticket.id === selectedId) ? selectedId : null;
  recentBtn.setAttribute('aria-pressed', String(from === 'browser'));
  render();
}

function showBrowser(): void {
  const list = loadFinished().map((ticket) => ({ ticket, file: null }));
  setEntries(
    list,
    'browser',
    list.length
      ? `Showing the last ${list.length} tickets finished in this browser.`
      : 'No tickets have been finished in this browser yet. Open your save folder or some files.',
  );
}

function skippedNote(skipped: number, truncated = false): string {
  const parts: string[] = [];
  if (skipped) parts.push(` ${skipped} file${skipped === 1 ? '' : 's'} weren’t ticket forms and were skipped.`);
  if (truncated) parts.push(` Only the first ${LIMITS.filesPerLoad} files were read.`);
  return parts.join('');
}

async function loadFolder(handle: FileSystemDirectoryHandle, ask: boolean): Promise<boolean> {
  if (!(await hasPermission(handle, 'read', ask))) {
    if (ask) toast(`Allow access to ${handle.name} to read its forms.`, 'warn');
    return false;
  }
  try {
    const { entries: rows, skipped, truncated } = await readFolder(handle);
    const list = rows.map((r: FileEntry) => ({ ticket: r.ticket, file: r.file }));
    setEntries(list, 'folder', `${list.length} form${list.length === 1 ? '' : 's'} in ${handle.name}.${skippedNote(skipped, truncated)}`);
    return true;
  } catch (err) {
    toast(`Couldn't read ${handle.name}: ${(err as Error).message}`, 'fail');
    return false;
  }
}

let loadingFiles = false;

async function loadFileList(files: File[]): Promise<void> {
  // A second drop or pick while the first batch is still being read would race it.
  if (loadingFiles) {
    toast('Still reading the last files. Try again in a moment.', 'warn');
    return;
  }
  loadingFiles = true;
  try {
    await readAndShow(files);
  } finally {
    loadingFiles = false;
  }
}

async function readAndShow(files: File[]): Promise<void> {
  const { entries: rows, skipped, truncated } = await readFiles(files);
  if (!rows.length) {
    toast('None of those files are ticket forms.', 'warn');
    return;
  }
  setEntries(
    rows.map((r) => ({ ticket: r.ticket, file: r.file })),
    'files',
    `${rows.length} form${rows.length === 1 ? '' : 's'} from opened files.${skippedNote(skipped, truncated)}`,
  );
}

/* ---------- list ---------- */

function matches(t: Ticket): boolean {
  if (filter !== 'all' && t.status !== filter) return false;
  if (!query) return true;
  const hay = [t.serial, t.model, t.technician, t.repair.errorCodes, t.notes, ...t.parts.map((p) => p.name)]
    .join(' ')
    .toLowerCase();
  return hay.includes(query);
}

function badge(status: Status): HTMLElement {
  return el('span', { class: `badge badge-${status}` }, STATUS_LABEL[status]);
}

function render(): void {
  const shown = entries
    .filter((e) => matches(e.ticket))
    .sort((a, b) => Date.parse(b.ticket.updatedAt) - Date.parse(a.ticket.updatedAt));

  if (!shown.length) {
    results.replaceChildren(
      el('li', { class: 'results-empty' }, entries.length ? 'Nothing matches that search.' : 'No forms loaded.'),
    );
  } else {
    results.replaceChildren(
      ...shown.map((e) => {
        const t = e.ticket;
        const btn = el(
          'button',
          { type: 'button', class: 'result-item', 'aria-current': t.id === selectedId ? 'true' : null },
          el('span', { class: 'result-top' }, el('span', { class: 'rail-serial' }, t.serial || 'No serial'), badge(t.status)),
          el('span', { class: 'rail-model' }, [t.model || 'Model not set', t.technician].filter(Boolean).join(', ')),
          el('span', { class: 'result-date' }, `Opened ${fmtShortDate(t.openedAt)}`),
        );
        btn.addEventListener('click', () => {
          selectedId = t.id;
          render();
          detail.focus();
        });
        return el('li', {}, btn);
      }),
    );
  }

  const current = entries.find((e) => e.ticket.id === selectedId);
  renderDetail(current ?? null);
}

/* ---------- detail ---------- */

const yes = (v: boolean, onText: string, offText: string): HTMLElement =>
  el('span', { class: v ? 'mark mark-on' : 'mark mark-off' }, el('span', { 'aria-hidden': 'true' }, v ? '✓' : '–'), ` ${v ? onText : offText}`);

function renderDetail(entry: Entry | null): void {
  if (!entry) {
    detail.replaceChildren(el('p', { class: 'detail-empty' }, 'Pick a form from the list to read it.'));
    return;
  }
  const t = entry.ticket;
  const done = stepsDone(t);
  const end = t.finishedAt ? Date.parse(t.finishedAt) : Date.parse(t.updatedAt);
  const parts = t.parts.filter((p) => p.name.trim());

  const reopenBtn = el('button', { type: 'button', class: 'btn btn-ink' }, 'Reopen as ticket');
  reopenBtn.addEventListener('click', () => {
    if (t.status !== 'open' && !window.confirm(`This form is marked ${STATUS_LABEL[t.status].toLowerCase()}. Reopen it as an open ticket?`)) return;
    if (loadOpen().some((x) => x.id === t.id) && !window.confirm('This ticket is already open. Replace the open copy with this saved one?')) return;
    const res = reopen(t);
    if (res === 'full') {
      toast(`There are already ${LIMITS.openTickets} open tickets. Finish or delete some first.`, 'fail');
      return;
    }
    if (res === 'storage') {
      toast('Couldn’t reopen it: browser storage is full or blocked.', 'fail');
      return;
    }
    location.href = `./#t=${encodeURIComponent(t.id)}`;
  });
  const printBtn = el('button', { type: 'button', class: 'btn' }, 'Print');
  printBtn.addEventListener('click', () => window.print());
  const actions: HTMLElement[] = [reopenBtn, printBtn];
  if (source === 'browser') {
    const saveBtn = el('button', { type: 'button', class: 'btn' }, 'Save to folder');
    saveBtn.addEventListener('click', async () => {
      if (saveBtn.disabled) return;
      saveBtn.disabled = true;
      try {
        const res = await saveTicket(t);
        if (res.where === 'folder') toast(`Saved to ${res.folder}/${res.file}`, 'info');
        else if (res.where === 'download') toast(`Downloaded ${res.file}`, 'info');
      } catch (err) {
        toast(`Couldn't save: ${(err as Error).message}`, 'fail');
      } finally {
        saveBtn.disabled = false;
      }
    });
    actions.push(saveBtn);
  }

  detail.replaceChildren(
    el(
      'header',
      { class: 'detail-head' },
      el('div', {}, el('h2', { class: 'detail-serial' }, t.serial || 'No serial'), el('p', { class: 'detail-model' }, t.model || 'Model not set')),
      badge(t.status),
    ),
    el(
      'dl',
      { class: 't-times' },
      el('div', {}, el('dt', {}, 'Technician'), el('dd', {}, t.technician || 'Not entered')),
      el('div', {}, el('dt', {}, 'Opened'), el('dd', {}, fmtDateTime(t.openedAt))),
      el('div', {}, el('dt', {}, t.finishedAt ? 'Finished' : 'Last change'), el('dd', {}, fmtDateTime(t.finishedAt ?? t.updatedAt))),
      el('div', {}, el('dt', {}, 'On the bench'), el('dd', {}, fmtDuration(end - Date.parse(t.openedAt)))),
      entry.file ? el('div', {}, el('dt', {}, 'File'), el('dd', { class: 'mono' }, entry.file)) : null,
    ),
    el(
      'ol',
      { class: 'steps steps-read' },
      readStep(0, done[0], yes(t.visual.done, 'Visual inspection complete', 'Visual inspection not checked')),
      readStep(1, done[1], yes(t.power.powerOk, 'Power checked', 'Power not checked'), yes(t.power.calibrationOk, 'Calibration checked', 'Calibration not checked')),
      readStep(
        2,
        done[2],
        el('p', {}, 'Error codes: ', el('span', { class: 'mono' }, t.repair.errorCodes || 'none recorded')),
        yes(t.repair.errorsFixed, 'Error codes cleared', 'Error codes not cleared'),
        yes(t.repair.partsReplaced, 'Parts replaced', 'No parts replaced'),
      ),
      readStep(
        3,
        done[3],
        el(
          'p',
          {},
          el('span', { class: t.testPrint.result ? `print-result print-${t.testPrint.result}` : 'print-result' }, t.testPrint.result === 'pass' ? 'Passed' : t.testPrint.result === 'fail' ? 'Failed' : 'No result'),
          ` after ${t.testPrint.count} print${t.testPrint.count === 1 ? '' : 's'}`,
        ),
      ),
    ),
    el(
      'section',
      { class: 'record' },
      el('h3', { class: 'record-title' }, 'Parts used'),
      parts.length
        ? el(
            'table',
            { class: 'parts-table' },
            el('thead', {}, el('tr', {}, el('th', { scope: 'col' }, 'Part'), el('th', { scope: 'col' }, 'Qty'))),
            el('tbody', {}, ...parts.map((p) => el('tr', {}, el('td', {}, p.name), el('td', {}, String(p.qty))))),
          )
        : el('p', { class: 'muted' }, 'No parts recorded.'),
    ),
    el(
      'section',
      { class: 'record' },
      el('h3', { class: 'record-title' }, 'Notes'),
      t.notes ? el('p', { class: 'notes-text' }, t.notes) : el('p', { class: 'muted' }, 'No notes.'),
    ),
    el('footer', { class: 'detail-actions' }, ...actions),
  );
}

function readStep(index: number, done: boolean, ...body: HTMLElement[]): HTMLLIElement {
  return el(
    'li',
    { class: done ? 'step is-done' : 'step' },
    el(
      'h3',
      { class: 'step-title' },
      el('span', { class: 'step-marker', 'aria-hidden': 'true' }, String(index + 1)),
      STEP_NAMES[index],
      el('span', { class: 'sr-only' }, done ? ' (done)' : ''),
    ),
    el('div', { class: 'step-body' }, ...body),
  );
}

/* ---------- wiring ---------- */

openFolderBtn.addEventListener('click', async () => {
  try {
    const handle = (await getSaveFolder()) ?? (await chooseFolder(true));
    if (handle) await loadFolder(handle, true);
  } catch (err) {
    toast(`Couldn't open the folder: ${(err as Error).message}`, 'fail');
  }
});

pickFolderBtn.addEventListener('click', async () => {
  try {
    const handle = await chooseFolder(false, 'read');
    if (handle) await loadFolder(handle, true);
  } catch (err) {
    toast(`Couldn't open the folder: ${(err as Error).message}`, 'fail');
  }
});

fileInput.addEventListener('change', () => {
  // Copy first: clearing the input empties its live FileList.
  const files = [...(fileInput.files ?? [])];
  fileInput.value = '';
  if (files.length) void loadFileList(files);
});

recentBtn.addEventListener('click', showBrowser);

search.addEventListener('input', () => {
  query = search.value.trim().toLowerCase();
  render();
});

document.querySelectorAll<HTMLButtonElement>('[data-filter]').forEach((btn) => {
  btn.addEventListener('click', () => {
    filter = (btn.dataset.filter as typeof filter) ?? 'all';
    document.querySelectorAll('[data-filter]').forEach((b) => b.setAttribute('aria-pressed', String(b === btn)));
    render();
  });
});

// Drag JSON files anywhere on the page to read them.
document.addEventListener('dragover', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  document.body.classList.add('is-dropping');
});
document.addEventListener('dragleave', (e) => {
  if (e.relatedTarget === null) document.body.classList.remove('is-dropping');
});
document.addEventListener('drop', (e) => {
  e.preventDefault();
  document.body.classList.remove('is-dropping');
  const files = [...(e.dataTransfer?.files ?? [])];
  if (files.length) void loadFileList(files);
});

async function init(): Promise<void> {
  startClock(byId('clock'));
  if (!folderSupported) {
    openFolderBtn.hidden = true;
    pickFolderBtn.hidden = true;
  }
  showBrowser();
  // If the browser still has permission for the save folder, show it straight away.
  const handle = await getSaveFolder();
  if (handle) {
    openFolderBtn.textContent = `Open ${handle.name}`;
    await loadFolder(handle, false);
  }
}

void init();
