// Tiny static server for previewing dist/ locally: npm run build && npm run preview
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = fileURLToPath(new URL('../dist', import.meta.url));
const port = Number(process.env.PORT) || 5173;
// Local only by default. Set HOST=0.0.0.0 to show the preview to other machines on the network.
const host = process.env.HOST || '127.0.0.1';
const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.map': 'application/json',
};

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const decoded = decodeURIComponent(url.pathname);
    if (decoded.includes('\0')) throw new Error('bad path');
    let path = normalize(join(dist, decoded));
    // Must stay inside dist/ itself (a plain startsWith would also allow a sibling like dist-old/).
    if (path !== dist && !path.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
    if ((await stat(path)).isDirectory()) path = join(path, 'index.html');
    const body = await readFile(path);
    res.writeHead(200, {
      'Content-Type': types[extname(path)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'no-store',
    }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, host, () => console.log(`Preview at http://${host === '0.0.0.0' ? 'localhost' : host}:${port}/`));
