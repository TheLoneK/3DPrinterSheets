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
- Up to 100 tickets can be open at once. Clicking **New ticket by hand** again reuses an untouched blank ticket instead of adding another.
- Invisible control characters (which some scanners send) are removed, and leading/trailing spaces are trimmed when you leave a field.
- Finishing a ticket warns about things that don't add up: a duplicate serial, a test print result with 0 prints, parts listed without **Parts replaced** checked (or the reverse), or a part with quantity 0.

## Developing

```bash
npm install
npm run build     # compiles src/*.ts to dist/js and copies public/ into dist/
npm run preview   # serves dist/ at http://127.0.0.1:5173 (HOST=0.0.0.0 to share it on the network)
npm run watch     # recompiles TypeScript on change (copy public/ again with a build if you edit it)
```

- `src/` — TypeScript (`main.ts` tickets page, `reader.ts` reader, `model.ts` data and validation, `store.ts` browser storage, `folder.ts` folder saving).
- `public/` — HTML, CSS and the icon.

## Deploying to GitHub Pages

The workflow in `.github/workflows/deploy.yml` builds and deploys on every push to `main`.

1. In the repo on GitHub: **Settings → Pages → Build and deployment → Source: GitHub Actions**.
2. Push to `main` (or run the workflow from the **Actions** tab).
3. The site appears at `https://thelonek.github.io/3DPrinterSheets/`.

## Security notes

- Nothing leaves the browser: tickets live in this browser's storage and in the folder you choose. There is no server or login.
- Both pages set a strict Content-Security-Policy (scripts only from this site, no inline scripts, Trusted Types on) and send no referrer.
- Forms opened in the reader are treated as untrusted: they're size-limited, validated field by field, and only shown as text.
- The only third-party request is Google Fonts. If your network blocks it, the pages fall back to system fonts.
- The deploy workflow pins its actions to commit SHAs and gives write access only to the deploy job.
