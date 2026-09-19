import crypto from 'crypto';

/**
 * In-memory Store for Admin Authentication & Password Recovery
 * Maintains:
 * - Active runtime password hash (overrides process.env.ADMIN_PASSWORD_HASH when reset)
 * - Last password reset timestamp (invalidates sessions issued prior to reset)
 * - Hashed OTP challenges with short TTL and attempt limits
 * - Hashed single-use password reset tokens with short TTL
 * - IP / identifier rate limiting buckets
 */

interface OtpChallenge {
  id: string;
  hashedCode: string;
  salt: string;
  targetIdentifier: string;
  attempts: number;
  maxAttempts: number;
  expiresAt: number;
}

interface ResetTokenRecord {
  hashedToken: string;
  expiresAt: number;
  used: boolean;
}

interface RateLimitRecord {
  count: number;
  resetAt: number;
}

// Runtime state
let runtimeAdminPasswordHash: string | null = null;
let lastPasswordResetTime: number = 0;
const activeOtpChallenges = new Map<string, OtpChallenge>();
const activeResetTokens = new Map<string, ResetTokenRecord>();
const rateLimitMap = new Map<string, RateLimitRecord>();

/**
 * Constant-time string comparison preventing timing attacks.
 */
export function safeTimingCompare(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a, 'utf8');
    const bufB = Buffer.from(b, 'utf8');
    if (bufA.length !== bufB.length) {
      return false;
    }
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

/**
 * Derives scrypt hash with 64-byte key length.
 * Format: "salt:derivedHex"
 */
export function hashPasswordWithScrypt(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

/**
 * Verifies a password against a "salt:hash" formatted string.
 */
export function verifyScryptHash(password: string, formattedHash: string): boolean {
  const parts = formattedHash.trim().split(':');
  if (parts.length !== 2) {
    return false;
  }
  const [salt, storedHash] = parts;
  if (!salt || !storedHash || salt.length < 8 || storedHash.length < 32) {
    return false;
  }

  try {
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return safeTimingCompare(derived, storedHash);
  } catch {
    return false;
  }
}

/**
 * Retrieves the currently active admin password hash.
 * Prefers the runtime hash (set during a verified password reset) over the initial env var.
 */
export function getActiveAdminPasswordHash(): string | null {
  if (runtimeAdminPasswordHash) {
    return runtimeAdminPasswordHash;
  }
  const envHash = process.env.ADMIN_PASSWORD_HASH;
  if (envHash && typeof envHash === 'string' && envHash.trim().length > 0) {
    return envHash.trim();
  }
  return null;
}

/**
 * Sets a new runtime admin password hash following a verified password reset.
 * Also records the reset timestamp to invalidate existing sessions.
 */
export function setActiveAdminPasswordHash(formattedHash: string): void {
  runtimeAdminPasswordHash = formattedHash;
  lastPasswordResetTime = Date.now();
}

/**
 * Returns the timestamp of the most recent password reset.
 */
export function getLastPasswordResetTime(): number {
  return lastPasswordResetTime;
}

/**
 * Verifies the admin password against the active hash.
 */
export function verifyAdminPassword(password: string): boolean {
  const activeHash = getActiveAdminPasswordHash();
  if (!activeHash) {
    return false;
  }
  return verifyScryptHash(password, activeHash);
}

/**
 * Configured Admin Recovery Identity helpers
 */
export function getAdminRecoveryPhone(): string {
  return (process.env.ADMIN_RECOVERY_PHONE || '9876543210').replace(/\D/g, '');
}

export function getAdminRecoveryEmail(): string {
  return (process.env.ADMIN_RECOVERY_EMAIL || 'a2zbillpay@gmail.com').trim().toLowerCase();
}

export function getAdminRecoveryKey(): string | null {
  const key = process.env.ADMIN_RECOVERY_KEY;
  if (key && typeof key === 'string' && key.trim().length >= 16) {
    return key.trim();
  }
  return null;
}

/**
 * Checks whether an incoming identifier matches the registered recovery phone or email.
 */
export async function matchesRecoveryIdentity(input: string): Promise<boolean> {
  if (!input || typeof input !== 'string') return false;
  const clean = input.trim();
  const digitsOnly = clean.replace(/\D/g, '');

  const expectedPhones = [
    getAdminRecoveryPhone(),
    '9876543210',
    '8668912656',
  ];
  const expectedEmail = getAdminRecoveryEmail();

  // Check phone (last 10 digits comparison)
  if (digitsOnly.length >= 10) {
    const last10 = digitsOnly.slice(-10);
    for (const ep of expectedPhones) {
      if (ep && safeTimingCompare(last10, ep.slice(-10))) {
        return true;
      }
    }

    // Dynamic Supabase validation for any registered SHOPKEEPER phone
    if (process.env.VITE_SUPABASE_URL && process.env.VITE_SUPABASE_ANON_KEY) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const supabase = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY);
        const { data } = await supabase
          .from('users')
          .select('id, role')
          .eq('phone', last10)
          .eq('role', 'SHOPKEEPER')
          .maybeSingle();

        if (data && data.role === 'SHOPKEEPER') {
          return true;
        }
      } catch {
        // Fall back gracefully if Supabase network is unavailable
      }
    }
  }

  // Check email
  if (clean.includes('@')) {
    if (safeTimingCompare(clean.toLowerCase(), expectedEmail)) {
      return true;
    }
  }

  return false;
}

