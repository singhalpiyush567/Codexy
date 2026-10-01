import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { ArrowRight, Users, Activity, Ticket, LogOut, Loader2, Code2 } from "lucide-react";
import { setOwnerToken } from "@/lib/projectUtils";
import { useToast } from "@/components/ui/use-toast";
import JoinModal from "@/components/project/JoinModal";

function timeAgo(d) {
  if (!d) return "";
  const diff = Date.now() - new Date(d).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  return `${days}d ago`;
}

const actionLabel = {
  registered: "registered",
  logged_in: "logged in",
  created_session: "created a session",
  joined_session: "joined a session",
};

export default function Dashboard() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user, isAuthenticated, isLoadingAuth } = useAuth();
  const [showJoin, setShowJoin] = useState(false);
  const [starting, setStarting] = useState(false);
  const [activity, setActivity] = useState([]);
  const [loadingAct, setLoadingAct] = useState(true);
  const [projects, setProjects] = useState([]);
  const [loadingProjects, setLoadingProjects] = useState(true);

  useEffect(() => {
    if (!isLoadingAuth && !isAuthenticated) {
      navigate("/login?returnTo=" + encodeURIComponent("/dashboard"));
      return;
    }
    if (!isAuthenticated) return;
    // best-effort: record login + load dashboard data
    base44.functions.invoke("logActivity", { action: "logged_in" }).catch(() => {});
    base44.functions.invoke("getUserDashboard", {})
      .then((res) => setActivity(res.data.activity || []))
      .catch(() => {})
      .finally(() => setLoadingAct(false));
    base44.functions.invoke("getMyProjects", {})
      .then((res) => setProjects(res.data.projects || []))
      .catch(() => {})
      .finally(() => setLoadingProjects(false));
  }, [isAuthenticated, isLoadingAuth]);

  async function startCoding() {
    setStarting(true);
    try {
      const res = await base44.functions.invoke("createProject", { name: "Untitled Project", language: "javascript" });
      setOwnerToken(res.data.public_id, res.data.owner_token);
      base44.functions.invoke("logActivity", { action: "created_session", project_public_id: res.data.public_id }).catch(() => {});
      navigate(`/p/${res.data.public_id}`);
    } catch (e) {
      toast({ title: "Failed to start", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally { setStarting(false); }
  }

  if (isLoadingAuth) {
    return <div className="min-h-screen bg-[#2c3035] flex items-center justify-center"><Loader2 className="w-6 h-6 animate-spin text-white/50" /></div>;
  }

  const name = user?.full_name || user?.email?.split("@")[0] || "there";

  return (
    <div className="min-h-screen bg-[#2c3035] text-white flex flex-col">
      <header className="px-8 py-5 flex items-center justify-between">
        <Link to="/" className="text-2xl font-bold tracking-tight">codexy</Link>
        <div className="flex items-center gap-5 text-sm">
          <Link to="/admin" className="text-white/50 hover:text-white/80">Admin</Link>
          <button onClick={() => base44.auth.logout("/")} className="inline-flex items-center gap-1.5 text-white/70 hover:text-white"><LogOut className="w-4 h-4" /> Logout</button>
        </div>
      </header>

      <main className="flex-1 max-w-4xl w-full mx-auto px-6 py-10">
        <h1 className="text-3xl font-bold">Welcome back, {name}</h1>
        <p className="text-white/50 mt-1">Pick up where you left off or start something new.</p>

        <div className="grid sm:grid-cols-2 gap-4 mt-8">
          <button onClick={startCoding} disabled={starting} className="flex items-center gap-3 p-5 rounded-xl bg-[#e91e63]/15 border border-[#e91e63]/30 hover:bg-[#e91e63]/25 transition-colors text-left">
            <div className="w-10 h-10 rounded-lg bg-[#e91e63] flex items-center justify-center shrink-0">
              {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />}
            </div>
            <div>
              <div className="font-semibold">Share Code Now</div>
              <div className="text-sm text-white/50">Start a new live session</div>
            </div>
          </button>
          <button onClick={() => setShowJoin(true)} className="flex items-center gap-3 p-5 rounded-xl bg-white/5 border border-white/10 hover:bg-white/10 transition-colors text-left">
            <div className="w-10 h-10 rounded-lg bg-white/10 flex items-center justify-center shrink-0"><Users className="w-5 h-5" /></div>
            <div>
              <div className="font-semibold">Join Session</div>
              <div className="text-sm text-white/50">Enter a 4-digit code</div>
            </div>
          </button>
        </div>

        <div className="mt-10">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4"><Code2 className="w-4 h-4 text-pink-400" /> My Projects</h2>
          {loadingProjects ? (
            <div className="text-white/40 text-sm">Loading…</div>
          ) : projects.length === 0 ? (
            <div className="text-white/40 text-sm">No projects yet. Click "Share Code Now" to create one — it'll show up here.</div>
          ) : (
            <div className="grid sm:grid-cols-2 gap-3">
              {projects.map((p) => (
                <Link key={p.public_id} to={`/p/${p.public_id}`} className="block rounded-lg bg-white/5 border border-white/10 hover:bg-white/10 hover:border-pink-500/30 transition-colors p-4">
                  <div className="flex items-center justify-between gap-2">
                    <div className="font-medium text-white truncate">{p.name}</div>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-300 shrink-0">{p.language || "code"}</span>
                  </div>
                  <div className="text-xs text-white/40 mt-1">{p.file_count} file{p.file_count === 1 ? "" : "s"} · {timeAgo(p.created_date)}</div>
                  {p.preview_filename && <div className="text-xs text-white/50 mt-2 font-mono truncate">{p.preview_filename}</div>}
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="mt-10">
          <h2 className="text-lg font-semibold flex items-center gap-2 mb-4"><Activity className="w-4 h-4 text-pink-400" /> Your Activity</h2>
          {loadingAct ? (
            <div className="text-white/40 text-sm">Loading…</div>
          ) : activity.length === 0 ? (
            <div className="text-white/40 text-sm">No activity yet. Start or join a session to see it here.</div>
          ) : (
            <div className="space-y-2">
              {activity.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-lg bg-white/5 border border-white/10 px-4 py-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Ticket className="w-4 h-4 text-pink-400/70" />
                    <span className="text-white/80">{actionLabel[a.action] || a.action}</span>
                    {a.project_public_id && (
                      <Link to={`/p/${a.project_public_id}`} className="text-pink-400 hover:text-pink-300 text-xs ml-1">open</Link>
                    )}
                  </div>
                  <span className="text-xs text-white/40">{timeAgo(a.created_date)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      {showJoin && <JoinModal onClose={() => setShowJoin(false)} />}
    </div>
  );
}