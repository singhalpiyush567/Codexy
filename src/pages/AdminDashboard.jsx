import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { Users, Activity, UserCircle, ShieldAlert, Loader2, ArrowLeft } from "lucide-react";

function fmtDate(d) {
  if (!d) return "—";
  const dt = new Date(d);
  if (isNaN(dt)) return "—";
  return dt.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + dt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

const actionLabel = {
  registered: "registered",
  logged_in: "logged in",
  created_session: "created a session",
  joined_session: "joined a session",
};

export default function AdminDashboard() {
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [stats, setStats] = useState(null);
  const [users, setUsers] = useState([]);
  const [activity, setActivity] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (isLoadingAuth) return;
    if (!isAuthenticated || user?.role !== "admin") { setLoading(false); setError("forbidden"); return; }
    Promise.all([
      base44.functions.invoke("getAdminStats", {}),
      base44.functions.invoke("getAdminUsers", {}),
      base44.functions.invoke("getAdminActivity", {}),
    ]).then(([s, u, a]) => {
      setStats(s.data);
      setUsers(u.data.users || []);
      setActivity(a.data.activity || []);
    }).catch((e) => setError(e.response?.data?.error || e.message))
      .finally(() => setLoading(false));
  }, [isAuthenticated, isLoadingAuth, user]);

  if (isLoadingAuth || loading) {
    return <div className="min-h-screen bg-[#2c3035] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-white/50" /></div>;
  }

  if (error === "forbidden" || user?.role !== "admin") {
    return (
      <div className="min-h-screen bg-[#2c3035] text-white flex flex-col items-center justify-center px-6">
        <ShieldAlert className="w-12 h-12 text-pink-500 mb-4" />
        <h1 className="text-2xl font-bold">Access Denied</h1>
        <p className="text-white/50 mt-2 text-center max-w-sm">You need an admin account to view this page.</p>
        <Link to="/" className="mt-6 inline-flex items-center gap-2 text-pink-400 hover:text-pink-300"><ArrowLeft className="w-4 h-4" /> Back to home</Link>
      </div>
    );
  }

  if (error) {
    return <div className="min-h-screen bg-[#2c3035] text-white flex items-center justify-center"><p className="text-red-400">{error}</p></div>;
  }

  const cards = [
    { label: "Total Users", value: stats?.totalUsers ?? 0, icon: Users },
    { label: "Active Sessions", value: stats?.activeSessions ?? 0, icon: Activity },
    { label: "Signups Today", value: stats?.signupsToday ?? 0, icon: UserCircle },
  ];

  return (
    <div className="min-h-screen bg-[#2c3035] text-white">
      <header className="px-8 py-5 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3">
          <Link to="/" className="text-2xl font-bold tracking-tight">codexy</Link>
          <span className="text-xs px-2 py-0.5 rounded-full bg-pink-500/20 text-pink-300 border border-pink-500/30">Admin</span>
        </div>
        <Link to="/dashboard" className="text-sm text-white/60 hover:text-white">Dashboard</Link>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-8">
        <h1 className="text-2xl font-bold mb-6">Admin Dashboard</h1>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
          {cards.map((c) => {
            const Icon = c.icon;
            return (
              <div key={c.label} className="rounded-xl bg-white/5 border border-white/10 p-5">
                <div className="flex items-center gap-2 text-white/50 text-sm mb-2"><Icon className="w-4 h-4" /> {c.label}</div>
                <div className="text-3xl font-bold">{c.value}</div>
              </div>
            );
          })}
        </div>

        <h2 className="text-lg font-semibold mb-3">Recent Users</h2>
        <div className="rounded-xl bg-white/5 border border-white/10 overflow-hidden mb-8">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-white/50 border-b border-white/10">
                  <th className="px-4 py-3 font-medium">Name</th>
                  <th className="px-4 py-3 font-medium">Email</th>
                  <th className="px-4 py-3 font-medium">Joined</th>
                  <th className="px-4 py-3 font-medium">Last Login</th>
                  <th className="px-4 py-3 font-medium">Sessions</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-6 text-center text-white/40">No users yet.</td></tr>
                ) : users.map((u) => (
                  <tr key={u.id} className="border-b border-white/5 last:border-0">
                    <td className="px-4 py-3 text-white/90">{u.name || "—"}</td>
                    <td className="px-4 py-3 text-white/60">{u.email}</td>
                    <td className="px-4 py-3 text-white/60">{fmtDate(u.created_date)}</td>
                    <td className="px-4 py-3 text-white/60">{u.last_login_at ? fmtDate(u.last_login_at) : "—"}</td>
                    <td className="px-4 py-3 text-white/60">{u.session_count ?? 0}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${u.is_active ? "bg-green-500/15 text-green-400" : "bg-white/10 text-white/40"}`}>
                        {u.is_active ? "Active" : "Inactive"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <h2 className="text-lg font-semibold mb-3">Recent Activity</h2>
        <div className="rounded-xl bg-white/5 border border-white/10 divide-y divide-white/5">
          {activity.length === 0 ? (
            <div className="px-4 py-6 text-center text-white/40">No activity yet.</div>
          ) : activity.map((a) => (
            <div key={a.id} className="flex items-center justify-between px-4 py-3">
              <div className="text-sm text-white/80">
                <span className="font-medium">{a.user_name}</span>{" "}
                <span className="text-white/50">{actionLabel[a.action] || a.action}</span>
                {a.project_public_id && <Link to={`/p/${a.project_public_id}`} className="text-pink-400 hover:text-pink-300 text-xs ml-2">open</Link>}
              </div>
              <span className="text-xs text-white/40">{fmtDate(a.created_date)}</span>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}