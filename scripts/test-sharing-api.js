process.env.NODE_ENV = 'development';
import { handleAuthRequest } from '../server/api/auth.js';
import { handleProjectsRequest } from '../server/api/projects.js';
import { handleFilesRequest } from '../server/api/files.js';
import { handleSharesRequest } from '../server/api/shares.js';

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

async function runTests() {
  console.log('=== PHASE 5: SHARING, INVITATIONS & JOIN CODES TEST SUITE ===\n');

  // 1. Create User 1 (Owner) and User 2 (Collaborator)
  const user1Email = `owner_${Date.now()}@example.com`;
  const user2Email = `collab_${Date.now()}@example.com`;
  const password = 'Password123!';

  const reg1 = await handleAuthRequest({}, {}, 'register', { email: user1Email, password, name: 'Project Owner' }, {});
  assert(reg1.status === 200, 'User 1 registered successfully');
  const otp1 = reg1.body.otpDebug || '123456';
  const ver1 = await handleAuthRequest({}, {}, 'verify-otp', { email: user1Email, otpCode: otp1 }, {});
  assert(ver1.status === 200, 'User 1 OTP verified');
  const cookie1 = ver1.headers['Set-Cookie'];

  const reg2 = await handleAuthRequest({}, {}, 'register', { email: user2Email, password, name: 'Collaborator User' }, {});
  assert(reg2.status === 200, 'User 2 registered successfully');
  const otp2 = reg2.body.otpDebug || '123456';
  const ver2 = await handleAuthRequest({}, {}, 'verify-otp', { email: user2Email, otpCode: otp2 }, {});
  assert(ver2.status === 200, 'User 2 OTP verified');
  const cookie2 = ver2.headers['Set-Cookie'];

  // 2. User 1 creates a project
  const createProj = await handleProjectsRequest(
    { method: 'POST' }, {}, ['projects'], {},
    { name: 'Sharing Test Project', language: 'javascript' },
    { cookie: cookie1 }
  );
  assert(createProj.status === 201, 'Project created by User 1');
  const project = createProj.body.project;

  const getProj = await handleProjectsRequest(
    { method: 'GET' }, {}, [project.public_id], {},
    {}, { cookie: cookie1 }
  );
  assert(getProj.status === 200, 'Fetched project files');
  const files = getProj.body.files;
  const file1 = files[0];

  // 3. Create Share Link (VIEW ONLY)
  const viewShareRes = await handleSharesRequest(
    { method: 'POST' }, {}, ['projects', project.public_id, 'shares'], {},
    { permission: 'view' },
    { cookie: cookie1 }
  );
  if (viewShareRes.status !== 201) console.error('viewShareRes error:', viewShareRes);
  assert(viewShareRes.status === 201, 'Created VIEW share link');
  const viewToken = viewShareRes.body.share.token;

  // 4. Anonymous user fetches share link data
  const anonViewRes = await handleSharesRequest(
    { method: 'GET' }, {}, ['shares', viewToken], {},
    {}, {}
  );
  assert(anonViewRes.status === 200, 'Anonymous user can view shared project');
  assert(anonViewRes.body.canEdit === false, 'Anonymous user has canEdit = false');

  // 5. Anonymous user attempts to edit file (MUST BE REJECTED)
  const anonEditRes = await handleFilesRequest(
    { method: 'PUT' }, {}, [file1.id, 'content'], {},
    { content: 'Hacked by anonymous' }, {}
  );
  assert(anonEditRes.status === 403, 'Anonymous edit attempt rejected with 403 Forbidden');

  // 6. User 1 creates EDIT Share Link
  const editShareRes = await handleSharesRequest(
    { method: 'POST' }, {}, ['projects', project.public_id, 'shares'], {},
    { permission: 'edit' },
    { cookie: cookie1 }
  );
  assert(editShareRes.status === 201, 'Created EDIT share link');
  const editToken = editShareRes.body.share.token;

  // 7. User 2 (logged-in) opens EDIT Share Link
  const user2ViewRes = await handleSharesRequest(
    { method: 'GET' }, {}, ['shares', editToken], {},
    {}, { cookie: cookie2 }
  );
  assert(user2ViewRes.status === 200, 'User 2 opened EDIT share link');
  assert(user2ViewRes.body.canEdit === true, 'User 2 granted canEdit = true');

  // 8. User 2 edits file
  const user2EditRes = await handleFilesRequest(
    { method: 'PUT' }, {}, [file1.id, 'content'], {},
    { content: 'console.log("Edited by User 2!");' },
    { cookie: cookie2 }
  );
  assert(user2EditRes.status === 200, 'User 2 successfully edited file as collaborator');

  // 9. Delete Share Link
  const deleteShareRes = await handleSharesRequest(
    { method: 'DELETE' }, {}, ['shares', viewToken], {},
    {}, { cookie: cookie1 }
  );
  assert(deleteShareRes.status === 200, 'User 1 deleted share link');

  const deletedShareCheck = await handleSharesRequest(
    { method: 'GET' }, {}, ['shares', viewToken], {},
    {}, {}
  );
  assert(deletedShareCheck.status === 404, 'Deleted share link returns 404 Not Found');

  // 10. Create Invitation / Join Code (Max uses = 1)
  const invRes = await handleSharesRequest(
    { method: 'POST' }, {}, ['projects', project.public_id, 'invitations'], {},
    { permission: 'edit', max_uses: 1 },
    { cookie: cookie1 }
  );
  assert(invRes.status === 201, 'Created 4-digit join code invitation');
  const code = invRes.body.invitation.code;
  const invId = invRes.body.invitation.id;

  // 11. List Invitations
  const listInvRes = await handleSharesRequest(
    { method: 'GET' }, {}, ['projects', project.public_id, 'invitations'], {},
    {}, { cookie: cookie1 }
  );
  assert(listInvRes.status === 200 && listInvRes.body.invitations.length >= 1, 'Owner listed project invitations');

  // 12. Join by Code (First Use)
  const joinRes1 = await handleSharesRequest(
    { method: 'POST' }, {}, ['join'], {},
    { code }, { cookie: cookie2 }
  );
  assert(joinRes1.status === 200, 'User 2 successfully joined project using code');
  assert(joinRes1.body.public_id === project.public_id, 'Join returned correct project public_id');

  // 13. Join by Code (Second Use on max_uses=1 -> MUST FAIL)
  const joinRes2 = await handleSharesRequest(
    { method: 'POST' }, {}, ['join'], {},
    { code }, { cookie: cookie2 }
  );
  assert(joinRes2.status === 400, 'Second join attempt rejected due to max_uses limit');

  // 14. Expired Invitation Test
  const expiredInvRes = await handleSharesRequest(
    { method: 'POST' }, {}, ['projects', project.public_id, 'invitations'], {},
    { permission: 'view', expires_at: new Date(Date.now() - 10000).toISOString() },
    { cookie: cookie1 }
  );
  const expiredCode = expiredInvRes.body.invitation.code;

  const joinExpiredRes = await handleSharesRequest(
    { method: 'POST' }, {}, ['join'], {},
    { code: expiredCode }, {}
  );
  assert(joinExpiredRes.status === 400, 'Expired join code rejected');

  // 15. Delete Invitation
  const deleteInvRes = await handleSharesRequest(
    { method: 'DELETE' }, {}, ['invitations', invId], {},
    {}, { cookie: cookie1 }
  );
  assert(deleteInvRes.status === 200, 'Owner deleted invitation');

  // 16. IDOR Check: User 2 trying to create invitation for User 1 project without edit access
  const proj2Res = await handleProjectsRequest(
    { method: 'POST' }, {}, ['projects'], {},
    { name: 'Private Proj', language: 'python' },
    { cookie: cookie1 }
  );
  const proj2PublicId = proj2Res.body.project.public_id;

  const idorInvRes = await handleSharesRequest(
    { method: 'POST' }, {}, ['projects', proj2PublicId, 'invitations'], {},
    { permission: 'edit' },
    { cookie: cookie2 }
  );
  assert(idorInvRes.status === 403, 'IDOR rejection: Unauthorized user cannot create invitations');

  // 17. Rate Limiting Check (Brute-force protection on 4-digit codes)
  console.log('Testing 4-digit join code rate limiter...');
  let rateLimited = false;
  const testIp = '192.168.1.99';
  for (let i = 0; i < 12; i++) {
    const res = await handleSharesRequest(
      { method: 'POST' }, {}, ['join'], {},
      { code: '9999' },
      { 'x-forwarded-for': testIp }
    );
    if (res.status === 429) {
      rateLimited = true;
      break;
    }
  }
  assert(rateLimited === true, 'Rate limiter activated (429 Too Many Requests) after max attempts');

  console.log(`\nRESULTS: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
