import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user || user.role !== 'admin') return Response.json({ error: 'Forbidden' }, { status: 403 });
    const svc = base44.asServiceRole;

    const totalUsers = await svc.entities.Account.count({});

    const startToday = new Date(); startToday.setHours(0, 0, 0, 0);
    const signupsToday = await svc.entities.Account.count({ first_seen: { $gte: startToday.toISOString() } });

    const projRes = await svc.entities.Project.list({ limit: 1000 });
    const activeSessions = (projRes.items || []).length;

    return Response.json({ totalUsers, signupsToday, activeSessions });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}