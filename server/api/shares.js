import crypto from 'node:crypto';
import { query, transaction } from '../db.js';
import { getUserBySession } from '../auth.js';
import { checkProjectPermission } from '../projects.js';

// Simple in-memory rate limiter for 4-digit join code protection
const joinAttemptsMap = new Map();

function checkJoinRateLimit(clientIp) {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const maxAttempts = 10;

  const record = joinAttemptsMap.get(clientIp) || { attempts: 0, resetAt: now + windowMs };

  if (now > record.resetAt) {
    record.attempts = 0;
    record.resetAt = now + windowMs;
  }

  if (record.attempts >= maxAttempts) {
    return { limited: true, retryAfterSeconds: Math.ceil((record.resetAt - now) / 1000) };
  }

  return { limited: false, record };
}

function registerFailedJoinAttempt(clientIp) {
  const now = Date.now();
  const record = joinAttemptsMap.get(clientIp) || { attempts: 0, resetAt: now + 15 * 60 * 1000 };
  record.attempts += 1;
  joinAttemptsMap.set(clientIp, record);
}

export async function handleSharesRequest(req, res, pathParts, queryParams, body, headers) {
  const cookieHeader = headers?.cookie || req.headers?.cookie || '';
  const user = await getUserBySession(cookieHeader);
  const method = req.method || 'GET';
  const clientIp = headers?.['x-forwarded-for'] || req.socket?.remoteAddress || '127.0.0.1';

  // Routing parsing:
  // e.g. /api/projects/:publicId/shares -> route='projects', publicId=parts[0], action='shares'
  // e.g. /api/shares/:token -> route='shares', token=parts[1]
  // e.g. /api/projects/:publicId/invitations -> route='projects', publicId=parts[0], action='invitations'
  // e.g. /api/invitations/:id -> route='invitations', id=parts[1]
  // e.g. /api/join -> route='join'

  const route = pathParts[0];

  try {
    // -----------------------------------------------------------------
    // 1. JOIN BY CODE (POST /api/join)
    // -----------------------------------------------------------------
    if (route === 'join' && method === 'POST') {
      const { code } = body || {};
      if (!code) {
        return { status: 400, body: { error: 'Join code is required' } };
      }

      const cleanCode = String(code).trim();

      // Check rate limit
      const rateLimitState = checkJoinRateLimit(clientIp);
      if (rateLimitState.limited) {
        return {
          status: 429,
          headers: { 'Retry-After': String(rateLimitState.retryAfterSeconds) },
          body: { error: 'Too many join attempts. Please try again later.' }
        };
      }

      // Atomic lookup & transaction-safe consumption
      const result = await transaction(async (tx) => {
        // Atomic update on invitations enforcing max_uses & expiration
        const updateRes = await tx.query(
          `UPDATE invitations 
           SET uses = uses + 1 
           WHERE code = $1 
             AND (max_uses = 0 OR uses < max_uses) 
             AND (expires_at IS NULL OR expires_at > NOW())
           RETURNING id, project_id, code, permission, max_uses, uses`,
          [cleanCode]
        );

        if (updateRes.rows.length === 0) {
          return null;
        }

        const inv = updateRes.rows[0];

        // Fetch project details
        const projRes = await tx.query(
          `SELECT id, public_id, name, language, user_id FROM projects WHERE id = $1`,
          [inv.project_id]
        );

        if (projRes.rows.length === 0) {
          return null;
        }

        const project = projRes.rows[0];

        // If user is logged in AND invitation has 'edit' permission, add as collaborator
        let grantedPermission = 'view';
        if (user && inv.permission === 'edit') {
          await tx.query(
            `INSERT INTO project_collaborators (project_id, user_id, role) 
             VALUES ($1, $2, $3) 
             ON CONFLICT (project_id, user_id) 
             DO UPDATE SET role = EXCLUDED.role WHERE project_collaborators.role != 'owner'`,
            [project.id, user.id, 'edit']
          );
          grantedPermission = 'edit';
        }

        // Log activity
        await tx.query(
          `INSERT INTO user_activity (user_id, user_name, action, project_id, detail) 
           VALUES ($1, $2, $3, $4, $5)`,
          [user ? user.id : null, user ? user.name : 'Guest', 'joined_session', project.id, `Joined project via code ${cleanCode}`]
        );

        return { project, invitation: inv, grantedPermission };
      });

      if (!result) {
        registerFailedJoinAttempt(clientIp);
        return { status: 400, body: { error: 'Invalid, expired, or fully used join code' } };
      }

      return {
        status: 200,
        body: {
          success: true,
          public_id: result.project.public_id,
          project: result.project,
          permission: result.grantedPermission,
          requiresAuthForEdit: !user && result.invitation.permission === 'edit'
        }
      };
    }

    // -----------------------------------------------------------------
    // 2. CREATE SHARE LINK (POST /api/projects/:publicId/shares)
    // -----------------------------------------------------------------
    if (route === 'projects' && pathParts[2] === 'shares' && method === 'POST') {
      const publicId = pathParts[1];
      const perm = await checkProjectPermission(publicId, user);

      if (!perm.exists) {
        return { status: 404, body: { error: 'Project not found' } };
      }

      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to create share links for this project' } };
      }

      const { permission } = body || {};
      const sharePerm = permission === 'edit' ? 'edit' : 'view';
      const token = crypto.randomBytes(32).toString('hex'); // Cryptographically secure token

      const newShareRes = await query(
        `INSERT INTO share_links (project_id, token, permission, is_active) 
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [perm.project.id, token, sharePerm, true]
      );

      return {
        status: 201,
        body: {
          success: true,
          share: newShareRes.rows[0]
        }
      };
    }

    // -----------------------------------------------------------------
    // 3. GET SHARE LINK DATA (GET /api/shares/:token)
    // -----------------------------------------------------------------
    if (route === 'shares' && method === 'GET') {
      const token = pathParts[1];
      if (!token) {
        return { status: 400, body: { error: 'Share token is required' } };
      }

      const shareRes = await query(
        `SELECT s.id, s.project_id, s.token, s.permission, s.is_active, s.created_at,
                p.public_id, p.name as project_name, p.language
         FROM share_links s
         JOIN projects p ON s.project_id = p.id
         WHERE s.token = $1 AND s.is_active = TRUE`,
        [token]
      );

      if (shareRes.rows.length === 0) {
        return { status: 404, body: { error: 'Invalid or inactive share link' } };
      }

      const share = shareRes.rows[0];

      // Fetch project files
      const filesRes = await query(
        `SELECT id, filename, language, content, version_number, created_at, updated_at 
         FROM project_files WHERE project_id = $1 ORDER BY created_at ASC`,
        [share.project_id]
      );

      // SECURITY RULE: Anonymous user opening EDIT link MUST NOT get automatically authorized edit access.
      // If user is authenticated AND share link is 'edit', add user as collaborator!
      let canEdit = false;
      if (user && share.permission === 'edit') {
        await query(
          `INSERT INTO project_collaborators (project_id, user_id, role) 
           VALUES ($1, $2, $3) 
           ON CONFLICT (project_id, user_id) 
           DO UPDATE SET role = EXCLUDED.role WHERE project_collaborators.role != 'owner'`,
          [share.project_id, user.id, 'edit']
        );
        canEdit = true;
      } else if (user) {
        const check = await checkProjectPermission(share.public_id, user);
        canEdit = check.canEdit;
      }

      return {
        status: 200,
        body: {
          project: {
            id: share.project_id,
            public_id: share.public_id,
            name: share.project_name,
            language: share.language
          },
          files: filesRes.rows,
          permission: share.permission,
          canEdit,
          requiresAuthForEdit: !user && share.permission === 'edit'
        }
      };
    }

    // -----------------------------------------------------------------
    // 4. DELETE SHARE LINK (DELETE /api/shares/:token)
    // -----------------------------------------------------------------
    if (route === 'shares' && method === 'DELETE') {
      const token = pathParts[1];
      if (!token) return { status: 400, body: { error: 'Token is required' } };

      const shareRes = await query(
        `SELECT s.id, s.project_id, p.public_id FROM share_links s JOIN projects p ON s.project_id = p.id WHERE s.token = $1`,
        [token]
      );

      if (shareRes.rows.length === 0) return { status: 404, body: { error: 'Share link not found' } };

      const share = shareRes.rows[0];
      const perm = await checkProjectPermission(share.public_id, user);

      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to delete this share link' } };
      }

      await query(`DELETE FROM share_links WHERE id = $1`, [share.id]);
      return { status: 200, body: { success: true } };
    }

    // -----------------------------------------------------------------
    // 5. CREATE INVITATION / JOIN CODE (POST /api/projects/:publicId/invitations)
    // -----------------------------------------------------------------
    if (route === 'projects' && pathParts[2] === 'invitations' && method === 'POST') {
      const publicId = pathParts[1];
      const perm = await checkProjectPermission(publicId, user);

      if (!perm.exists) {
        return { status: 404, body: { error: 'Project not found' } };
      }

      if (!perm.canEdit) {
        return { status: 403, body: { error: 'You do not have permission to create invitations for this project' } };
      }

      const { permission, expires_at, max_uses } = body || {};
      const invPermission = permission === 'edit' ? 'edit' : 'view';

      // Generate 4-digit code e.g. 1000 - 9999
      const code = crypto.randomInt(1000, 10000).toString();
      const expiresAt = expires_at ? new Date(expires_at) : null;
      const maxUses = max_uses != null ? parseInt(max_uses, 10) : 0;

      const newInvRes = await query(
        `INSERT INTO invitations (project_id, code, permission, expires_at, max_uses, uses) 
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [perm.project.id, code, invPermission, expiresAt, maxUses, 0]
      );

      return {
        status: 201,
        body: {
          success: true,
          invitation: newInvRes.rows[0]
        }
      };
    }

    // -----------------------------------------------------------------
    // 6. LIST INVITATIONS FOR PROJECT (GET /api/projects/:publicId/invitations)
    // -----------------------------------------------------------------
    if (route === 'projects' && pathParts[2] === 'invitations' && method === 'GET') {
      const publicId = pathParts[1];
      const perm = await checkProjectPermission(publicId, user);

      if (!perm.exists) return { status: 404, body: { error: 'Project not found' } };
      if (!perm.canEdit) return { status: 403, body: { error: 'Permission denied' } };

      const invRes = await query(
        `SELECT id, project_id, code, permission, expires_at, max_uses, uses, created_at 
         FROM invitations WHERE project_id = $1 ORDER BY created_at DESC`,
        [perm.project.id]
      );

      return { status: 200, body: { invitations: invRes.rows } };
    }

    // -----------------------------------------------------------------
    // 7. DELETE INVITATION (DELETE /api/invitations/:id)
    // -----------------------------------------------------------------
    if (route === 'invitations' && method === 'DELETE') {
      const invId = pathParts[1];
      if (!invId) return { status: 400, body: { error: 'Invitation ID is required' } };

      const invRes = await query(
        `SELECT i.id, p.public_id FROM invitations i JOIN projects p ON i.project_id = p.id WHERE i.id = $1`,
        [invId]
      );

      if (invRes.rows.length === 0) return { status: 404, body: { error: 'Invitation not found' } };

      const perm = await checkProjectPermission(invRes.rows[0].public_id, user);
      if (!perm.canEdit) return { status: 403, body: { error: 'Permission denied' } };

      await query(`DELETE FROM invitations WHERE id = $1`, [invId]);
      return { status: 200, body: { success: true } };
    }

    return { status: 404, body: { error: 'Shares endpoint not found' } };
  } catch (err) {
    console.error(`[SHARES_API_ERROR] Error handling request:`, err);
    return { status: 500, body: { error: err.message || 'Internal server error' } };
  }
}
