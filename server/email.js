/**
 * Server-Side Email Service for CodeXY
 * 
 * Supports Resend API as the primary provider with a safe offline mock transport for local testing.
 * Configured via environment variables:
 * - RESEND_API_KEY
 * - EMAIL_FROM
 * - EMAIL_TO
 * - APP_URL
 */

export async function sendEmail({ to, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || 'CodeXY <onboarding@resend.dev>';

  if (!to) {
    throw new Error('Recipient email address (to) is required');
  }

  // If RESEND_API_KEY is not configured, fallback to offline mock transport
  if (!apiKey || apiKey.trim() === '') {
    if (process.env.NODE_ENV === 'development' || process.env.NODE_ENV === 'test') {
      console.log(`[EMAIL_MOCK] To: ${to} | Subject: ${subject}`);
    }
    return {
      success: true,
      delivered: false,
      provider: 'mock',
      message: 'LIVE EMAIL DELIVERY NOT VERIFIED — RESEND_API_KEY unavailable'
    };
  }

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [to],
        subject,
        html,
        text
      })
    });

    const data = await res.json();
    if (!res.ok) {
      console.error('[EMAIL_PROVIDER_ERROR] Resend API error:', data);
      return {
        success: false,
        delivered: false,
        provider: 'resend',
        error: data.message || 'Email delivery failed'
      };
    }

    return {
      success: true,
      delivered: true,
      provider: 'resend',
      id: data.id
    };
  } catch (err) {
    console.error('[EMAIL_DELIVERY_EXCEPTION]', err);
    return {
      success: false,
      delivered: false,
      provider: 'resend',
      error: err.message || 'Network failure sending email'
    };
  }
}

/**
 * Send OTP Verification Email to User
 */
export async function sendOtpEmail(email, otpCode) {
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const subject = `Your CodeXY Verification Code: ${otpCode}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #12151c; color: #ffffff; padding: 24px; margin: 0; }
        .card { max-width: 480px; margin: 0 auto; background: #1e222b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 32px; text-align: center; }
        .logo { font-size: 24px; font-weight: bold; color: #e91e63; margin-bottom: 20px; }
        .code { font-family: monospace; font-size: 32px; letter-spacing: 8px; color: #38bdf8; background: rgba(255,255,255,0.05); padding: 16px; border-radius: 8px; margin: 24px 0; font-weight: bold; }
        .footer { font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 32px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">codexy</div>
        <h2>Verify Your Account</h2>
        <p>Use the 6-digit code below to complete your registration:</p>
        <div class="code">${otpCode}</div>
        <p style="font-size: 13px; color: rgba(255,255,255,0.6);">This code expires in 10 minutes and can only be used once.</p>
        <div class="footer">If you did not request this verification, please ignore this email.<br>&copy; CodeXY</div>
      </div>
    </body>
    </html>
  `;

  const text = `Your CodeXY Verification Code: ${otpCode}\n\nThis code expires in 10 minutes.\n\nCodeXY`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send Password Reset Email to User
 */
export async function sendPasswordResetEmail(email, resetToken) {
  const appUrl = process.env.APP_URL || 'http://localhost:5173';
  const resetLink = `${appUrl}/reset-password?token=${encodeURIComponent(resetToken)}&email=${encodeURIComponent(email)}`;
  const subject = `Reset Your CodeXY Password`;

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #12151c; color: #ffffff; padding: 24px; margin: 0; }
        .card { max-width: 480px; margin: 0 auto; background: #1e222b; border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; padding: 32px; text-align: center; }
        .logo { font-size: 24px; font-weight: bold; color: #e91e63; margin-bottom: 20px; }
        .btn { display: inline-block; background-color: #e91e63; color: #ffffff; text-decoration: none; padding: 12px 24px; border-radius: 6px; font-weight: bold; margin: 24px 0; }
        .footer { font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 32px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 16px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="logo">codexy</div>
        <h2>Password Reset Request</h2>
        <p>We received a request to reset your password for your CodeXY account.</p>
        <a href="${resetLink}" class="btn">Reset Password</a>
        <p style="font-size: 13px; color: rgba(255,255,255,0.6);">This link expires in 15 minutes and can only be used once.</p>
        <div class="footer">If you did not request a password reset, please ignore this email.<br>&copy; CodeXY</div>
      </div>
    </body>
    </html>
  `;

  const text = `Reset your CodeXY Password:\n\n${resetLink}\n\nThis link expires in 15 minutes.\n\nCodeXY`;

  return sendEmail({ to: email, subject, html, text });
}

/**
 * Send Admin Notification Email on Registration / Login
 */
export async function sendAdminNotification({ event, userEmail, userName }) {
  const adminEmail = process.env.EMAIL_TO;
  if (!adminEmail) return { success: true, skipped: true };

  const timestamp = new Date().toISOString();
  const subject = `[CodeXY Notification] ${event === 'account_created' ? 'New User Registration' : 'User Login'}: ${userName}`;

  const html = `
    <!DOCTYPE html>
    <html>
    <body style="font-family: sans-serif; padding: 20px; background-color: #f4f4f5;">
      <div style="max-width: 500px; background: white; padding: 20px; border-radius: 8px;">
        <h3 style="color: #e91e63; margin-top: 0;">CodeXY Admin Notification</h3>
        <p><strong>Event:</strong> ${event === 'account_created' ? 'New Account Created' : 'Successful User Login'}</p>
        <p><strong>User Name:</strong> ${userName}</p>
        <p><strong>Email:</strong> ${userEmail}</p>
        <p><strong>Timestamp:</strong> ${timestamp}</p>
      </div>
    </body>
    </html>
  `;

  const text = `[CodeXY Admin Notification]\nEvent: ${event}\nUser: ${userName} (${userEmail})\nTimestamp: ${timestamp}`;

  return sendEmail({ to: adminEmail, subject, html, text });
}
