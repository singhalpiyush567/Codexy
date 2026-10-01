import { useState, memo } from "react";
import { FilePlus, FileCode, Trash2, Pencil, Check, X } from "lucide-react";
import { getLanguageFromFilename } from "@/lib/projectUtils";

function FileExplorer({ files, activeId, onSelect, onAdd, onRename, onDelete, canEdit }) {
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [renamingId, setRenamingId] = useState(null);
  const [renameVal, setRenameVal] = useState("");

  function submitNew() {
    const name = newName.trim();
    if (!name) { setAdding(false); return; }
    onAdd(name, getLanguageFromFilename(name));
    setNewName(""); setAdding(false);
  }
  function submitRename(id) {
    const name = renameVal.trim();
    if (name) onRename(id, name);
    setRenamingId(null);
  }

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-white/5">
        <span className="text-[11px] font-medium uppercase tracking-wide text-white/40">Files</span>
        {canEdit && <button onClick={() => setAdding(true)} className="text-slate-400 hover:text-white" title="New file"><FilePlus className="w-4 h-4" /></button>}
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {files.map((f) => (
          <div key={f.id} className={`group flex items-center gap-1.5 px-3 py-1.5 cursor-pointer ${activeId === f.id ? "bg-pink-500/15 text-white" : "text-white/60 hover:bg-white/5"}`} onClick={() => onSelect(f.id)}>
            <FileCode className="w-3.5 h-3.5 shrink-0 text-slate-500" />
            {renamingId === f.id ? (
              <input autoFocus value={renameVal} onChange={(e) => setRenameVal(e.target.value)} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => { if (e.key === "Enter") submitRename(f.id); if (e.key === "Escape") setRenamingId(null); }} className="flex-1 min-w-0 bg-black/40 border border-white/10 rounded px-1 text-xs text-slate-100 outline-none" />
            ) : (
              <span className="text-sm truncate flex-1">{f.filename}</span>
            )}
            {canEdit && renamingId !== f.id && (
              <div className="hidden group-hover:flex items-center gap-0.5">
                <button onClick={(e) => { e.stopPropagation(); setRenamingId(f.id); setRenameVal(f.filename); }} className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-white"><Pencil className="w-3 h-3" /></button>
                <button onClick={(e) => { e.stopPropagation(); if (confirm(`Delete ${f.filename}?`)) onDelete(f.id); }} className="p-1 rounded hover:bg-white/10 text-slate-500 hover:text-red-400"><Trash2 className="w-3 h-3" /></button>
              </div>
            )}
            {renamingId === f.id && (
              <div className="flex items-center gap-0.5">
                <button onClick={(e) => { e.stopPropagation(); submitRename(f.id); }} className="p-1 rounded hover:bg-white/10 text-green-400"><Check className="w-3 h-3" /></button>
                <button onClick={(e) => { e.stopPropagation(); setRenamingId(null); }} className="p-1 rounded hover:bg-white/10 text-slate-500"><X className="w-3 h-3" /></button>
              </div>
            )}
          </div>
        ))}
        {adding && (
          <div className="flex items-center gap-1.5 px-3 py-1.5">
            <FileCode className="w-3.5 h-3.5 text-slate-500" />
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submitNew(); if (e.key === "Escape") setAdding(false); }} placeholder="filename.js" className="flex-1 bg-black/40 border border-white/10 rounded px-1.5 py-0.5 text-xs text-slate-100 outline-none" />
            <button onClick={submitNew} className="p-1 rounded hover:bg-white/10 text-green-400"><Check className="w-3 h-3" /></button>
            <button onClick={() => setAdding(false)} className="p-1 rounded hover:bg-white/10 text-slate-500"><X className="w-3 h-3" /></button>
          </div>
        )}
        {!files.length && !adding && <div className="px-3 py-6 text-center text-xs text-slate-600">No files yet</div>}
      </div>
    </div>
  );
}

export default memo(FileExplorer);