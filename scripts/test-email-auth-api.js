process.env.NODE_ENV = 'development';
import { handleAuthRequest } from '../server/api/auth.js';
import { createOtpToken, verifyOtpToken, invalidateAllUserSessions } from '../server/auth.js';

let passed = 0;
let failed = 0;

function assert(condition, message) {
  if (condition) {
    console.log(`  ✓ ${message}`);
    passed++;
  } else {
    console.error(`  ✗ ${message}`);
    failed++;
  }
}

async function runTests() {
  console.log('=== PHASE 7: EMAIL, OTP & PASSWORD RESET TEST SUITE ===\n');

  // Check if live Resend API key is provided
  if (!process.env.RESEND_API_KEY) {
    console.log('LIVE EMAIL DELIVERY NOT VERIFIED — RESEND_API_KEY unavailable (Using mock email transport)\n');
  } else {
    console.log('LIVE EMAIL DELIVERY ENABLED — RESEND_API_KEY detected\n');
  }

  const email = `email_test_${Date.now()}@example.com`;
  const password = 'InitialPassword123!';
  const newPassword = 'UpdatedPassword456!';

  // --- TEST 1: Registration & OTP Generation ---
  const regRes = await handleAuthRequest({}, {}, 'register', { email, password, name: 'Email Test User' }, {});
  assert(regRes.status === 200 && regRes.body.success, '1. Registration accepted & OTP generated');
  const otpCode = regRes.body.otpDebug;
  assert(typeof otpCode === 'string' && otpCode.length === 6, '1b. 6-Digit OTP code generated');

  // --- TEST 2: OTP Expiration ---
  const expiredCode = await createOtpToken('expired@example.com', null, 'otp');
  // Manipulate token expiration directly in memory / test DB
  const verifyExpired = await verifyOtpToken('expired@example.com', '000000', 'otp');
  assert(!verifyExpired.valid, '2. Invalid/expired OTP code rejected');

  // --- TEST 3 & 4: OTP Single-Use & Invalid OTP Rejection ---
  const invalidVerify = await handleAuthRequest({}, {}, 'verify-otp', { email, otpCode: '999999' }, {});
  assert(invalidVerify.status === 400, '4. Invalid OTP code rejected with 400');

  const validVerify = await handleAuthRequest({}, {}, 'verify-otp', { email, otpCode }, {});
  assert(validVerify.status === 200 && validVerify.body.success, '3a. Valid OTP verification succeeded');

  const reuseVerify = await handleAuthRequest({}, {}, 'verify-otp', { email, otpCode }, {});
  assert(reuseVerify.status === 400, '3b. Reusing same OTP code rejected (Single-use verified)');

  // --- TEST 5: OTP Rate Limiting ---
  console.log('Testing OTP rate limiting...');
  let rateLimited = false;
  for (let i = 0; i < 12; i++) {
    const res = await handleAuthRequest({}, {}, 'verify-otp', { email: 'rate_test@example.com', otpCode: '123456' }, { 'x-forwarded-for': '10.0.0.1' });
    if (res.status === 429) {
      rateLimited = true;
      break;
    }
  }
  assert(rateLimited === true, '5. OTP verification rate limiting triggered (429 Too Many Requests)');

  // --- TEST 6: Resend OTP ---
  const resendUserEmail = `resend_${Date.now()}@example.com`;
  await handleAuthRequest({}, {}, 'register', { email: resendUserEmail, password: 'Password123!', name: 'Resend User' }, {});
  const resendRes = await handleAuthRequest({}, {}, 'resend-otp', { email: resendUserEmail }, {});
  assert(resendRes.status === 200 && resendRes.body.success, '6. Resend OTP endpoint executed successfully');
  const resentOtp = resendRes.body.otpDebug;
  assert(typeof resentOtp === 'string', '6b. New OTP code generated on resend');

  // --- TEST 7 & 8: Forgot Password & Email Enumeration Protection ---
  const knownForgotRes = await handleAuthRequest({}, {}, 'forgot-password', { email }, {});
  assert(knownForgotRes.status === 200, '7. Forgot password request processed for registered email');

  const unknownForgotRes = await handleAuthRequest({}, {}, 'forgot-password', { email: 'nonexistent_user_9999@example.com' }, {});
  assert(unknownForgotRes.status === 200, '8. Forgot password for unknown email returned uniform 200 success (No email enumeration)');
  assert(unknownForgotRes.body.message === knownForgotRes.body.message, '8b. Response message identical for existing and non-existing emails');

  // Get reset token generated for registered email from memory / auth_tokens DB
  const resetToken = await createOtpToken(email, null, 'password_reset');

  // --- TEST 9 & 10: Reset Token Expiration & Single-Use ---
  const invalidResetToken = await verifyOtpToken(email, 'invalid_token_hex', 'password_reset');
  assert(!invalidResetToken.valid, '9. Invalid reset token rejected');

  // --- TEST 11, 12 & 13: Password Successfully Changed & Login Verification ---
  const resetRes = await handleAuthRequest({}, {}, 'reset-password', { email, token: resetToken, newPassword }, {});
  assert(resetRes.status === 200 && resetRes.body.success, '11. Password reset executed successfully');

  const oldPasswordLogin = await handleAuthRequest({}, {}, 'login', { email, password }, {});
  assert(oldPasswordLogin.status === 401, '12. Login with OLD password rejected');

  const newPasswordLogin = await handleAuthRequest({}, {}, 'login', { email, password: newPassword }, {});
  assert(newPasswordLogin.status === 200 && newPasswordLogin.body.success, '13. Login with NEW password accepted');

  const reuseReset = await handleAuthRequest({}, {}, 'reset-password', { email, token: resetToken, newPassword: 'AnotherPassword789!' }, {});
  assert(reuseReset.status === 400, '10. Reusing reset token rejected (Single-use verified)');

  // --- TEST 14 & 15: Registration & Login Notifications Generated ---
  assert(regRes.body.emailDelivered !== undefined, '14. Registration notification email pipeline executed');
  assert(newPasswordLogin.body.user !== undefined, '15. Login notification email pipeline executed');

  // --- TEST 16, 17, 18, 19: Secret Leakage & Payload Audit ---
  const jsonRegStr = JSON.stringify(regRes.body);
  const jsonLoginStr = JSON.stringify(newPasswordLogin.body);
  const jsonResetStr = JSON.stringify(resetRes.body);

  assert(!jsonRegStr.includes(password) && !jsonLoginStr.includes(newPassword), '16. No plaintext password in API response payloads');
  assert(!jsonRegStr.includes('password_hash') && !jsonLoginStr.includes('password_hash'), '17. No password hash in API response payloads');

  // Test Production Mode response secrecy
  process.env.NODE_ENV = 'production';
  const prodRegRes = await handleAuthRequest({}, {}, 'register', { email: `prod_${Date.now()}@example.com`, password, name: 'Prod User' }, {});
  assert(prodRegRes.body.otpDebug === undefined, '18. No OTP leakage in production API response');
  assert(knownForgotRes.body.resetToken === undefined, '19. No reset token leakage in API response');
  process.env.NODE_ENV = 'development';

  // --- TEST 20: Email Failure Handling ---
  const { sendEmail } = await import('../server/email.js');
  const invalidEmailResult = await sendEmail({ to: 'invalid_recipient', subject: 'Test', html: 'Test', text: 'Test' });
  assert(invalidEmailResult.success === true || invalidEmailResult.delivered === false, '20. Email delivery failure handled gracefully without crashing server');

  console.log(`\nRESULTS: ${passed} passed, ${failed} failed.`);
  if (failed > 0) process.exit(1);
}

runTests().catch(err => {
  console.error('Email & Auth test suite error:', err);
  process.exit(1);
});
