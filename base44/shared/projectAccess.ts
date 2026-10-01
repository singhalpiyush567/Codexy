// Shared helpers for anonymous-owner project access.
// All functions run as service role (bypass RLS) and validate owner_token / membership.

export function generateToken(length = 16) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint8Array(length);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < length; i++) out += chars[arr[i] % chars.length];
  return out;
}

export function generateInviteCode() {
  const arr = new Uint8Array(4);
  crypto.getRandomValues(arr);
  let out = "";
  for (let i = 0; i < 4; i++) out += String(arr[i] % 10);
  return out;
}

export async function getProjectByPublicId(svc, publicId) {
  const res = await svc.entities.Project.filter({ public_id: publicId }, { limit: 2 });
  return (res.items || [])[0] || null;
}

export async function getProjectFiles(svc, publicId) {
  const res = await svc.entities.ProjectFile.filter({ project_public_id: publicId }, { sort: "filename", limit: 500 });
  return res.items || [];
}

// Resolves the caller's access level for a project.
// ownerToken -> owner (full edit + share + invite)
// authenticated collaborator -> editor (edit + history) or viewer (history)
// otherwise -> viewer (read-only + history)
// Permission model: owner (via token) can edit; ANY authenticated user can edit;
// everyone else is a read-only viewer. No complex per-user ACL.
export async function resolveAccess(svc, project, ownerToken, user, shareToken) {
  if (ownerToken && project.owner_token && ownerToken === project.owner_token) {
    return { role: "owner", canEdit: true, user };
  }
  if (user && project.user_id && user.id === project.user_id) {
    return { role: "owner", canEdit: true, user };
  }
  if (user) {
    return { role: "editor", canEdit: true, user };
  }
  return { role: "viewer", canEdit: false, user };
}

export function publicFile(f) {
  return {
    id: f.id,
    filename: f.filename,
    language: f.language,
    content: f.content || "",
    version_number: f.version_number || 1
  };
}

export function publicVersion(v) {
  return {
    id: v.id,
    version_number: v.version_number,
    content: v.content || "",
    old_content: v.old_content || "",
    new_content: v.new_content || "",
    user_name: v.user_name || "Anonymous",
    user_id: v.user_id || "",
    change_type: v.change_type || "edited",
    created_date: v.created_date
  };
}