import { useEffect, useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, ArrowRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function JoinProject() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [authed, setAuthed] = useState(null);

  useEffect(() => { base44.auth.isAuthenticated().then(setAuthed).catch(() => setAuthed(false)); }, []);

  async function join() {
    if (code.length !== 4) return;
    setJoining(true);
    try {
      const res = await base44.functions.invoke("joinByCode", { code });
      navigate(`/p/${res.data.public_id}`);
    } catch (e) {
      toast({ title: "Could not join", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally { setJoining(false); }
  }

  return (
    <div className="min-h-screen bg-[#2c3035] text-white flex flex-col items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <h1 className="text-2xl font-bold text-center mb-1">Join a project</h1>
        <p className="text-sm text-white/60 text-center mb-6">Enter the 4-digit invite code from your friend.</p>
        <Input value={code} onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))} onKeyDown={(e) => { if (e.key === "Enter") join(); }} placeholder="0000" className="text-center text-2xl tracking-[0.5em] font-mono h-14 bg-white/5 border-white/10 text-white placeholder:text-white/30" />
        <Button onClick={join} disabled={joining || code.length !== 4} className="w-full mt-4 bg-[#e91e63] hover:bg-[#d81b5c] h-11">{joining ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <>Join <ArrowRight className="w-4 h-4 ml-2" /></>}</Button>
        <div className="mt-6 text-center text-sm text-white/50">
          {authed ? null : (<>New here? <Link to="/register" className="text-pink-400 hover:text-pink-300">Create account</Link> · <Link to="/login" className="text-pink-400 hover:text-pink-300">Login</Link></>)}
        </div>
        <div className="mt-4 text-center"><Link to="/" className="text-xs text-white/40 hover:text-white/60">← Back to home</Link></div>
      </div>
    </div>
  );
}