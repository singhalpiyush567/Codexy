import { createClientFromRequest } from 'npm:@base44/sdk@0.8.52';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const body = await req.json().catch(() => ({}));
    const action = body.action;
    if (!action) return Response.json({ error: 'Action required' }, { status: 400 });

    const svc = base44.asServiceRole;
    const now = new Date().toISOString();
    const name = user.full_name || "";
    const email = user.email || "";

    // Mirror the user into an Account record (admin dashboard source of truth).
    const existing = await svc.entities.Account.filter({ user_id: user.id }, { limit: 1 });
    const acct = (existing.items || [])[0];
    if (!acct) {
      await svc.entities.Account.create({
        user_id: user.id,
        name,
        email,
        first_seen: now,
        last_login_at: action === 'logged_in' ? now : null,
        is_active: true
      });
    } else {
      const upd = { name, email };
      if (action === 'logged_in') upd.last_login_at = now;
      await svc.entities.Account.update(acct.id, upd);
    }

    await svc.entities.UserActivity.create({
      user_id: user.id,
      user_name: name || email || "User",
      action,
      project_public_id: body.project_public_id || "",
      detail: body.detail || ""
    });

    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}