import { Editor } from "@monaco-editor/react";
import { Loader2 } from "lucide-react";

export default function CodeEditor({ value, language, onChange, readOnly, theme, onMount }) {
  const isDark = theme !== "light";
  return (
    <Editor
      height="100%"
      language={language}
      value={value}
      theme={isDark ? "vs-dark" : "light"}
      onChange={(v) => onChange?.(v ?? "")}
      onMount={onMount}
      loading={<div className="flex items-center justify-center h-full text-slate-500"><Loader2 className="w-5 h-5 animate-spin" /></div>}
      options={{ minimap: { enabled: false }, fontSize: 13, readOnly, automaticLayout: true, scrollBeyondLastLine: false, wordWrap: "on", tabSize: 2, lineNumbers: "on" }}
    />
  );
}