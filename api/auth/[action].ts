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

export const INDIAN_MOBILE_REGEX = /^[6-9][0-9]{9}$/;
export const INVALID_INDIAN_MOBILE_MESSAGE =
  'कृपया 6 ते 9 या अंकाने सुरू होणारा वैध 10 अंकी मोबाईल नंबर टाका.';

export function normalizeIndianMobile(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const trimmed = String(raw).trim();
  if (!trimmed) return '';
  if (!/^[0-9\s+()-]+$/.test(trimmed)) return '';

  // When '+' is present, strictly recognize only a leading '+91' prefix (optional parens/spaces),
  // separate it from the mobile number, and validate the actual 10-digit number.
  if (trimmed.includes('+')) {
    if (!/^[\s(]*\+91/.test(trimmed)) return '';
    const compact = trimmed.replace(/[\s()-]/g, '');
    if (!compact.startsWith('+91')) return '';
    const actual = compact.slice(3);
    return INDIAN_MOBILE_REGEX.test(actual) ? actual : '';
  }

  let digits = trimmed.replace(/\D/g, '');
  if (digits.length === 14 && digits.startsWith('0091')) {
    digits = digits.slice(4);
  } else if (digits.length === 13 && digits.startsWith('091')) {
    digits = digits.slice(3);
  } else if (digits.length === 12 && digits.startsWith('91')) {
    digits = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    digits = digits.slice(1);
  }
  return INDIAN_MOBILE_REGEX.test(digits) ? digits : '';
}

export function normalizeIndianMobileE164(raw: unknown): string {
  const clean10 = normalizeIndianMobile(raw);
  return clean10 ? `+91${clean10}` : '';
}

export function getIndianMobileVariants(cleanPhone10: string): string[] {
  if (!INDIAN_MOBILE_REGEX.test(cleanPhone10)) return [];
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

function isMissingColumnError(err: any, columnName: string): boolean {
  if (!err) return false;
  const code = String(err.code || '').trim();
  const msg = String(err.message || '');
  return (
    (code === 'PGRST204' || code === '42703' || msg.toLowerCase().includes('schema cache')) &&
    new RegExp(columnName, 'i').test(msg)
  );
}

async function findExistingCustomerByPhone(
  supabase: SupabaseClient,
  cleanPhone10: string,
  phoneNormalized: string
): Promise<{ user: any | null; error: any | null }> {
  if (phoneNormalized) {
    const byNorm = await supabase
      .from('users')
      .select('*')
      .eq('phone_normalized', phoneNormalized)
      .eq('role', 'CUSTOMER')
      .order('created_at', { ascending: true })
      .limit(1);

    if (!byNorm.error && byNorm.data && byNorm.data.length > 0) {
      return { user: byNorm.data[0], error: null };
    }
    if (byNorm.error && !isMissingColumnError(byNorm.error, 'phone_normalized')) {
      return { user: null, error: byNorm.error };
    }
  }

  const phoneVariants = getIndianMobileVariants(cleanPhone10);
  const byVariants = await supabase
    .from('users')
    .select('*')
    .in('phone', phoneVariants)
    .eq('role', 'CUSTOMER')
    .order('created_at', { ascending: true })
    .limit(1);

  if (byVariants.error) {
    return { user: null, error: byVariants.error };
  }
  return { user: byVariants.data?.[0] || null, error: null };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value?: string | null): boolean {
  return Boolean(value && UUID_REGEX.test(value.trim()));
}

function isWalletLedgerEntry(r: any): boolean {
  if (!r) return false;
  const desc = String(r.description || '').toLowerCase();
  if (desc.includes('cod payment') || desc.includes('cod collection')) return false;
  if (r.id && (String(r.id).startsWith('cod_tx_') || String(r.id).startsWith('led_ord_'))) return false;

  if (r.type === 'DEBIT' && (desc.includes('wallet') || String(r.id || '').startsWith('wtx_'))) return true;
  if (
    r.type === 'CREDIT' &&
    (desc.includes('refund') || desc.includes('wallet') || String(r.id || '').startsWith('wtx_'))
  ) {
    return true;
  }
  return false;
}

function parseServerCustomerAddress(rawAddress?: unknown): {
  fullAddress: string;
  landmark: string;
  pincode: string;
} {
  const fromObject = (obj: Record<string, any>) => {
    const landmark = String(obj.landmark ?? '').trim();
    const pincode = obj.pincode !== undefined && obj.pincode !== null ? String(obj.pincode).trim() : '';
    const fullAddress = String(obj.full_address ?? obj.fullAddress ?? obj.address ?? obj.address_line1 ?? obj.addressLine1 ?? '').trim();
    return { fullAddress, landmark, pincode };
  };

  if (rawAddress && typeof rawAddress === 'object') {
    return fromObject(rawAddress as Record<string, any>);
  }

  let savedAddressText = typeof rawAddress === 'string' ? rawAddress.trim() : '';
  let savedLandmark = '';
  let savedPincode = '';

  if (!savedAddressText) {
    return { fullAddress: '', landmark: '', pincode: '' };
  }

  if (savedAddressText.startsWith('{') && savedAddressText.endsWith('}')) {
    try {
      const parsed = JSON.parse(savedAddressText);
      if (parsed && typeof parsed === 'object') {
        return fromObject(parsed);
      }
    } catch {
      // treat as raw string
    }
  }

  const landmarkMatch = savedAddressText.match(/\(Landmark:\s*([^)]+)\)/i);
  if (landmarkMatch) {
    savedLandmark = landmarkMatch[1].trim();
    savedAddressText = savedAddressText.replace(/\(Landmark:\s*[^)]+\)/i, '').trim();
  }

  const pincodeMatch = savedAddressText.match(/[-,\s]+(\d{6})\s*$/);
  if (pincodeMatch) {
    savedPincode = pincodeMatch[1];
    savedAddressText = savedAddressText.replace(/[-,\s]+\d{6}\s*$/, '').trim();
  }

  savedAddressText = savedAddressText.replace(/,\s*$/, '').trim();
  return {
    fullAddress: savedAddressText,
    landmark: savedLandmark,
    pincode: savedPincode,
  };
}

