import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: "You must be signed in to join a project." }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const code = (body.code || "").trim();
    if (!code) return Response.json({ error: "Invitation code is required." }, { status: 400 });

    const svc = base44.asServiceRole;
    const invRes = await svc.entities.Invitation.filter({ code }, { limit: 5 });
    const inv = (invRes.items || [])[0];
    if (!inv) return Response.json({ error: "Invalid invite code. Please check the code and try again." }, { status: 404 });
    if (inv.expires_at && new Date(inv.expires_at) < new Date()) {
      return Response.json({ error: "This invite code has expired." }, { status: 403 });
    }

    const project = await getProjectByPublicId(svc, inv.project_public_id);
    if (!project) return Response.json({ error: "Project not found." }, { status: 404 });

    const collaborators = project.collaborators || [];
    if (collaborators.find((c) => c.user_id === user.id)) {
      return Response.json({ public_id: project.public_id, project_name: project.name, already: true });
    }
    collaborators.push({ user_id: user.id, name: user.full_name || user.email, email: user.email, role: "editor" });
    await svc.entities.Project.update(project.id, { collaborators });
    await svc.entities.Invitation.update(inv.id, { uses: (inv.uses || 0) + 1 });

    return Response.json({ public_id: project.public_id, project_name: project.name, role: "editor" });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}