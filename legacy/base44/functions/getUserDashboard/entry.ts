import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const svc = base44.asServiceRole;
    const res = await svc.entities.UserActivity.filter({ user_id: user.id }, { sort: '-created_date', limit: 20 });
    return Response.json({
      user: { id: user.id, name: user.full_name, email: user.email, role: user.role },
      activity: (res.items || []).map(a => ({
        id: a.id, action: a.action, project_public_id: a.project_public_id, detail: a.detail, created_date: a.created_date
      }))
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}