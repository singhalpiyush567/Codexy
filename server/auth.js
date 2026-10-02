import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import { query, transaction } from './db.js';

const SESSION_COOKIE_NAME = 'codexy_session';
const SESSION_DURATION_DAYS = 30;

export function serializeCookie(name, val, options = {}) {
  let cookieStr = `${encodeURIComponent(name)}=${encodeURIComponent(val || '')}`;
  if (options.maxAge != null) cookieStr += `; Max-Age=${Math.floor(options.maxAge)}`;
  if (options.domain) cookieStr += `; Domain=${options.domain}`;
  if (options.path) cookieStr += `; Path=${options.path}`;
  if (options.expires) cookieStr += `; Expires=${options.expires.toUTCString()}`;
  if (options.httpOnly) cookieStr += `; HttpOnly`;
  if (options.secure) cookieStr += `; Secure`;
  if (options.sameSite) cookieStr += `; SameSite=${options.sameSite}`;
  return cookieStr;
}

export function parseCookies(str) {
  const obj = {};
  if (!str) return obj;
  const pairs = str.split(';');
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i].trim();
    const eqIdx = pair.indexOf('=');
    if (eqIdx < 0) continue;
    const key = pair.substring(0, eqIdx).trim();
    let val = pair.substring(eqIdx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) {
      val = val.slice(1, -1);
    }
    try {
      obj[decodeURIComponent(key)] = decodeURIComponent(val);
    } catch (e) {
      obj[key] = val;
    }
  }
  return obj;
}

/**
 * Hash a plain text password using bcrypt
 */
export async function hashPassword(password) {
  const salt = await bcrypt.genSalt(10);
  return bcrypt.hash(password, salt);
}

/**
 * Compare a plain text password with a stored hash
 */
export async function comparePassword(password, hash) {
  if (!hash) return false;
  return bcrypt.compare(password, hash);
}

/**
 * Generate a SHA-256 hash of a string (e.g. for session token storage)
 */
export function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/**
 * Create a new session for a user and return the raw session token & set-cookie header
 */
export async function createSession(userId) {
  const rawToken = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(rawToken);
  const expiresAt = new Date(Date.now() + SESSION_DURATION_DAYS * 24 * 60 * 60 * 1000);

  await query(
    `INSERT INTO sessions (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
    [userId, tokenHash, expiresAt]
  );

  const cookieHeader = serializeCookie(SESSION_COOKIE_NAME, rawToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DURATION_DAYS * 24 * 60 * 60,
  });

  return { rawToken, expiresAt, cookieHeader };
}

/**
 * Destroy a session from cookie string and return clearing cookie header
 */
export async function destroySession(cookieString) {
  const cookies = parseCookies(cookieString || '');
  const rawToken = cookies[SESSION_COOKIE_NAME];

  if (rawToken) {
    const tokenHash = hashToken(rawToken);
    await query(`DELETE FROM sessions WHERE token_hash = $1`, [tokenHash]);
  }

  const clearCookieHeader = serializeCookie(SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/',
    maxAge: 0,
  });

  return clearCookieHeader;
}

/**
 * Get currently authenticated user from cookie header string
 */
export async function getUserBySession(cookieString) {
  if (!cookieString) return null;
  const cookies = parseCookies(cookieString);
  const rawToken = cookies[SESSION_COOKIE_NAME];
  if (!rawToken) return null;

  const tokenHash = hashToken(rawToken);
  const res = await query(
    `SELECT u.id, u.email, u.name, u.role, u.is_verified, u.created_at 
     FROM sessions s
     JOIN users u ON s.user_id = u.id
     WHERE s.token_hash = $1 AND s.expires_at > NOW()`,
    [tokenHash]
  );

  if (res.rows.length === 0) return null;
  return res.rows[0];
}

/**
 * Generate a 6-digit numeric OTP code and save to auth_tokens table
 */
export async function createOtpToken(email, userId = null, type = 'otp') {
  const code = Math.floor(100000 + Math.random() * 900000).toString();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

  // Invalidate old tokens of this type for this email
  await query(
    `UPDATE auth_tokens SET used = TRUE WHERE email = $1 AND type = $2 AND used = FALSE`,
    [email, type]
  );

  await query(
    `INSERT INTO auth_tokens (email, user_id, token, type, expires_at) VALUES ($1, $2, $3, $4, $5)`,
    [email, userId, code, type, expiresAt]
  );

  return code;
}

/**
 * Verify an OTP token
 */
export async function verifyOtpToken(email, code, type = 'otp') {
  const res = await query(
    `SELECT * FROM auth_tokens 
     WHERE email = $1 AND token = $2 AND type = $3 AND used = FALSE AND expires_at > NOW()
     ORDER BY created_at DESC LIMIT 1`,
    [email, code, type]
  );

  if (res.rows.length === 0) {
    return { valid: false, message: 'Invalid or expired verification code' };
  }

  const tokenRecord = res.rows[0];
  await query(`UPDATE auth_tokens SET used = TRUE WHERE id = $1`, [tokenRecord.id]);
  return { valid: true, tokenRecord };
}
