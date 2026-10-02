import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';
import { publicFile } from '../../shared/projectAccess.ts';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const res = await svc.entities.Project.filter({ user_id: user.id }, { sort: '-created_date', limit: 100 });
    const projects = res.items || [];
    if (!projects.length) return Response.json({ projects: [] });

    const publicIds = projects.map((p) => p.public_id);
    const filesRes = await svc.entities.ProjectFile.filter({ project_public_id: { $in: publicIds } }, { sort: 'filename', limit: 500 });
    const filesByProject = {};
    for (const f of (filesRes.items || [])) {
      (filesByProject[f.project_public_id] = filesByProject[f.project_public_id] || []).push(f);
    }

    const enriched = projects.map((p) => {
      const pfiles = filesByProject[p.public_id] || [];
      const first = pfiles[0] || null;
      return {
        public_id: p.public_id,
        name: p.name,
        language: p.language,
        created_date: p.created_date,
        file_count: pfiles.length,
        preview: first ? (first.content || '').slice(0, 200) : '',
        preview_filename: first ? first.filename : '',
        files: pfiles.map(publicFile)
      };
    });

    return Response.json({ projects: enriched });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}