import { useRef, useState } from "react";
import { QRCodeCanvas } from "qrcode.react";
import { Copy, Download, Check, Link2, Eye, Pencil, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

function PermToggle({ value, onChange }) {
  const opts = [
    { v: "view", label: "View Only", icon: Eye },
    { v: "edit", label: "Can Edit", icon: Pencil },
  ];
  return (
    <div className="grid grid-cols-2 gap-2">
      {opts.map((o) => {
        const Icon = o.icon;
        const active = value === o.v;
        return (
          <button
            key={o.v}
            type="button"
            onClick={() => onChange(o.v)}
            className={`flex items-center justify-center gap-1.5 py-2.5 rounded-lg border text-sm transition-colors ${
              active
                ? "bg-[#e91e63]/15 border-[#e91e63] text-pink-300"
                : "bg-white/5 border-white/10 text-white/60 hover:text-white/90"
            }`}
          >
            <Icon className="w-3.5 h-3.5" />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export default function ShareModal({ publicId, ownerToken, onSessionSaved, onClose }) {
  const { toast } = useToast();
  const [copied, setCopied] = useState(false);
  const [sharePerm, setSharePerm] = useState("view");
  const [shareLink, setShareLink] = useState(null);
  const [creating, setCreating] = useState(false);
  const qrRef = useRef(null);

  function copyLink() {
    if (!shareLink) return;
    navigator.clipboard.writeText(shareLink.url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
    toast({ title: "Link copied" });
  }

  function downloadQr() {
    const canvas = qrRef.current?.querySelector("canvas");
    if (!canvas) return;
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = "codexy-qr.png";
    a.click();
  }

  async function createShare() {
    setCreating(true);
    try {
      const res = await fetch(`/api/projects/${publicId}/shares`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permission: sharePerm }),
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Failed to create share link');
      }

      setShareLink({ url: `${window.location.origin}/share/${data.share.token}`, perm: data.share.permission });
      onSessionSaved?.();
      toast({ title: "Share link created", description: sharePerm === "edit" ? "Others can edit" : "View only" });
    } catch (e) {
      toast({ title: "Failed to create link", description: e.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="w-full max-w-md rounded-2xl bg-[#16171b] border border-white/10 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="p-6">
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-lg font-semibold text-white">Share Code</h2>
            <button onClick={onClose} className="text-white/40 hover:text-white text-xl leading-none">×</button>
          </div>

          <div className="text-xs text-white/40 mb-1.5">Permission</div>
          <PermToggle value={sharePerm} onChange={setSharePerm} />

          {!shareLink ? (
            <button
              onClick={createShare}
              disabled={creating}
              className="w-full mt-4 py-2.5 rounded-lg bg-[#e91e63] hover:bg-[#d81b5c] text-white text-sm font-medium flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Link2 className="w-4 h-4" />}
              Create Share Link
            </button>
          ) : (
            <div ref={qrRef} className="mt-4 rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex flex-col sm:flex-row items-center gap-4">
                <div className="bg-white p-3 rounded-lg shrink-0">
                  <QRCodeCanvas value={shareLink.url} size={120} level="M" />
                </div>
                <div className="flex-1 min-w-0 w-full">
                  <div className="text-xs text-white/40 mb-1">Share Link · {shareLink.perm === "edit" ? "Can Edit" : "View Only"}</div>
                  <div className="font-mono text-xs text-white/70 break-all bg-black/30 rounded-md p-2 border border-white/10">
                    {shareLink.url}
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={copyLink}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
                    >
                      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
                      {copied ? "Copied" : "Copy Link"}
                    </button>
                    <button
                      onClick={downloadQr}
                      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md bg-white/5 hover:bg-white/10 text-white/80 border border-white/10"
                    >
                      <Download className="w-3.5 h-3.5" /> QR Code
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          <p className="text-xs text-white/40 mt-4 text-center">
            {sharePerm === "edit" ? "Anyone with the link can edit." : "Anyone with the link can view. Login required to edit."}
          </p>
        </div>
      </div>
    </div>
  );
}