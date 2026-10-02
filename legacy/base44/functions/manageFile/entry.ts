import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId, resolveAccess, getProjectFiles, publicFile } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { public_id, owner_token, action } = body;
    if (!public_id || !action) return Response.json({ error: "Missing parameters" }, { status: 400 });
    const svc = base44.asServiceRole;
    const project = await getProjectByPublicId(svc, public_id);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    let user = null;
    try { user = await base44.auth.me(); } catch (e) { user = null; }
    const access = await resolveAccess(svc, project, owner_token || "", user);
    if (!access.canEdit) return Response.json({ error: "You do not have edit access." }, { status: 403 });

    const userName = body.user_name || (user ? user.full_name : "Owner");
    const userId = user ? user.id : "";

    if (action === "create") {
      const filename = (body.filename || "untitled.txt").slice(0, 100);
      const language = body.language || "plaintext";
      const file = await svc.entities.ProjectFile.create({
        project_public_id: public_id, filename, language, content: "", version_number: 1
      });
      await svc.entities.FileVersion.create({
        file_id: file.id, project_public_id: public_id, version_number: 1,
        content: "", old_content: "", new_content: "", user_name: userName, user_id: userId, change_type: "created"
      });
    } else if (action === "rename") {
      const file = await svc.entities.ProjectFile.get(body.file_id).catch(() => null);
      if (!file || file.project_public_id !== public_id) return Response.json({ error: "File not found" }, { status: 404 });
      await svc.entities.ProjectFile.update(body.file_id, { filename: (body.filename || file.filename).slice(0, 100) });
    } else if (action === "delete") {
      const file = await svc.entities.ProjectFile.get(body.file_id).catch(() => null);
      if (!file || file.project_public_id !== public_id) return Response.json({ error: "File not found" }, { status: 404 });
      await svc.entities.ProjectFile.delete(body.file_id);
      const vers = await svc.entities.FileVersion.filter({ file_id: body.file_id }, { limit: 1000 });
      for (const v of vers.items || []) await svc.entities.FileVersion.delete(v.id);
    } else {
      return Response.json({ error: "Unknown action" }, { status: 400 });
    }

    const files = await getProjectFiles(svc, public_id);
    return Response.json({ files: files.map(publicFile) });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}