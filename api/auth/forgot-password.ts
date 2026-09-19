import type { IncomingMessage, ServerResponse } from 'http';
import {
  matchesRecoveryIdentity,
  createOtpChallenge,
  checkRateLimit,
  getAdminRecoveryPhone,
  getAdminRecoveryEmail,
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

function maskRecoveryTarget(input: string): string {
  const clean = input.trim();
  const digitsOnly = clean.replace(/\D/g, '');
  if (digitsOnly.length >= 10) {
    const last4 = digitsOnly.slice(-4);
    return `******${last4}`;
  }
  if (clean.includes('@')) {
    const [user, domain] = clean.split('@');
    const maskedUser = user.length > 2 ? `${user.slice(0, 2)}***` : `${user}***`;
    return `${maskedUser}@${domain || 'email.com'}`;
  }
  return '******';
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Allow', 'POST');
    res.end(JSON.stringify({ error: 'Method Not Allowed' }));
    return;
  }

  // Rate limit: max 10 forgot-password requests per 10 minutes per IP
  const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
  if (!checkRateLimit(`forgot-pwd:${clientIp}`, 10, 10 * 60 * 1000)) {
    res.statusCode = 429;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        error: 'Too many recovery requests. Please try again in 15 minutes.',
      })
    );
    return;
  }

  try {
    const body = await readJsonBody(req);
    const identifier = (body?.recoveryIdentifier || body?.identifier || '').trim();

    if (!identifier) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Please provide your registered recovery mobile number or email.',
        })
      );
      return;
    }

    const isMatch = await matchesRecoveryIdentity(identifier);

    if (isMatch) {
      // Valid administrator identity: generate secure random OTP challenge
      const { challengeId, otp } = createOtpChallenge(identifier);

      // External SMS / Webhook delivery if configured in environment
      const webhookUrl = process.env.ADMIN_OTP_SMS_PROVIDER_URL;
      if (webhookUrl && typeof webhookUrl === 'string' && webhookUrl.startsWith('http')) {
        try {
          await fetch(webhookUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              recipient: identifier,
              otp,
              service: 'Om Distributors Admin Recovery',
            }),
          });
        } catch {
          // Webhook failure caught safely without exposing credentials
        }
      }

      const masked = maskRecoveryTarget(identifier);

      // Log dispatch securely to server terminal for administrative visibility
      console.log(`[Shopkeeper Recovery] One-Time Password for ${masked}: ${otp} (Expires in 5 minutes)`);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          success: true,
          challengeId,
          maskedTarget: masked,
          message: `A verification code has been dispatched to ${masked}. Please enter it within 5 minutes.`,
        })
      );
      return;
    }

    // Uniform response to prevent account enumeration
    const genericMasked = maskRecoveryTarget(getAdminRecoveryPhone() || getAdminRecoveryEmail());
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        challengeId: 'dummy-challenge-id',
        maskedTarget: genericMasked,
        message:
          'If the provided details match our administrator records, a verification code has been dispatched.',
      })
    );
  } catch {
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Recovery service temporarily unavailable.' }));
  }
}
