import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { getProjectByPublicId, resolveAccess } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const { public_id, file_id, owner_token, share_token, content, user_name } = body;
    if (!public_id || !file_id) return Response.json({ error: "Missing parameters" }, { status: 400 });
    const svc = base44.asServiceRole;
    const project = await getProjectByPublicId(svc, public_id);
    if (!project) return Response.json({ error: "Project not found" }, { status: 404 });

    let user = null;
    try { user = await base44.auth.me(); } catch (e) { user = null; }
    const access = await resolveAccess(svc, project, owner_token || "", user, share_token || "");
    if (!access.canEdit) return Response.json({ error: "Login required to edit this session." }, { status: 403 });

    const file = await svc.entities.ProjectFile.get(file_id).catch(() => null);
    if (!file || file.project_public_id !== public_id) return Response.json({ error: "File not found" }, { status: 404 });

    let versionContent = content || "";
    let changeType = "edited";
    let createHistory = body.create_history === true;

    if (body.restore_version_id) {
      const v = await svc.entities.FileVersion.get(body.restore_version_id).catch(() => null);
      if (v) { versionContent = v.content || ""; changeType = "restored"; createHistory = true; }
    }

    // AUTOSAVE: just update the file content. No history entry.
    if (!createHistory) {
      await svc.entities.ProjectFile.update(file_id, { content: versionContent });
      return Response.json({ saved: true, version_number: file.version_number || 1, content: versionContent });
    }

    // SAVE TO HISTORY: create a permanent version entry.
    // Autosave already updated ProjectFile.content to the latest draft, so reading
    // file.content here would make old and new identical. The previous FileVersion
    // holds the real baseline to diff against.
    const lastVerRes = await svc.entities.FileVersion.filter({ file_id }, { sort: "-version_number", limit: 1 });
    const lastVersion = (lastVerRes.items || [])[0];
    const oldContent = lastVersion ? (lastVersion.content || "") : (file.content || "");
    const nextVersion = (file.version_number || 1) + 1;
    await svc.entities.FileVersion.create({
      file_id, project_public_id: public_id, version_number: nextVersion,
      content: versionContent, old_content: oldContent, new_content: versionContent,
      user_name: user_name || (user ? user.full_name : "Owner"), user_id: user ? user.id : "",
      change_type: changeType
    });
    await svc.entities.ProjectFile.update(file_id, { content: versionContent, version_number: nextVersion });
    return Response.json({ saved: true, version_number: nextVersion, content: versionContent, history: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}