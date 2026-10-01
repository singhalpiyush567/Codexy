import { useState, useEffect, useRef } from "react";
import { base44 } from "@/api/base44Client";
import { Pencil, Check, X, Loader2 } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";

export default function ProjectNameEditor({ publicId, ownerToken, name, isOwner, onSaved }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => { setValue(name); }, [name]);
  useEffect(() => { if (editing && inputRef.current) { inputRef.current.focus(); inputRef.current.select(); } }, [editing]);

  async function save() {
    const clean = value.trim();
    if (!clean || clean === name) { setEditing(false); setValue(name); return; }
    setSaving(true);
    try {
      const res = await base44.functions.invoke("renameProject", { public_id: publicId, owner_token: ownerToken, name: clean });
      onSaved?.(res.data.name);
      toast({ title: "Project renamed" });
    } catch (e) {
      toast({ title: "Rename failed", description: e.response?.data?.error || e.message, variant: "destructive" });
      setValue(name);
    } finally {
      setSaving(false);
      setEditing(false);
    }
  }

  if (!isOwner) return <span className="text-sm text-white/70 truncate">{name}</span>;

  if (!editing) return (
    <button onClick={() => setEditing(true)} className="inline-flex items-center gap-1.5 text-sm text-white/70 hover:text-white truncate group max-w-[40vw]">
      <span className="truncate">{name}</span>
      <Pencil className="w-3 h-3 opacity-0 group-hover:opacity-60 transition-opacity shrink-0" />
    </button>
  );

  return (
    <div className="inline-flex items-center gap-1">
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") save(); if (e.key === "Escape") { setEditing(false); setValue(name); } }}
        disabled={saving}
        className="text-sm text-white bg-black/30 border border-white/15 rounded px-2 py-0.5 outline-none focus:border-pink-500/50 w-48"
      />
      <button onClick={save} disabled={saving} className="text-green-400 hover:text-green-300 p-0.5">{saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}</button>
      <button onClick={() => { setEditing(false); setValue(name); }} disabled={saving} className="text-white/50 hover:text-white p-0.5"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}