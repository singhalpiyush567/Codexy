import base44 from "@base44/vite-plugin";
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { handleAuthRequest } from './server/api/auth.js';

function apiDevMiddleware() {
  return {
    name: 'codexy-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url.startsWith('/api/auth')) {
          const host = req.headers.host || 'localhost';
          const url = new URL(req.url, `http://${host}`);
          const pathname = url.pathname.replace(/\/$/, '');
          const parts = pathname.split('/');
          const action = parts[parts.length - 1] || 'me';

          let body = {};
          if (req.method !== 'GET') {
            const buffers = [];
            for await (const chunk of req) {
              buffers.push(chunk);
            }
            const data = Buffer.concat(buffers).toString();
            try { body = JSON.parse(data); } catch (e) {}
          }

          const result = await handleAuthRequest(req, res, action, body, req.headers);

          if (result.headers) {
            Object.entries(result.headers).forEach(([k, v]) => {
              res.setHeader(k, v);
            });
          }

          res.setHeader('Content-Type', 'application/json');
          res.statusCode = result.status;
          res.end(JSON.stringify(result.body));
          return;
        }
        next();
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    apiDevMiddleware(),
    base44({
      legacySDKImports: process.env.BASE44_LEGACY_SDK_IMPORTS === 'true',
      hmrNotifier: true,
      navigationNotifier: true,
      analyticsTracker: true,
      visualEditAgent: true
    }),
    react(),
  ]
});
