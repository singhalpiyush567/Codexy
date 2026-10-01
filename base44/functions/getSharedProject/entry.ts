import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId, getProjectFiles, publicFile, resolveAccess } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const token = body.token;
    if (!token) return Response.json({ error: "Token is required" }, { status: 400 });
    const svc = base44.asServiceRole;

    const linkRes = await svc.entities.ShareLink.filter({ token }, { limit: 5 });
    const link = (linkRes.items || [])[0];
    if (!link) return Response.json({ error: "Share link not found" }, { status: 404 });
    if (!link.is_active) return Response.json({ error: "This share link has been disabled." }, { status: 403 });

    const project = await getProjectByPublicId(svc, link.project_public_id);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });
    const files = await getProjectFiles(svc, project.public_id);

    let viewer = null;
    try { viewer = await base44.auth.me(); } catch (e) { viewer = null; }
    const access = await resolveAccess(svc, project, "", viewer, token);
    const canEdit = link.permission === "edit" && access.canEdit;

    return Response.json({
      project: { public_id: project.public_id, name: project.name, language: project.language },
      files: files.map(publicFile),
      permission: link.permission,
      viewer: viewer ? { id: viewer.id, name: viewer.full_name, email: viewer.email } : null,
      canEdit
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}