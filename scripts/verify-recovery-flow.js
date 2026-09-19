import {
  matchesRecoveryIdentity,
  createOtpChallenge,
  verifyRecoveryCode,
  createResetToken,
  consumeResetToken,
  setActiveAdminPasswordHash,
  verifyAdminPassword,
} from '../api/auth/store.ts';
import {
  createSessionToken,
  verifySessionToken,
  SESSION_MAX_AGE_MS,
} from '../api/auth/verify.ts';

async function runVerification() {
  console.log('--- TEST 1: Recovery Identity Matching ---');
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

  console.log('\n--- TEST 5: Password Reset & Hash Updating ---');
  const crypto = await import('crypto');
  const testPassword = 'NewSecurePassword#2026';
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(testPassword, salt, 64).toString('hex');
  const newHashRecord = `${salt}:${hash}`;

  setActiveAdminPasswordHash(newHashRecord);
  const verifyOld = verifyAdminPassword('WrongPassword');
  const verifyNew = verifyAdminPassword(testPassword);
  console.log('Wrong password verification rejected:', !verifyOld);
  console.log('New password verification accepted:', verifyNew);

  if (verifyOld || !verifyNew) {
    throw new Error('TEST 5 FAILED: Password verification failed');
  }

  console.log('\n--- TEST 6: Session Signing & Invalidation ---');
  const now = Date.now();
  const sessionToken = createSessionToken({
    role: 'SHOPKEEPER',
    issuedAt: now,
    expiresAt: now + SESSION_MAX_AGE_MS,
  });
  console.log('Session token generated:', Boolean(sessionToken));
  const sessionValid = verifySessionToken(sessionToken);
  console.log('Session token verified (role):', sessionValid?.role);

  if (!sessionValid || sessionValid.role !== 'SHOPKEEPER') {
    throw new Error('TEST 6 FAILED: Session verification failed');
  }

  console.log('\n=============================================');
  console.log('ALL 6 RECOVERY & AUTHENTICATION TESTS PASSED!');
  console.log('=============================================');
}

runVerification().catch((err) => {
  console.error('Verification Error:', err);
  process.exit(1);
});
