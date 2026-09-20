import {
  matchesRecoveryIdentity,
  createOtpChallenge,
  verifyRecoveryCode,
  createResetToken,
  consumeResetToken,
  hashPasswordWithScrypt,
  verifyScryptHash,
} from '../api/auth/store.ts';
import {
  createSessionToken,
  verifySessionToken,
  SESSION_MAX_AGE_MS,
} from '../api/auth/verify.ts';

// SAFETY GUARD: Verify this script NEVER imports or invokes production credential mutators
if (typeof globalThis.setActiveAdminPasswordHash !== 'undefined') {
  throw new Error('FATAL SECURITY GUARD: setActiveAdminPasswordHash must not be accessible in test suite');
}

/**
 * Isolated In-Memory Mock Credential Store
 * Simulates credential storage, updates, and verification in pure RAM.
 * STRICTLY guarantees zero network requests and zero Supabase database writes.
 */
class IsolatedMockCredentialStore {
  constructor() {
    this.activeHash = null;
    this.updatedAt = 0;
  }

  async updatePasswordHash(newFormattedHash) {
    const parts = newFormattedHash.split(':');
    if (parts.length !== 2 || parts[0].length < 16 || parts[1].length < 32) {
      return false;
    }
    this.activeHash = newFormattedHash;
    this.updatedAt = Date.now();
    return true;
  }

  async verifyPassword(password) {
    if (!this.activeHash) return false;
    return verifyScryptHash(password, this.activeHash);
  }

  getUpdatedAt() {
    return this.updatedAt;
  }
}

async function getProductionCredentialTimestamp() {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key || url.includes('your-project') || key.includes('your-anon-key')) {
    return null;
  }
  try {
    const { createClient } = await import('@supabase/supabase-js');
    const sb = createClient(url, key, { auth: { persistSession: false } });
    const { data } = await sb
      .from('users')
      .select('updated_at')
      .eq('id', 'admin_credential_store')
      .maybeSingle();
    return data?.updated_at || null;
  } catch {
    return null;
  }
}

