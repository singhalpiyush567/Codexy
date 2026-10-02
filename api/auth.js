import { handleAuthRequest } from '../server/api/auth.js';

export default async function handler(req, res) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const pathname = url.pathname.replace(/\/$/, '');
  const parts = pathname.split('/');
  const action = parts[parts.length - 1] || 'me';

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {}
  } else if (!body && req.method !== 'GET') {
    // Parse body stream if needed
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const data = Buffer.concat(buffers).toString();
    try { body = JSON.parse(data); } catch (e) { body = {}; }
  }

  const result = await handleAuthRequest(req, res, action, body, req.headers);

  if (result.headers) {
    Object.entries(result.headers).forEach(([k, v]) => {
      res.setHeader(k, v);
    });
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(result.status).send(JSON.stringify(result.body));
}
