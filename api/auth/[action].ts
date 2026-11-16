import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  setAdminSessionCookie,
  clearAdminSessionCookie,
  verifyAdminSession,
  SESSION_MAX_AGE_MS,
  AdminSession,
  getSessionSecret,
  setCustomerSessionCookie,
  clearCustomerSessionCookie,
  verifyCustomerSession,
  CUSTOMER_SESSION_MAX_AGE_MS,
  CustomerSession,
} from './_verify.js';
import {
  verifyAdminPassword,
  checkRateLimit,
  matchesRecoveryIdentity,
  createOtpChallenge,
  verifyRecoveryCode,
  createResetToken,
  consumeResetToken,
  hashPasswordWithScrypt,
  setActiveAdminPasswordHash,
  getAdminRecoveryPhone,
  getAdminRecoveryEmail,
} from './_store.js';

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

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end(JSON.stringify(data));
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

function getAction(req: IncomingMessage): string {
  const queryAction = (req as any).query?.action;
  if (queryAction && typeof queryAction === 'string') {
    return queryAction.toLowerCase().trim();
  }
  try {
    const rawUrl = req.url || '';
    const parsed = new URL(rawUrl, `http://${req.headers.host || 'localhost'}`);
    const segments = parsed.pathname.split('/').filter(Boolean);
    const authIdx = segments.indexOf('auth');
    if (authIdx !== -1 && segments[authIdx + 1]) {
      return segments[authIdx + 1].toLowerCase().trim();
    }
    if (segments.length > 0) {
      return segments[segments.length - 1].toLowerCase().trim();
    }
  } catch {}
  return '';
}

function getServerSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (url && key && url !== 'https://your-project.supabase.co' && key !== 'your-service-role-key') {
    try {
      return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    } catch {
      return null;
    }
  }
  return null;
}

export const DUPLICATE_CUSTOMER_MESSAGE =
  '🙏 हा मोबाईल नंबर आधीपासून नोंदणीकृत आहे. आपण विद्यमान ग्राहक आहात. कृपया आपल्या जुन्या Customer Account मधून Login करा.';

export function normalizeIndianMobile(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  let digits = String(raw).replace(/\D/g, '');
  if (digits.length === 14 && digits.startsWith('0091')) {
    digits = digits.slice(4);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return digits.length === 10 ? digits : '';
}

export function getIndianMobileVariants(cleanPhone10: string): string[] {
  if (!cleanPhone10 || cleanPhone10.length !== 10) return [];
  return Array.from(
    new Set([
      cleanPhone10,
      `+91${cleanPhone10}`,
      `+91 ${cleanPhone10}`,
      `91${cleanPhone10}`,
      `0${cleanPhone10}`,
      `0091${cleanPhone10}`,
    ])
  );
}

// Per-mobile in-process queue to prevent simultaneous duplicate registration races
const phoneRegistrationQueues = new Map<string, Promise<any>>();

async function withPhoneRegistrationLock<T>(cleanPhone: string, task: () => Promise<T>): Promise<T> {
  const previous = phoneRegistrationQueues.get(cleanPhone) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => {}).then(() => current);
  phoneRegistrationQueues.set(cleanPhone, chained);

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (phoneRegistrationQueues.get(cleanPhone) === chained) {
      phoneRegistrationQueues.delete(cleanPhone);
    }
  }
}

function isUniqueViolationError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '').trim();
  const msg = String(err.message || '').toLowerCase();
  return code === '23505' || msg.includes('duplicate key') || msg.includes('unique constraint');
}

export interface CustomerLoginProcessResult {
  statusCode: number;
  payload: any;
  sessionToSet?: CustomerSession;
}