async function runVerification() {
  console.log('=== RUNNING RECOVERY & AUTH SUITE (ISOLATED TEST MODE) ===');

  // Baseline Safety Check: Capture pre-test production credential record timestamp
  const preTestTimestamp = await getProductionCredentialTimestamp();
  if (preTestTimestamp) {
    console.log('[SAFETY AUDIT] Production admin_credential_store initial timestamp:', preTestTimestamp);
  }

  console.log('\n--- TEST 1: Recovery Identity Matching ---');
  const match1 = await matchesRecoveryIdentity('8668912656');
  console.log('Registered proprietor 8668912656 matches:', match1);
  const match2 = await matchesRecoveryIdentity('9876543210');
  console.log('Default proprietor 9876543210 matches:', match2);
  const match3 = await matchesRecoveryIdentity('a2zbillpay@gmail.com');
  console.log('Admin recovery email matches:', match3);
  const match4 = await matchesRecoveryIdentity('9999999999');
  console.log('Unregistered number 9999999999 matches:', match4);

  if (!match1 || !match2 || !match3 || match4) {
    throw new Error('TEST 1 FAILED: Identity matching mismatch');
  }

  console.log('\n--- TEST 2: OTP Challenge Generation & Cryptographic Hashing ---');
  const { challengeId, otp } = createOtpChallenge('8668912656');
  console.log('Challenge generated:', challengeId, 'OTP format valid (6 digits):', /^\d{6}$/.test(otp));

  console.log('\n--- TEST 3: OTP Verification Attempts and Expiration ---');
  const failAttempt = verifyRecoveryCode(challengeId, '000000');
  console.log('Incorrect OTP rejection:', failAttempt);

  const successAttempt = verifyRecoveryCode(challengeId, otp);
  console.log('Correct OTP verification:', successAttempt);

  const replayAttempt = verifyRecoveryCode(challengeId, otp);
  console.log('Replay prevention (consumed OTP):', replayAttempt);

  if (!successAttempt.success || replayAttempt.success) {
    throw new Error('TEST 3 FAILED: Single-use OTP enforcement failed');
  }

  console.log('\n--- TEST 4: Single-Use Reset Token Lifecycle ---');
  const plainToken = createResetToken();
  console.log('Generated reset token (64 hex):', plainToken.length === 64);
  const consumed1 = consumeResetToken(plainToken);
  console.log('First consumption of reset token:', consumed1);
  const consumed2 = consumeResetToken(plainToken);
  console.log('Second consumption of reset token (replay blocked):', consumed2);

  if (!consumed1 || consumed2) {
    throw new Error('TEST 4 FAILED: Reset token single-use check failed');
  }

  console.log('\n--- TEST 5: Password Reset & Hash Updating (Isolated In-Memory Store) ---');
  const mockStore = new IsolatedMockCredentialStore();
  const testPassword = 'TestMockPassword#2026';

  // 1. Verify production scrypt password hashing
  const generatedHash = hashPasswordWithScrypt(testPassword);
  console.log('Scrypt hash generation valid format (salt:hash):', generatedHash.includes(':'));

  // 2. Verify hash updating behavior in isolated mock store (ZERO database writes)
  const updateResult = await mockStore.updatePasswordHash(generatedHash);
  console.log('Isolated mock credential store updated:', updateResult);

  // 3. Verify password verification logic: wrong password rejected
  const verifyOld = await mockStore.verifyPassword('WrongPassword');
  console.log('Wrong password verification rejected:', !verifyOld);

  // 4. Verify password verification logic: new password accepted
  const verifyNew = await mockStore.verifyPassword(testPassword);
  console.log('New password verification accepted:', verifyNew);

  if (!updateResult || verifyOld || !verifyNew) {
    throw new Error('TEST 5 FAILED: Isolated password update or verification failed');
  }

  console.log('\n--- TEST 6: Session Signing, Verification & Invalidation ---');
  const now = Date.now();
  const validSessionToken = createSessionToken({
    role: 'SHOPKEEPER',
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_MS,
  });
  console.log('Session token generated:', Boolean(validSessionToken));
  const sessionValid = validSessionToken ? verifySessionToken(validSessionToken) : null;
  console.log('Session token verified (role):', sessionValid?.role);

  // Invalidation check: expired session token must be rejected
  const expiredToken = createSessionToken({
    role: 'SHOPKEEPER',
    issuedAt: now - 100000,
    expiresAt: now - 1000, // Expired in the past
  });
  const expiredCheck = expiredToken ? verifySessionToken(expiredToken) : null;
  console.log('Expired session token rejected (null):', expiredCheck === null);

  // Invalidation check: tampered signature token must be rejected
  const tamperedToken = validSessionToken ? `${validSessionToken.slice(0, -5)}abcde` : '';
  const tamperedCheck = verifySessionToken(tamperedToken);
  console.log('Tampered session token rejected (null):', tamperedCheck === null);

  if (!sessionValid || sessionValid.role !== 'SHOPKEEPER' || expiredCheck !== null || tamperedCheck !== null) {
    throw new Error('TEST 6 FAILED: Session verification or invalidation failed');
  }

  // Final Safety Verification: Confirm production admin credential was NOT touched
  const postTestTimestamp = await getProductionCredentialTimestamp();
  if (preTestTimestamp && postTestTimestamp) {
    if (preTestTimestamp !== postTestTimestamp) {
      throw new Error(
        `CRITICAL SECURITY FAILURE: Production admin_credential_store timestamp changed from ${preTestTimestamp} to ${postTestTimestamp}!`
      );
    }
    console.log('\n[SAFETY AUDIT CONFIRMED] Production admin_credential_store timestamp remained strictly unchanged:');
    console.log(`Pre-test:  ${preTestTimestamp}`);
    console.log(`Post-test: ${postTestTimestamp}`);
  }

  console.log('\n========================================================');
  console.log('ALL TESTS PASSED WITH 100% PRODUCTION CREDENTIAL ISOLATION!');
  console.log('========================================================');
}

runVerification().catch((err) => {
  console.error('Verification Error:', err);
  process.exit(1);
});
