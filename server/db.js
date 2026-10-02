import pg from 'pg';
import crypto from 'node:crypto';
const { Pool } = pg;

// Singleton database pool
let pool = null;

// In-memory store fallback for offline testing / development without live DB
const memoryStore = {
  users: [],
  sessions: [],
  auth_tokens: [],
  oauth_accounts: [],
  projects: [],
  project_collaborators: [],
  project_files: [],
  file_versions: [],
  invitations: [],
  share_links: [],
  user_activity: []
};

export function getPool() {
  const connectionString = process.env.DATABASE_URL || process.env.DATABASE_URL_UNPOOLED;
  if (!connectionString) {
    return null;
  }
  if (!pool) {
    pool = new Pool({
      connectionString,
      ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });
  }
  return pool;
}

/**
 * Execute a single SQL query (with in-memory fallback if no DB connection string)
 */
export async function query(text, params = []) {
  const p = getPool();
  if (p) {
    const start = Date.now();
    const res = await p.query(text, params);
    const duration = Date.now() - start;
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text: text.substring(0, 80), duration, rows: res.rowCount });
    }
    return res;
  }

  // --- IN-MEMORY FALLBACK FOR OFFLINE TESTS ---
  const sql = text.trim();

  // 1. SELECT FROM USERS BY EMAIL
  if (sql.includes('SELECT') && sql.includes('FROM users WHERE email = $1')) {
    const email = params[0]?.toLowerCase();
    const rows = memoryStore.users.filter(u => u.email === email);
    return { rows, rowCount: rows.length };
  }

  // 2. INSERT INTO USERS
  if (sql.includes('INSERT INTO users')) {
    const user = {
      id: crypto.randomUUID(),
      email: params[0]?.toLowerCase(),
      password_hash: params[1],
      name: params[2],
      role: params[3] || 'user',
      is_verified: params[4] || false,
      created_at: new Date()
    };
    memoryStore.users.push(user);
    return { rows: [user], rowCount: 1 };
  }

  // 3. INSERT INTO SESSIONS
  if (sql.includes('INSERT INTO sessions')) {
    const session = {
      id: crypto.randomUUID(),
      user_id: params[0],
      token_hash: params[1],
      expires_at: params[2],
      created_at: new Date()
    };
    memoryStore.sessions.push(session);
    return { rows: [session], rowCount: 1 };
  }

  // 4. SELECT FROM SESSIONS JOIN USERS
  if (sql.includes('SELECT') && sql.includes('FROM sessions s') && sql.includes('JOIN users u')) {
    const token_hash = params[0];
    const session = memoryStore.sessions.find(s => s.token_hash === token_hash && new Date(s.expires_at) > new Date());
    if (!session) return { rows: [], rowCount: 0 };
    const user = memoryStore.users.find(u => u.id === session.user_id);
    if (!user) return { rows: [], rowCount: 0 };
    return { rows: [user], rowCount: 1 };
  }

  // 5. DELETE FROM SESSIONS WHERE TOKEN_HASH
  if (sql.includes('DELETE FROM sessions WHERE token_hash = $1')) {
    const token_hash = params[0];
    memoryStore.sessions = memoryStore.sessions.filter(s => s.token_hash !== token_hash);
    return { rows: [], rowCount: 1 };
  }

  // 6. UPDATE AUTH_TOKENS SET USED = TRUE
  if (sql.includes('UPDATE auth_tokens SET used = TRUE')) {
    if (params.length === 2) {
      const email = params[0];
      const type = params[1];
      memoryStore.auth_tokens.forEach(t => {
        if (t.email === email && t.type === type) t.used = true;
      });
    } else if (params.length === 1) {
      const id = params[0];
      const tokenRec = memoryStore.auth_tokens.find(t => t.id === id);
      if (tokenRec) tokenRec.used = true;
    }
    return { rows: [], rowCount: 1 };
  }

  // 7. INSERT INTO AUTH_TOKENS
  if (sql.includes('INSERT INTO auth_tokens')) {
    const tokenRecord = {
      id: crypto.randomUUID(),
      email: params[0],
      user_id: params[1],
      token: params[2],
      type: params[3],
      expires_at: params[4],
      used: false,
      created_at: new Date()
    };
    memoryStore.auth_tokens.push(tokenRecord);
    return { rows: [tokenRecord], rowCount: 1 };
  }

  // 8. SELECT FROM AUTH_TOKENS
  if (sql.includes('SELECT') && sql.includes('FROM auth_tokens')) {
    const email = params[0]?.toLowerCase();
    const token = params[1];
    const type = params[2];
    const match = memoryStore.auth_tokens.find(
      t => t.email === email && t.token === token && t.type === type && !t.used && new Date(t.expires_at) > new Date()
    );
    return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
  }

  // 9. UPDATE USERS SET IS_VERIFIED
  if (sql.includes('UPDATE users SET is_verified = TRUE')) {
    const email = params[0]?.toLowerCase();
    const user = memoryStore.users.find(u => u.email === email);
    if (user) user.is_verified = true;
    return { rows: [], rowCount: 1 };
  }

  // 10. UPDATE USERS SET PASSWORD_HASH
  if (sql.includes('UPDATE users SET password_hash = $1')) {
    const hash = params[0];
    const email = params[1]?.toLowerCase();
    const user = memoryStore.users.find(u => u.email === email);
    if (user) user.password_hash = hash;
    return { rows: [], rowCount: 1 };
  }

  // 11. INSERT INTO USER_ACTIVITY
  if (sql.includes('INSERT INTO user_activity')) {
    const act = {
      id: crypto.randomUUID(),
      user_id: params[0],
      user_name: params[1],
      action: params[2],
      detail: params[3],
      created_at: new Date()
    };
    memoryStore.user_activity.push(act);
    return { rows: [act], rowCount: 1 };
  }

  // 12. INSERT INTO PROJECTS
  if (sql.includes('INSERT INTO projects')) {
    const proj = {
      id: crypto.randomUUID(),
      public_id: params[0],
      name: params[1],
      language: params[2],
      user_id: params[3],
      owner_token: 'deprecated',
      created_at: new Date(),
      updated_at: new Date()
    };
    memoryStore.projects.push(proj);
    return { rows: [proj], rowCount: 1 };
  }

  // 13. SELECT FROM PROJECTS BY PUBLIC_ID OR ID
  if (sql.includes('SELECT') && sql.includes('FROM projects WHERE public_id = $1')) {
    const public_id = params[0];
    const match = memoryStore.projects.find(p => p.public_id === public_id);
    return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
  }

  if (sql.includes('SELECT') && sql.includes('FROM projects WHERE user_id = $1')) {
    const user_id = params[0];
    const rows = memoryStore.projects.filter(p => p.user_id === user_id);
    return { rows, rowCount: rows.length };
  }

  // 14. UPDATE PROJECTS
  if (sql.includes('UPDATE projects SET')) {
    const projId = params[params.length - 1];
    const proj = memoryStore.projects.find(p => p.id === projId);
    if (proj) {
      if (sql.includes('name = $1')) proj.name = params[0];
      if (sql.includes('language = $1') || sql.includes('language = $2')) proj.language = params[params.length - 2];
      proj.updated_at = new Date();
    }
    return { rows: proj ? [proj] : [], rowCount: proj ? 1 : 0 };
  }

  // 15. DELETE FROM PROJECTS
  if (sql.includes('DELETE FROM projects WHERE id = $1')) {
    const projId = params[0];
    memoryStore.projects = memoryStore.projects.filter(p => p.id !== projId);
    memoryStore.project_files = memoryStore.project_files.filter(f => f.project_id !== projId);
    return { rows: [], rowCount: 1 };
  }

  // 16. INSERT INTO PROJECT_FILES
  if (sql.includes('INSERT INTO project_files')) {
    const file = {
      id: crypto.randomUUID(),
      project_id: params[0],
      filename: params[1],
      language: params[2],
      content: params[3],
      version_number: params[4] || 1,
      created_at: new Date(),
      updated_at: new Date()
    };
    memoryStore.project_files.push(file);
    return { rows: [file], rowCount: 1 };
  }

  // 17. SELECT FROM PROJECT_FILES
  if (sql.includes('SELECT') && sql.includes('FROM project_files') && sql.includes('JOIN projects')) {
    const fileId = params[0];
    const file = memoryStore.project_files.find(f => f.id === fileId);
    if (!file) return { rows: [], rowCount: 0 };
    const proj = memoryStore.projects.find(p => p.id === file.project_id);
    return {
      rows: [{ ...file, project_public_id: proj?.public_id, project_name: proj?.name }],
      rowCount: 1
    };
  }

  if (sql.includes('SELECT') && sql.includes('FROM project_files WHERE project_id = $1 AND filename = $2')) {
    const projId = params[0];
    const fname = params[1];
    const match = memoryStore.project_files.find(f => f.project_id === projId && f.filename === fname);
    return { rows: match ? [match] : [], rowCount: match ? 1 : 0 };
  }

  if (sql.includes('SELECT') && sql.includes('FROM project_files WHERE project_id = $1')) {
    const projId = params[0];
    const rows = memoryStore.project_files.filter(f => f.project_id === projId);
    return { rows, rowCount: rows.length };
  }

  // 18. UPDATE PROJECT_FILES
  if (sql.includes('UPDATE project_files SET content = $1')) {
    const content = params[0];
    const filename = params[1];
    const language = params[2];
    const fileId = params[3];
    const file = memoryStore.project_files.find(f => f.id === fileId);
    if (file) {
      file.content = content;
      file.filename = filename;
      file.language = language;
      file.updated_at = new Date();
    }
    return { rows: file ? [file] : [], rowCount: file ? 1 : 0 };
  }

  // 19. DELETE FROM PROJECT_FILES
  if (sql.includes('DELETE FROM project_files WHERE id = $1')) {
    const fileId = params[0];
    memoryStore.project_files = memoryStore.project_files.filter(f => f.id !== fileId);
    return { rows: [], rowCount: 1 };
  }

  // 20. PROJECT COLLABORATORS
  if (sql.includes('INSERT INTO project_collaborators')) {
    const pc = {
      id: crypto.randomUUID(),
      project_id: params[0],
      user_id: params[1],
      role: params[2] || 'edit',
      created_at: new Date()
    };
    memoryStore.project_collaborators.push(pc);
    return { rows: [pc], rowCount: 1 };
  }

  if (sql.includes('SELECT role FROM project_collaborators')) {
    const projId = params[0];
    const userId = params[1];
    const match = memoryStore.project_collaborators.find(pc => pc.project_id === projId && pc.user_id === userId);
    return { rows: match ? [{ role: match.role }] : [], rowCount: match ? 1 : 0 };
  }

  if (sql.includes('UPDATE project_collaborators SET role')) {
    const projId = params[0];
    const userId = params[1];
    const pc = memoryStore.project_collaborators.find(p => p.project_id === projId && p.user_id === userId);
    if (pc) pc.role = 'edit';
    return { rows: [], rowCount: 1 };
  }

  if (sql.includes('DELETE FROM project_collaborators')) {
    const projId = params[0];
    const userId = params[1];
    memoryStore.project_collaborators = memoryStore.project_collaborators.filter(pc => !(pc.project_id === projId && pc.user_id === userId));
    return { rows: [], rowCount: 1 };
  }

  // 21. SELECT FROM FILE_VERSIONS
  if (sql.includes('SELECT COUNT(*) FROM file_versions')) {
    const fileId = params[0];
    const rows = memoryStore.file_versions.filter(fv => fv.file_id === fileId);
    return { rows: [{ count: rows.length }], rowCount: 1 };
  }

  return { rows: [], rowCount: 0 };
}

/**
 * Execute a database transaction
 */
export async function transaction(callback) {
  const p = getPool();
  if (p) {
    const client = await p.connect();
    try {
      await client.query('BEGIN');
      const result = await callback(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  // In-memory mock transaction
  return callback({ query });
}

export default {
  query,
  transaction,
  getPool,
};
