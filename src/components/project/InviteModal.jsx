import { useState } from "react";
import { Copy, Check, Ticket, Loader2, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useToast } from "@/components/ui/use-toast";

export default function InviteModal({ publicId, ownerToken, joinCode, onSessionSaved, onClose }) {
  const { toast } = useToast();
  const [code, setCode] = useState(joinCode || "");
  const [copied, setCopied] = useState(false);
  const [creating, setCreating] = useState(false);

  function copyCode() {
    if (!code) return;
    navigator.clipboard.writeText(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: "Code copied" });
  }

  async function generateNew() {
    setCreating(true);
    try {
      const res = await base44.functions.invoke("createInviteCode", {
        public_id: publicId,
        owner_token: ownerToken,
        permission: "edit",
      });
      setCode(res.data.code);
      onSessionSaved?.();
      toast({ title: "New invite code generated", description: "Others can edit" });
    } catch (e) {
      toast({ title: "Failed to generate code", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-[#16171b] border border-white/10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-white flex items-center gap-2">
              <Ticket className="w-5 h-5 text-pink-400" /> Invite by Code
            </h2>
            <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">×</button>
          </div>

          <div className="text-xs text-white/40 mb-1.5">Invite Code</div>
          <div className="flex items-center gap-2">
            <div className="text-3xl font-bold tracking-[0.3em] font-mono text-white flex-1 bg-white/5 rounded-lg py-3 text-center border border-white/10">
              {code || "----"}
            </div>
            <button
              onClick={copyCode}
              className="h-12 px-4 rounded-lg bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 flex items-center gap-1.5 text-sm"
            >
              {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>

          <div className="mt-3 flex items-center gap-2 text-xs text-pink-300/90 bg-pink-500/10 border border-pink-500/20 rounded-lg px-3 py-2">
            <span className="w-1.5 h-1.5 rounded-full bg-pink-400" />
            Anyone who joins with this code can edit the session.
          </div>

          <button
            onClick={generateNew}
            disabled={creating}
            className="w-full mt-4 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 text-white/90 text-sm font-medium flex items-center justify-center gap-2 border border-white/10 disabled:opacity-60"
          >
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            Generate New Code
          </button>

          <p className="text-xs text-white/40 mt-4 text-center">
            Share this 4-digit code so others can join and edit live with you.
          </p>
        </div>
      </div>
    </div>
  );
}