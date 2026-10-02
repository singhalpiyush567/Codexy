import { query } from '../db.js';
import { getUserBySession } from '../auth.js';
import { checkProjectPermission } from '../projects.js';

export async function handleFilesRequest(req, res, pathParts, queryParams, body, headers) {
  const cookieHeader = headers?.cookie || req.headers?.cookie || '';
  const user = await getUserBySession(cookieHeader);
  const method = req.method || 'GET';

  // Path resolution:
  // e.g. /api/files/:id -> fileId = pathParts[0] or pathParts[1]
  // e.g. /api/files/:id/content -> fileId = pathParts[0], subAction = 'content'
  const fileId = pathParts[0] && pathParts[0] !== 'files' ? pathParts[0] : (pathParts[1] || null);
  const subAction = pathParts[2] || (pathParts[1] === 'content' ? 'content' : null);

  try {
    if (!fileId) {
      return { status: 400, body: { error: 'File ID is required' } };
    }

    // Lookup file and associated project
    const fileRes = await query(
      `SELECT f.id, f.project_id, f.filename, f.language, f.content, f.version_number, f.created_at, f.updated_at,
              p.public_id as project_public_id, p.name as project_name
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

    // -----------------------------------------------------------------
    // 1. GET FILE DETAILS (GET /api/files/:id)
    // -----------------------------------------------------------------
    if (method === 'GET' && !subAction) {
      if (!perm.canView) {
        return { status: 403, body: { error: 'You do not have permission to view this file' } };
      }

      return {
        status: 200,
        body: { file }
      };
    }

    // -----------------------------------------------------------------
    // 2. AUTOSAVE / UPDATE FILE CONTENT (PUT /api/files/:id/content or PUT /api/files/:id)
    // -----------------------------------------------------------------
    if ((method === 'PUT' || method === 'PATCH') && (subAction === 'content' || !subAction)) {
      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to edit this file' } };
      }

      const { content, filename, language } = body || {};
      const newContent = content !== undefined ? content : file.content;
      const newFilename = filename ? filename.trim() : file.filename;
      const newLanguage = language ? language.trim() : file.language;

      // CRITICAL AUTOSAVE RULE:
      // Update project_files.content & updated_at ONLY.
      // MUST NOT insert any row into file_versions!
      const updateRes = await query(
        `UPDATE project_files 
         SET content = $1, filename = $2, language = $3, updated_at = NOW() 
         WHERE id = $4 RETURNING id, project_id, filename, language, content, version_number, updated_at`,
        [newContent, newFilename, newLanguage, fileId]
      );

      return {
        status: 200,
        body: {
          success: true,
          file: updateRes.rows[0],
          autosaved: true
        }
      };
    }

    // -----------------------------------------------------------------
    // 3. DELETE FILE (DELETE /api/files/:id)
    // -----------------------------------------------------------------
    if (method === 'DELETE') {
      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to delete this file' } };
      }

      await query(`DELETE FROM project_files WHERE id = $1`, [fileId]);

      return {
        status: 200,
        body: { success: true, message: 'File deleted successfully' }
      };
    }

    return { status: 405, body: { error: `Method ${method} not allowed for file resource` } };
  } catch (err) {
    console.error(`[FILES_API_ERROR] Error handling request:`, err);
    return { status: 500, body: { error: err.message || 'Internal server error' } };
  }
}