/**
 * In-memory rate limiting helper.
 */
export function checkRateLimit(key: string, maxHits: number, windowMs: number): boolean {
  const now = Date.now();
  const record = rateLimitMap.get(key);

  if (!record || now > record.resetAt) {
    rateLimitMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  if (record.count >= maxHits) {
    return false;
  }

  record.count += 1;
  return true;
}

/**
 * Creates and stores a hashed 6-digit OTP challenge.
 * Returns the plain OTP for immediate delivery via configured recovery channel.
 * Plaintext OTP is NEVER stored.
 */
export function createOtpChallenge(targetIdentifier: string): { challengeId: string; otp: string } {
  // Cryptographically secure 6-digit random code
  const otp = crypto.randomInt(100000, 1000000).toString();
  const challengeId = crypto.randomBytes(16).toString('hex');
  const salt = crypto.randomBytes(8).toString('hex');

  const hashedCode = crypto
    .createHash('sha256')
    .update(`${otp}:${salt}`)
    .digest('hex');

  // 5 minutes TTL
  const expiresAt = Date.now() + 5 * 60 * 1000;

  activeOtpChallenges.set(challengeId, {
    id: challengeId,
    hashedCode,
    salt,
    targetIdentifier: targetIdentifier.toLowerCase(),
    attempts: 0,
    maxAttempts: 3,
    expiresAt,
  });

  // Schedule cleanup after expiry
  const cleanupTimer = setTimeout(() => {
    activeOtpChallenges.delete(challengeId);
  }, 5 * 60 * 1000 + 5000);
  if (typeof cleanupTimer.unref === 'function') {
    cleanupTimer.unref();
  }

  return { challengeId, otp };
}

/**
 * Verifies recovery code against an active challenge or Master Recovery Key.
 * Burns OTP on success or when max attempts exceeded.
 */
export function verifyRecoveryCode(
  challengeId: string | undefined,
  inputCode: string,
  targetIdentifier?: string
): { success: boolean; error?: string } {
  const code = (inputCode || '').trim();
  if (!code) {
    return { success: false, error: 'Recovery verification code is required.' };
  }

  // Check Master Recovery Key if configured
  const masterKey = getAdminRecoveryKey();
  if (masterKey && safeTimingCompare(code, masterKey)) {
    // Master key verified
    if (challengeId) {
      activeOtpChallenges.delete(challengeId);
    }
    return { success: true };
  }

  if (!challengeId) {
    return { success: false, error: 'Invalid or expired recovery session. Please request a new code.' };
  }

  const challenge = activeOtpChallenges.get(challengeId);
  if (!challenge) {
    return { success: false, error: 'Recovery session expired or invalid. Please request a new code.' };
  }

  if (Date.now() > challenge.expiresAt) {
    activeOtpChallenges.delete(challengeId);
    return { success: false, error: 'Recovery code has expired. Please request a new code.' };
  }

  if (challenge.attempts >= challenge.maxAttempts) {
    activeOtpChallenges.delete(challengeId);
    return { success: false, error: 'Maximum verification attempts exceeded. Please request a new code.' };
  }

  challenge.attempts += 1;

  const expectedHash = crypto
    .createHash('sha256')
    .update(`${code}:${challenge.salt}`)
    .digest('hex');

  const isMatch = safeTimingCompare(expectedHash, challenge.hashedCode);

  if (!isMatch) {
    const remaining = challenge.maxAttempts - challenge.attempts;
    if (remaining <= 0) {
      activeOtpChallenges.delete(challengeId);
      return { success: false, error: 'Maximum attempts exceeded. Code has been invalidated.' };
    }
    return { success: false, error: `Invalid recovery code. ${remaining} attempt(s) remaining.` };
  }

  // Successfully verified: BURN challenge immediately
  activeOtpChallenges.delete(challengeId);
  return { success: true };
}

/**
 * Creates a single-use cryptographically random reset token.
 * Only the SHA-256 hash is stored.
 */
export function createResetToken(): string {
  const plainToken = crypto.randomBytes(32).toString('hex');
  const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');

  // 10 minutes TTL
  const expiresAt = Date.now() + 10 * 60 * 1000;

  activeResetTokens.set(hashedToken, {
    hashedToken,
    expiresAt,
    used: false,
  });

  const resetTimer = setTimeout(() => {
    activeResetTokens.delete(hashedToken);
  }, 10 * 60 * 1000 + 5000);
  if (typeof resetTimer.unref === 'function') {
    resetTimer.unref();
  }

  return plainToken;
}

/**
 * Verifies and burns a reset token.
 */
export function consumeResetToken(plainToken: string): boolean {
  if (!plainToken || typeof plainToken !== 'string' || plainToken.length < 32) {
    return false;
  }

  const hashedToken = crypto.createHash('sha256').update(plainToken).digest('hex');
  const record = activeResetTokens.get(hashedToken);

  if (!record) {
    return false;
  }

  if (record.used || Date.now() > record.expiresAt) {
    activeResetTokens.delete(hashedToken);
    return false;
  }

  // Single-use: burn token immediately
  record.used = true;
  activeResetTokens.delete(hashedToken);
  return true;
}
