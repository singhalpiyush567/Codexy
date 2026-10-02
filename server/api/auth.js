import { query, transaction } from '../db.js';
import { 
  hashPassword, 
  comparePassword, 
  createSession, 
  destroySession, 
  getUserBySession, 
  createOtpToken, 
  verifyOtpToken 
} from '../auth.js';

export async function handleAuthRequest(req, res, action, body, headers) {
  const cookieHeader = headers?.cookie || req.headers?.cookie || '';

  try {
    // -----------------------------------------------------------------
    // 1. GET CURRENT USER PROFILE (/api/auth/me)
    // -----------------------------------------------------------------
    if (action === 'me' || action === 'GET /api/auth/me') {
      const user = await getUserBySession(cookieHeader);
      if (!user) {
        return { status: 200, body: { authenticated: false, user: null } };
      }
      return { 
        status: 200, 
        body: { 
          authenticated: true, 
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            is_verified: user.is_verified,
            created_at: user.created_at
          } 
        } 
      };
    }

    // -----------------------------------------------------------------
    // 2. REGISTER USER (/api/auth/register)
    // -----------------------------------------------------------------
    if (action === 'register' || action === 'POST /api/auth/register') {
      const { email, password, name } = body || {};
      if (!email || !password) {
        return { status: 400, body: { error: 'Email and password are required' } };
      }

      const existing = await query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (existing.rows.length > 0) {
        return { status: 400, body: { error: 'Email is already registered' } };
      }

      const password_hash = await hashPassword(password);
      const displayName = name || email.split('@')[0];

      const newUserRes = await query(
        `INSERT INTO users (email, password_hash, name, role, is_verified) 
         VALUES ($1, $2, $3, $4, $5) RETURNING id, email, name, role`,
        [email.toLowerCase(), password_hash, displayName, 'user', false]
      );

      const user = newUserRes.rows[0];
      const otpCode = await createOtpToken(user.email, user.id, 'otp');

      // Log user activity
      await query(
        `INSERT INTO user_activity (user_id, user_name, action, detail) VALUES ($1, $2, $3, $4)`,
        [user.id, user.name, 'registered', `User registered with email ${user.email}`]
      );

      console.log(`[AUTH] OTP generated for ${user.email}: ${otpCode}`);

      return {
        status: 200,
        body: {
          success: true,
          message: 'Account created. Verification OTP sent.',
          email: user.email,
          // In development environments without email provider configured, we include debug code if needed
          otpDebug: process.env.NODE_ENV === 'development' ? otpCode : undefined
        }
      };
    }

    // -----------------------------------------------------------------
    // 3. VERIFY OTP (/api/auth/verify-otp)
    // -----------------------------------------------------------------
    if (action === 'verify-otp' || action === 'POST /api/auth/verify-otp') {
      const { email, otpCode } = body || {};
      if (!email || !otpCode) {
        return { status: 400, body: { error: 'Email and OTP code are required' } };
      }

      const verifyRes = await verifyOtpToken(email.toLowerCase(), otpCode, 'otp');
      if (!verifyRes.valid) {
        return { status: 400, body: { error: verifyRes.message } };
      }

      // Mark user as verified
      await query(`UPDATE users SET is_verified = TRUE WHERE email = $1`, [email.toLowerCase()]);
      const userRes = await query(`SELECT id, email, name, role FROM users WHERE email = $1`, [email.toLowerCase()]);
      const user = userRes.rows[0];

      // Create session & cookie
      const { cookieHeader: newCookie } = await createSession(user.id);

      return {
        status: 200,
        headers: { 'Set-Cookie': newCookie },
        body: {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
          }
        }
      };
    }

    // -----------------------------------------------------------------
    // 4. RESEND OTP (/api/auth/resend-otp)
    // -----------------------------------------------------------------
    if (action === 'resend-otp' || action === 'POST /api/auth/resend-otp') {
      const { email } = body || {};
      if (!email) {
        return { status: 400, body: { error: 'Email is required' } };
      }

      const userRes = await query('SELECT id, email FROM users WHERE email = $1', [email.toLowerCase()]);
      if (userRes.rows.length === 0) {
        return { status: 400, body: { error: 'User not found' } };
      }

      const user = userRes.rows[0];
      const otpCode = await createOtpToken(user.email, user.id, 'otp');

      console.log(`[AUTH] Resent OTP for ${user.email}: ${otpCode}`);

      return {
        status: 200,
        body: {
          success: true,
          message: 'OTP resent successfully.',
          otpDebug: process.env.NODE_ENV === 'development' ? otpCode : undefined
        }
      };
    }

    // -----------------------------------------------------------------
    // 5. LOGIN (/api/auth/login)
    // -----------------------------------------------------------------
    if (action === 'login' || action === 'POST /api/auth/login') {
      const { email, password } = body || {};
      if (!email || !password) {
        return { status: 400, body: { error: 'Email and password are required' } };
      }

      const userRes = await query(
        `SELECT id, email, name, password_hash, role, is_verified FROM users WHERE email = $1`,
        [email.toLowerCase()]
      );

      if (userRes.rows.length === 0) {
        return { status: 401, body: { error: 'Invalid email or password' } };
      }

      const user = userRes.rows[0];
      const valid = await comparePassword(password, user.password_hash);
      if (!valid) {
        return { status: 401, body: { error: 'Invalid email or password' } };
      }

      // Create session
      const { cookieHeader: newCookie } = await createSession(user.id);

      // Log login activity
      await query(
        `INSERT INTO user_activity (user_id, user_name, action, detail) VALUES ($1, $2, $3, $4)`,
        [user.id, user.name, 'logged_in', `User logged in from web`]
      );

      return {
        status: 200,
        headers: { 'Set-Cookie': newCookie },
        body: {
          success: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role,
            is_verified: user.is_verified
          }
        }
      };
    }

    // -----------------------------------------------------------------
    // 6. LOGOUT (/api/auth/logout)
    // -----------------------------------------------------------------
    if (action === 'logout' || action === 'POST /api/auth/logout') {
      const clearCookie = await destroySession(cookieHeader);
      return {
        status: 200,
        headers: { 'Set-Cookie': clearCookie },
        body: { success: true }
      };
    }

    // -----------------------------------------------------------------
    // 7. FORGOT PASSWORD (/api/auth/forgot-password)
    // -----------------------------------------------------------------
    if (action === 'forgot-password' || action === 'POST /api/auth/forgot-password') {
      const { email } = body || {};
      if (!email) {
        return { status: 400, body: { error: 'Email is required' } };
      }

      const userRes = await query('SELECT id, email FROM users WHERE email = $1', [email.toLowerCase()]);
      if (userRes.rows.length > 0) {
        const user = userRes.rows[0];
        const resetToken = await createOtpToken(user.email, user.id, 'password_reset');
        console.log(`[AUTH] Password reset token for ${user.email}: ${resetToken}`);
      }

      // Always return success to prevent email enumeration
      return {
        status: 200,
        body: {
          success: true,
          message: 'If an account exists with that email, a password reset link/code has been sent.'
        }
      };
    }

    // -----------------------------------------------------------------
    // 8. RESET PASSWORD (/api/auth/reset-password)
    // -----------------------------------------------------------------
    if (action === 'reset-password' || action === 'POST /api/auth/reset-password') {
      const { email, token, newPassword } = body || {};
      if (!email || !token || !newPassword) {
        return { status: 400, body: { error: 'Email, reset token, and new password are required' } };
      }

      const verifyRes = await verifyOtpToken(email.toLowerCase(), token, 'password_reset');
      if (!verifyRes.valid) {
        return { status: 400, body: { error: verifyRes.message } };
      }

      const password_hash = await hashPassword(newPassword);
      await query('UPDATE users SET password_hash = $1 WHERE email = $2', [password_hash, email.toLowerCase()]);

      return {
        status: 200,
        body: { success: true, message: 'Password updated successfully. You can now log in.' }
      };
    }

    // -----------------------------------------------------------------
    // 9. GOOGLE OAUTH LOGIN (/api/auth/google)
    // -----------------------------------------------------------------
    if (action === 'google' || action === 'POST /api/auth/google') {
      const { idToken, googleProfile } = body || {};
      if (!googleProfile || !googleProfile.email) {
        return { status: 400, body: { error: 'Google profile information required' } };
      }

      const email = googleProfile.email.toLowerCase();
      const googleId = googleProfile.sub || googleProfile.id;

      let userRes = await query('SELECT id, email, name, role FROM users WHERE email = $1', [email]);
      let user;

      if (userRes.rows.length === 0) {
        // Create new user for Google login
        const newUser = await query(
          `INSERT INTO users (email, name, role, is_verified) VALUES ($1, $2, $3, $4) RETURNING id, email, name, role`,
          [email, googleProfile.name || email.split('@')[0], 'user', true]
        );
        user = newUser.rows[0];
      } else {
        user = userRes.rows[0];
      }

      // Link OAuth account
      await query(
        `INSERT INTO oauth_accounts (user_id, provider, provider_account_id)
         VALUES ($1, $2, $3)
         ON CONFLICT (provider, provider_account_id) DO NOTHING`,
        [user.id, 'google', googleId]
      );

      // Create session
      const { cookieHeader: newCookie } = await createSession(user.id);

      return {
        status: 200,
        headers: { 'Set-Cookie': newCookie },
        body: { success: true, user }
      };
    }

    return { status: 404, body: { error: `Unknown auth action: ${action}` } };
  } catch (err) {
    console.error(`[AUTH_ERROR] Error handling ${action}:`, err);
    return { status: 500, body: { error: err.message || 'Internal server error' } };
  }
}
