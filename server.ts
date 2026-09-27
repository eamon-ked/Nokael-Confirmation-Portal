import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    // Serve static files in production
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));

    // Driver web app (PWA), built into dist/driver-app by `npm run build:driver`.
    // Shared with drivers as https://coc.nokael.com/driver-app/ — its routes live in
    // the URL hash, so anything else under the prefix just gets its index.html.
    const driverAppPath = path.join(distPath, 'driver-app');
    app.get('/driver-app/*', (req, res) => {
      // A missing file (e.g. an old hashed asset) is a real 404, never the HTML page.
      if (path.extname(req.path)) return res.sendStatus(404);
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(driverAppPath, 'index.html'));
    });

    // Client dashboard, built into dist/portal by `npm run build:portal` (own codebase
    // in client-portal/). Registered before the SPA catch-all so /portal/* never falls
    // through to the confirmation app's /:token/:step route.
    const portalPath = path.join(distPath, 'portal');
    app.use('/portal', express.static(portalPath, { index: false }));
    app.get(['/portal', '/portal/*'], (req, res) => {
      if (path.extname(req.path)) return res.sendStatus(404);
      res.set('Cache-Control', 'no-cache');
      res.sendFile(path.join(portalPath, 'index.html'));
    });
    
    // Handle SPA routing
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(Number(PORT), '0.0.0.0', () => {
    console.log(`Server running at http://localhost:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
