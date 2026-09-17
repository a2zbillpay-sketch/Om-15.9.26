import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import {
  setAdminSessionCookie,
  SESSION_MAX_AGE_MS,
  AdminSession,
  getSessionSecret,
} from './verify.ts';

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      // 32 KB payload limit for auth endpoint
      if (body.length > 32 * 1024) {
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

/**
 * Constant-time string comparison preventing timing attacks.
 */
function safeTimingCompare(a: string, b: string): boolean {
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
 * Verifies admin password strictly against ADMIN_PASSWORD_HASH.
 * Supported format:
 *   salt:scryptHex   (Node.js native scryptSync with 64-byte key length)
 *
 * FAILS CLOSED:
 * - Does NOT support plaintext passwords.
 * - Does NOT support hardcoded fallback passwords (e.g. admin123).
 * - If ADMIN_PASSWORD_HASH is missing or malformed, authentication fails safely.
 */
function verifyAdminPasswordHash(password: string): boolean {
  const envHash = process.env.ADMIN_PASSWORD_HASH;

  if (!envHash || typeof envHash !== 'string') {
    return false;
  }

  const parts = envHash.trim().split(':');
  if (parts.length !== 2) {
    return false;
  }

  const [salt, storedHash] = parts;
  if (!salt || !storedHash || salt.length < 8 || storedHash.length < 32) {
    return false;
  }

  try {
    // 64-byte scrypt key derivation
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return safeTimingCompare(derived, storedHash);
  } catch {
    return false;
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Allow', 'POST');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  // Ensure server session signing secret is configured
  if (!getSessionSecret()) {
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Authentication service unavailable' }));
    return;
  }

  try {
    const body = await readJsonBody(req);
    const password = body?.password;

    if (!password || typeof password !== 'string' || !password.trim()) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid credentials' }));
      return;
    }

    const isValid = verifyAdminPasswordHash(password);

    if (!isValid) {
      res.statusCode = 401;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Invalid credentials' }));
      return;
    }

    const now = Date.now();
    const session: AdminSession = {
      role: 'SHOPKEEPER',
      issuedAt: now,
      expiresAt: now + SESSION_MAX_AGE_MS,
    };

    const cookieSet = setAdminSessionCookie(res, session);
    if (!cookieSet) {
      res.statusCode = 503;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Failed to issue session' }));
      return;
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        authenticated: true,
        role: 'SHOPKEEPER',
      })
    );
  } catch {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Authentication failed' }));
  }
}
