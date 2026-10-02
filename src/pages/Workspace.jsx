import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/use-toast";
import { Share2, History as HistoryIcon, Loader2, Sun, Moon, LogIn, Check, Cloud, Users, Ticket } from "lucide-react";
import FileExplorer from "@/components/project/FileExplorer";
import CodeEditor from "@/components/project/CodeEditor";
import ShareModal from "@/components/project/ShareModal";
import InviteModal from "@/components/project/InviteModal";
import HistoryPanel from "@/components/project/HistoryPanel";
import LoginToEditModal from "@/components/project/LoginToEditModal";
import ProjectNameEditor from "@/components/project/ProjectNameEditor";
import { getOwnerToken, monacoLang, getLanguageFromFilename, getGuestIdentity } from "@/lib/projectUtils";
import { useAuth } from "@/lib/AuthContext";
import { useRealtime } from "@/lib/useRealtime";

export default function Workspace() {
  const { publicId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
  const { logout } = useAuth();
  const [project, setProject] = useState(null);
  const [files, setFiles] = useState([]);
  const [access, setAccess] = useState({ role: "viewer", canEdit: false });
  const [me, setMe] = useState(null);
  const [inviteCodes, setInviteCodes] = useState([]);
  const [activeFileId, setActiveFileId] = useState(null);
  const [draft, setDraft] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saveStatus, setSaveStatus] = useState("saved");
  const [savingHistory, setSavingHistory] = useState(false);
  const [theme, setTheme] = useState("dark");
  const [showShare, setShowShare] = useState(false);
  const [showInvite, setShowInvite] = useState(false);
  const [showLoginToEdit, setShowLoginToEdit] = useState(false);
  const [panel, setPanel] = useState("history");
  const [historyKey, setHistoryKey] = useState(0);
  const [activeUsers, setActiveUsers] = useState([]);
  const [connStatus, setConnStatus] = useState("connecting");
  const ownerToken = getOwnerToken(publicId);

  const draftRef = useRef("");
  const activeFileRef = useRef(null);
  const activeFileIdRef = useRef(null);
  const filesRef = useRef([]);
  const canEditRef = useRef(false);
  const applyingRemote = useRef(false);
  const dirtyRef = useRef(false);
  const doSaveRef = useRef(() => {});

  const handleRemoteEdit = useCallback((msg) => {
    if (msg.fileId === activeFileIdRef.current) {
      applyingRemote.current = true;
      setDraft(msg.content);
      draftRef.current = msg.content;
    }
    setFiles((prev) => prev.map((f) => (f.id === msg.fileId ? { ...f, content: msg.content } : f)));
  }, []);

  const handlePresence = useCallback((users) => {
    setActiveUsers(users);
  }, []);

  const handleStatusChange = useCallback((st) => {
    setConnStatus(st);
  }, []);

  const { sendEdit } = useRealtime({
    projectId: publicId,
    enabled: !!project,
    onEdit: handleRemoteEdit,
    onPresence: handlePresence,
    onStatusChange: handleStatusChange
  });

  const sendEditRef = useRef(sendEdit);
  useEffect(() => { sendEditRef.current = sendEdit; }, [sendEdit]);

  const loadProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/projects/${publicId}`, {
        method: 'GET',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Failed to load project');
      }

      const d = await res.json();
      setProject(d.project);
      setFiles(d.files || []);
      setAccess(d.access || { role: "viewer", canEdit: false });
      setMe(d.me || null);
      if (d.inviteCodes) setInviteCodes(d.inviteCodes);
      setActiveFileId((prev) => prev || (d.files && d.files.length ? d.files[0].id : null));
    } catch (e) {
      toast({ title: "Failed to load project", description: e.message, variant: "destructive" });
      navigate("/");
    } finally {
      setLoading(false);
    }
  }, [publicId, navigate, toast]);

  useEffect(() => { loadProject(); }, [loadProject]);

  const activeFile = files.find((f) => f.id === activeFileId);
  const isOwner = access.role === "owner" || access.isOwner;
  const canEdit = access.canEdit;

  useEffect(() => { activeFileRef.current = activeFile; }, [activeFile]);
  useEffect(() => { activeFileIdRef.current = activeFileId; }, [activeFileId]);
  useEffect(() => { filesRef.current = files; }, [files]);
  useEffect(() => { canEditRef.current = canEdit; }, [canEdit]);
  useEffect(() => { draftRef.current = draft; }, [draft]);
  useEffect(() => { dirtyRef.current = dirty; }, [dirty]);

  useEffect(() => {
    if (activeFile) { setDraft(activeFile.content || ""); setDirty(false); setSaveStatus("saved"); }
    else setDraft("");
  }, [activeFileId]);

  // AUTOSAVE (no history entry) — debounced 1.2s after last keystroke
  const doSave = useCallback(async () => {
    const file = activeFileRef.current;
    if (!file || !canEditRef.current) return;
    const content = draftRef.current;
    setSaveStatus("saving");
    try {
      const res = await fetch(`/api/files/${file.id}/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
        credentials: 'include'
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Autosave failed');
      }

      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, content } : f)));
      setDirty(false);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      toast({ title: "Auto-save failed", description: e.message, variant: "destructive" });
    }
  }, [toast]);

  useEffect(() => { doSaveRef.current = doSave; }, [doSave]);

  useEffect(() => {
    if (!dirty || !canEdit || !activeFile) return;
    setSaveStatus("unsaved");
    const t = setTimeout(() => { doSave(); }, 1200);
    return () => clearTimeout(t);
  }, [draft, dirty, canEdit, activeFile, doSave]);

  // SAVE TO HISTORY — explicit, creates a version entry
  const doSaveHistory = useCallback(async () => {
    const file = activeFileRef.current;
    if (!file || !canEditRef.current) return;
    setSavingHistory(true);
    try {
      const res = await fetch(`/api/files/${file.id}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: draftRef.current, user_name: me?.name || getGuestIdentity() }),
        credentials: 'include'
      });

      const data = await res.json();
      const versionNum = data.version?.version_number || (file.version_number || 1) + 1;

      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, content: draftRef.current, version_number: versionNum } : f)));
      setDirty(false);
      setSaveStatus("saved");
      setHistoryKey((k) => k + 1);
      toast({ title: "Saved to history", description: `Version ${versionNum}` });
    } catch (e) {
      toast({ title: "Failed to save history", description: e.message, variant: "destructive" });
    } finally { setSavingHistory(false); }
  }, [me, toast]);

  useEffect(() => {
    function onKey(e) { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); doSaveHistory(); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSaveHistory]);

  function handleChange(v) {
    if (applyingRemote.current) { applyingRemote.current = false; setDraft(v); return; }
    if (!canEdit) return;
    draftRef.current = v;
    setDraft(v);
    setDirty(true);
    if (sendEditRef.current && activeFileIdRef.current) {
      sendEditRef.current(activeFileIdRef.current, v);
    }
  }

  function handleEditorMount(editor) {
    editor.onKeyDown((e) => {
      if (!canEditRef.current) {
        const k = e.browserEvent?.key;
        if (k && (k.length === 1 || k === "Backspace" || k === "Delete" || k === "Enter")) {
          e.preventDefault();
          e.stopPropagation();
          setShowLoginToEdit(true);
        }
      }
    });
  }

  const handleSelectFile = useCallback(async (id) => {
    if (dirtyRef.current && canEditRef.current && activeFileRef.current) { await doSaveRef.current(); }
    setActiveFileId(id);
  }, []);

  const manageFile = useCallback(async (action, payload) => {
    if (dirtyRef.current && canEditRef.current && activeFileRef.current) { await doSaveRef.current(); }
    try {
      if (action === "create") {
        const res = await fetch(`/api/projects/${publicId}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: payload.filename, language: payload.language }),
          credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to create file');
        setFiles((prev) => [...prev, data.file]);
        setActiveFileId(data.file.id);
      } else if (action === "rename") {
        const res = await fetch(`/api/files/${payload.file_id}/content`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename: payload.filename }),
          credentials: 'include'
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed to rename file');
        setFiles((prev) => prev.map((f) => (f.id === payload.file_id ? { ...f, filename: payload.filename } : f)));
      } else if (action === "delete") {
        const res = await fetch(`/api/files/${payload.file_id}`, {
          method: 'DELETE',
          credentials: 'include'
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to delete file');
        }
        setFiles((prev) => prev.filter((f) => f.id !== payload.file_id));
        setActiveFileId((prev) => (prev === payload.file_id ? null : prev));
      }
    } catch (e) {
      toast({ title: "File operation failed", description: e.message, variant: "destructive" });
    }
  }, [publicId, toast]);

  const onAdd = useCallback((name, lang) => manageFile("create", { filename: name, language: lang }), [manageFile]);
  const onRename = useCallback((id, name) => manageFile("rename", { file_id: id, filename: name }), [manageFile]);
  const onDelete = useCallback((id) => manageFile("delete", { file_id: id }), [manageFile]);

  const handleRestored = useCallback((d) => {
    setFiles((prev) => prev.map((f) => (f.id === activeFileIdRef.current ? { ...f, content: d.content, version_number: d.version_number } : f)));
    setDraft(d.content);
    setDirty(false);
    setSaveStatus("saved");
  }, []);

  if (loading) return <div className="min-h-screen bg-[#2c3035] flex items-center justify-center text-white/60"><Loader2 className="w-6 h-6 animate-spin" /></div>;
  if (!project) return null;

  const statusLabel = saveStatus === "saving" ? "Saving..." : saveStatus === "unsaved" ? "Editing..." : saveStatus === "error" ? "Save failed" : "Saved";
  const joinCode = inviteCodes[0]?.code;

  return (
    <div className="h-screen flex flex-col bg-[#2c3035] text-white overflow-hidden">
      <header className="h-12 shrink-0 border-b border-white/10 flex items-center px-3 gap-2 bg-[#272b30]">
        <Link to="/" className="text-lg font-bold px-2 tracking-tight">codexy</Link>
        <ProjectNameEditor publicId={publicId} ownerToken={ownerToken} name={project.name} isOwner={isOwner} onSaved={(n) => setProject((p) => ({ ...p, name: n }))} />
        {isOwner && <span className="text-[10px] px-1.5 py-0.5 rounded bg-pink-500/20 text-pink-300">Owner</span>}
        <div className="flex-1" />

        {activeUsers.length > 0 && (
          <div className="flex items-center gap-1.5 mr-2">
            <div className="flex -space-x-2">
              {activeUsers.slice(0, 4).map((u, i) => (
                <div key={i} className="w-6 h-6 rounded-full bg-pink-500/30 border-2 border-[#272b30] flex items-center justify-center text-[10px] text-white font-medium" title={u.name}>{u.name.charAt(0).toUpperCase()}</div>
              ))}
            </div>
            <span className="text-xs text-white/60 hidden sm:inline">{activeUsers.length} {activeUsers.length === 1 ? "person" : "people"}</span>
          </div>
        )}

        <div className="flex items-center gap-1.5 text-[11px] mr-1">
          <span className={`w-2 h-2 rounded-full ${connStatus === 'connected' ? 'bg-green-400' : connStatus === 'reconnecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-400'}`} />
          <span className="text-white/50 hidden sm:inline">{connStatus === 'connected' ? 'Online' : connStatus === 'reconnecting' ? 'Reconnecting' : 'Offline'}</span>
        </div>

        <Button variant="ghost" size="sm" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))} className="text-white/60 hover:text-white h-8">{theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}</Button>
        {isOwner && (
          <>
            <Button size="sm" variant="outline" onClick={() => setShowInvite(true)} className="border-pink-500/40 bg-pink-500/10 text-pink-300 hover:bg-pink-500/20 hover:text-pink-200 h-8"><Ticket className="w-3.5 h-3.5 mr-1.5" /> Invite</Button>
            <Button size="sm" onClick={() => setShowShare(true)} className="bg-[#e91e63] hover:bg-[#d81b5c] h-8 shadow-sm shadow-pink-500/20"><Share2 className="w-3.5 h-3.5 mr-1.5" /> Share</Button>
          </>
        )}
        {!me && !isOwner && (
          <Button size="sm" variant="outline" onClick={() => navigate("/login")} className="border-white/15 bg-transparent text-white hover:bg-white/10 h-8"><LogIn className="w-3.5 h-3.5 mr-1.5" /> Login</Button>
        )}
        {me && (
          <Button size="sm" variant="ghost" onClick={() => logout(true, "/")} className="text-white/60 hover:text-white h-8">Logout</Button>
        )}
      </header>

      <div className="flex-1 flex min-h-0">
        <div className="w-56 shrink-0 hidden sm:block border-r border-white/10 bg-[#272b30]">
          <FileExplorer files={files} activeId={activeFileId} onSelect={handleSelectFile} onAdd={onAdd} onRename={onRename} onDelete={onDelete} canEdit={canEdit} />
        </div>
        <div className="flex-1 flex flex-col min-w-0">
          {activeFile ? (
            <>
              <div className="flex items-center justify-between px-3 h-9 border-b border-white/10">
                <div className="flex items-center gap-2 text-xs text-white/60"><span className="font-mono">{activeFile.filename}</span>{dirty && <span className="text-amber-400">●</span>}</div>
                <div className="flex items-center gap-3">
                  {canEdit && (
                    <button onClick={doSaveHistory} disabled={savingHistory} className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-md bg-white/5 hover:bg-white/10 text-white/80 border border-white/10 disabled:opacity-50">
                      {savingHistory ? <Loader2 className="w-3 h-3 animate-spin" /> : <HistoryIcon className="w-3 h-3" />} Save to History
                    </button>
                  )}
                  {canEdit && (
                    <div className="flex items-center gap-1.5 text-[11px] text-white/60">
                      {saveStatus === "saving" ? <Loader2 className="w-3 h-3 animate-spin" /> : saveStatus === "saved" ? <Check className="w-3 h-3 text-green-400" /> : <Cloud className="w-3 h-3" />}
                      <span className={saveStatus === "error" ? "text-red-400" : ""}>{statusLabel}</span>
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 min-h-0">
                <CodeEditor
                  value={draft}
                  language={monacoLang(activeFile.language || getLanguageFromFilename(activeFile.filename))}
                  onChange={handleChange}
                  onMount={handleEditorMount}
                  readOnly={!canEdit}
                  theme={theme}
                />
              </div>
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-white/40 text-sm">{canEdit ? "Create a file to start coding." : "No file selected."}</div>
          )}
        </div>
        <div className="w-80 shrink-0 hidden md:flex flex-col border-l border-white/10 bg-[#272b30]">
          <div className="flex border-b border-white/10">
            <button onClick={() => setPanel("history")} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs ${panel === "history" ? "text-pink-300 border-b-2 border-pink-500" : "text-white/50 hover:text-white/80 border-b-2 border-transparent"}`}><HistoryIcon className="w-3.5 h-3.5" /> History</button>
            <button onClick={() => setPanel("people")} className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 text-xs ${panel === "people" ? "text-pink-300 border-b-2 border-pink-500" : "text-white/50 hover:text-white/80 border-b-2 border-transparent"}`}><Users className="w-3.5 h-3.5" /> People</button>
          </div>
          <div className="flex-1 overflow-hidden">
            {panel === "history" ? (
              <HistoryPanel key={historyKey} publicId={publicId} ownerToken={ownerToken} file={activeFile} canEdit={canEdit} onRestored={handleRestored} />
            ) : (
              <div className="py-2 overflow-y-auto h-full">
                {activeUsers.length === 0 && <div className="px-3 py-6 text-center text-xs text-white/30">No one else here.</div>}
                {activeUsers.map((u, i) => (
                  <div key={i} className="px-3 py-2 flex items-center gap-2 border-b border-white/10">
                    <div className="w-7 h-7 rounded-full bg-pink-500/20 text-pink-300 flex items-center justify-center text-xs">{u.name.charAt(0).toUpperCase()}</div>
                    <div className="min-w-0">
                      <div className="text-sm text-white truncate">{u.name}</div>
                      <div className="text-[11px] text-white/40">Editor</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <footer className="h-7 shrink-0 border-t border-white/10 bg-[#272b30] flex items-center px-3 gap-4 text-[11px] text-white/40">
        <span>{activeFile ? (activeFile.language || getLanguageFromFilename(activeFile.filename)) : ""}</span>
        <span>v{activeFile?.version_number || 1}</span>
        <span>{saveStatus === "error" ? <span className="text-red-400">Save failed</span> : dirty ? <span className="text-amber-400">Editing...</span> : <span className="text-green-400/80">All changes saved</span>}</span>
        <div className="flex-1" />
        <span>{isOwner ? "Owner" : canEdit ? "Editor" : "Viewer"}</span>
      </footer>

      {showShare && <ShareModal publicId={publicId} ownerToken={ownerToken} onSessionSaved={doSaveHistory} onClose={() => setShowShare(false)} />}
      {showInvite && <InviteModal publicId={publicId} ownerToken={ownerToken} joinCode={joinCode} onSessionSaved={doSaveHistory} onClose={() => setShowInvite(false)} />}
      {showLoginToEdit && <LoginToEditModal publicId={publicId} onClose={() => setShowLoginToEdit(false)} />}
    </div>
  );
}