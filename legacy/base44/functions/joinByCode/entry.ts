import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const code = (body.code || "").trim();
    if (!code) return Response.json({ error: "Code is required." }, { status: 400 });

    const svc = base44.asServiceRole;
    const invRes = await svc.entities.Invitation.filter({ code }, { limit: 5 });
    const inv = (invRes.items || [])[0];
    if (!inv) return Response.json({ error: "Invalid code. Please check and try again." }, { status: 404 });
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return Response.json({ error: "This code has expired." }, { status: 403 });
    }

    const project = await getProjectByPublicId(svc, inv.project_public_id);
    if (!project) return Response.json({ error: "Session not found." }, { status: 404 });

    await svc.entities.Invitation.update(inv.id, { uses: (inv.uses || 0) + 1 });
    return Response.json({ public_id: project.public_id, project_name: project.name });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}