import base44 from "@base44/vite-plugin";
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { handleAuthRequest } from './server/api/auth.js';
import { handleProjectsRequest } from './server/api/projects.js';
import { handleFilesRequest } from './server/api/files.js';

function apiDevMiddleware() {
  return {
    name: 'codexy-api-dev-middleware',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url.startsWith('/api/')) return next();

        const host = req.headers.host || 'localhost';
        const url = new URL(req.url, `http://${host}`);
        const pathname = url.pathname.replace(/\/$/, '');
        const parts = pathname.split('/').filter(Boolean); // ['api', 'route', ...]
        const route = parts[1];
        const pathParts = parts.slice(1);

        let body = {};
        if (req.method !== 'GET') {
          const buffers = [];
          for await (const chunk of req) {
            buffers.push(chunk);
          }
          const data = Buffer.concat(buffers).toString();
          try { body = JSON.parse(data); } catch (e) {}
        }

        const queryParams = Object.fromEntries(url.searchParams.entries());
        let result = null;

        if (route === 'auth') {
          const action = parts[parts.length - 1] || 'me';
          result = await handleAuthRequest(req, res, action, body, req.headers);
        } else if (route === 'projects') {
          result = await handleProjectsRequest(req, res, pathParts, queryParams, body, req.headers);
        } else if (route === 'files') {
          result = await handleFilesRequest(req, res, pathParts, queryParams, body, req.headers);
        } else {
          return next();
        }

        if (result.headers) {
          Object.entries(result.headers).forEach(([k, v]) => {
            res.setHeader(k, v);
          });
        }

        res.setHeader('Content-Type', 'application/json');
        res.statusCode = result.status;
        res.end(JSON.stringify(result.body));
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
