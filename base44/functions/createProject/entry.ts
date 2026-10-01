import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { generateToken, generateInviteCode, getProjectFiles, publicFile } from '../../shared/projectAccess.ts';

const DEFAULT_FILE = {
  javascript: "script.js", typescript: "script.ts", python: "main.py", java: "Main.java",
  c: "main.c", cpp: "main.cpp", html: "index.html", css: "style.css", sql: "query.sql", json: "data.json",
};

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const name = (body.name || "Untitled Project").slice(0, 100);
    const language = body.language || "javascript";
    const svc = base44.asServiceRole;

    let user = null;
    try { user = await base44.auth.me(); } catch (e) { user = null; }
    const publicId = generateToken(12);
    const ownerToken = generateToken(32);
    await svc.entities.Project.create({
      public_id: publicId, owner_token: ownerToken, name, language, collaborators: [], user_id: user ? user.id : ""
    });

    const filename = body.filename || DEFAULT_FILE[language] || "code.txt";
    const file = await svc.entities.ProjectFile.create({
      project_public_id: publicId, filename, language, content: "", version_number: 1
    });
    await svc.entities.FileVersion.create({
      file_id: file.id, project_public_id: publicId, version_number: 1,
      content: "", old_content: "", new_content: "", user_name: "Owner", user_id: "", change_type: "created"
    });

    // Auto-generate a 4-digit join code (no expiry) so the session is instantly shareable.
    const joinCode = generateInviteCode();
    await svc.entities.Invitation.create({
      project_public_id: publicId, code: joinCode, expires_at: null, max_uses: 0, uses: 0
    });

    const files = await getProjectFiles(svc, publicId);
    return Response.json({
      public_id: publicId, owner_token: ownerToken, join_code: joinCode,
      project: { public_id: publicId, name, language },
      files: files.map(publicFile)
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}