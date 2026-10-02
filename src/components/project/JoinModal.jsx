import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, ArrowRight } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function JoinModal({ onClose }) {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [joining, setJoining] = useState(false);

  async function join() {
    if (code.length !== 4) return;
    setJoining(true);
    try {
      const res = await fetch("/api/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Could not join project");
      navigate(`/p/${data.public_id}`);
    } catch (e) {
      toast({ title: "Could not join", description: e.message, variant: "destructive" });
    } finally { setJoining(false); }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-sm rounded-2xl bg-[#12151c] border border-white/10 shadow-2xl p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-lg font-semibold text-white">Join Code Session</h2>
          <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-white/50 mb-5">Enter the 4-digit code to view code live. No login needed.</p>
        <input
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/[^0-9]/g, "").slice(0, 4))}
          onKeyDown={(e) => { if (e.key === "Enter") join(); }}
          placeholder="0000"
          autoFocus
          className="w-full text-center text-3xl tracking-[0.5em] font-mono h-16 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/20 outline-none focus:border-pink-500/50"
        />
        <button
          onClick={join}
          disabled={joining || code.length !== 4}
          className="w-full mt-4 inline-flex items-center justify-center gap-2 bg-[#e91e63] hover:bg-[#d81b5c] disabled:opacity-50 text-white font-semibold py-3 rounded-lg transition-colors"
        >
          {joining ? <Loader2 className="w-4 h-4 animate-spin" /> : <>Join Session <ArrowRight className="w-4 h-4" /></>}
        </button>
      </div>
    </div>
  );
}