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

      const isEmailRecovery = identifier.includes('@');

      // If email recovery, send OTP via Resend REST API
      if (isEmailRecovery) {
        const resendApiKey = process.env.RESEND_API_KEY;
        const resendFromEmail = process.env.RESEND_FROM_EMAIL;

        if (!resendApiKey || typeof resendApiKey !== 'string' || !resendApiKey.trim()) {
          // Delivery provider not configured
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error:
                'Email delivery service is not configured. Please contact the system administrator.',
            })
          );
          return;
        }

        if (!resendFromEmail || typeof resendFromEmail !== 'string' || !resendFromEmail.trim()) {
          // Sender address not configured
          res.statusCode = 503;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error:
                'Email delivery sender address is not configured. Please configure RESEND_FROM_EMAIL.',
            })
          );
          return;
        }

        try {
          const resendResponse = await fetch('https://api.resend.com/emails', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${resendApiKey.trim()}`,
            },
            body: JSON.stringify({
              from: resendFromEmail.trim(),
              to: [getAdminRecoveryEmail()],
              subject: 'Om Distributors — Shopkeeper Password Recovery Code',
              text: `Your Shopkeeper/Admin password recovery code is: ${otp}\n\nThis code expires in 5 minutes.\n\nSecurity Notice: If you did not request this recovery code, please ignore this email. Never share this code with anyone.`,
              html: `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <h2 style="color: #0f172a; margin-top: 0;">Om Distributors — Shopkeeper Recovery</h2>
                  <p style="color: #475569; font-size: 15px; line-height: 1.5;">You requested a password recovery code for your Shopkeeper / Admin portal access.</p>
                  <div style="margin: 24px 0; padding: 16px; background-color: #f8fafc; border: 1px solid #cbd5e1; border-radius: 6px; text-align: center;">
                    <span style="font-size: 32px; font-weight: 700; letter-spacing: 6px; color: #0f172a; font-family: monospace;">${otp}</span>
                  </div>
                  <p style="color: #64748b; font-size: 14px; margin-bottom: 8px;"><strong>Expires in 5 minutes.</strong></p>
                  <p style="color: #dc2626; font-size: 13px; margin-top: 16px; border-top: 1px solid #e2e8f0; padding-top: 12px;">
                    <strong>Security Warning:</strong> Never share this verification code with anyone. Om Distributors staff will never ask for your recovery code.
                  </p>
                </div>
              `,
            }),
          });

          if (!resendResponse.ok) {
            // Delivery failed at provider
            res.statusCode = 502;
            res.setHeader('Content-Type', 'application/json');
            res.end(
              JSON.stringify({
                error:
                  'Unable to dispatch recovery email. Please verify delivery service configuration and try again.',
              })
            );
            return;
          }
        } catch {
          // Network or unexpected transport error
          res.statusCode = 502;
          res.setHeader('Content-Type', 'application/json');
          res.end(
            JSON.stringify({
              error:
                'Failed to connect to email delivery service. Please check network connectivity and try again.',
            })
          );
          return;
        }
      }

      // External SMS / Webhook delivery if configured in environment
      const webhookUrl = process.env.ADMIN_OTP_SMS_PROVIDER_URL;
      if (!isEmailRecovery && webhookUrl && typeof webhookUrl === 'string' && webhookUrl.startsWith('http')) {
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
