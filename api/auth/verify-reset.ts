import type { IncomingMessage, ServerResponse } from 'http';
import {
  verifyRecoveryCode,
  createResetToken,
  checkRateLimit,
} from './store.ts';

function readJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
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

  // Rate limiting verification attempts per IP
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(`verify-reset:${clientIp}`, 10, 10 * 60 * 1000)) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Too many verification attempts. Please try again later.',
      })
    );
    return;
  }

  try {
    const body = await readJsonBody(req);
    const challengeId = body?.challengeId;
    const recoveryCode = (body?.recoveryCode || body?.code || '').trim();

    if (!recoveryCode) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Verification code or recovery key is required.' }));
      return;
    }

    const result = verifyRecoveryCode(challengeId, recoveryCode.trim());

    if (!result.success) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: result.error || 'Verification failed.' }));
      return;
    }

    // Verification succeeded: Issue single-use reset token
    const resetToken = createResetToken();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        resetToken,
        message: 'Recovery verified successfully. You may now set a new password.',
      })
    );
  } catch {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Verification service error.' }));
  }
}
