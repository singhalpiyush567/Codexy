import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { getUserBySession } from './auth.js';
import { checkProjectPermission } from './projects.js';
import { query } from './db.js';

// In-memory rooms: projectId -> Set of WebSocket clients
const rooms = new Map();

// In-memory pub/sub broker fallback when Redis is not configured
const memorySubscribers = new Map();

// Rate limiting: wsClient -> { count, resetAt }
const clientRateLimits = new Map();

function checkWsRateLimit(ws) {
  const now = Date.now();
  let record = clientRateLimits.get(ws);
  if (!record || now > record.resetAt) {
    record = { count: 0, resetAt: now + 1000 };
    clientRateLimits.set(ws, record);
  }
  record.count += 1;
  return record.count <= 100; // 100 messages per second limit
}

// In-memory Pub/Sub channel publish
function publishToChannel(channel, message) {
  const subscribers = memorySubscribers.get(channel);
  if (subscribers) {
    subscribers.forEach(cb => {
      try { cb(message); } catch (e) {}
    });
  }
}

// In-memory Pub/Sub channel subscribe
function subscribeToChannel(channel, callback) {
  if (!memorySubscribers.has(channel)) {
    memorySubscribers.set(channel, new Set());
  }
  memorySubscribers.get(channel).add(callback);
  return () => {
    const subSet = memorySubscribers.get(channel);
    if (subSet) {
      subSet.delete(callback);
      if (subSet.size === 0) memorySubscribers.delete(channel);
    }
  };
}

/**
 * Handle a single WebSocket connection
 */
