import type { IncomingMessage, ServerResponse } from 'http';
import {
  setAdminSessionCookie,
  SESSION_MAX_AGE_MS,
  AdminSession,
  getSessionSecret,
} from './verify.ts';
import {
  verifyAdminPassword,
  checkRateLimit,
} from './store.ts';

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

  // Client IP rate limiting: max 5 login attempts per 10 minutes per IP
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(`login:${clientIp}`, 5, 10 * 60 * 1000)) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Too many failed login attempts. Please try again in 10 minutes.' }));
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

    const isValid = await verifyAdminPassword(password);

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
