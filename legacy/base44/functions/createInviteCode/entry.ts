import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId, resolveAccess, generateInviteCode } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { public_id, owner_token, permission } = body;
    if (!public_id) return Response.json({ error: "Missing project id" }, { status: 400 });
    const svc = base44.asServiceRole;
    const project = await getProjectByPublicId(svc, public_id);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    let user = null;
    try { user = await base44.auth.me(); } catch (e) { user = null; }
    const access = await resolveAccess(svc, project, owner_token || "", user);
    if (access.role !== "owner") return Response.json({ error: "Only the owner can invite collaborators." }, { status: 403 });

    const perm = permission === "edit" ? "edit" : "view";
    const code = generateInviteCode();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await svc.entities.Invitation.create({
      project_public_id: public_id, code, permission: perm, expires_at: expires, max_uses: 0, uses: 0
    });
    return Response.json({ code, permission: perm, expires_at: expires });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}