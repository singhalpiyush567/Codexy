import { useEffect, useState, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Loader2, Eye, LogIn, Check, Cloud, History as HistoryIcon } from "lucide-react";
import CodeEditor from "@/components/project/CodeEditor";
import HistoryPanel from "@/components/project/HistoryPanel";
import { monacoLang, getLanguageFromFilename } from "@/lib/projectUtils";
import { useToast } from "@/components/ui/use-toast";

export default function PublicShareViewer() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeFileId, setActiveFileId] = useState(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState("saved");
  const draftRef = useRef("");
  const activeFileRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/shares/${token}`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Invalid or inactive share link");
        setData(json);
        if (json.files?.length) setActiveFileId(json.files[0].id);
      } catch (e) {
        setData({ error: e.message });
      } finally { setLoading(false); }
    })();
  }, [token]);

  const activeFile = data?.files?.find((f) => f.id === activeFileId);
  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { if (activeFile) { setDraft(activeFile.content || ""); setDirty(false); setSaveStatus("saved"); } }, [activeFileId]);

  const canEdit = data?.canEdit;

  const doSave = async () => {
    const file = activeFileRef.current;
    if (!file || !canEdit) return;
    const content = draftRef.current;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/files/${file.id}/content`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content })
      });
      const resData = await res.json();
      if (!res.ok) throw new Error(resData.error || "Auto-save failed");
      setData((prev) => ({ ...prev, files: prev.files.map((f) => (f.id === file.id ? { ...f, content } : f)) }));
      setDirty(false);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      toast({ title: "Auto-save failed", description: e.message, variant: "destructive" });
    }
  };

  // Auto-save debounce
  useEffect(() => {
    if (!dirty || !canEdit || !activeFile) return;
    setSaveStatus("unsaved");
    const t = setTimeout(() => { doSave(); }, 1200);
    return () => clearTimeout(t);
  }, [draft, dirty, canEdit, activeFile]);

  if (loading) return <div className="min-h-screen bg-[#2c3035] flex items-center justify-center text-white/60"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (data?.error) return (
    <div className="min-h-screen bg-[#2c3035] flex flex-col items-center justify-center text-white gap-3">
      <p>{data.error}</p>
      <Link to="/"><Button variant="outline" className="border-white/15 bg-transparent text-white">Go home</Button></Link>
    </div>
  );

  const statusLabel = saveStatus === "saving" ? "Saving..." : saveStatus === "unsaved" ? "Editing..." : saveStatus === "error" ? "Save failed" : "Saved";

  return (
    <div className="h-screen flex flex-col bg-[#2c3035] text-white overflow-hidden">
      <header className="h-12 shrink-0 border-b border-white/10 flex items-center px-4 gap-2 bg-[#272b30]">
        <span className="text-lg font-bold tracking-tight">codexy</span>
        <span className="text-sm text-white/70 truncate">{data.project.name}</span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded ${canEdit ? "bg-amber-500/15 text-amber-300" : "bg-white/10 text-white/60"}`}>{canEdit ? "Can edit" : "View only"}</span>
        <div className="flex-1" />
        <Link to="/"><Button variant="ghost" size="sm" className="text-white/60 hover:text-white h-8">Home</Button></Link>
      </header>
      <div className="flex-1 flex min-h-0">
        <div className="w-52 shrink-0 hidden sm:block border-r border-white/10 bg-[#272b30] overflow-y-auto">
          <div className="px-3 py-2 text-[11px] uppercase tracking-wide text-white/40 border-b border-white/10">Files</div>
          {data.files.map((f) => (
            <button key={f.id} onClick={() => setActiveFileId(f.id)} className={`w-full text-left px-3 py-1.5 text-sm ${activeFileId === f.id ? "bg-pink-500/15 text-white" : "text-white/60 hover:bg-white/5"}`}><span className="truncate block">{f.filename}</span></button>
          ))}
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          {activeFile ? (
            <>
              <div className="flex items-center justify-between px-3 h-9 border-b border-white/10">
                <span className="font-mono text-xs text-white/60">{activeFile.filename}</span>
                {canEdit && (
                  <div className="flex items-center gap-1.5 text-[11px] text-white/60">
                    {saveStatus === "saving" ? <Loader2 className="w-3 h-3 animate-spin" /> : saveStatus === "saved" ? <Check className="w-3 h-3 text-green-400" /> : <Cloud className="w-3 h-3" />}
                    <span className={saveStatus === "error" ? "text-red-400" : ""}>{statusLabel}</span>
                  </div>
                )}
              </div>
              <div className="flex-1 min-h-0">
                <CodeEditor value={draft} language={monacoLang(activeFile.language || getLanguageFromFilename(activeFile.filename))} onChange={(v) => { setDraft(v); setDirty(true); }} readOnly={!canEdit} theme="dark" />
              </div>
            </>
          ) : <div className="flex-1 flex items-center justify-center text-white/40 text-sm">No files</div>}
        </div>
        <div className="w-80 shrink-0 hidden md:flex flex-col border-l border-white/10 bg-[#272b30]">
          <div className="flex items-center gap-1.5 px-3 h-9 border-b border-white/10 text-xs text-white/60"><HistoryIcon className="w-3.5 h-3.5" /> History</div>
          <div className="flex-1 overflow-hidden">
            {activeFile ? (
              <HistoryPanel publicId={data.project.public_id} shareToken={token} file={activeFile} canEdit={canEdit} />
            ) : <div className="p-4 text-white/40 text-sm">No file selected.</div>}
          </div>
        </div>
      </div>
      {!canEdit && (
        <div className="shrink-0 border-t border-white/10 bg-[#272b30] px-4 py-2.5 flex items-center justify-between">
          <span className="text-xs text-white/60 flex items-center gap-1.5"><Eye className="w-3.5 h-3.5" /> Read-only view</span>
          {data.permission === "edit" && !data.viewer && (
            <Button size="sm" onClick={() => navigate("/login")} className="bg-[#e91e63] hover:bg-[#d81b5c] h-8"><LogIn className="w-3.5 h-3.5 mr-1.5" /> Sign in to edit</Button>
          )}
        </div>
      )}
    </div>
  );
}