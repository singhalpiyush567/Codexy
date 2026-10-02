import { useEffect, useState, memo } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { Button } from "@/components/ui/button";
import { Loader2, RotateCcw, X, FilePlus, History as HistoryIcon, Pencil } from "lucide-react";
import { formatDate, timeAgo, monacoLang, getLanguageFromFilename } from "@/lib/projectUtils";
import { useToast } from "@/components/ui/use-toast";

function HistoryPanel({ publicId, ownerToken, shareToken, file, canEdit, onRestored }) {
  const { toast } = useToast();
  const [versions, setVersions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const loadHistory = async (fileId) => {
    if (!fileId) { setVersions([]); setLoading(false); return; }
    setLoading(true);
    try {
      const res = await fetch(`/api/history/${fileId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load history');
      }

      const data = await res.json();
      setVersions(data.versions || []);
    } catch (e) {
      toast({ title: "Failed to load history", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelected(null);
    if (file?.id) {
      loadHistory(file.id);
    } else {
      setVersions([]);
      setLoading(false);
    }
  }, [publicId, file?.id]);

  const lang = file ? monacoLang(file.language || getLanguageFromFilename(file.filename)) : "plaintext";

  async function restore(v) {
    if (!confirm(`Restore version ${v.version_number}? A new version will be created — history is preserved.`)) return;
    setRestoring(true);
    try {
      const res = await fetch(`/api/files/${file.id}/versions/${v.version_number}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || 'Restore failed');
      }

      toast({ title: `Restored version ${v.version_number}`, description: `Created version ${data.version_number}` });
      setSelected(null);
      onRestored?.(data);
      await loadHistory(file.id);
    } catch (e) {
      toast({ title: "Restore failed", description: e.message, variant: "destructive" });
    } finally { setRestoring(false); }
  }

  if (loading) return <div className="p-4 text-white/50 text-sm flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading history...</div>;

  // Full-screen diff overlay
  if (selected) {
    const v = selected;
    const isCreated = v.change_type === "created";
    const original = v.old_content || "";
    const modified = v.new_content || v.content || "";
    return (
      <div className="fixed inset-0 z-50 bg-[#2c3035] flex flex-col">
        <div className="h-12 shrink-0 border-b border-white/10 bg-[#272b30] flex items-center px-4 gap-3">
          <button onClick={() => setSelected(null)} className="flex items-center gap-1.5 text-sm text-white/70 hover:text-white"><X className="w-4 h-4" /> Close</button>
          <div className="h-4 w-px bg-white/10" />
          <span className="text-sm font-medium text-white">Version {v.version_number}</span>
          {v.version_number === file?.version_number && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">Current</span>}
          {isCreated && <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300">Created</span>}
          <div className="flex-1" />
          <div className="text-xs text-white/50 hidden sm:block">{v.user_name} · {formatDate(v.created_at || v.created_date)}</div>
          {canEdit && v.version_number !== file?.version_number && (
            <Button size="sm" onClick={() => restore(v)} disabled={restoring} className="bg-[#e91e63] hover:bg-[#d81b5c] h-8">
              <RotateCcw className="w-3.5 h-3.5 mr-1.5" />{restoring ? "Restoring..." : "Restore this version"}
            </Button>
          )}
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <div className="grid grid-cols-2 h-8 shrink-0 border-b border-white/10">
            <div className="flex items-center px-3 text-xs font-medium bg-red-500/10 text-red-300 border-r border-white/10">Original code</div>
            <div className="flex items-center px-3 text-xs font-medium bg-green-500/10 text-green-400">Changed code</div>
          </div>
          <div className="flex-1 min-h-0">
            <DiffEditor original={original} modified={modified} language={lang} theme="vs-dark" options={{ readOnly: true, renderSideBySide: true, minimap: { enabled: false }, originalEditable: false, scrollBeyondLastLine: false }} />
          </div>
        </div>
      </div>
    );
  }

  if (!versions.length) return <div className="p-6 text-center text-sm text-white/40">No versions yet. Click "Save to History" in the toolbar to create a version checkpoint.</div>;

  return (
    <div className="py-2 overflow-y-auto h-full">
      {versions.map((v, i) => {
        const isCurrent = v.version_number === file?.version_number;
        const isCreated = v.change_type === "created";
        return (
          <button key={v.id} onClick={() => setSelected(v)} className={`w-full text-left px-3 py-3 border-b border-white/10 hover:bg-white/[0.03] transition relative ${isCurrent ? "bg-green-500/[0.04]" : ""}`}>
            {i === 0 && <span className="absolute left-0 top-0 bottom-0 w-0.5 bg-pink-500" />}
            <div className="flex items-center gap-2.5">
              <div className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${isCreated ? "bg-pink-500/15 text-pink-300" : "bg-white/10 text-white/70"}`}>
                {isCreated ? <FilePlus className="w-4 h-4" /> : <Pencil className="w-3.5 h-3.5" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-white">Version {v.version_number}</span>
                  {isCurrent && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/20 text-green-400">Current</span>}
                  {isCreated && <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/15 text-pink-300">Created</span>}
                </div>
                <div className="text-[11px] text-white/50 mt-0.5 truncate">{v.user_name} · {timeAgo(v.created_at || v.created_date)}</div>
              </div>
              <HistoryIcon className="w-3.5 h-3.5 text-white/30 shrink-0" />
            </div>
          </button>
        );
      })}
    </div>
  );
}

export default memo(HistoryPanel);