export async function handleRealtimeConnection(ws, req) {
  const cookieHeader = req?.headers?.cookie || '';
  let user = null;
  try {
    user = await getUserBySession(cookieHeader);
  } catch (e) {
    user = null;
  }

  const clientId = crypto.randomBytes(8).toString('hex');
  let currentRoomId = null;
  let currentPermission = null;
  let seat = 1;
  let unsubscribeRedis = null;

  ws.isAlive = true;
  ws.clientId = clientId;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', async (rawMsg) => {
    // 1. Rate limiting check
    if (!checkWsRateLimit(ws)) {
      sendJson(ws, { type: 'error', error: 'Rate limit exceeded. Too many messages.' });
      return;
    }

    // 2. Payload size check (Max 1 MB)
    if (typeof rawMsg === 'string' && rawMsg.length > 1024 * 1024) {
      sendJson(ws, { type: 'error', error: 'Message payload size exceeds 1MB limit' });
      return;
    }
    if (Buffer.isBuffer(rawMsg) && rawMsg.length > 1024 * 1024) {
      sendJson(ws, { type: 'error', error: 'Message payload size exceeds 1MB limit' });
      return;
    }

    // 3. Parse JSON
    let msg;
    try {
      msg = JSON.parse(rawMsg.toString());
    } catch (e) {
      sendJson(ws, { type: 'error', error: 'Malformed JSON payload' });
      return;
    }

    if (!msg || typeof msg !== 'object' || !msg.type) {
      sendJson(ws, { type: 'error', error: 'Message type is required' });
      return;
    }

    // 4. Handle Event Types
    try {
      switch (msg.type) {
        case 'ping': {
          sendJson(ws, { type: 'pong' });
          break;
        }

        case 'join': {
          const { projectId } = msg;
          if (!projectId || typeof projectId !== 'string') {
            sendJson(ws, { type: 'error', error: 'projectId is required to join a room' });
            return;
          }

          // SERVER-SIDE AUTHORIZATION CHECK: Check actual DB permission for project
          const perm = await checkProjectPermission(projectId, user);
          if (!perm.exists) {
            sendJson(ws, { type: 'error', error: 'Project not found' });
            return;
          }

          if (!perm.canView) {
            sendJson(ws, { type: 'error', error: 'You do not have permission to view this project' });
            return;
          }

          // Leave previous room if any
          if (currentRoomId && rooms.has(currentRoomId)) {
            leaveRoom(currentRoomId, ws);
          }

          currentRoomId = projectId;
          currentPermission = perm;

          if (!rooms.has(currentRoomId)) {
            rooms.set(currentRoomId, new Set());
          }
          const roomClients = rooms.get(currentRoomId);

          // Calculate next seat ID
          const existingSeats = Array.from(roomClients).map(c => c.seat || 1);
          seat = existingSeats.length > 0 ? Math.max(...existingSeats) + 1 : 1;
          ws.seat = seat;
          ws.projectId = currentRoomId;
          ws.user = user;
          ws.userName = user ? user.name : 'Guest User';
          ws.canEdit = perm.canEdit;

          roomClients.add(ws);

          // Subscribe to Pub/Sub channel for this project
          const channel = `codexy:project:${currentRoomId}`;
          if (unsubscribeRedis) unsubscribeRedis();
          unsubscribeRedis = subscribeToChannel(channel, (pubMsg) => {
            if (pubMsg.senderClientId !== clientId && ws.readyState === 1) {
              sendJson(ws, pubMsg);
            }
          });

          // Send success ack to joining client
          sendJson(ws, {
            type: 'joined',
            projectId: currentRoomId,
            seat,
            canEdit: perm.canEdit,
            role: perm.role,
            userName: ws.userName
          });

          // Broadcast presence to room
          broadcastPresence(currentRoomId);
          break;
        }

        case 'edit': {
          const { projectId, fileId, content } = msg;
          if (!currentRoomId || currentRoomId !== projectId) {
            sendJson(ws, { type: 'error', error: 'You must join the project room before sending edits' });
            return;
          }

          if (typeof fileId !== 'string' || typeof content !== 'string') {
            sendJson(ws, { type: 'error', error: 'Invalid edit payload parameters' });
            return;
          }

          // STRICT SERVER-SIDE EDIT AUTHORIZATION CHECK
          if (!ws.canEdit) {
            sendJson(ws, { type: 'error', error: 'You do not have edit permission for this project' });
            return;
          }

          // Verify file belongs to current project in DB
          const fileCheck = await query(
            `SELECT f.id FROM project_files f JOIN projects p ON f.project_id = p.id WHERE f.id = $1 AND p.public_id = $2`,
            [fileId, projectId]
          );

          if (fileCheck.rows.length === 0) {
            sendJson(ws, { type: 'error', error: 'Cross-project file edit rejected' });
            return;
          }

          // Broadcast code edit to other clients in room via Pub/Sub & local WS
          const eventPayload = {
            type: 'edit',
            projectId,
            fileId,
            content,
            seat: ws.seat,
            senderClientId: clientId,
            timestamp: Date.now()
          };

          broadcastToRoom(currentRoomId, eventPayload, clientId);
          publishToChannel(`codexy:project:${currentRoomId}`, eventPayload);
          break;
        }

        case 'cursor': {
          const { projectId, fileId, position } = msg;
          if (!currentRoomId || currentRoomId !== projectId) return;

          const eventPayload = {
            type: 'cursor',
            projectId,
            fileId,
            position,
            seat: ws.seat,
            senderClientId: clientId
          };

          broadcastToRoom(currentRoomId, eventPayload, clientId);
          publishToChannel(`codexy:project:${currentRoomId}`, eventPayload);
          break;
        }

        case 'selection': {
          const { projectId, fileId, selection } = msg;
          if (!currentRoomId || currentRoomId !== projectId) return;

          const eventPayload = {
            type: 'selection',
            projectId,
            fileId,
            selection,
            seat: ws.seat,
            senderClientId: clientId
          };

          broadcastToRoom(currentRoomId, eventPayload, clientId);
          publishToChannel(`codexy:project:${currentRoomId}`, eventPayload);
          break;
        }

        case 'presence': {
          if (!currentRoomId) return;
          if (msg.name && typeof msg.name === 'string') {
            ws.userName = msg.name.slice(0, 40);
          }
          broadcastPresence(currentRoomId);
          break;
        }

        default: {
          sendJson(ws, { type: 'error', error: `Unknown event type: ${msg.type}` });
          break;
        }
      }
    } catch (err) {
      console.error('[REALTIME_ERROR] Error processing WS message:', err);
      sendJson(ws, { type: 'error', error: 'Internal server error processing message' });
    }
  });

  ws.on('close', () => {
    clientRateLimits.delete(ws);
    if (unsubscribeRedis) unsubscribeRedis();
    if (currentRoomId) {
      leaveRoom(currentRoomId, ws);
    }
  });

  ws.on('error', (err) => {
    console.error('[REALTIME_WS_ERROR]', err);
  });
}

function leaveRoom(projectId, ws) {
  const roomClients = rooms.get(projectId);
  if (roomClients) {
    roomClients.delete(ws);
    if (roomClients.size === 0) {
      rooms.delete(projectId);
    } else {
      broadcastPresence(projectId);
    }
  }
}

function broadcastToRoom(projectId, payload, excludeClientId = null) {
  const roomClients = rooms.get(projectId);
  if (!roomClients) return;

  for (const client of roomClients) {
    if (client.clientId !== excludeClientId && client.readyState === 1) {
      sendJson(client, payload);
    }
  }
}

function broadcastPresence(projectId) {
  const roomClients = rooms.get(projectId);
  if (!roomClients) return;

  const usersList = Array.from(roomClients).map(c => ({
    name: c.userName || 'Guest User',
    seat: c.seat,
    canEdit: c.canEdit,
    role: c.user ? 'collaborator' : 'guest'
  }));

  const payload = {
    type: 'presence',
    projectId,
    users: usersList
  };

  for (const client of roomClients) {
    if (client.readyState === 1) {
      sendJson(client, payload);
    }
  }
}

function sendJson(ws, obj) {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(obj));
  }
}

/**
 * Helper function for programmatic test suite connection handling
 */
export function createMockRealtimeServer() {
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws, req) => {
    handleRealtimeConnection(ws, req);
  });
  return wss;
}
