import { defineConfig } from 'vite';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// The 99 focus-music MP3s live OUTSIDE the app (in "<repo>/Music Database", ~500 MB)
// so they're never bundled into the Vite build. In dev, this middleware streams them
// at /music-lib/<Genre folder>/<file>.mp3 (the paths src/focus/library.ts references),
// with HTTP range support so <audio> can seek. Production serves them from static
// hosting / Firebase Storage instead (deploy-time concern).
const MUSIC_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'Music Database');
const musicLibPlugin = {
  name: 'workspace-music-lib',
  configureServer(server: { middlewares: { use: (p: string, fn: (req: any, res: any, next: () => void) => void) => void } }) {
    server.middlewares.use('/music-lib', (req, res, next) => {
      try {
        const rel = decodeURIComponent((req.url || '').split('?')[0]).replace(/^\/+/, '');
        const filePath = path.join(MUSIC_ROOT, rel);
        // Path-traversal guard: the resolved path must stay inside MUSIC_ROOT.
        if (filePath !== MUSIC_ROOT && !filePath.startsWith(MUSIC_ROOT + path.sep)) {
          res.statusCode = 403;
          return res.end('forbidden');
        }
        const stat = fs.statSync(filePath, { throwIfNoEntry: false });
        if (!stat || !stat.isFile()) {
          res.statusCode = 404;
          return res.end('not found');
        }
        const type = filePath.toLowerCase().endsWith('.mp3') ? 'audio/mpeg' : 'application/octet-stream';
        res.setHeader('Accept-Ranges', 'bytes');
        res.setHeader('Content-Type', type);
        const range = req.headers?.range as string | undefined;
        const m = range && /bytes=(\d*)-(\d*)/.exec(range);
        if (m) {
          let start = m[1] ? parseInt(m[1], 10) : 0;
          let end = m[2] ? parseInt(m[2], 10) : stat.size - 1;
          if (Number.isNaN(start)) start = 0;
          if (Number.isNaN(end) || end >= stat.size) end = stat.size - 1;
          res.statusCode = 206;
          res.setHeader('Content-Range', `bytes ${start}-${end}/${stat.size}`);
          res.setHeader('Content-Length', end - start + 1);
          fs.createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.setHeader('Content-Length', stat.size);
          fs.createReadStream(filePath).pipe(res);
        }
      } catch {
        next();
      }
    });
  },
};

// Cobalt web app: Vite config.
// PWA service worker lives in /public/sw.js and is registered from main.ts.
export default defineConfig({
  plugins: [musicLibPlugin],
  // Keep Vite's dependency-optimizer cache OUTSIDE the Dropbox folder. Dropbox locks
  // node_modules/.vite mid-sync, so Vite's atomic rename of the re-bundled deps fails
  // (EBUSY) — which blanks the whole app whenever a new dependency is first imported.
  // AppData\Local (Windows) / tmp (else) is local and never synced.
  cacheDir: path.join(process.env.LOCALAPPDATA || os.tmpdir(), 'vite-workspace-cache'),
  server: {
    port: 5173,
    host: true,
    // The project lives in a Dropbox folder, which swallows OS file-change
    // events and breaks HMR. Polling makes Vite detect saves reliably.
    watch: { usePolling: true, interval: 300 },
    // Dev-only CORS bypass for the Schoology iCal feed (Schoology serves no
    // CORS headers, so the browser can't fetch it directly). In production the
    // scheduled Cloud Function does the fetch server-side instead.
    // v1 is single-school (Heschel); Phase 6 makes this per-schoolDomain.
    proxy: {
      '/sgy': {
        target: 'https://heschel.schoology.com',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/sgy/, ''),
      },
    },
  },
  build: {
    target: 'es2021',
    outDir: 'dist',
    // OFF for production: sourcemap:true publishes the complete TypeScript source
    // alongside the bundle, and the deployed site served every .map file to anyone
    // who asked (confirmed live 9/3/26). Flip to true temporarily if you need to
    // debug a minified stack trace, then flip it back before deploying.
    sourcemap: false,
  },
});
