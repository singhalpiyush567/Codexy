import crypto from 'node:crypto';
import { query, transaction } from './db.js';

/**
 * Generate a random secure 8-character public ID for projects
 */
export function generatePublicId() {
  return crypto.randomBytes(4).toString('hex');
}

/**
 * Check user permission for a project
 * Returns: { canView: boolean, canEdit: boolean, isOwner: boolean, role: string }
 */
export async function checkProjectPermission(projectPublicId, user) {
  const projRes = await query(
    `SELECT id, public_id, name, language, user_id, owner_token, created_at, updated_at 
     FROM projects WHERE public_id = $1`,
    [projectPublicId]
  );

  if (projRes.rows.length === 0) {
    return { exists: false, canView: false, canEdit: false, isOwner: false };
  }

  const project = projRes.rows[0];

  // Anonymous user: VIEW ONLY
  if (!user) {
    return {
      exists: true,
      project,
      canView: true,
      canEdit: false,
      isOwner: false,
      role: 'anonymous'
    };
  }

  // Project owner
  if (project.user_id && project.user_id === user.id) {
    return {
      exists: true,
      project,
      canView: true,
      canEdit: true,
      isOwner: true,
      role: 'owner'
    };
  }

  // Check collaborator role
  const collabRes = await query(
    `SELECT role FROM project_collaborators WHERE project_id = $1 AND user_id = $2`,
    [project.id, user.id]
  );

  if (collabRes.rows.length > 0) {
    const collabRole = collabRes.rows[0].role;
    return {
      exists: true,
      project,
      canView: true,
      canEdit: collabRole === 'edit',
      isOwner: false,
      role: collabRole
    };
  }

  // Default logged-in user viewing a public project
  return {
    exists: true,
    project,
    canView: true,
    canEdit: false,
    isOwner: false,
    role: 'viewer'
  };
}

/**
 * Initialize default project files (index.html, style.css, script.js)
 */
export async function createDefaultFiles(projectId) {
  const defaultFiles = [
    {
      filename: 'index.html',
      language: 'html',
      content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Document</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <h1>Hello, CodeXY!</h1>\n  <script src="script.js"></script>\n</body>\n</html>`
    },
    {
      filename: 'style.css',
      language: 'css',
      content: `body {\n  font-family: system-ui, -apple-system, sans-serif;\n  padding: 24px;\n  background-color: #0f172a;\n  color: #f8fafc;\n}\n\nh1 {\n  color: #38bdf8;\n}`
    },
    {
      filename: 'script.js',
      language: 'javascript',
      content: `console.log("Welcome to CodeXY!");\n`
    }
  ];

  for (const f of defaultFiles) {
    await query(
      `INSERT INTO project_files (project_id, filename, language, content, version_number) 
       VALUES ($1, $2, $3, $4, $5) 
       ON CONFLICT (project_id, filename) DO NOTHING`,
      [projectId, f.filename, f.language, f.content, 1]
    );
  }
}
