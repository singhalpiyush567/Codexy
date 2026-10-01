import { formatDistanceToNow, format } from "date-fns";

export const LANGUAGE_OPTIONS = [
  { value: "javascript", label: "JavaScript", monaco: "javascript" },
  { value: "typescript", label: "TypeScript", monaco: "typescript" },
  { value: "python", label: "Python", monaco: "python" },
  { value: "java", label: "Java", monaco: "java" },
  { value: "c", label: "C", monaco: "c" },
  { value: "cpp", label: "C++", monaco: "cpp" },
  { value: "html", label: "HTML", monaco: "html" },
  { value: "css", label: "CSS", monaco: "css" },
  { value: "sql", label: "SQL", monaco: "sql" },
  { value: "json", label: "JSON", monaco: "json" },
];

const EXT_MAP = {
  js: "javascript", jsx: "javascript", mjs: "javascript",
  ts: "typescript", tsx: "typescript",
  py: "python",
  java: "java",
  c: "c", h: "c",
  cpp: "cpp", cc: "cpp", hpp: "cpp",
  html: "html", htm: "html",
  css: "css",
  json: "json",
  sql: "sql",
};

export function getLanguageFromFilename(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  return EXT_MAP[ext] || "plaintext";
}

export function monacoLang(value) {
  const found = LANGUAGE_OPTIONS.find((l) => l.value === value);
  return found ? found.monaco : "plaintext";
}

export function defaultFilenameForLanguage(lang) {
  const map = {
    javascript: "script.js", typescript: "script.ts", python: "main.py", java: "Main.java",
    c: "main.c", cpp: "main.cpp", html: "index.html", css: "style.css", sql: "query.sql", json: "data.json",
  };
  return map[lang] || "code.txt";
}

export function timeAgo(date) {
  if (!date) return "";
  try {
    return formatDistanceToNow(new Date(date), { addSuffix: true });
  } catch {
    return "";
  }
}

export function formatDate(date) {
  if (!date) return "";
  try {
    return format(new Date(date), "d MMM yyyy, h:mm a");
  } catch {
    return "";
  }
}

// owner_token storage helpers (anonymous owner session)
export function getOwnerToken(publicId) {
  try { return localStorage.getItem(`codeshare_owner_${publicId}`) || ""; } catch { return ""; }
}
export function setOwnerToken(publicId, token) {
  try { localStorage.setItem(`codeshare_owner_${publicId}`, token); } catch {}
}
export function clearOwnerToken(publicId) {
  try { localStorage.removeItem(`codeshare_owner_${publicId}`); } catch {}
}

// Anonymous guest identity for presence (e.g. "Guest-AB12"). Persisted per browser.
export function getGuestIdentity() {
  try {
    let id = localStorage.getItem("codexy_guest_id");
    if (!id) {
      const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ";
      const arr = new Uint8Array(4);
      crypto.getRandomValues(arr);
      let suffix = "";
      for (let i = 0; i < 4; i++) suffix += chars[arr[i] % chars.length];
      id = `Guest-${suffix}`;
      localStorage.setItem("codexy_guest_id", id);
    }
    return id;
  } catch { return "Guest"; }
}