async function resolveServerCustomerWalletData(
  supabase: SupabaseClient,
  customerSession: CustomerSession
): Promise<{ balance: number; transactions: any[] } | null> {
  const cleanPhone = normalizeIndianMobile(customerSession.phone);
  const phoneNormalized = normalizeIndianMobileE164(cleanPhone);

  const targetIds = new Set<string>();
  if (customerSession.customerId) targetIds.add(customerSession.customerId);
  if (cleanPhone) {
    targetIds.add(cleanPhone);
    targetIds.add(`user-${cleanPhone}`);
    targetIds.add(`usr_${cleanPhone}`);
  }

  let dbUser: any = null;
  if (cleanPhone) {
    const { user } = await findExistingCustomerByPhone(supabase, cleanPhone, phoneNormalized);
    if (user) {
      dbUser = user;
      if (user.id) targetIds.add(String(user.id));
    }
  } else if (isUuid(customerSession.customerId)) {
    const { data: userRow } = await supabase
      .from('users')
      .select('*')
      .eq('id', customerSession.customerId)
      .eq('role', 'CUSTOMER')
      .maybeSingle();
    if (userRow) {
      dbUser = userRow;
      if (userRow.id) targetIds.add(String(userRow.id));
    }
  }

  const allIds = Array.from(targetIds).filter(Boolean);
  if (allIds.length === 0) {
    return { balance: 0, transactions: [] };
  }

  const filters = allIds.map((id) => `customer_id.eq.${id}`);
  const { data: rows, error } = await supabase
    .from('ledger')
    .select('*')
    .or(filters.join(','))
    .order('date', { ascending: true });

  if (error || !rows) {
    return null;
  }

  const walletRows = rows.filter(isWalletLedgerEntry);
  let balance = 0;

  if (walletRows.length > 0) {
    for (const tx of walletRows) {
      const amt = Number(tx.amount) || 0;
      if (tx.type === 'CREDIT') {
        balance += amt;
      } else if (tx.type === 'DEBIT') {
        balance = Math.max(0, balance - amt);
      }
    }
    balance = Math.round(balance * 100) / 100;
  } else if (dbUser) {
    balance = Math.max(0, Number(dbUser.wallet_balance || 0));
  }

  const transactions = [...walletRows].reverse().map((r: any) => {
    let orderNum: string | undefined = undefined;
    const match = r.description?.match(/#([A-Z0-9-]+)/i);
    if (match) orderNum = match[1];

    return {
      id: r.id,
      userId: r.customer_id,
      userPhone: cleanPhone || r.customer_id,
      orderId: r.order_id || undefined,
      orderNumber: orderNum,
      type: r.type as 'CREDIT' | 'DEBIT',
      amount: Number(r.amount) || 0,
      balanceAfter: Number(r.balance_after) || 0,
      description: r.description,
      createdAt: r.date,
    };
  });

  return { balance, transactions };
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
  const phoneNormalized = normalizeIndianMobileE164(body?.phone);
  if (!INDIAN_MOBILE_REGEX.test(cleanPhone) || !phoneNormalized) {
    return {
      statusCode: 400,
      payload: {
        code: 'INVALID_MOBILE',
        error: INVALID_INDIAN_MOBILE_MESSAGE,
      },
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
      const { user: existingCustomer, error: userErr } = await findExistingCustomerByPhone(
        supabase,
        cleanPhone,
        phoneNormalized
      );

      if (userErr) {
        return {
          statusCode: 500,
          payload: { error: userErr.message || 'Database lookup failed.' },
        };
      }

      if (existingCustomer) {
        if (isNewRegistration) {
          return {
            statusCode: 409,
            payload: {
              authenticated: false,
              code: 'DUPLICATE_CUSTOMER',
              redirectToLogin: true,
              phone: cleanPhone,
              phoneNormalized,
              error: DUPLICATE_CUSTOMER_MESSAGE,
            },
          };
        }

        resolvedUser = existingCustomer;
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
          phone_normalized: phoneNormalized,
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
          isMissingColumnError(insertErr, 'phone_normalized')
        ) {
          const withoutNormRes = await supabase
            .from('users')
            .insert({
              id: newCustomerId,
              full_name: requestedName,
              phone: cleanPhone,
              role: 'CUSTOMER',
              status: 'ACTIVE',
              created_at: nowIso,
              updated_at: nowIso,
            })
            .select()
            .single();
          insertedUser = withoutNormRes.data;
          insertErr = withoutNormRes.error;
        }

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
          const { user: retryUser } = await findExistingCustomerByPhone(
            supabase,
            cleanPhone,
            phoneNormalized
          );

          if (retryUser) {
            if (isNewRegistration) {
              return {
                statusCode: 409,
                payload: {
                  authenticated: false,
                  code: 'DUPLICATE_CUSTOMER',
                  redirectToLogin: true,
                  phone: cleanPhone,
                  phoneNormalized,
                  error: DUPLICATE_CUSTOMER_MESSAGE,
                },
              };
            }

            resolvedUser = retryUser;
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
                phoneNormalized,
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
        phoneNormalized,
        user: resolvedUser
          ? {
              id: resolvedUser.id,
              name: resolvedUser.full_name ?? resolvedUser.name ?? '',
              phone: resolvedUser.phone,
              phoneNormalized:
                resolvedUser.phone_normalized ||
                normalizeIndianMobileE164(resolvedUser.phone) ||
                phoneNormalized,
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

  // 2d. CUSTOMER PROFILE (GET / PUT) - strictly requires verified customer session & uses service role
  if (action === 'customer-profile') {
    const customerSession = verifyCustomerSession(req);
    if (!customerSession || customerSession.role !== 'CUSTOMER') {
      return sendJson(res, 401, {
        success: false,
        error: 'Unauthorized: Customer session required.',
      });
    }

    const supabase = getServerSupabaseClient();
    if (!supabase) {
      return sendJson(res, 503, {
        success: false,
        error: 'Database service unavailable.',
      });
    }

    const cleanPhone = normalizeIndianMobile(customerSession.phone);
    const phoneNormalized = normalizeIndianMobileE164(cleanPhone);

    if (method === 'GET') {
      try {
        const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
        const includeLedger = parsedUrl.searchParams.get('includeLedger') !== 'false';

        let dbUser: any = null;
        let lookupErr: any = null;

        if (cleanPhone && phoneNormalized) {
          const resLookup = await findExistingCustomerByPhone(supabase, cleanPhone, phoneNormalized);
          dbUser = resLookup.user;
          lookupErr = resLookup.error;
        }
        if (!dbUser && !lookupErr && isUuid(customerSession.customerId)) {
          const byId = await supabase
            .from('users')
            .select('*')
            .eq('id', customerSession.customerId)
            .eq('role', 'CUSTOMER')
            .maybeSingle();
          dbUser = byId.data;
          lookupErr = byId.error;
        }

        if (lookupErr) {
          return sendJson(res, 500, {
            success: false,
            error: lookupErr.message || 'Failed to load customer profile.',
          });
        }

        if (!dbUser) {
          return sendJson(res, 404, {
            success: false,
            error: 'Customer profile not found.',
          });
        }

        const { fullAddress, landmark, pincode } = parseServerCustomerAddress(dbUser.address);
        const formattedAddresses = fullAddress
          ? [
              {
                id: `addr-${dbUser.id}`,
                userId: dbUser.id,
                fullAddress,
                landmark,
                pincode,
                isDefault: true,
              },
            ]
          : [];

        const dbOutstanding = Number(dbUser.outstanding_balance || 0);
        let ledgerCredits = 0;
        if (includeLedger) {
          const walletData = await resolveServerCustomerWalletData(supabase, {
            ...customerSession,
            customerId: String(dbUser.id),
            phone: cleanPhone || customerSession.phone,
          });
          if (walletData) {
            ledgerCredits = walletData.balance;
          }
        }
        const dbCredits = Math.max(Number(dbUser.wallet_balance || 0), ledgerCredits);

        return sendJson(res, 200, {
          success: true,
          user: {
            id: dbUser.id,
            name: dbUser.full_name ?? dbUser.name ?? '',
            phone: dbUser.phone || cleanPhone,
            role: 'CUSTOMER',
            walletBalance: dbCredits,
            outstandingBalance: dbOutstanding,
            codOrderCount: Number(dbUser.cod_order_count || 0),
            addresses: formattedAddresses,
            createdAt: dbUser.updated_at || dbUser.created_at || new Date().toISOString(),
            isDatabaseVerified: true,
          },
        });
      } catch {
        return sendJson(res, 500, { success: false, error: 'Failed to load customer profile.' });
      }
    }

    if (method === 'PUT' || method === 'POST') {
      try {
        const body = await readJsonBody(req);

        // Support phone-only update if action === 'update_phone'
        if (body?.action === 'update_phone') {
          const nextCleanPhone = normalizeIndianMobile(body?.newPhone);
          const nextPhoneNormalized = normalizeIndianMobileE164(body?.newPhone);
          if (!INDIAN_MOBILE_REGEX.test(nextCleanPhone) || !nextPhoneNormalized) {
            return sendJson(res, 400, {
              success: false,
              code: 'INVALID_MOBILE',
              error: INVALID_INDIAN_MOBILE_MESSAGE,
            });
          }

          const { data: rpcData, error: rpcError } = await supabase.rpc(
            'update_customer_phone_atomic',
            {
              p_user_id: String(customerSession.customerId || ''),
              p_session_phone: cleanPhone,
              p_new_phone: nextCleanPhone,
              p_update_profile: false,
            }
          );

          if (rpcError) {
            const rpcCode = String(rpcError.code || '').trim();
            const rpcMsg = String(rpcError.message || '');
            const isMissingRpc =
              rpcCode === '42883' ||
              rpcCode === 'PGRST202' ||
              /could not find the function|update_customer_phone_atomic/i.test(rpcMsg);

            if (isUniqueViolationError(rpcError)) {
              return sendJson(res, 409, {
                success: false,
                code: 'DUPLICATE_CUSTOMER',
                error: DUPLICATE_CUSTOMER_MESSAGE,
              });
            }

            return sendJson(res, 500, {
              success: false,
              code: isMissingRpc ? 'MISSING_ATOMIC_RPC' : 'UPDATE_FAILED',
              error: isMissingRpc
                ? 'Atomic customer phone update database function is not installed. Please apply supabase_order_creation_atomic_v2.sql.'
                : rpcMsg || 'Failed to update customer mobile number.',
            });
          }

          if (!rpcData || typeof rpcData !== 'object' || !rpcData.ok) {
            return sendJson(res, Number(rpcData?.statusCode) || 500, {
              success: false,
              code: rpcData?.code || 'UPDATE_FAILED',
              error: String(rpcData?.error || 'Failed to update customer mobile number.'),
            });
          }

          const updatedPhone = String(rpcData.phone || nextCleanPhone);
          const updatedUserId = String(rpcData.user?.id || customerSession.customerId);
          const nowMs = Date.now();
          setCustomerSessionCookie(res, {
            role: 'CUSTOMER',
            customerId: updatedUserId,
            phone: updatedPhone,
            issuedAt: nowMs,
            expiresAt: nowMs + CUSTOMER_SESSION_MAX_AGE_MS,
          });

          return sendJson(res, 200, {
            success: true,
            phone: updatedPhone,
            phoneNormalized: String(rpcData.phoneNormalized || nextPhoneNormalized),
          });
        }

        // Standard profile update
        const cleanName = typeof body?.name === 'string' ? body.name.trim() : '';
        const fullAddress = typeof body?.fullAddress === 'string' ? body.fullAddress.trim() : '';
        const landmark = typeof body?.landmark === 'string' ? body.landmark.trim() : '';
        const pincode = typeof body?.pincode === 'string' ? body.pincode.trim() : '';
        const newPhone = typeof body?.newPhone === 'string' ? body.newPhone : undefined;

        let completeAddress = fullAddress;
        if (landmark && !completeAddress.toLowerCase().includes(landmark.toLowerCase())) {
          completeAddress = `${completeAddress} (Landmark: ${landmark})`;
        }
        if (pincode && !completeAddress.includes(pincode)) {
          completeAddress = `${completeAddress} - ${pincode}`;
        }

        let targetUser: any = null;
        if (isUuid(customerSession.customerId)) {
          const { data: userById } = await supabase
            .from('users')
            .select('*')
            .eq('id', customerSession.customerId)
            .eq('role', 'CUSTOMER')
            .limit(1);
          if (userById && userById.length > 0) {
            targetUser = userById[0];
          }
        }
        if (!targetUser && cleanPhone && phoneNormalized) {
          const { user: existingByPhone } = await findExistingCustomerByPhone(
            supabase,
            cleanPhone,
            phoneNormalized
          );
          if (existingByPhone) {
            targetUser = existingByPhone;
          }
        }

        const nowIso = new Date().toISOString();
        let effectiveCleanPhone = cleanPhone;

        if (targetUser) {
          const updatePayload: Record<string, any> = {
            updated_at: nowIso,
          };
          if (cleanName) {
            if ('full_name' in targetUser) {
              updatePayload.full_name = cleanName;
            } else {
              updatePayload.name = cleanName;
            }
          }
          if ('address' in targetUser) {
            updatePayload.address = completeAddress;
          }
          if ('shop_name' in targetUser && !targetUser.shop_name && cleanName) {
            updatePayload.shop_name = `${cleanName}'s Kirana Store`;
          }
          if (targetUser.role !== 'SHOPKEEPER' && targetUser.role !== 'SECONDARY_ADMIN') {
            updatePayload.role = 'CUSTOMER';
          }

          let phoneChangedViaRpc = false;
          if (typeof newPhone === 'string' && newPhone.trim()) {
            const nextCleanPhone = normalizeIndianMobile(newPhone);
            const nextPhoneNormalized = normalizeIndianMobileE164(newPhone);
            const existingNorm =
              targetUser.phone_normalized || normalizeIndianMobileE164(targetUser.phone);
            if (nextCleanPhone && nextPhoneNormalized && nextPhoneNormalized !== existingNorm) {
              const { data: phoneRpcData, error: phoneRpcError } = await supabase.rpc(
                'update_customer_phone_atomic',
                {
                  p_user_id: String(targetUser.id),
                  p_session_phone: cleanPhone,
                  p_new_phone: nextCleanPhone,
                  p_update_profile: true,
                  p_name: cleanName || null,
                  p_address: 'address' in targetUser ? completeAddress : null,
                  p_shop_name: cleanName ? `${cleanName}'s Kirana Store` : null,
                }
              );

              if (phoneRpcError) {
                const rpcCode = String(phoneRpcError.code || '').trim();
                const rpcMsg = String(phoneRpcError.message || '');
                const isMissingRpc =
                  rpcCode === '42883' ||
                  rpcCode === 'PGRST202' ||
                  /could not find the function|update_customer_phone_atomic/i.test(rpcMsg);

                if (isUniqueViolationError(phoneRpcError)) {
                  return sendJson(res, 409, {
                    success: false,
                    code: 'DUPLICATE_CUSTOMER',
                    error: DUPLICATE_CUSTOMER_MESSAGE,
                  });
                }

                return sendJson(res, 500, {
                  success: false,
                  code: isMissingRpc ? 'MISSING_ATOMIC_RPC' : 'UPDATE_FAILED',
                  error: isMissingRpc
                    ? 'Atomic customer phone update database function is not installed. Please apply supabase_order_creation_atomic_v2.sql.'
                    : rpcMsg || 'Failed to update customer profile.',
                });
              }

              if (!phoneRpcData || typeof phoneRpcData !== 'object' || !phoneRpcData.ok) {
                return sendJson(res, Number(phoneRpcData?.statusCode) || 500, {
                  success: false,
                  code: phoneRpcData?.code || 'UPDATE_FAILED',
                  error: String(phoneRpcData?.error || 'Failed to update customer profile.'),
                });
              }

              if (phoneRpcData.user) {
                targetUser = phoneRpcData.user;
              }
              effectiveCleanPhone =
                normalizeIndianMobile(phoneRpcData.phone) || nextCleanPhone;
              phoneChangedViaRpc = true;
            }
          }

          if (!phoneChangedViaRpc) {
            let { data: updated, error: updateError } = await supabase
              .from('users')
              .update(updatePayload)
              .eq('id', targetUser.id)
              .select()
              .single();

            if (
              updateError &&
              !isUniqueViolationError(updateError) &&
              isMissingColumnError(updateError, 'phone_normalized')
            ) {
              const { phone_normalized: _omit, ...fallbackUpdate } = updatePayload;
              const retryUpdate = await supabase
                .from('users')
                .update(fallbackUpdate)
                .eq('id', targetUser.id)
                .select()
                .single();
              updated = retryUpdate.data;
              updateError = retryUpdate.error;
            }

            if (updateError) {
              if (isUniqueViolationError(updateError)) {
                return sendJson(res, 409, {
                  success: false,
                  code: 'DUPLICATE_CUSTOMER',
                  error: DUPLICATE_CUSTOMER_MESSAGE,
                });
              }
              return sendJson(res, 500, {
                success: false,
                error: updateError.message || 'Failed to update customer profile.',
              });
            } else if (updated) {
              targetUser = updated;
              effectiveCleanPhone = normalizeIndianMobile(updated.phone) || effectiveCleanPhone;
            }
          }
        } else {
          if (!INDIAN_MOBILE_REGEX.test(cleanPhone) || !phoneNormalized) {
            return sendJson(res, 400, { success: false, error: INVALID_INDIAN_MOBILE_MESSAGE });
          }

          const newUserId = isUuid(customerSession.customerId)
            ? customerSession.customerId.trim()
            : crypto.randomUUID();
          const primaryInsertPayload = {
            id: newUserId,
            full_name: cleanName || `Customer (${cleanPhone.slice(-4)})`,
            phone: cleanPhone,
            phone_normalized: phoneNormalized,
            role: 'CUSTOMER',
            status: 'ACTIVE',
            created_at: nowIso,
            updated_at: nowIso,
          };

          let { data: inserted, error: insertError } = await supabase
            .from('users')
            .insert(primaryInsertPayload)
            .select()
            .single();

          if (
            insertError &&
            !isUniqueViolationError(insertError) &&
            isMissingColumnError(insertError, 'phone_normalized')
          ) {
            const withoutNormInsert = await supabase
              .from('users')
              .insert({
                id: newUserId,
                full_name: cleanName || `Customer (${cleanPhone.slice(-4)})`,
                phone: cleanPhone,
                role: 'CUSTOMER',
                status: 'ACTIVE',
                created_at: nowIso,
                updated_at: nowIso,
              })
              .select()
              .single();
            inserted = withoutNormInsert.data;
            insertError = withoutNormInsert.error;
          }

          if (
            insertError &&
            !isUniqueViolationError(insertError) &&
            (insertError.code === 'PGRST204' ||
              insertError.code === '42703' ||
              /full_name|status/i.test(String(insertError.message || '')))
          ) {
            const legacyInsert = await supabase
              .from('users')
              .insert({
                id: newUserId,
                name: cleanName || `Customer (${cleanPhone.slice(-4)})`,
                phone: cleanPhone,
                role: 'CUSTOMER',
                address: completeAddress,
                outstanding_balance: 0,
                updated_at: nowIso,
              })
              .select()
              .single();
            inserted = legacyInsert.data;
            insertError = legacyInsert.error;
          }

          if (insertError) {
            const { user: retryUser } = await findExistingCustomerByPhone(
              supabase,
              cleanPhone,
              phoneNormalized
            );
            if (retryUser) {
              targetUser = retryUser;
            } else {
              return sendJson(res, 500, {
                success: false,
                error: insertError.message || 'Failed to save customer profile.',
              });
            }
          } else if (inserted) {
            targetUser = inserted;
          }
        }

        const resolvedId = String(targetUser?.id || customerSession.customerId);
        if (effectiveCleanPhone !== cleanPhone || resolvedId !== customerSession.customerId) {
          const nowMs = Date.now();
          setCustomerSessionCookie(res, {
            role: 'CUSTOMER',
            customerId: resolvedId,
            phone: effectiveCleanPhone,
            issuedAt: nowMs,
            expiresAt: nowMs + CUSTOMER_SESSION_MAX_AGE_MS,
          });
        }

        const dbOutstanding = Number(targetUser?.outstanding_balance || 0);
        const walletData = await resolveServerCustomerWalletData(supabase, {
          ...customerSession,
          customerId: resolvedId,
          phone: effectiveCleanPhone,
        });
        const ledgerCredits = walletData ? walletData.balance : 0;
        const dbCredits = Math.max(Number(targetUser?.wallet_balance || 0), ledgerCredits);

        return sendJson(res, 200, {
          success: true,
          user: {
            id: resolvedId,
            name: targetUser?.full_name ?? targetUser?.name ?? cleanName,
            phone: effectiveCleanPhone,
            role: 'CUSTOMER',
            walletBalance: dbCredits,
            outstandingBalance: dbOutstanding,
            codOrderCount: Number(targetUser?.cod_order_count || 0),
            addresses: [],
            createdAt: targetUser?.updated_at || nowIso,
            isDatabaseVerified: true,
          },
        });
      } catch {
        return sendJson(res, 500, { success: false, error: 'Failed to save customer profile.' });
      }
    }

    res.setHeader('Allow', 'GET, PUT, POST');
    return sendJson(res, 405, { error: 'Method Not Allowed' });
  }

  // 2e. CUSTOMER WALLET & LEDGER SUMMARY (GET) - strictly requires verified customer session & uses service role
  if (action === 'customer-wallet') {
    if (method !== 'GET') {
      res.setHeader('Allow', 'GET');
      return sendJson(res, 405, { error: 'Method Not Allowed' });
    }

    const customerSession = verifyCustomerSession(req);
    if (!customerSession || customerSession.role !== 'CUSTOMER') {
      return sendJson(res, 401, {
        success: false,
        error: 'Unauthorized: Customer session required.',
      });
    }

    const supabase = getServerSupabaseClient();
    if (!supabase) {
      return sendJson(res, 503, {
        success: false,
        error: 'Database service unavailable.',
      });
    }

    try {
      const walletData = await resolveServerCustomerWalletData(supabase, customerSession);
      if (!walletData) {
        return sendJson(res, 500, {
          success: false,
          error: 'Failed to verify wallet ledger from database.',
        });
      }
      return sendJson(res, 200, {
        success: true,
        balance: walletData.balance,
        transactions: walletData.transactions,
      });
    } catch {
      return sendJson(res, 500, {
        success: false,
        error: 'Failed to fetch customer wallet summary.',
      });
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
