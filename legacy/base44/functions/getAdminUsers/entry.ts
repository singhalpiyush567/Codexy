import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const svc = base44.asServiceRole;

    const res = await svc.entities.Account.list({ limit: 1000, sort: '-first_seen' });
    const users = (res.items || []).map(a => ({
      id: a.user_id,
      name: a.name || "",
      email: a.email || "",
      created_date: a.first_seen,
      last_login_at: a.last_login_at || null,
      is_active: a.is_active !== false
    }));

    // session counts per user (created_session actions)
    const counts = {};
    try {
      const agg = await svc.entities.UserActivity.aggregate({ query: { action: 'created_session' }, groupBy: 'user_id' });
      (agg.rows || []).forEach(r => { counts[r.user_id] = r.count; });
    } catch (e) { /* best effort */ }
    users.forEach(u => { u.session_count = counts[u.id] || 0; });

    return Response.json({ users });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}