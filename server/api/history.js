import { query, transaction } from '../db.js';
import { getUserBySession } from '../auth.js';
import { checkProjectPermission } from '../projects.js';

export async function handleHistoryRequest(req, res, pathParts, queryParams, body, headers) {
  const cookieHeader = headers?.cookie || req.headers?.cookie || '';
  const user = await getUserBySession(cookieHeader);
  const method = req.method || 'GET';

  // Routing:
  // GET /api/history/:fileId
  // POST /api/files/:id/versions
  // POST /api/files/:id/versions/:version/restore
  const route = pathParts[0]; // 'history' or 'files'
  const targetId = pathParts[1]; // fileId or file ID
  const subAction = pathParts[2]; // 'versions'
  const versionParam = pathParts[3]; // version number or 'restore'
  const isRestore = pathParts[4] === 'restore' || subAction === 'restore' || queryParams?.action === 'restore';

  try {
    // -----------------------------------------------------------------
    // 1. GET HISTORY LIST (GET /api/history/:fileId)
    // -----------------------------------------------------------------
    if ((route === 'history' || subAction === 'versions') && method === 'GET') {
      const fileId = route === 'history' ? targetId : targetId;
      if (!fileId) {
        return { status: 400, body: { error: 'File ID is required' } };
      }

      // Lookup file & project
      const fileRes = await query(
        `SELECT f.id, f.project_id, f.filename, f.language, f.content, f.version_number,
                p.public_id as project_public_id
         FROM project_files f
         JOIN projects p ON f.project_id = p.id
         WHERE f.id = $1`,
        [fileId]
      );

      if (fileRes.rows.length === 0) {
        return { status: 404, body: { error: 'File not found' } };
      }

      const file = fileRes.rows[0];
      const perm = await checkProjectPermission(file.project_public_id, user);

      if (!perm.canView) {
        return { status: 403, body: { error: 'You do not have permission to view this file history' } };
      }

      // Fetch history versions
      const historyRes = await query(
        `SELECT id, file_id, project_id, version_number, content, old_content, new_content, user_id, user_name, change_type, created_at
         FROM file_versions
         WHERE file_id = $1
         ORDER BY version_number DESC`,
        [file.id]
      );

      return {
        status: 200,
        body: {
          file_id: file.id,
          current_version: file.version_number,
          versions: historyRes.rows
        }
      };
    }

    // -----------------------------------------------------------------
    // 2. SAVE TO HISTORY (POST /api/files/:id/versions)
    // -----------------------------------------------------------------
    if (route === 'files' && subAction === 'versions' && method === 'POST' && !versionParam) {
      const fileId = targetId;
      if (!fileId) {
        return { status: 400, body: { error: 'File ID is required' } };
      }

      // Lookup file & project
      const fileRes = await query(
        `SELECT f.id, f.project_id, f.filename, f.language, f.content, f.version_number,
                p.public_id as project_public_id
         FROM project_files f
         JOIN projects p ON f.project_id = p.id
         WHERE f.id = $1`,
        [fileId]
      );

      if (fileRes.rows.length === 0) {
        return { status: 404, body: { error: 'File not found' } };
      }

      const file = fileRes.rows[0];
      const perm = await checkProjectPermission(file.project_public_id, user);

      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to save history for this file' } };
      }

      const { content, user_name, restore_version_id } = body || {};
      const versionContent = content !== undefined ? content : file.content;
      const userName = user_name || user?.name || 'User';

      // Race-safe version creation with retry strategy
      let createdVersion = null;
      let maxRetries = 3;

      while (maxRetries > 0 && !createdVersion) {
        try {
          createdVersion = await transaction(async (tx) => {
            // Compute next version number atomically
            const numRes = await tx.query(
              `SELECT COALESCE(MAX(version_number), 0) + 1 as next_ver FROM file_versions WHERE file_id = $1`,
              [file.id]
            );
            const nextVer = parseInt(numRes.rows[0].next_ver, 10);

            // Insert new version row
            const insertRes = await tx.query(
              `INSERT INTO file_versions (file_id, project_id, version_number, content, old_content, new_content, user_id, user_name, change_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING *`,
              [
                file.id,
                file.project_id,
                nextVer,
                versionContent,
                file.content,
                versionContent,
                user ? user.id : null,
                userName,
                restore_version_id ? 'restore' : 'manual_save'
              ]
            );

            // Update project_files table
            await tx.query(
              `UPDATE project_files SET content = $1, version_number = $2, updated_at = NOW() WHERE id = $3`,
              [versionContent, nextVer, file.id]
            );

            return insertRes.rows[0];
          });
        } catch (err) {
          maxRetries--;
          if (maxRetries === 0) throw err;
        }
      }

      return {
        status: 201,
        body: {
          success: true,
          version: createdVersion
        }
      };
    }

    // -----------------------------------------------------------------
    // 3. RESTORE PREVIOUS VERSION (POST /api/files/:id/versions/:version/restore)
    // -----------------------------------------------------------------
    if (route === 'files' && subAction === 'versions' && method === 'POST' && versionParam) {
      const fileId = targetId;
      const targetVersionNum = parseInt(versionParam, 10);

      if (!fileId || isNaN(targetVersionNum)) {
        return { status: 400, body: { error: 'File ID and valid version number are required' } };
      }

      // Lookup file & project
      const fileRes = await query(
        `SELECT f.id, f.project_id, f.filename, f.language, f.content, f.version_number,
                p.public_id as project_public_id
         FROM project_files f
         JOIN projects p ON f.project_id = p.id
         WHERE f.id = $1`,
        [fileId]
      );

      if (fileRes.rows.length === 0) {
        return { status: 404, body: { error: 'File not found' } };
      }

      const file = fileRes.rows[0];
      const perm = await checkProjectPermission(file.project_public_id, user);

      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to restore versions for this file' } };
      }

      // Verify targeted version exists AND belongs strictly to this file & project!
      const targetVerRes = await query(
        `SELECT * FROM file_versions WHERE file_id = $1 AND version_number = $2`,
        [file.id, targetVersionNum]
      );

      if (targetVerRes.rows.length === 0) {
        return { status: 404, body: { error: 'Requested version not found for this file' } };
      }

      const targetVersion = targetVerRes.rows[0];
      const restoredContent = targetVersion.content;
      const userName = user?.name || 'User';

      // Append new version entry (V1, V2, V3 stay intact; V4 created for restore)
      let newVersionRecord = null;
      let maxRetries = 3;

      while (maxRetries > 0 && !newVersionRecord) {
        try {
          newVersionRecord = await transaction(async (tx) => {
            const numRes = await tx.query(
              `SELECT COALESCE(MAX(version_number), 0) + 1 as next_ver FROM file_versions WHERE file_id = $1`,
              [file.id]
            );
            const nextVer = parseInt(numRes.rows[0].next_ver, 10);

            const insertRes = await tx.query(
              `INSERT INTO file_versions (file_id, project_id, version_number, content, old_content, new_content, user_id, user_name, change_type)
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
               RETURNING *`,
              [
                file.id,
                file.project_id,
                nextVer,
                restoredContent,
                file.content,
                restoredContent,
                user ? user.id : null,
                `${userName} (restored v${targetVersionNum})`,
                'restore'
              ]
            );

            // Update current file content
            await tx.query(
              `UPDATE project_files SET content = $1, version_number = $2, updated_at = NOW() WHERE id = $3`,
              [restoredContent, nextVer, file.id]
            );

            return insertRes.rows[0];
          });
        } catch (err) {
          maxRetries--;
          if (maxRetries === 0) throw err;
        }
      }

      return {
        status: 200,
        body: {
          success: true,
          restored_from_version: targetVersionNum,
          new_version: newVersionRecord,
          content: restoredContent,
          version_number: newVersionRecord.version_number
        }
      };
    }

    return { status: 404, body: { error: 'History endpoint not found' } };
  } catch (err) {
    console.error(`[HISTORY_API_ERROR] Error handling history request:`, err);
    return { status: 500, body: { error: err.message || 'Internal server error' } };
  }
}
