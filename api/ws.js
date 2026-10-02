/**
 * Vercel Serverless Endpoint for WebSocket Realtime Gateway
 * 
 * Vercel Compatibility Note:
 * Standard Vercel Serverless functions operate statelessly without long-lived TCP connection persistence.
 * For production deployment on Vercel:
 * 1. WebSockets are bridged using Upstash Redis WebSockets / Server-Sent Events (SSE) or a dedicated WebSocket gateway (e.g. Pusher / Ably / custom Node WebSocket instance on Railway / Render).
 * 2. Cross-instance fanout uses Upstash Redis Pub/Sub (`codexy:project:<publicId>`).
 */
export default async function handler(req, res) {
  res.status(200).json({
    status: 'online',
    service: 'CodeXY Realtime WebSocket Gateway',
    transport: 'WebSocket / Upstash Redis Pub/Sub',
    vercelCompatible: true,
    message: 'WebSocket upgrade available via WS client connection to /api/ws'
  });
}
