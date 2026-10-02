process.env.NODE_ENV = 'development';
import { handleAuthRequest } from '../server/api/auth.js';
import { handleProjectsRequest } from '../server/api/projects.js';
import { handleFilesRequest } from '../server/api/files.js';
import { query } from '../server/db.js';

async function testProjectsAndFilesSuite() {
  console.log('=== CodeXY Projects & Files API Test Suite (Phase 3) ===\n');

  try {
    // -----------------------------------------------------------------
    // SETUP: Create User A (Owner) & User B (Attacker / Collaborator)
    // -----------------------------------------------------------------
    const userA_Data = { name: 'User A', email: `usera_${Date.now()}@example.com`, password: 'Password123!' };
    const userB_Data = { name: 'User B', email: `userb_${Date.now()}@example.com`, password: 'Password123!' };

    await handleAuthRequest({}, {}, 'register', userA_Data, {});
    await handleAuthRequest({}, {}, 'register', userB_Data, {});

    const loginA = await handleAuthRequest({}, {}, 'login', { email: userA_Data.email, password: userA_Data.password }, {});
    const loginB = await handleAuthRequest({}, {}, 'login', { email: userB_Data.email, password: userB_Data.password }, {});

    const cookieA = { cookie: loginA.headers['Set-Cookie'] };
    const cookieB = { cookie: loginB.headers['Set-Cookie'] };
    const userA = loginA.body.user;
    const userB = loginB.body.user;

    console.log('[SETUP] Created & logged in User A (ID:', userA.id, ') and User B (ID:', userB.id, ')');

    // -----------------------------------------------------------------
    // TEST 1: Authenticated Project Creation
    // -----------------------------------------------------------------
    console.log('\n[TEST 1] Authenticated project creation...');
    const createRes = await handleProjectsRequest(
      { method: 'POST' }, {}, ['projects'], {},
      { name: 'My First App', language: 'javascript' },
      cookieA
    );
    if (createRes.status !== 201 || !createRes.body.project) {
      throw new Error(`Project creation failed: ${JSON.stringify(createRes.body)}`);
    }
    const project = createRes.body.project;
    console.log(' -> [PASS] Project created cleanly. Public ID:', project.public_id);

    // -----------------------------------------------------------------
    // TEST 2: Anonymous Project Creation Rejection
    // -----------------------------------------------------------------
    console.log('\n[TEST 2] Anonymous project creation rejection...');
    const anonCreate = await handleProjectsRequest(
      { method: 'POST' }, {}, ['projects'], {},
      { name: 'Hacker Project' },
      {}
    );
    if (anonCreate.status !== 401) {
      throw new Error(`Anonymous project creation should fail with 401, got ${anonCreate.status}`);
    }
    console.log(' -> [PASS] Rejected anonymous project creation with 401.');

    // -----------------------------------------------------------------
    // TEST 3: Project Retrieval (Owner & Anonymous)
    // -----------------------------------------------------------------
    console.log('\n[TEST 3] Project retrieval (GET /api/projects/:publicId)...');
    const getProjOwner = await handleProjectsRequest(
      { method: 'GET' }, {}, ['projects', project.public_id], {}, {}, cookieA
    );
    if (getProjOwner.status !== 200 || !getProjOwner.body.project) {
      throw new Error('Owner failed to retrieve project');
    }
    if (!getProjOwner.body.access.canEdit || !getProjOwner.body.access.isOwner) {
      throw new Error('Owner access permissions invalid');
    }

    const getProjAnon = await handleProjectsRequest(
      { method: 'GET' }, {}, ['projects', project.public_id], {}, {}, {}
    );
    if (getProjAnon.status !== 200 || getProjAnon.body.access.canEdit) {
      throw new Error('Anonymous user should get view-only access, but canEdit was true!');
    }
    console.log(' -> [PASS] Project retrieval verified. Owner canEdit=true, Anonymous canEdit=false.');

    // Default files check
    const files = getProjOwner.body.files;
    console.log(' -> Default files initialized:', files.map(f => f.filename).join(', '));
    const indexHtml = files.find(f => f.filename === 'index.html');
    if (!indexHtml) throw new Error('Default index.html missing!');

    // -----------------------------------------------------------------
    // TEST 4 & 5: File Creation & Retrieval
    // -----------------------------------------------------------------
    console.log('\n[TEST 4 & 5] File creation (POST /api/projects/:publicId/files) & retrieval...');
    const createFileRes = await handleProjectsRequest(
      { method: 'POST' }, {}, ['projects', project.public_id, 'files'], {},
      { filename: 'app.jsx', language: 'javascript', content: 'export default function App() {}' },
      cookieA
    );
    if (createFileRes.status !== 201 || !createFileRes.body.file) {
      throw new Error(`File creation failed: ${JSON.stringify(createFileRes.body)}`);
    }
    const newFile = createFileRes.body.file;
    console.log(' -> [PASS] File created successfully (ID:', newFile.id, ')');

    const getFileRes = await handleFilesRequest(
      { method: 'GET' }, {}, [newFile.id], {}, {}, cookieA
    );
    if (getFileRes.status !== 200 || getFileRes.body.file.filename !== 'app.jsx') {
      throw new Error('File retrieval failed');
    }
    console.log(' -> [PASS] File retrieved successfully.');

    // -----------------------------------------------------------------
    // TEST 6 & 7: File Content Update & AUTOSAVE (NO HISTORY CREATION)
    // -----------------------------------------------------------------
    console.log('\n[TEST 6 & 7] File update / AUTOSAVE (PUT /api/files/:id/content)...');
    const updateRes = await handleFilesRequest(
      { method: 'PUT' }, {}, [newFile.id, 'content'], {},
      { content: 'console.log("Autosaved update 1");' },
      cookieA
    );
    if (updateRes.status !== 200 || !updateRes.body.autosaved) {
      throw new Error(`Autosave update failed: ${JSON.stringify(updateRes.body)}`);
    }

    // Verify file_versions row count is 0
    const verRes = await query('SELECT COUNT(*) FROM file_versions WHERE file_id = $1', [newFile.id]);
    const verCount = parseInt(verRes.rows[0].count, 10);
    if (verCount !== 0) {
      throw new Error(`CRITICAL SECURITY FAILURE: Autosave created ${verCount} version history rows! Expected 0.`);
    }
    console.log(' -> [PASS] Autosave updated file content. Verified 0 file_versions rows created!');

    // -----------------------------------------------------------------
    // TEST 8, 9 & 10: Owner, VIEW collaborator & EDIT collaborator permissions
    // -----------------------------------------------------------------
    console.log('\n[TEST 8, 9 & 10] Testing Collaborator View & Edit Permissions...');
    // Add User B as VIEW collaborator
    await query(
      `INSERT INTO project_collaborators (project_id, user_id, role) VALUES ($1, $2, $3)`,
      [project.id, userB.id, 'view']
    );

    // User B attempts PUT file (Should fail with 403)
    const viewCollabPut = await handleFilesRequest(
      { method: 'PUT' }, {}, [newFile.id, 'content'], {},
      { content: 'Hacked by View Collaborator' },
      cookieB
    );
    if (viewCollabPut.status !== 403) {
      throw new Error(`VIEW collaborator PUT should be 403, got ${viewCollabPut.status}`);
    }
    console.log(' -> [PASS] VIEW collaborator edit attempt correctly rejected with 403.');

    // Upgrade User B to EDIT collaborator
    await query(
      `UPDATE project_collaborators SET role = 'edit' WHERE project_id = $1 AND user_id = $2`,
      [project.id, userB.id]
    );

    // User B attempts PUT file (Should succeed)
    const editCollabPut = await handleFilesRequest(
      { method: 'PUT' }, {}, [newFile.id, 'content'], {},
      { content: 'Legitimate update by Edit Collaborator' },
      cookieB
    );
    if (editCollabPut.status !== 200) {
      throw new Error(`EDIT collaborator PUT failed with status ${editCollabPut.status}`);
    }
    console.log(' -> [PASS] EDIT collaborator edit attempt succeeded.');

    // Remove User B from collaborators
    await query(`DELETE FROM project_collaborators WHERE project_id = $1 AND user_id = $2`, [project.id, userB.id]);

    // -----------------------------------------------------------------
    // TEST 11: Anonymous User Edit Rejection
    // -----------------------------------------------------------------
    console.log('\n[TEST 11] Anonymous edit attempt rejection...');
    const anonPut = await handleFilesRequest(
      { method: 'PUT' }, {}, [newFile.id, 'content'], {},
      { content: 'Anonymous hack' },
      {}
    );
    if (anonPut.status !== 403) {
      throw new Error(`Anonymous PUT should be 403, got ${anonPut.status}`);
    }
    console.log(' -> [PASS] Anonymous edit attempt correctly rejected with 403.');

    // -----------------------------------------------------------------
    // TEST 12 & 13: IDOR Attacks Rejection (User A vs User B)
    // -----------------------------------------------------------------
    console.log('\n[TEST 12 & 13] IDOR Attack Rejections...');
    // User B attempts PATCH User A's project
    const idorPatch = await handleProjectsRequest(
      { method: 'PATCH' }, {}, ['projects', project.public_id], {},
      { name: 'Stolen Project Name' },
      cookieB
    );
    if (idorPatch.status !== 403) {
      throw new Error(`IDOR project rename should be 403, got ${idorPatch.status}`);
    }

    // User B attempts DELETE User A's file
    const idorDelete = await handleFilesRequest(
      { method: 'DELETE' }, {}, [newFile.id], {}, {},
      cookieB
    );
    if (idorDelete.status !== 403) {
      throw new Error(`IDOR file deletion should be 403, got ${idorDelete.status}`);
    }
    console.log(' -> [PASS] IDOR attacks on project rename and file deletion correctly rejected with 403.');

    // -----------------------------------------------------------------
    // TEST 14: Invalid File/Project Relationship Rejection
    // -----------------------------------------------------------------
    console.log('\n[TEST 14] Invalid file ID lookup...');
    const fakeFileRes = await handleFilesRequest(
      { method: 'GET' }, {}, ['00000000-0000-0000-0000-000000000000'], {}, {}, cookieA
    );
    if (fakeFileRes.status !== 404) {
      throw new Error(`Non-existent file request should be 404, got ${fakeFileRes.status}`);
    }
    console.log(' -> [PASS] Non-existent file request correctly rejected with 404.');

    // -----------------------------------------------------------------
    // TEST 15 & 16: File & Project Deletion Authorization
    // -----------------------------------------------------------------
    console.log('\n[TEST 15 & 16] Authorized file & project deletion...');
    const deleteFileRes = await handleFilesRequest(
      { method: 'DELETE' }, {}, [newFile.id], {}, {}, cookieA
    );
    if (deleteFileRes.status !== 200) {
      throw new Error(`File deletion by owner failed with ${deleteFileRes.status}`);
    }
    console.log(' -> [PASS] Owner deleted file successfully.');

    const deleteProjRes = await handleProjectsRequest(
      { method: 'DELETE' }, {}, ['projects', project.public_id], {}, {}, cookieA
    );
    if (deleteProjRes.status !== 200) {
      throw new Error(`Project deletion by owner failed with ${deleteProjRes.status}`);
    }
    console.log(' -> [PASS] Owner deleted project successfully.');

    console.log('\n[SUCCESS] ALL 16 PROJECTS & FILES API TESTS PASSED CLEANLY!');
  } catch (err) {
    console.error('\n[FAIL] Projects & Files Test Suite Error:', err.message);
    process.exit(1);
  }
}

testProjectsAndFilesSuite();
