import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { getLastPasswordResetTime } from './store.ts';

export interface AdminSession {
  role: 'SHOPKEEPER';
  issuedAt: number;
  expiresAt: number;
}

export const SESSION_COOKIE_NAME = 'om_admin_session';
export const SESSION_MAX_AGE_MS = 1000 * 60 * 60 * 8; // 8 hours

/**
 * Retrieves the server-only secret for HMAC session signing.
 * Requires persistent ADMIN_SESSION_SECRET (min 32 chars).
 * Fails safely and does NOT fall back to an ephemeral random secret.
 */
export function getSessionSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (secret && typeof secret === 'string' && secret.trim().length >= 32) {
    return secret.trim();
  }
  console.error(
    '[Auth Config Error] ADMIN_SESSION_SECRET environment variable is missing or shorter than 32 characters. Shopkeeper session signing is disabled.'
  );
  return null;
}

/**
 * Robust, crash-safe cookie parsing for incoming HTTP requests.
 * Handles escaped characters, malformed keys/values, and unexpected input safely.
 */
export function parseCookies(req: IncomingMessage): Record<string, string> {
  const list: Record<string, string> = {};
  const cookieHeader = req.headers.cookie;

  if (!cookieHeader || typeof cookieHeader !== 'string') {
    return list;
  }

  const pairs = cookieHeader.split(';');
  for (let i = 0; i < pairs.length; i++) {
    const pair = pairs[i];
    const idx = pair.indexOf('=');
    if (idx < 0) continue;

    const key = pair.slice(0, idx).trim();
    if (!key) continue;

    let val = pair.slice(idx + 1).trim();
    if (val.startsWith('"') && val.endsWith('"') && val.length > 1) {
      val = val.slice(1, -1);
    }

    try {
      list[key] = decodeURIComponent(val);
    } catch {
      list[key] = val;
    }
  }

  return list;
}

/**
 * Creates a cryptographically signed HMAC-SHA256 session token.
 * Returns null if the required server session secret is not configured.
 */
export function createSessionToken(payload: AdminSession): string | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  try {
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64url');
    return `${encodedPayload}.${signature}`;
  } catch {
    return null;
  }
}

/**
 * Cryptographically verifies a signed HMAC-SHA256 session token.
 * Validates payload structure, timing-safe signature comparison, expiration, and role.
 */
export function verifySessionToken(token: string): AdminSession | null {
  const secret = getSessionSecret();
  if (!secret) return null;

  try {
    if (!token || typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const [encodedPayload, signature] = parts;
    if (!encodedPayload || !signature) return null;

    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(encodedPayload)
      .digest('base64url');

    const sigBuffer = Buffer.from(signature, 'utf8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf8');

    if (sigBuffer.length !== expectedBuffer.length) {
      return null;
    }

    // Timing-safe constant-time comparison
    if (!crypto.timingSafeEqual(sigBuffer, expectedBuffer)) {
      return null;
    }

    const payloadJson = Buffer.from(encodedPayload, 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson);

    if (!payload || typeof payload !== 'object') {
      return null;
    }

    if (typeof payload.expiresAt !== 'number' || Date.now() > payload.expiresAt) {
      return null;
    }

    // Invalidate sessions issued before the most recent password reset
    const resetTime = getLastPasswordResetTime();
    if (resetTime > 0 && (typeof payload.issuedAt !== 'number' || payload.issuedAt < resetTime)) {
      return null;
    }

    if (payload.role !== 'SHOPKEEPER') {
      return null;
    }

    return payload as AdminSession;
  } catch {
    return null;
  }
}

/**
 * Reads and verifies the Admin session strictly from the HttpOnly request cookie.
 * NEVER trusts client-submitted request bodies, URL query params, or custom headers.
 */
export function verifyAdminSession(req: IncomingMessage): AdminSession | null {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE_NAME];
  if (!token) return null;

  return verifySessionToken(token);
}

/**
 * Sets the secure HttpOnly cookie on the ServerResponse.
 * Uses SameSite=None; Secure for cross-site iframe operation in AI Studio preview.
 */
export function setAdminSessionCookie(res: ServerResponse, session: AdminSession): boolean {
  const token = createSessionToken(session);
  if (!token) return false;

  const maxAgeSeconds = Math.floor(SESSION_MAX_AGE_MS / 1000);
  const cookieStr = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=${maxAgeSeconds}`;
  res.setHeader('Set-Cookie', cookieStr);
  return true;
}

/**
 * Clears the secure session cookie on logout.
 */
export function clearAdminSessionCookie(res: ServerResponse): void {
  const cookieStr = `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; SameSite=None; Secure; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`;
  res.setHeader('Set-Cookie', cookieStr);
}
