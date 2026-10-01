import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId, resolveAccess } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { public_id, owner_token, name } = body;
    if (!public_id || !name) return Response.json({ error: "Missing parameters" }, { status: 400 });
    const svc = base44.asServiceRole;
    const project = await getProjectByPublicId(svc, public_id);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    let user = null;
    try { user = await base44.auth.me(); } catch (e) { user = null; }
    const access = await resolveAccess(svc, project, owner_token || "", user, "");
    if (access.role !== "owner") return Response.json({ error: "Only the owner can rename this project" }, { status: 403 });
    const cleanName = String(name).slice(0, 100).trim() || "Untitled Project";
    await svc.entities.Project.update(project.id, { name: cleanName });
    return Response.json({ name: cleanName });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}