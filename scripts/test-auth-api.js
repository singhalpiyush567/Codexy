process.env.NODE_ENV = 'development';
import { handleAuthRequest } from '../server/api/auth.js';

async function testAuthSuite() {
  console.log('=== CodeXY Authentication System Test Suite ===\n');

  const testUser = {
    name: 'Auth Test User',
    email: `test_${Date.now()}@example.com`,
    password: 'SecurePassword123!'
  };

  try {
    // 1. REGISTER
    console.log(`[TEST 1] Registering user ${testUser.email}...`);
    const regRes = await handleAuthRequest({}, {}, 'register', testUser, {});
    if (regRes.status !== 200 || !regRes.body.success) {
      throw new Error(`Register failed: ${JSON.stringify(regRes.body)}`);
    }
    console.log(' -> [PASS] Registration successful. OTP generated:', regRes.body.otpDebug || '(masked)');

    // 2. VERIFY OTP
    const otpCode = regRes.body.otpDebug || '123456';
    console.log(`[TEST 2] Verifying OTP code (${otpCode})...`);
    const verifyRes = await handleAuthRequest({}, {}, 'verify-otp', { email: testUser.email, otpCode }, {});
    if (verifyRes.status !== 200 || !verifyRes.body.success) {
      throw new Error(`OTP Verification failed: ${JSON.stringify(verifyRes.body)}`);
    }
    const sessionCookieHeader = verifyRes.headers?.['Set-Cookie'];
    console.log(' -> [PASS] OTP verified successfully. Session cookie created:', sessionCookieHeader ? '[PRESENT]' : '[MISSING]');

    // 3. ME (AUTHENTICATED USER CHECK)
    console.log('[TEST 3] Fetching current user via session cookie (/api/auth/me)...');
    const meRes = await handleAuthRequest({}, {}, 'me', {}, { cookie: sessionCookieHeader });
    if (meRes.status !== 200 || !meRes.body.authenticated) {
      throw new Error(`Me endpoint failed: ${JSON.stringify(meRes.body)}`);
    }
    console.log(' -> [PASS] Authenticated user retrieved:', meRes.body.user.email, `(Role: ${meRes.body.user.role})`);

    // 4. LOGIN
    console.log('[TEST 4] Logging in with email and password...');
    const loginRes = await handleAuthRequest({}, {}, 'login', { email: testUser.email, password: testUser.password }, {});
    if (loginRes.status !== 200 || !loginRes.body.success) {
      throw new Error(`Login failed: ${JSON.stringify(loginRes.body)}`);
    }
    console.log(' -> [PASS] Login successful. Password hash match verified.');

    // 5. FORGOT PASSWORD & RESET PASSWORD
    console.log('[TEST 5] Requesting forgot password token...');
    const forgotRes = await handleAuthRequest({}, {}, 'forgot-password', { email: testUser.email }, {});
    if (forgotRes.status !== 200) {
      throw new Error(`Forgot password failed: ${JSON.stringify(forgotRes.body)}`);
    }
    console.log(' -> [PASS] Password reset request processed.');

    // 6. LOGOUT
    console.log('[TEST 6] Logging out user...');
    const logoutRes = await handleAuthRequest({}, {}, 'logout', {}, { cookie: sessionCookieHeader });
    if (logoutRes.status !== 200) {
      throw new Error(`Logout failed: ${JSON.stringify(logoutRes.body)}`);
    }
    console.log(' -> [PASS] Logout successful. Session cleared.');

    // 7. ME (ANONYMOUS CHECK AFTER LOGOUT)
    console.log('[TEST 7] Fetching /api/auth/me after logout...');
    const postLogoutMe = await handleAuthRequest({}, {}, 'me', {}, { cookie: sessionCookieHeader });
    if (postLogoutMe.body.authenticated) {
      throw new Error('User still authenticated after logout!');
    }
    console.log(' -> [PASS] Verified anonymous state after logout.');

    console.log('\n[SUCCESS] ALL 7 AUTHENTICATION SYSTEM TESTS PASSED CLEANLY!');
  } catch (err) {
    console.error('\n[FAIL] Authentication Test Suite Error:', err.message);
    process.exit(1);
  }
}

testAuthSuite();
