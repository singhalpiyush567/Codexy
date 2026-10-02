import { handleSharesRequest } from '../server/api/shares.js';

export default async function handler(req, res) {
  const host = req.headers.host || 'localhost';
  const url = new URL(req.url, `http://${host}`);
  const pathname = url.pathname.replace(/\/$/, '');
  const parts = pathname.split('/').filter(Boolean);
  const pathParts = parts.slice(1);

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) {}
  } else if (!body && req.method === 'POST') {
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const data = Buffer.concat(buffers).toString();
    try { body = JSON.parse(data); } catch (e) { body = {}; }
  }

  const queryParams = Object.fromEntries(url.searchParams.entries());
  const result = await handleSharesRequest(req, res, pathParts, queryParams, body, req.headers);

  if (result.headers) {
    Object.entries(result.headers).forEach(([k, v]) => {
      res.setHeader(k, v);
    });
  }

  res.setHeader('Content-Type', 'application/json');
  res.status(result.status).send(JSON.stringify(result.body));
}
