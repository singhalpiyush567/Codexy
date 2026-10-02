import http from 'node:http';
import { WebSocketServer } from 'ws';
import { handleRealtimeConnection } from './realtime.js';

const PORT = process.env.PORT || 3001;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim().toLowerCase())
  : null;

function isOriginAllowed(origin) {
  if (!ALLOWED_ORIGINS || ALLOWED_ORIGINS.length === 0) return true;
  if (!origin) return true; // Allow non-browser / tool clients in dev if needed
  return ALLOWED_ORIGINS.includes(origin.toLowerCase());
}

// Create HTTP server for health checks & WebSocket upgrades
const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  // CORS Headers
  const origin = req.headers.origin;
  if (isOriginAllowed(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin || '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  if (url.pathname === '/health' || url.pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'ok',
      service: 'codexy-realtime',
      timestamp: new Date().toISOString()
    }));
    return;
  }

  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not Found' }));
});

// Create WebSocket Server without attached server initially
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket Connection
wss.on('connection', (ws, req) => {
  handleRealtimeConnection(ws, req);
});

// Handle Upgrade Request
server.on('upgrade', (req, socket, head) => {
  const origin = req.headers.origin;

  if (!isOriginAllowed(origin)) {
    socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
    socket.destroy();
    return;
  }

  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/ws') || url.pathname.startsWith('/ws') || url.pathname === '/') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  } else {
    socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
    socket.destroy();
  }
});

// Start Server
server.listen(PORT, () => {
  console.log(`[CodeXY Realtime Gateway] Persistent WebSocket server running on port ${PORT}`);
});

// Graceful Shutdown Handler
function gracefulShutdown(signal) {
  console.log(`[CodeXY Realtime Gateway] ${signal} received. Shutting down gracefully...`);
  
  // Close all client WebSocket connections
  for (const client of wss.clients) {
    try {
      client.close(1001, 'Server shutting down');
    } catch (e) {}
  }

  wss.close(() => {
    console.log('[CodeXY Realtime Gateway] WebSocket server closed.');
    server.close(() => {
      console.log('[CodeXY Realtime Gateway] HTTP server closed.');
      process.exit(0);
    });
  });

  // Force exit if shutdown hangs after 5s
  setTimeout(() => {
    console.error('[CodeXY Realtime Gateway] Forced exit after timeout.');
    process.exit(1);
  }, 5000);
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
