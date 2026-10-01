import { useEffect, useState, useCallback, useRef } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
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

export default function Workspace() {
  const { publicId } = useParams();
  const navigate = useNavigate();
  const { toast } = useToast();
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

  // refs to avoid stale closures in actor subscribe
  const draftRef = useRef("");
  const activeFileRef = useRef(null);
  const activeFileIdRef = useRef(null);
  const filesRef = useRef([]);
  const canEditRef = useRef(false);
  const mySeatRef = useRef(0);
  const applyingRemote = useRef(false);
  const roomRef = useRef(null);
  const dirtyRef = useRef(false);
  const doSaveRef = useRef(() => {});
  const lastPongRef = useRef(Date.now());
  const sendTimerRef = useRef(null);

  const loadProject = useCallback(async () => {
    try {
      const res = await base44.functions.invoke("getProject", { public_id: publicId, owner_token: ownerToken });
      const d = res.data;
      setProject(d.project);
      setFiles(d.files);
      setAccess(d.access);
      setMe(d.me);
      if (d.inviteCodes) setInviteCodes(d.inviteCodes);
      setActiveFileId((prev) => prev || (d.files.length ? d.files[0].id : null));
    } catch (e) {
      toast({ title: "Failed to load project", description: e.response?.data?.error || e.message, variant: "destructive" });
      navigate("/");
    } finally { setLoading(false); }
  }, [publicId, ownerToken]);

  useEffect(() => { loadProject(); }, [loadProject]);

  const activeFile = files.find((f) => f.id === activeFileId);
  const isOwner = access.role === "owner";
  const canEdit = access.canEdit;

  // keep refs in sync
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
      await base44.functions.invoke("saveFile", {
        public_id: publicId, file_id: file.id, owner_token: ownerToken,
        content, user_name: me?.name || getGuestIdentity(), create_history: false
      });
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, content } : f)));
      setDirty(false);
      setSaveStatus("saved");
    } catch (e) {
      setSaveStatus("error");
      toast({ title: "Auto-save failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }, [publicId, ownerToken, me]);
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
      const res = await base44.functions.invoke("saveFile", {
        public_id: publicId, file_id: file.id, owner_token: ownerToken,
        content: draftRef.current, user_name: me?.name || getGuestIdentity(), create_history: true
      });
      setFiles((prev) => prev.map((f) => (f.id === file.id ? { ...f, content: draftRef.current, version_number: res.data.version_number } : f)));
      setDirty(false);
      setSaveStatus("saved");
      setHistoryKey((k) => k + 1);
      toast({ title: "Saved to history", description: `Version ${res.data.version_number}` });
    } catch (e) {
      toast({ title: "Failed to save history", description: e.response?.data?.error || e.message, variant: "destructive" });
    } finally { setSavingHistory(false); }
  }, [publicId, ownerToken, me]);

  // Ctrl/Cmd+S → Save to History
  useEffect(() => {
    function onKey(e) { if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); doSaveHistory(); } }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [doSaveHistory]);

  // REAL-TIME: connect to the CodeSession actor
  useEffect(() => {
    let connId = sessionStorage.getItem("codexy_conn_id");
    if (!connId) { connId = crypto.randomUUID(); sessionStorage.setItem("codexy_conn_id", connId); }
    const room = base44.actors.CodeSession(publicId).connect({ id: connId });
    roomRef.current = room;
    lastPongRef.current = Date.now();
    setConnStatus("connecting");
    const sub = room.subscribe((msg) => {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "pong") { lastPongRef.current = Date.now(); setConnStatus("connected"); return; }
      if (msg.type === "sync") {
        mySeatRef.current = msg.seat;
        // seed the actor with any files it doesn't have yet
        const filesObj = {};
        for (const f of filesRef.current) {
          if (!msg.content[f.id]) filesObj[f.id] = f.content || "";
        }
        if (Object.keys(filesObj).length) room.send({ type: "init", files: filesObj });
        // apply live content for the active file if the actor has it
        if (activeFileIdRef.current && msg.content[activeFileIdRef.current]) {
          applyingRemote.current = true;
          setDraft(msg.content[activeFileIdRef.current]);
          setDirty(false);
        }
      } else if (msg.type === "sync_file") {
        if (msg.file_id === activeFileIdRef.current && msg.content != null) {
          applyingRemote.current = true;
          setDraft(msg.content);
          setDirty(false);
        }
      } else if (msg.type === "edit") {
        if (msg.file_id === activeFileIdRef.current && msg.seat !== mySeatRef.current) {
          applyingRemote.current = true;
          setDraft(msg.content);
          setDirty(false);
        }
      } else if (msg.type === "presence") {
        setActiveUsers(msg.users || []);
      }
    });
    room.send({ type: "presence", name: getGuestIdentity(), anonymous: true });
    return () => { sub.unsubscribe(); room.close(); roomRef.current = null; };
  }, [publicId]);

  // update presence when identity resolves
  useEffect(() => {
    if (roomRef.current) {
      roomRef.current.send({ type: "presence", name: me?.name || getGuestIdentity(), anonymous: !me });
    }
  }, [me]);

  // heartbeat → reconnect indicator
  useEffect(() => {
    const interval = setInterval(() => {
      roomRef.current?.send({ type: "ping" });
      if (lastPongRef.current && Date.now() - lastPongRef.current > 15000) setConnStatus("reconnecting");
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  function handleChange(v) {
    if (applyingRemote.current) { applyingRemote.current = false; setDraft(v); return; }
    if (!canEdit) return;
    draftRef.current = v;
    setDraft(v);
    setDirty(true);
    // broadcast to actor (throttled ~100ms for low latency without flooding)
    if (activeFileRef.current && roomRef.current) {
      if (sendTimerRef.current) clearTimeout(sendTimerRef.current);
      sendTimerRef.current = setTimeout(() => {
        roomRef.current?.send({ type: "edit", file_id: activeFileRef.current.id, content: draftRef.current });
      }, 100);
    }
  }

  // detect edit attempts by anonymous viewers (readOnly editor) → login prompt
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
    roomRef.current?.send({ type: "request_file", file_id: id });
  }, []);

  const manageFile = useCallback(async (action, payload) => {
    if (dirtyRef.current && canEditRef.current && activeFileRef.current) { await doSaveRef.current(); }
    try {
      const res = await base44.functions.invoke("manageFile", { public_id: publicId, owner_token: ownerToken, action, ...payload });
      setFiles(res.data.files);
      if (action === "create" && res.data.files.length) {
        const newest = res.data.files[res.data.files.length - 1];
        setActiveFileId(newest.id);
      }
    } catch (e) {
      toast({ title: "Failed", description: e.response?.data?.error || e.message, variant: "destructive" });
    }
  }, [publicId, ownerToken]);

  const onAdd = useCallback((name, lang) => manageFile("create", { filename: name, language: lang }), [manageFile]);
  const onRename = useCallback((id, name) => manageFile("rename", { file_id: id, filename: name }), [manageFile]);
  const onDelete = useCallback((id) => { manageFile("delete", { file_id: id }); setActiveFileId((prev) => (prev === id ? null : prev)); }, [manageFile]);

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

        {/* active users */}
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

        {/* connection status */}
        <div className="flex items-center gap-1.5 text-[11px] mr-1">
          <span className={`w-2 h-2 rounded-full ${connStatus === "connected" ? "bg-green-400" : connStatus === "reconnecting" ? "bg-amber-400 animate-pulse" : "bg-white/30 animate-pulse"}`} />
          <span className="text-white/50 hidden sm:inline">{connStatus === "connected" ? "Live" : connStatus === "reconnecting" ? "Reconnecting..." : "Connecting..."}</span>
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
          <Button size="sm" variant="ghost" onClick={() => { base44.auth.logout(window.location.origin); }} className="text-white/60 hover:text-white h-8">Logout</Button>
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
                      <div className="text-sm text-white truncate">{u.name}{u.seat === mySeatRef.current && u.anonymous ? " (you)" : ""}</div>
                      <div className="text-[11px] text-white/40">{u.anonymous ? "Guest" : "Editor"}</div>
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