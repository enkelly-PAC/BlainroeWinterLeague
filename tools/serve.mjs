import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, dirname, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 8080);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.csv': 'text/csv', '.md': 'text/plain' };
const server = createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const target = resolve(root, `.${pathname === '/' ? '/index.html' : pathname}`);
    const relative = target.slice(root.length + 1);
    if (!target.startsWith(root + sep) || relative.split(/[\\/]/).some(part => part.startsWith('.')) || !types[extname(target)]) {
      res.writeHead(403); res.end('Forbidden'); return;
    }
    const content = await readFile(target);
    res.writeHead(200, { 'Content-Type': `${types[extname(target)]}${extname(target) === '.png' ? '' : '; charset=utf-8'}`, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : content);
  } catch {
    res.writeHead(404); res.end('Not found');
  }
});
server.listen(port, '127.0.0.1', () => console.log(`Local preview: http://127.0.0.1:${port}. Stop with Ctrl+C. No backend publishing.`));
