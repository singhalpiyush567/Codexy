import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const svc = base44.asServiceRole;

    const actRes = await svc.entities.UserActivity.filter({}, { sort: '-created_date', limit: 30 });
    const activity = (actRes.items || []).map(a => ({
      id: a.id, user_name: a.user_name || "User", action: a.action,
      project_public_id: a.project_public_id, detail: a.detail, created_date: a.created_date
    }));

    // recent registrations (from Account first_seen)
    const acctRes = await svc.entities.Account.list({ limit: 1000, sort: '-first_seen' });
    const recentUsers = (acctRes.items || []).slice(0, 10).map(a => ({
      id: 'reg-' + a.user_id, user_name: a.name || a.email || "User",
      action: 'registered', created_date: a.first_seen
    }));

    const merged = [...activity, ...recentUsers]
      .sort((a, b) => new Date(b.created_date || 0) - new Date(a.created_date || 0))
      .slice(0, 30);
    return Response.json({ activity: merged });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}