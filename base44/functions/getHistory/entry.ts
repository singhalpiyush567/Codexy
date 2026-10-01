import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId, resolveAccess, publicVersion } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { public_id, file_id, owner_token, share_token } = body;
    if (!public_id || !file_id) return Response.json({ error: "Missing parameters" }, { status: 400 });
    const svc = base44.asServiceRole;
    const project = await getProjectByPublicId(svc, public_id);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    let user = null;
    try { user = await base44.auth.me(); } catch (e) { user = null; }
    await resolveAccess(svc, project, owner_token || "", user, share_token || "");

    const res = await svc.entities.FileVersion.filter({ file_id }, { sort: "-version_number", limit: 100 });
    return Response.json({ versions: (res.items || []).map(publicVersion) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}