#!/usr/bin/env node
/**
 * Local development server.
 *
 *   npm run dev        → http://localhost:8888
 *
 * Serves the static pages and routes /api/* to the same handler modules the
 * deployed functions use, so what you exercise locally is the real code path
 * rather than a mock.
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PORT) || 8888;

const ROUTES = {
  '/api/agreement': () => import('../api/agreement.js'),
  '/api/execute-nda': () => import('../api/execute-nda.js'),
  '/api/verify-nda': () => import('../api/verify-nda.js'),
  '/api/submit-idea': () => import('../api/submit-idea.js'),
  '/api/countersigned-pdf': () => import('../api/countersigned-pdf.js'),
  '/api/auth-request-link': () => import('../api/auth-request-link.js'),
  '/api/auth-verify': () => import('../api/auth-verify.js'),
  '/api/auth-logout': () => import('../api/auth-logout.js'),
  '/api/me': () => import('../api/me.js'),
  '/api/submissions': () => import('../api/submissions.js'),
  '/api/export-all': () => import('../api/export-all.js'),
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.md': 'text/plain; charset=utf-8',
};

/** Resolve a URL path to a file, adding .html and index.html as needed. */
async function resolveFile(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0]);
  // Contain the path inside ROOT.
  const target = path.resolve(ROOT, `.${path.posix.normalize(clean)}`);
  if (!target.startsWith(ROOT)) return null;

  for (const candidate of [target, `${target}.html`, path.join(target, 'index.html')]) {
    try {
      const info = await stat(candidate);
      if (info.isFile()) return candidate;
    } catch { /* keep looking */ }
  }
  return null;
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // --- API ---------------------------------------------------------------
  const route = ROUTES[url.pathname];
  if (route) {
    try {
      const { default: handler } = await route();

      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;

      const request = new Request(url.href, {
        method: req.method,
        headers: req.headers,
        body: ['GET', 'HEAD'].includes(req.method) ? undefined : body,
      });

      const response = await handler(request);
      res.writeHead(response.status, Object.fromEntries(response.headers));
      res.end(Buffer.from(await response.arrayBuffer()));
    } catch (err) {
      console.error(`[api] ${url.pathname}`, err);
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'handler_threw', message: err.message } }));
    }
    return;
  }

  // --- Static ------------------------------------------------------------
  const file = await resolveFile(url.pathname === '/' ? '/index.html' : url.pathname);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('404');
    return;
  }

  res.writeHead(200, {
    'content-type': MIME[path.extname(file)] ?? 'application/octet-stream',
    'cache-control': 'no-store',
  });
  res.end(await readFile(file));
});

server.listen(PORT, () => {
  console.log(`\n  Dev server → http://localhost:${PORT}\n`);
  if (!process.env.COUNTERSIGN_PRIVATE_KEY) {
    console.log('  Note: no COUNTERSIGN_PRIVATE_KEY set. Signatures will not survive a restart.');
    console.log('  Run `npm run keygen` to generate production keys.\n');
  }
});
