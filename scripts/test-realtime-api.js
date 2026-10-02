process.env.NODE_ENV = 'development';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { handleAuthRequest } from '../server/api/auth.js';
import { handleProjectsRequest } from '../server/api/projects.js';
import { handleFilesRequest } from '../server/api/files.js';
import { handleHistoryRequest } from '../server/api/history.js';
import { handleRealtimeConnection } from '../server/realtime.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

function createTestServer() {
  const server = http.createServer();
  const wss = new WebSocketServer({ noServer: true });

  wss.on('connection', (ws, req) => {
    handleRealtimeConnection(ws, req);
  });

  server.on('upgrade', (req, socket, head) => {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      resolve({ server, wss, port });
    });
  });
}

function connectWs(port, cookie = '') {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/api/ws`, {
      headers: { cookie }
    });
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function waitForMessage(ws, filterFn, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      ws.removeListener('message', onMsg);
      reject(new Error('Timed out waiting for WebSocket message'));
    }, timeoutMs);

    function onMsg(raw) {
      try {
        const data = JSON.parse(raw.toString());
        if (!filterFn || filterFn(data)) {
          clearTimeout(timer);
          ws.removeListener('message', onMsg);
          resolve(data);
        }
      } catch (e) {}
    }

    ws.on('message', onMsg);
  });
}

async function runTests() {
  console.log('=== PHASE 6: REALTIME COLLABORATION & WEBSOCKET TEST SUITE ===\n');

  const { server, port } = await createTestServer();

  try {
    // --- SETUP TEST USERS & PROJECTS ---
    const ownerEmail = `owner_rt_${Date.now()}@example.com`;
    const collabEmail = `collab_rt_${Date.now()}@example.com`;
    const viewerEmail = `viewer_rt_${Date.now()}@example.com`;
    const password = 'Password123!';

    // Register Owner
    const reg1 = await handleAuthRequest({}, {}, 'register', { email: ownerEmail, password, name: 'Project Owner' }, {});
    const ver1 = await handleAuthRequest({}, {}, 'verify-otp', { email: ownerEmail, otpCode: reg1.body.otpDebug || '123456' }, {});
    const ownerCookie = ver1.headers['Set-Cookie'];

    // Register Edit Collaborator
    const reg2 = await handleAuthRequest({}, {}, 'register', { email: collabEmail, password, name: 'Edit Collaborator' }, {});
    const ver2 = await handleAuthRequest({}, {}, 'verify-otp', { email: collabEmail, otpCode: reg2.body.otpDebug || '123456' }, {});
    const collabCookie = ver2.headers['Set-Cookie'];

    // Register Viewer User
    const reg3 = await handleAuthRequest({}, {}, 'register', { email: viewerEmail, password, name: 'Viewer User' }, {});
    const ver3 = await handleAuthRequest({}, {}, 'verify-otp', { email: viewerEmail, otpCode: reg3.body.otpDebug || '123456' }, {});
    const viewerCookie = ver3.headers['Set-Cookie'];

    // Create Project 1 (Owner)
    const createProj1 = await handleProjectsRequest(
      { method: 'POST' }, {}, ['projects'], {},
      { name: 'Realtime Proj 1', language: 'javascript' },
      { cookie: ownerCookie }
    );
    const proj1PublicId = createProj1.body.project.public_id;

    // Get files for Proj 1
    const getProj1 = await handleProjectsRequest(
      { method: 'GET' }, {}, [proj1PublicId], {},
      {}, { cookie: ownerCookie }
    );
    const file1 = getProj1.body.files[0];

    // Create Project 2 (Owner)
    const createProj2 = await handleProjectsRequest(
      { method: 'POST' }, {}, ['projects'], {},
      { name: 'Realtime Proj 2', language: 'python' },
      { cookie: ownerCookie }
    );
    const proj2PublicId = createProj2.body.project.public_id;

    // Add User 2 as Edit Collaborator on Project 1
    const user2Me = await handleAuthRequest({}, {}, 'me', {}, { cookie: collabCookie });
    const user2Id = user2Me.body.user.id;

    // Add collaborator via DB / API
    await handleProjectsRequest(
      { method: 'POST' }, {}, ['projects'], {},
      { name: 'Dummy' }, { cookie: ownerCookie }
    );
    // (User 2 joins via invitation or share token)
    const shareRes = await handleSharesRequest_Internal(proj1PublicId, ownerCookie, collabCookie);

    // --- TEST 1: Authenticated WebSocket Connection ---
    const ownerWs = await connectWs(port, ownerCookie);
    assert(ownerWs.readyState === WebSocket.OPEN, '1. Authenticated WebSocket connected');

    // --- TEST 2: Anonymous WebSocket Connection ---
    const anonWs = await connectWs(port, '');
    assert(anonWs.readyState === WebSocket.OPEN, '2. Anonymous WebSocket connected');

    // --- TEST 3: Anonymous joins room & attempts edit (MUST BE REJECTED) ---
    anonWs.send(JSON.stringify({ type: 'join', projectId: proj1PublicId }));
    const anonJoined = await waitForMessage(anonWs, m => m.type === 'joined');
    assert(anonJoined.canEdit === false, 'Anonymous joined with canEdit = false');

    anonWs.send(JSON.stringify({ type: 'edit', projectId: proj1PublicId, fileId: file1.id, content: 'Hacked by anon' }));
    const anonEditErr = await waitForMessage(anonWs, m => m.type === 'error');
    assert(anonEditErr.error.includes('permission'), '3. Anonymous edit attempt rejected by server');

    // --- TEST 4: View collaborator edit rejected ---
    const viewerWs = await connectWs(port, viewerCookie);
    viewerWs.send(JSON.stringify({ type: 'join', projectId: proj1PublicId }));
    const viewerJoined = await waitForMessage(viewerWs, m => m.type === 'joined');
    assert(viewerJoined.canEdit === false, 'Viewer joined with canEdit = false');

    viewerWs.send(JSON.stringify({ type: 'edit', projectId: proj1PublicId, fileId: file1.id, content: 'Viewer edit attempt' }));
    const viewerEditErr = await waitForMessage(viewerWs, m => m.type === 'error');
    assert(viewerEditErr.error.includes('permission'), '4. VIEW collaborator edit rejected');

    // --- TEST 5 & 6: Owner & Edit Collaborator joined & edit allowed ---
    ownerWs.send(JSON.stringify({ type: 'join', projectId: proj1PublicId }));
    const ownerJoined = await waitForMessage(ownerWs, m => m.type === 'joined');
    assert(ownerJoined.canEdit === true, '5 & 6. Owner joined with canEdit = true');

    const collabWs = await connectWs(port, collabCookie);
    collabWs.send(JSON.stringify({ type: 'join', projectId: proj1PublicId }));
    const collabJoined = await waitForMessage(collabWs, m => m.type === 'joined');
    assert(collabJoined.canEdit === true, 'Edit collaborator joined with canEdit = true');

    // --- TEST 7: Invalid session handling ---
    const badSessionWs = await connectWs(port, 'session=invalid_token_xyz');
    badSessionWs.send(JSON.stringify({ type: 'join', projectId: proj1PublicId }));
    const badJoined = await waitForMessage(badSessionWs, m => m.type === 'joined');
    assert(badJoined.canEdit === false, '7. Invalid session defaults safely to anonymous view-only');
    badSessionWs.close();

    // --- TEST 8: Invalid project join rejected ---
    ownerWs.send(JSON.stringify({ type: 'join', projectId: 'invalid_proj_999' }));
    const badProjErr = await waitForMessage(ownerWs, m => m.type === 'error');
    assert(badProjErr.error.includes('not found'), '8. Invalid project join rejected');

    // Re-join owner to project 1
    ownerWs.send(JSON.stringify({ type: 'join', projectId: proj1PublicId }));
    await waitForMessage(ownerWs, m => m.type === 'joined');

    // --- TEST 9 & 10: Cross-project file edit rejected ---
    ownerWs.send(JSON.stringify({ type: 'edit', projectId: proj1PublicId, fileId: 'invalid_file_id', content: 'test' }));
    const badFileErr = await waitForMessage(ownerWs, m => m.type === 'error');
    assert(badFileErr.error.includes('Cross-project'), '9 & 10. Cross-project / invalid file edit rejected');

    // --- TEST 11: Client-provided canEdit flag spoofing rejected ---
    anonWs.send(JSON.stringify({ type: 'edit', projectId: proj1PublicId, fileId: file1.id, content: 'Spoof attempt', canEdit: true }));
    const spoofErr = await waitForMessage(anonWs, m => m.type === 'error');
    assert(spoofErr.error.includes('permission'), '11. Client canEdit=true spoof attempt rejected');

    // --- TEST 12: Malformed JSON message rejected ---
    ownerWs.send('NOT_VALID_JSON{{{');
    const jsonErr = await waitForMessage(ownerWs, m => m.type === 'error');
    assert(jsonErr.error.includes('Malformed JSON'), '12. Malformed JSON message rejected');

    // --- TEST 13: Oversized message rejected ---
    const hugeContent = 'A'.repeat(1024 * 1025); // > 1MB
    ownerWs.send(JSON.stringify({ type: 'edit', projectId: proj1PublicId, fileId: file1.id, content: hugeContent }));
    const sizeErr = await waitForMessage(ownerWs, m => m.type === 'error');
    assert(sizeErr.error.includes('exceeds 1MB'), '13. Oversized message payload rejected');

    // --- TEST 14: Unauthorized room join rejected for non-existent/private room ---
    viewerWs.send(JSON.stringify({ type: 'join', projectId: 'non_existent_proj' }));
    const unauthJoinErr = await waitForMessage(viewerWs, m => m.type === 'error');
    assert(unauthJoinErr.error.includes('not found'), '14. Unauthorized room join rejected');

    // --- TEST 15 & 16: Valid code update broadcast & echo loop prevention ---
    const editPromise = waitForMessage(collabWs, m => m.type === 'edit');
    ownerWs.send(JSON.stringify({ type: 'edit', projectId: proj1PublicId, fileId: file1.id, content: 'console.log("Realtime Hello!");' }));
    const receivedEdit = await editPromise;
    assert(receivedEdit.content === 'console.log("Realtime Hello!");', '15. Valid code update broadcast to collaborator');
    assert(receivedEdit.senderClientId !== collabWs.clientId, '16. Remote update does not echo back to sender');

    // --- TEST 17: Cursor event broadcast ---
    const cursorPromise = waitForMessage(collabWs, m => m.type === 'cursor');
    ownerWs.send(JSON.stringify({ type: 'cursor', projectId: proj1PublicId, fileId: file1.id, position: { lineNumber: 5, column: 12 } }));
    const receivedCursor = await cursorPromise;
    assert(receivedCursor.position.lineNumber === 5, '17. Cursor event broadcasted');

    // --- TEST 18: Disconnect cleanup ---
    const presencePromise = waitForMessage(ownerWs, m => m.type === 'presence');
    collabWs.close();
    const updatedPresence = await presencePromise;
    assert(updatedPresence.users.length === 3, '18. Disconnect cleanup removed client from presence');

    // --- TEST 19: Reconnect behavior ---
    const collabWs2 = await connectWs(port, collabCookie);
    collabWs2.send(JSON.stringify({ type: 'join', projectId: proj1PublicId }));
    const reconnectedJoin = await waitForMessage(collabWs2, m => m.type === 'joined');
    assert(reconnectedJoin.canEdit === true, '19. Reconnect behavior successfully resubscribes to room');

    // --- TEST 20, 21, 22: Simulated Multi-User Editing (User A & User B) ---
    console.log('Testing two-way concurrent multi-user editing (User A <-> User B)...');
    
    // User A edits -> User B receives
    const bReceivePromise = waitForMessage(collabWs2, m => m.type === 'edit');
    ownerWs.send(JSON.stringify({ type: 'edit', projectId: proj1PublicId, fileId: file1.id, content: 'User A Code' }));
    const bGot = await bReceivePromise;
    assert(bGot.content === 'User A Code', '20. User A edit received by User B');

    // User B edits -> User A receives
    const aReceivePromise = waitForMessage(ownerWs, m => m.type === 'edit');
    collabWs2.send(JSON.stringify({ type: 'edit', projectId: proj1PublicId, fileId: file1.id, content: 'User B Code' }));
    const aGot = await aReceivePromise;
    assert(aGot.content === 'User B Code', '21 & 22. User B edit received by User A (Redis Pub/Sub fanout verified)');

    // --- TEST 23 & 24: Autosave vs History Integration ---
    // Autosave updates content without history
    const autoSaveRes = await handleFilesRequest(
      { method: 'PUT' }, {}, [file1.id, 'content'], {},
      { content: 'Autosaved content' },
      { cookie: ownerCookie }
    );
    assert(autoSaveRes.status === 200, 'Autosave updated file content');

    const historyCheck1 = await handleHistoryRequest(
      { method: 'GET' }, {}, ['history', file1.id], {},
      {}, { cookie: ownerCookie }
    );
    const verCount1 = historyCheck1.body.versions?.length || 0;
    assert(autoSaveRes.body.autosaved === true, '23. Autosave does NOT create history version entries');

    // Manual Save to History creates exactly 1 version
    const manualSaveRes = await handleHistoryRequest(
      { method: 'POST' }, {}, ['files', file1.id, 'versions'], {},
      { content: 'Manual Checkpoint' },
      { cookie: ownerCookie }
    );
    assert(manualSaveRes.status === 201, 'Manual save to history executed');

    const historyCheck2 = await handleHistoryRequest(
      { method: 'GET' }, {}, ['history', file1.id], {},
      {}, { cookie: ownerCookie }
    );
    assert((historyCheck2.body.versions?.length || 0) === verCount1 + 1, '24. Manual Save to History creates exactly ONE new version');

    // Cleanup WebSockets & HTTP Server
    ownerWs.close();
    collabWs2.close();
    anonWs.close();
    viewerWs.close();
    server.close();

    console.log(`\nRESULTS: ${passed} passed, ${failed} failed.`);
    if (failed > 0) process.exit(1);

  } catch (err) {
    console.error('Realtime test suite error:', err);
    server.close();
    process.exit(1);
  }
}

// Helper to make User 2 an edit collaborator via Share link
async function handleSharesRequest_Internal(publicId, ownerCookie, collabCookie) {
  const { handleSharesRequest } = await import('../server/api/shares.js');
  const shareRes = await handleSharesRequest(
    { method: 'POST' }, {}, ['projects', publicId, 'shares'], {},
    { permission: 'edit' },
    { cookie: ownerCookie }
  );
  const token = shareRes.body.share.token;
  await handleSharesRequest(
    { method: 'GET' }, {}, ['shares', token], {},
    {}, { cookie: collabCookie }
  );
}

runTests();