export async function processCustomerLoginRequest(
  supabase: SupabaseClient | null,
  body: any
): Promise<CustomerLoginProcessResult> {
  const cleanPhone = normalizeIndianMobile(body?.phone);
  if (cleanPhone.length !== 10) {
    return {
      statusCode: 400,
      payload: { error: 'Valid 10-digit mobile number is required.' },
    };
  }

  const requestedName = typeof body?.name === 'string' ? body.name.trim() : '';
  const isNewRegistration =
    body?.isNewRegistration === true ||
    String(body?.mode || '').toUpperCase() === 'NEW' ||
    body?.isExisting === false;
  const isExistingRequested =
    !isNewRegistration &&
    (body?.isExisting === true || String(body?.mode || '').toUpperCase() === 'EXISTING');

  if (isNewRegistration && !requestedName) {
    return {
      statusCode: 400,
      payload: { error: 'Full name is required for new customer registration.' },
    };
  }

  const execute = async (): Promise<CustomerLoginProcessResult> => {
    let resolvedUser: any = null;
    let customerId = `user-${cleanPhone}`;

    if (supabase) {
      const phoneVariants = getIndianMobileVariants(cleanPhone);
      const { data: userRows, error: userErr } = await supabase
        .from('users')
        .select('*')
        .in('phone', phoneVariants)
        .eq('role', 'CUSTOMER')
        .order('created_at', { ascending: true })
        .limit(1);

      if (userErr) {
        return {
          statusCode: 500,
          payload: { error: userErr.message || 'Database lookup failed.' },
        };
      }

      if (userRows && userRows.length > 0) {
        if (isNewRegistration) {
          return {
            statusCode: 409,
            payload: {
              authenticated: false,
              code: 'DUPLICATE_CUSTOMER',
              redirectToLogin: true,
              phone: cleanPhone,
              error: DUPLICATE_CUSTOMER_MESSAGE,
            },
          };
        }

        resolvedUser = userRows[0];
        if (resolvedUser.status && String(resolvedUser.status).toUpperCase() !== 'ACTIVE') {
          return {
            statusCode: 403,
            payload: {
              error: `Customer account is ${String(resolvedUser.status).toLowerCase()}${
                resolvedUser.inactive_reason ? `: ${resolvedUser.inactive_reason}` : '.'
              }`,
            },
          };
        }
        customerId = String(resolvedUser.id);
      } else {
        if (isExistingRequested) {
          return {
            statusCode: 404,
            payload: {
              error: `No registered customer profile found for +91 ${cleanPhone}. Please switch to New Customer to register.`,
            },
          };
        }

        const newCustomerId = crypto.randomUUID();
        const nowIso = new Date().toISOString();
        const primaryPayload = {
          id: newCustomerId,
          full_name: requestedName,
          phone: cleanPhone,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          created_at: nowIso,
          updated_at: nowIso,
        };

        let insertedUser: any = null;
        let insertErr: any = null;

        const primaryRes = await supabase
          .from('users')
          .insert(primaryPayload)
          .select()
          .single();
        insertedUser = primaryRes.data;
        insertErr = primaryRes.error;

        if (
          insertErr &&
          !isUniqueViolationError(insertErr) &&
          (insertErr.code === 'PGRST204' ||
            insertErr.code === '42703' ||
            /full_name|status/i.test(String(insertErr.message || '')))
        ) {
          const legacyRes = await supabase
            .from('users')
            .insert({
              id: newCustomerId,
              phone: cleanPhone,
              name: requestedName,
              role: 'CUSTOMER',
              updated_at: nowIso,
            })
            .select()
            .single();
          insertedUser = legacyRes.data;
          insertErr = legacyRes.error;
        }

        if (insertErr) {
          const { data: retryRows } = await supabase
            .from('users')
            .select('*')
            .in('phone', phoneVariants)
            .eq('role', 'CUSTOMER')
            .order('created_at', { ascending: true })
            .limit(1);

          if (retryRows && retryRows.length > 0) {
            if (isNewRegistration) {
              return {
                statusCode: 409,
                payload: {
                  authenticated: false,
                  code: 'DUPLICATE_CUSTOMER',
                  redirectToLogin: true,
                  phone: cleanPhone,
                  error: DUPLICATE_CUSTOMER_MESSAGE,
                },
              };
            }

            resolvedUser = retryRows[0];
            if (resolvedUser.status && String(resolvedUser.status).toUpperCase() !== 'ACTIVE') {
              return {
                statusCode: 403,
                payload: {
                  error: `Customer account is ${String(resolvedUser.status).toLowerCase()}${
                    resolvedUser.inactive_reason ? `: ${resolvedUser.inactive_reason}` : '.'
                  }`,
                },
              };
            }
            customerId = String(resolvedUser.id);
          } else if (isUniqueViolationError(insertErr)) {
            return {
              statusCode: 409,
              payload: {
                authenticated: false,
                code: 'DUPLICATE_CUSTOMER',
                redirectToLogin: true,
                phone: cleanPhone,
                error: DUPLICATE_CUSTOMER_MESSAGE,
              },
            };
          } else {
            return {
              statusCode: 500,
              payload: { error: insertErr.message || 'Failed to initialize customer record.' },
            };
          }
        } else if (insertedUser) {
          resolvedUser = insertedUser;
          customerId = String(insertedUser.id);
        }
      }
    } else if (typeof body?.customerId === 'string' && body.customerId.trim()) {
      customerId = body.customerId.trim();
    }

    const now = Date.now();
    const session: CustomerSession = {
      role: 'CUSTOMER',
      customerId,
      phone: cleanPhone,
      issuedAt: now,
      expiresAt: now + CUSTOMER_SESSION_MAX_AGE_MS,
    };

    return {
      statusCode: 200,
      sessionToSet: session,
      payload: {
        authenticated: true,
        role: 'CUSTOMER',
        customerId,
        phone: cleanPhone,
        user: resolvedUser
          ? {
              id: resolvedUser.id,
              name: resolvedUser.full_name ?? resolvedUser.name ?? '',
              phone: resolvedUser.phone,
              role: resolvedUser.role || 'CUSTOMER',
              status: resolvedUser.status || 'ACTIVE',
              walletBalance: Number(resolvedUser.wallet_balance || 0),
              outstandingBalance: Number(resolvedUser.outstanding_balance || 0),
              codOrderCount: Number(resolvedUser.cod_order_count || 0),
              createdAt: resolvedUser.updated_at || resolvedUser.created_at || new Date().toISOString(),
              isDatabaseVerified: true,
            }
          : null,
      },
    };
  };

  if (isNewRegistration) {
    return withPhoneRegistrationLock(cleanPhone, execute);
  }
  return execute();
}

