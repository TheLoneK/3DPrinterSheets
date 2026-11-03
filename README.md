# 3DPrinterSheets
Quick utility to optimize tracking workflow of 3d printer repairs.

A small TypeScript web app with two pages:

- **Tickets** (`index.html`) — open repair tickets by scanning printer barcodes (back to back is fine) or by hand, then work through the checklist: visual inspection, power and calibration, error codes and parts, test print (pass/fail plus a 0–9 print count), parts used, and notes. Open tickets autosave in the browser until they're finished as passed or failed.
- **Saved forms** (`reader.html`) — read forms from the save folder, from individual files, or from the last 50 tickets finished in this browser. Search, filter by status, print, or reopen a form as a ticket.

## Using it

- Any USB or Bluetooth scanner in keyboard (HID) mode works. Each scan ends with Enter (or Tab) and opens a ticket. Scanning a serial that's already open jumps to that ticket.
- Press **Esc** in any field to jump back to the scan box. Typing while nothing is focused also goes to the scan box.
- In **Parts used**, Enter moves to the next line (adding one if needed), so you can scan part barcodes one after another.
- **Save to folder** writes one JSON file per ticket (`<serial>_<opened date-time>.json`). Saving again, or finishing, overwrites that same file.
- In Chrome or Edge you pick the folder once and it's remembered. Other browsers download the file instead.
- Text fields are capped at 32 characters (error codes 64, notes 2000).

## Developing

```bash
npm install
npm run build     # compiles src/*.ts to dist/js and copies public/ into dist/
npm run preview   # serves dist/ at http://localhost:5173
npm run watch     # recompiles TypeScript on change (copy public/ again with a build if you edit it)
```

- `src/` — TypeScript (`main.ts` tickets page, `reader.ts` reader, `model.ts` data and validation, `store.ts` browser storage, `folder.ts` folder saving).
- `public/` — HTML, CSS and the icon.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.

1. In the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the workflow from the **Actions** tab).
3. The site appears at `https://thelonek.github.io/3DPrinterSheets/`.
