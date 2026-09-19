import type { IncomingMessage, ServerResponse } from 'http';
import {
  consumeResetToken,
  hashPasswordWithScrypt,
  setActiveAdminPasswordHash,
} from './store.ts';
import { clearAdminSessionCookie } from './verify.ts';

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

  try {
    const body = await readJsonBody(req);
    const resetToken = body?.resetToken;
    const newPassword = body?.newPassword;
    const confirmPassword = body?.confirmPassword;

    if (!resetToken || typeof resetToken !== 'string') {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Reset token is required. Please restart recovery.',
        })
      );
      return;
    }

    if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 8) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Password must be at least 8 characters long.',
        })
      );
      return;
    }

    if (newPassword !== confirmPassword) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'New password and confirmation do not match.',
        })
      );
      return;
    }

    // Verify and consume single-use reset token
    const tokenValid = consumeResetToken(resetToken);
    if (!tokenValid) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Invalid or expired password reset token. Please restart password recovery.',
        })
      );
      return;
    }

    // Hash new password using scrypt (salt:derivedHex)
    const formattedHash = hashPasswordWithScrypt(newPassword);

    // Save active runtime admin password hash and update lastPasswordResetTime
    setActiveAdminPasswordHash(formattedHash);

    // Invalidate existing sessions: clear session cookie on response
    clearAdminSessionCookie(res);

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        message: 'Password reset successful. Please log in with your new password.',
      })
    );
  } catch {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Failed to reset password. Please try again.' }));
  }
}
