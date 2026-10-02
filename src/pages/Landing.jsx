import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Loader2, ArrowRight, Users, LogOut, FolderClock } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import JoinModal from "@/components/project/JoinModal";

export default function Landing() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAuthenticated, logout } = useAuth();
  const [starting, setStarting] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  async function startCoding() {
    setStarting(true);
    try {
      const res = await fetch('/api/projects', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: "Untitled Project", language: "javascript" }),
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) {
        if (res.status === 401) {
          navigate('/login?returnTo=' + encodeURIComponent('/dashboard'));
          return;
        }
        throw new Error(data.error || 'Failed to start project');
      }

      navigate(`/p/${data.project.public_id}`);
    } catch (e) {
      toast({ title: "Failed to start", description: e.message, variant: "destructive" });
    } finally { setStarting(false); }
  }

  return (
    <div className="min-h-screen bg-[#2c3035] text-white flex flex-col">
      <header className="px-8 py-5 flex items-center justify-between">
        <span className="text-2xl font-bold tracking-tight">codexy</span>
        <nav className="flex items-center gap-3 text-sm">
          {isAuthenticated ? (
            <>
              <Link to="/dashboard" className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium border border-white/15 transition-colors"><FolderClock className="w-4 h-4" /> My Projects</Link>
              <button onClick={() => logout(true, "/")} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white font-medium border border-white/10 transition-colors"><LogOut className="w-4 h-4" /> Logout</button>
            </>
          ) : (
            <>
              <Link to="/register" className="px-4 py-2 rounded-lg bg-white/10 hover:bg-white/15 text-white font-medium border border-white/15 transition-colors">New Account</Link>
              <Link to="/login" className="px-4 py-2 rounded-lg bg-[#e91e63] hover:bg-[#d81b5c] text-white font-medium transition-colors">Login</Link>
            </>
          )}
        </nav>
      </header>

      <main className="flex-1 flex flex-col items-center justify-center text-center px-6 -mt-10">
        <h1 className="text-4xl sm:text-6xl font-bold tracking-tight max-w-3xl leading-[1.1]">Share Code in Real-time with Developers</h1>
        <p className="text-white/70 text-lg mt-6 max-w-xl">Share code instantly, collaborate live, and track every change.</p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-10">
          <button onClick={startCoding} disabled={starting} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-[#e91e63] hover:bg-[#d81b5c] text-white font-semibold text-base transition-colors shadow-lg shadow-pink-500/20">
            {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <ArrowRight className="w-5 h-5" />} Share Code Now
          </button>
          <button onClick={() => setShowJoin(true)} className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-white/10 hover:bg-white/15 text-white font-semibold text-base border border-white/15 transition-colors">
            <Users className="w-5 h-5" /> Join Session
          </button>
        </div>
      </main>

      {showJoin && <JoinModal onClose={() => setShowJoin(false)} />}
    </div>
  );
}