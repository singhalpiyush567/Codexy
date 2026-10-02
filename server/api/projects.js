import { query, transaction } from '../db.js';
import { getUserBySession } from '../auth.js';
import { generatePublicId, checkProjectPermission, createDefaultFiles } from '../projects.js';

export async function handleProjectsRequest(req, res, pathParts, queryParams, body, headers) {
  const cookieHeader = headers?.cookie || req.headers?.cookie || '';
  const user = await getUserBySession(cookieHeader);
  const method = req.method || 'GET';

  // Path resolution:
  // e.g. /api/projects -> publicId = null, action = null
  // e.g. /api/projects/a1b2c3d4 -> publicId = 'a1b2c3d4', action = null
  // e.g. /api/projects/a1b2c3d4/files -> publicId = 'a1b2c3d4', action = 'files'
  const publicId = pathParts[0] && pathParts[0] !== 'projects' ? pathParts[0] : (pathParts[1] || null);
  const subAction = pathParts[2] || (pathParts[1] === 'files' ? 'files' : null);

  try {
    // -----------------------------------------------------------------
    // 1. LIST MY PROJECTS (GET /api/projects)
    // -----------------------------------------------------------------
    if (!publicId && method === 'GET') {
      if (!user) {
        return { status: 401, body: { error: 'Authentication required to list projects' } };
      }

      // Fetch owned projects
      const ownedRes = await query(
        `SELECT id, public_id, name, language, created_at, updated_at, 'owner' as user_role 
         FROM projects WHERE user_id = $1 ORDER BY updated_at DESC`,
        [user.id]
      );

      // Fetch collaborated projects
      const collabRes = await query(
        `SELECT p.id, p.public_id, p.name, p.language, p.created_at, p.updated_at, pc.role as user_role 
         FROM project_collaborators pc
         JOIN projects p ON pc.project_id = p.id
         WHERE pc.user_id = $1 ORDER BY p.updated_at DESC`,
        [user.id]
      );

      // Combine and deduplicate
      const owned = ownedRes.rows;
      const collabs = collabRes.rows.filter(c => !owned.some(o => o.id === c.id));
      const allProjects = [...owned, ...collabs];

      return { status: 200, body: { projects: allProjects } };
    }

    // -----------------------------------------------------------------
    // 2. CREATE PROJECT (POST /api/projects)
    // -----------------------------------------------------------------
    if (!publicId && method === 'POST') {
      if (!user) {
        return { status: 401, body: { error: 'Authentication required to create projects' } };
      }

      const { name, language } = body || {};
      const projectName = (name || 'Untitled Project').trim();
      const projLang = (language || 'javascript').trim();
      const newPublicId = generatePublicId();

      const newProjRes = await query(
        `INSERT INTO projects (public_id, name, language, user_id) 
         VALUES ($1, $2, $3, $4) RETURNING id, public_id, name, language, created_at, updated_at`,
        [newPublicId, projectName, projLang, user.id]
      );

      const project = newProjRes.rows[0];

      // Create default files
      await createDefaultFiles(project.id);

      // Log activity
      await query(
        `INSERT INTO user_activity (user_id, user_name, action, project_id, detail) VALUES ($1, $2, $3, $4, $5)`,
        [user.id, user.name, 'created_session', project.id, `Created project ${project.name}`]
      );

      return {
        status: 201,
        body: {
          success: true,
          project: {
            ...project,
            owner_token: 'deprecated', // Preserved field for legacy contracts
            user_id: user.id
          }
        }
      };
    }

    // -----------------------------------------------------------------
    // 3. GET SINGLE PROJECT DETAILS & FILES (GET /api/projects/:publicId)
    // -----------------------------------------------------------------
    if (publicId && !subAction && method === 'GET') {
      const perm = await checkProjectPermission(publicId, user);
      if (!perm.exists) {
        return { status: 404, body: { error: 'Project not found' } };
      }

      // Fetch files
      const filesRes = await query(
        `SELECT id, filename, language, content, version_number, created_at, updated_at 
         FROM project_files WHERE project_id = $1 ORDER BY created_at ASC`,
        [perm.project.id]
      );

      return {
        status: 200,
        body: {
          project: perm.project,
          files: filesRes.rows,
          access: {
            canView: perm.canView,
            canEdit: perm.canEdit,
            isOwner: perm.isOwner,
            role: perm.role
          }
        }
      };
    }

    // -----------------------------------------------------------------
    // 4. RENAME / UPDATE PROJECT (PATCH /api/projects/:publicId)
    // -----------------------------------------------------------------
    if (publicId && !subAction && (method === 'PATCH' || method === 'PUT')) {
      const perm = await checkProjectPermission(publicId, user);
      if (!perm.exists) {
        return { status: 404, body: { error: 'Project not found' } };
      }

      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to edit this project' } };
      }

      const { name, language } = body || {};
      const updates = [];
      const params = [];
      let paramCount = 1;

      if (name) {
        updates.push(`name = $${paramCount++}`);
        params.push(name.trim());
      }

      if (language) {
        updates.push(`language = $${paramCount++}`);
        params.push(language.trim());
      }

      if (updates.length === 0) {
        return { status: 400, body: { error: 'No update parameters provided' } };
      }

      updates.push(`updated_at = NOW()`);
      params.push(perm.project.id);

      const updateQuery = `UPDATE projects SET ${updates.join(', ')} WHERE id = $${paramCount} RETURNING *`;
      const updatedRes = await query(updateQuery, params);

      return {
        status: 200,
        body: {
          success: true,
          project: updatedRes.rows[0]
        }
      };
    }

    // -----------------------------------------------------------------
    // 5. DELETE PROJECT (DELETE /api/projects/:publicId)
    // -----------------------------------------------------------------
    if (publicId && !subAction && method === 'DELETE') {
      const perm = await checkProjectPermission(publicId, user);
      if (!perm.exists) {
        return { status: 404, body: { error: 'Project not found' } };
      }

      if (!perm.isOwner) {
        return { status: 403, body: { error: 'Only the project owner can delete this project' } };
      }

      await query('DELETE FROM projects WHERE id = $1', [perm.project.id]);

      return {
        status: 200,
        body: { success: true, message: 'Project deleted successfully' }
      };
    }

    // -----------------------------------------------------------------
    // 6. CREATE FILE IN PROJECT (POST /api/projects/:publicId/files)
    // -----------------------------------------------------------------
    if (publicId && subAction === 'files' && method === 'POST') {
      const perm = await checkProjectPermission(publicId, user);
      if (!perm.exists) {
        return { status: 404, body: { error: 'Project not found' } };
      }

      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to create files in this project' } };
      }

      const { filename, language, content } = body || {};
      if (!filename) {
        return { status: 400, body: { error: 'Filename is required' } };
      }

      const cleanFilename = filename.trim();
      const fileLang = (language || cleanFilename.split('.').pop() || 'plaintext').toLowerCase();
      const fileContent = content || '';

      const existingFile = await query(
        `SELECT id FROM project_files WHERE project_id = $1 AND filename = $2`,
        [perm.project.id, cleanFilename]
      );

      if (existingFile.rows.length > 0) {
        return { status: 400, body: { error: 'A file with that name already exists in this project' } };
      }

      const newFileRes = await query(
        `INSERT INTO project_files (project_id, filename, language, content, version_number) 
         VALUES ($1, $2, $3, $4, $5) RETURNING *`,
        [perm.project.id, cleanFilename, fileLang, fileContent, 1]
      );

      return {
        status: 201,
        body: {
          success: true,
          file: newFileRes.rows[0]
        }
      };
    }

    // -----------------------------------------------------------------
    // 7. LIST FILES IN PROJECT (GET /api/projects/:publicId/files)
    // -----------------------------------------------------------------
    if (publicId && subAction === 'files' && method === 'GET') {
      const perm = await checkProjectPermission(publicId, user);
      if (!perm.exists) {
        return { status: 404, body: { error: 'Project not found' } };
      }

      const filesRes = await query(
        `SELECT id, filename, language, content, version_number, created_at, updated_at 
         FROM project_files WHERE project_id = $1 ORDER BY created_at ASC`,
        [perm.project.id]
      );

      return {
        status: 200,
        body: { files: filesRes.rows }
      };
    }

    return { status: 404, body: { error: 'Endpoint not found' } };
  } catch (err) {
    console.error(`[PROJECTS_API_ERROR] Error handling request:`, err);
    return { status: 500, body: { error: err.message || 'Internal server error' } };
  }
}
