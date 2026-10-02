import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId, getProjectFiles, resolveAccess, publicFile, generateInviteCode } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const publicId = body.public_id;
    if (!publicId) return Response.json({ error: "Project id required" }, { status: 400 });
    const svc = base44.asServiceRole;
    const project = await getProjectByPublicId(svc, publicId);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    let user = null;
    try { user = await base44.auth.me(); } catch (e) { user = null; }
    const access = await resolveAccess(svc, project, body.owner_token || "", user);
    const files = await getProjectFiles(svc, publicId);

    const result = {
      project: { public_id: project.public_id, name: project.name, language: project.language },
      files: files.map(publicFile),
      access: { role: access.role, canEdit: access.canEdit },
      me: user ? { id: user.id, name: user.full_name, email: user.email } : null
    };

    if (access.role === "owner") {
      const linksRes = await svc.entities.ShareLink.filter({ project_public_id: publicId }, { sort: "-created_date", limit: 50 });
      result.shareLinks = (linksRes.items || []).map((l) => ({
        id: l.id, token: l.token, permission: l.permission, is_active: l.is_active, created_date: l.created_date
      }));
      const invRes = await svc.entities.Invitation.filter({ project_public_id: publicId }, { sort: "-created_date", limit: 10 });
      const now = new Date();
      let inviteCodes = (invRes.items || [])
        .filter((i) => !i.expires_at || new Date(i.expires_at) > now)
        .map((i) => ({ id: i.id, code: i.code, expires_at: i.expires_at }));
      // Ensure a join code always exists for the owner.
      if (inviteCodes.length === 0) {
        const newCode = generateInviteCode();
        await svc.entities.Invitation.create({ project_public_id: publicId, code: newCode, expires_at: null, max_uses: 0, uses: 0 });
        inviteCodes = [{ code: newCode, expires_at: null }];
      }
      result.inviteCodes = inviteCodes;
      result.collaborators = project.collaborators || [];
    }
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}