/**
 * Consolidated Auth Endpoint: Combines login, logout, me, forgot-password,
 * verify-reset, and reset-password into a single handler to respect Vercel's
 * 12 Serverless Function limit.
 */
export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const action = getAction(req);
  const method = req.method?.toUpperCase();

  // 1. ME / SESSION CHECK (GET)
  if (action === 'me') {
    if (method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
    const session = verifyAdminSession(req);
    if (session && session.role === 'SHOPKEEPER') {
      return sendJson(res, 200, { authenticated: true, role: 'SHOPKEEPER' });
    }
    return sendJson(res, 200, { authenticated: false });
  }

  // 1b. CUSTOMER SESSION CHECK (GET)
  if (action === 'customer-me') {
    if (method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
    const customerSession = verifyCustomerSession(req);
    if (customerSession && customerSession.role === 'CUSTOMER') {
      return sendJson(res, 200, {
        authenticated: true,
        role: 'CUSTOMER',
        customerId: customerSession.customerId,
        phone: customerSession.phone,
      });
    }
    return sendJson(res, 200, { authenticated: false });
  }

  // 2. LOGOUT (POST)
  if (action === 'logout') {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
    clearAdminSessionCookie(res);
    return sendJson(res, 200, { success: true });
  }

  // 2b. CUSTOMER LOGOUT (POST)
  if (action === 'customer-logout') {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }
    clearCustomerSessionCookie(res);
    return sendJson(res, 200, { success: true });
  }

  // 2c. CUSTOMER LOGIN (POST) - issues signed HttpOnly om_customer_session cookie
  if (action === 'customer-login') {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    try {
      const body = await readJsonBody(req);
      const supabase = getServerSupabaseClient();
      const result = await processCustomerLoginRequest(supabase, body);

      if (result.sessionToSet) {
        const cookieSet = setCustomerSessionCookie(res, result.sessionToSet);
        if (!cookieSet) {
          return sendJson(res, 503, {
            error: 'Server authentication configuration error: CUSTOMER_SESSION_SECRET / ADMIN_SESSION_SECRET is not configured.',
          });
        }
      }

      return sendJson(res, result.statusCode, result.payload);
    } catch {
      return sendJson(res, 500, { error: 'Customer authentication failed' });
    }
  }

  // 3. LOGIN (POST)
  if (action === 'login') {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    if (!getSessionSecret()) {
      return sendJson(res, 503, {
        error: 'Server authentication configuration error: ADMIN_SESSION_SECRET is not configured on the server.',
      });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`login:${clientIp}`, 5, 10 * 60 * 1000)) {
      return sendJson(res, 429, { error: 'Too many failed login attempts. Please try again in 10 minutes.' });
    }

    try {
      const body = await readJsonBody(req);
      const password = body?.password;

      /* ===== TEMPORARY DEV ADMIN LOGIN BYPASS ===== */
      const isDevEnvironment = process.env.NODE_ENV !== 'production';
      const isDevBypass =
        isDevEnvironment &&
        (body?.bypassDev === true ||
          !password ||
          (typeof password === 'string' && !password.trim()) ||
          password === 'dev');
      /* ===== END TEMPORARY DEV ADMIN LOGIN BYPASS ===== */

      let isValid = false;
      if (isDevBypass) {
        isValid = true;
      } else {
        if (!password || typeof password !== 'string' || !password.trim()) {
          return sendJson(res, 400, { error: 'Invalid credentials' });
        }
        isValid = await verifyAdminPassword(password);
      }

      if (!isValid) {
        return sendJson(res, 401, { error: 'Invalid credentials' });
      }

      const now = Date.now();
      const session: AdminSession = {
        role: 'SHOPKEEPER',
        issuedAt: now,
        expiresAt: now + SESSION_MAX_AGE_MS,
      };

      const cookieSet = setAdminSessionCookie(res, session);
      if (!cookieSet) {
        return sendJson(res, 503, { error: 'Failed to issue session' });
      }

      return sendJson(res, 200, { authenticated: true, role: 'SHOPKEEPER' });
    } catch {
      return sendJson(res, 500, { error: 'Authentication failed' });
    }
  }

  // 4. FORGOT-PASSWORD (POST)
  if (action === 'forgot-password') {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`forgot-pwd:${clientIp}`, 10, 10 * 60 * 1000)) {
      return sendJson(res, 429, { error: 'Too many recovery requests. Please try again in 15 minutes.' });
    }

    try {
      const body = await readJsonBody(req);
      const identifier = (body?.recoveryIdentifier || body?.identifier || '').trim();

      if (!identifier) {
        return sendJson(res, 400, { error: 'Please provide your registered recovery mobile number or email.' });
      }

      const isMatch = await matchesRecoveryIdentity(identifier);

      if (isMatch) {
        const { challengeId, otp } = createOtpChallenge(identifier);
        const isEmailRecovery = identifier.includes('@');

        if (isEmailRecovery) {
          const resendApiKey = process.env.RESEND_API_KEY;
          const resendFromEmail = process.env.RESEND_FROM_EMAIL;

          if (!resendApiKey || typeof resendApiKey !== 'string' || !resendApiKey.trim()) {
            return sendJson(res, 503, {
              error: 'Email delivery service is not configured. Please contact the system administrator.',
            });
          }

          if (!resendFromEmail || typeof resendFromEmail !== 'string' || !resendFromEmail.trim()) {
            return sendJson(res, 503, {
              error: 'Email delivery sender address is not configured. Please configure RESEND_FROM_EMAIL.',
            });
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
              return sendJson(res, 502, {
                error: 'Unable to dispatch recovery email. Please verify delivery service configuration and try again.',
              });
            }
          } catch {
            return sendJson(res, 502, {
              error: 'Failed to connect to email delivery service. Please check network connectivity and try again.',
            });
          }
        }

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
          } catch {}
        }

        const masked = maskRecoveryTarget(identifier);
        return sendJson(res, 200, {
          success: true,
          challengeId,
          maskedTarget: masked,
          message: `A verification code has been dispatched to ${masked}. Please enter it within 5 minutes.`,
        });
      }

      // Generic response for privacy
      const genericMasked = maskRecoveryTarget(getAdminRecoveryPhone() || getAdminRecoveryEmail());
      return sendJson(res, 200, {
        success: true,
        challengeId: 'dummy-challenge-id',
        maskedTarget: genericMasked,
        message: 'If the provided details match our administrator records, a verification code has been dispatched.',
      });
    } catch {
      return sendJson(res, 500, { error: 'Recovery service temporarily unavailable.' });
    }
  }

  // 5. VERIFY-RESET / VERIFY-CODE (POST)
  if (action === 'verify-reset' || action === 'verify-code') {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const clientIp = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || 'unknown';
    if (!checkRateLimit(`verify-reset:${clientIp}`, 10, 10 * 60 * 1000)) {
      return sendJson(res, 429, { error: 'Too many verification attempts. Please try again later.' });
    }

    try {
      const body = await readJsonBody(req);
      const challengeId = body?.challengeId;
      const recoveryCode = (body?.recoveryCode || body?.code || '').trim();

      if (!recoveryCode) {
        return sendJson(res, 400, { error: 'Verification code or recovery key is required.' });
      }

      const result = verifyRecoveryCode(challengeId, recoveryCode.trim());
      if (!result.success) {
        return sendJson(res, 400, { error: result.error || 'Verification failed.' });
      }

      const resetToken = createResetToken();
      return sendJson(res, 200, {
        success: true,
        resetToken,
        message: 'Recovery verified successfully. You may now set a new password.',
      });
    } catch {
      return sendJson(res, 500, { error: 'Verification service error.' });
    }
  }

  // 6. RESET-PASSWORD (POST)
  if (action === 'reset-password') {
    if (method !== 'POST') {
      res.setHeader('Allow', 'POST');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    try {
      const body = await readJsonBody(req);
      const resetToken = body?.resetToken;
      const newPassword = body?.newPassword;
      const confirmPassword = body?.confirmPassword;

      if (!resetToken || typeof resetToken !== 'string') {
        return sendJson(res, 400, { error: 'Reset token is required. Please restart recovery.' });
      }

      if (!newPassword || typeof newPassword !== 'string' || newPassword.trim().length < 8) {
        return sendJson(res, 400, { error: 'Password must be at least 8 characters long.' });
      }

      if (newPassword !== confirmPassword) {
        return sendJson(res, 400, { error: 'New password and confirmation do not match.' });
      }

      const tokenValid = consumeResetToken(resetToken);
      if (!tokenValid) {
        return sendJson(res, 400, {
          error: 'Invalid or expired password reset token. Please restart password recovery.',
        });
      }

      const formattedHash = hashPasswordWithScrypt(newPassword);
      await setActiveAdminPasswordHash(formattedHash);
      clearAdminSessionCookie(res);

      return sendJson(res, 200, {
        success: true,
        message: 'Password reset successful. Please log in with your new password.',
      });
    } catch {
      return sendJson(res, 500, { error: 'Failed to reset password. Please try again.' });
    }
  }

  return sendJson(res, 404, { error: `Auth action '${action}' not found` });
}
