import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Loader2, ArrowRight, Users, LogOut, FolderClock } from "lucide-react";
import { setOwnerToken } from "@/lib/projectUtils";
import { useToast } from "@/components/ui/use-toast";
import { useAuth } from "@/lib/AuthContext";
import JoinModal from "@/components/project/JoinModal";

export default function Landing() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { isAuthenticated } = useAuth();
  const [starting, setStarting] = useState(false);
  const [showJoin, setShowJoin] = useState(false);

  async function startCoding() {
    setStarting(true);
    try {
      const res = await base44.functions.invoke("createProject", { name: "Untitled Project", language: "javascript" });
      setOwnerToken(res.data.public_id, res.data.owner_token);
      navigate(`/p/${res.data.public_id}`);
    } catch (e) {
      toast({ title: "Failed to start", description: e.response?.data?.error || e.message, variant: "destructive" });
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
              <button onClick={() => base44.auth.logout("/")} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/70 hover:text-white font-medium border border-white/10 transition-colors"><LogOut className="w-4 h-4" /> Logout</button>
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
          <button
            onClick={startCoding}
            disabled={starting}
            className="inline-flex items-center gap-2 bg-[#e91e63] hover:bg-[#d81b5c] disabled:opacity-70 text-white font-semibold text-lg px-8 py-3.5 rounded-lg transition-colors shadow-lg shadow-pink-600/20"
          >
            {starting ? <Loader2 className="w-5 h-5 animate-spin" /> : <>Share Code Now <ArrowRight className="w-5 h-5" /></>}
          </button>
          <button
            onClick={() => setShowJoin(true)}
            className="inline-flex items-center gap-2 bg-white/10 hover:bg-white/15 text-white font-semibold text-lg px-8 py-3.5 rounded-lg transition-colors border border-white/15"
          >
            <Users className="w-5 h-5" /> Join
          </button>
        </div>
        <p className="text-white/50 text-sm mt-4">Share code for free.</p>
      </main>

      {showJoin && <JoinModal onClose={() => setShowJoin(false)} />}
    </div>
  );
}