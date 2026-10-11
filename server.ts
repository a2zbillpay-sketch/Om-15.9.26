import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';

// Check if tsx loader is active
const isTsxLoaded =
  process.execArgv.some((arg) => arg.includes('tsx')) ||
  process.env.TSX_LOADED === 'true';

if (!isTsxLoaded) {
  // If invoked via plain `node server.ts`, re-exec with `--import tsx` to ensure
  // TypeScript resolution for relative files and nested modules.
  const currentFile = fileURLToPath(import.meta.url);
  const child = spawn(process.execPath, ['--import', 'tsx', currentFile, ...process.argv.slice(2)], {
    stdio: 'inherit',
    env: { ...process.env, TSX_LOADED: 'true' },
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    }
    process.exit(code ?? 0);
  });
} else {
  startAppServer().catch((err) => {
    console.error('Fatal error starting server:', err);
    process.exit(1);
  });
}

async function startAppServer() {
  const express = (await import('express')).default;
  const dotenv = (await import('dotenv')).default;

  dotenv.config();

  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const HOST = '0.0.0.0';
  const rootDir = process.cwd();
  const distDir = path.resolve(rootDir, 'dist');
  const publicDir = path.resolve(rootDir, 'public');

  // Health check routes for Cloud Run / load balancers
  app.get(['/healthz', '/health'], (_req, res) => {
    res.status(200).json({ ok: true, status: 'healthy', timestamp: Date.now() });
  });

  // Dedicated manifest endpoint with proper MIME headers
  app.get('/manifest.json', (_req, res) => {
    const manifestPath = path.resolve(publicDir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      res.setHeader('Content-Type', 'application/manifest+json; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      fs.createReadStream(manifestPath).pipe(res);
    } else {
      res.status(404).send('Manifest not found');
    }
  });

  // AI Studio media assets helper
  app.use('/assets/aistudio', (req, res, next) => {
    const rawPath = req.url.split('?')[0].split('#')[0];
    try {
      const decodedPath = decodeURIComponent(rawPath);
      const safeRelativePath = decodedPath.replace(/^\//, '');
      const aistudioDir = path.resolve(publicDir, 'assets', 'aistudio');
      const filePath = path.resolve(aistudioDir, safeRelativePath);
      if (filePath.startsWith(aistudioDir + path.sep) && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return res.sendFile(filePath);
      }
    } catch {
      // Fall through to next
    }
    next();
  });

  // API router dispatcher
  app.all('/api/*', async (req, res) => {
    const pathname = (req.originalUrl || req.url || '').split('?')[0].split('#')[0];
    const relativePath = pathname.replace(/^\/api\/?/, '');

    // Try finding the route handler file (.ts or .js or index)
    let targetPath = path.resolve(rootDir, 'api', `${relativePath}.ts`);
    if (!fs.existsSync(targetPath)) {
      targetPath = path.resolve(rootDir, 'api', relativePath, 'index.ts');
    }
    if (!fs.existsSync(targetPath)) {
      targetPath = path.resolve(rootDir, 'api', `${relativePath}.js`);
    }
    if (!fs.existsSync(targetPath)) {
      targetPath = path.resolve(rootDir, 'api', relativePath, 'index.js');
    }

    if (fs.existsSync(targetPath)) {
      try {
        const mod = await import(targetPath);
        const handler = mod.default || mod.handler;
        if (typeof handler === 'function') {
          return await handler(req, res);
        }
      } catch (err: any) {
        console.error(`API Error on ${pathname}:`, err);
        if (!res.headersSent) {
          return res.status(500).json({ error: err?.message || 'Internal Server Error' });
        }
        return;
      }
    }

    if (!res.headersSent) {
      res.status(404).json({ error: `Endpoint /api/${relativePath} not found` });
    }
  });

  const isDistBuilt = fs.existsSync(path.resolve(distDir, 'index.html'));
  const isProduction = process.env.NODE_ENV === 'production' || isDistBuilt;

  if (!isProduction) {
    // In local dev mode without dist, attach Vite middlewares
    const { createServer } = await import('vite');
    const vite = await createServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static frontend assets from public and dist
    app.use(express.static(publicDir));
    app.use(express.static(distDir));

    // Fallback to index.html for client-side SPA routing
    app.get('*', (_req, res) => {
      const indexPath = path.resolve(distDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Application build not found. Run npm run build first.');
      }
    });
  }

  const server = app.listen(PORT, HOST, () => {
    console.log(`Server listening on http://${HOST}:${PORT} (mode: ${isProduction ? 'production' : 'development'})`);
  });

  const gracefulShutdown = (signal: string) => {
    console.log(`${signal} received: closing HTTP server gracefully...`);
    server.close(() => {
      console.log('HTTP server closed.');
      process.exit(0);
    });
  };

  process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
  process.on('SIGINT', () => gracefulShutdown('SIGINT'));
}
