// Run the app on any computer with Node.js 20+:  npm start
// (On Vercel this file is not used; api/code.js and public/ are served directly.)

import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

try {
  process.loadEnvFile(); // reads .env if there is one
} catch {}

const { createHandler } = await import('./lib/handler.js');

const PUBLIC_DIR = fileURLToPath(new URL('./public/', import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const api = createHandler();

const server = createServer(async (req, res) => {
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');

  const { pathname } = new URL(req.url, 'http://localhost');
  if (pathname === '/api/code') return api(req, res);

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    return res.end();
  }
  let file;
  try {
    file = normalize(join(PUBLIC_DIR, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
  } catch {
    file = null;
  }
  if (!file || !file.startsWith(PUBLIC_DIR.replace(/[\\/]$/, '') + sep)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  try {
    const body = await readFile(file);
    res.setHeader('Content-Type', TYPES[extname(file)] || 'application/octet-stream');
    res.setHeader('Cache-Control', extname(file) === '.html' ? 'no-cache' : 'public, max-age=3600');
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch {
    res.statusCode = 404;
    res.end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`Netflix OTP is running on http://localhost:${PORT}`);
});
