import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  verifyAdminSession,
  verifyCustomerSession,
  AdminSession,
  CustomerSession,
} from './auth/_verify.js';
import {
  INDIAN_MOBILE_REGEX,
  INVALID_INDIAN_MOBILE_MESSAGE,
  normalizeIndianMobile,
  normalizeIndianMobileE164,
  getIndianMobileVariants,
} from './auth/[action].js';

export interface AddressAuthContext {
  adminSession: AdminSession | null;
  customerSession: CustomerSession | null;
}

export type AddressLabel = 'HOME' | 'SHOP' | 'OFFICE' | 'OTHER';

export interface ApiAddress {
  id: string;
  userId: string;
  label: AddressLabel;
  addressLabel: AddressLabel;
  recipientName: string;
  recipientPhone: string;
  addressLine1: string;
  addressLine2: string;
  fullAddress: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  isDefault: boolean;
  createdAt?: string;
  updatedAt?: string;
}

function getSupabaseServiceClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (
    url &&
    key &&
    url !== 'https://your-project.supabase.co' &&
    key !== 'your-service-role-key'
  ) {
    try {
      return createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
    } catch {
      return null;
    }
  }
  return null;
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 512 * 1024) {
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

function cleanText(raw: unknown): string {
  return typeof raw === 'string' ? raw.trim() : '';
}

export function normalizeAddressLabel(raw: unknown): AddressLabel {
  const upper = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (upper === 'HOME' || upper === 'SHOP' || upper === 'OFFICE' || upper === 'OTHER') {
    return upper;
  }
  return 'HOME';
}

function isValidProvidedLabel(raw: unknown): boolean {
  if (raw === undefined || raw === null) return true;
  if (typeof raw !== 'string') return false;
  const upper = raw.trim().toUpperCase();
  if (!upper) return true;
  return upper === 'HOME' || upper === 'SHOP' || upper === 'OFFICE' || upper === 'OTHER';
}

export function formatFullAddressFromComponents(parts: {
  addressLine1?: string;
  addressLine2?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
}): string {
  const line1 = (parts.addressLine1 || '').trim();
  const line2 = (parts.addressLine2 || '').trim();
  const landmark = (parts.landmark || '').trim();
  const city = (parts.city || '').trim();
  const state = (parts.state || '').trim();
  const pincode = (parts.pincode || '').trim();

  const cityState = [city, state].filter(Boolean).join(', ');
  const cityStatePin = pincode
    ? cityState
      ? `${cityState} - ${pincode}`
      : pincode
    : cityState;

  return [line1, line2, landmark ? `Near ${landmark}` : '', cityStatePin]
    .filter(Boolean)
    .join(', ');
}

export function mapAddressRow(row: any): ApiAddress {
  const addressLabel = normalizeAddressLabel(row?.address_label);
  const recipientName = cleanText(row?.recipient_name);
  const recipientPhone = cleanText(row?.recipient_phone);
  const addressLine1 = cleanText(row?.address_line1);
  const addressLine2 = cleanText(row?.address_line2);
  const landmark = cleanText(row?.landmark);
  const city = cleanText(row?.city);
  const state = cleanText(row?.state);
  const pincode =
    row?.pincode !== null && row?.pincode !== undefined ? String(row.pincode).trim() : '';

  const fullAddress = formatFullAddressFromComponents({
    addressLine1,
    addressLine2,
    landmark,
    city,
    state,
    pincode,
  });

  return {
    id: String(row.id),
    userId: String(row.user_id),
    label: addressLabel,
    addressLabel,
    recipientName,
    recipientPhone,
    addressLine1,
    addressLine2,
    fullAddress,
    landmark,
    city,
    state,
    pincode,
    isDefault: Boolean(row.is_default),
    ...(row.created_at ? { createdAt: String(row.created_at) } : {}),
    ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}),
  };
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value?: string | null): boolean {
  return Boolean(value && UUID_REGEX.test(value.trim()));
}

function isUuidSyntaxError(error: any): boolean {
  if (!error) return false;
  return (
    error.code === '22P02' ||
    /invalid input syntax for type uuid/i.test(String(error.message || ''))
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

function isUniqueViolationError(err: any): boolean {
  if (!err) return false;
  const code = String(err.code || '').trim();
  const msg = String(err.message || '').toLowerCase();
  return code === '23505' || msg.includes('duplicate key') || msg.includes('unique constraint');
}

function isCustomerRoleRow(row: any): boolean {
  const role = row?.role;
  if (role === null || role === undefined || String(role).trim() === '') return true;
  return String(role).trim().toUpperCase() === 'CUSTOMER';
}

function normalizeExistingPhoneForLookup(raw: unknown): string {
  const direct = normalizeIndianMobile(raw);
  if (direct) return direct;
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const digits = String(raw).replace(/\D/g, '');
  if (digits.length === 13 && digits.startsWith('091')) {
    return normalizeIndianMobile(digits.slice(3));
  }
  return '';
}

const addressPhoneCreationQueues = new Map<string, Promise<any>>();

async function withAddressPhoneCreationLock<T>(
  cleanPhone: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = addressPhoneCreationQueues.get(cleanPhone) || Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = previous.catch(() => {}).then(() => current);
  addressPhoneCreationQueues.set(cleanPhone, chained);

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
    if (addressPhoneCreationQueues.get(cleanPhone) === chained) {
      addressPhoneCreationQueues.delete(cleanPhone);
    }
  }
}

async function resolveCustomerIdentity(
  supabase: SupabaseClient,
  phone: string,
  sessionCustomerId?: string,
  options?: { ensureDbUser?: boolean; fallbackFullName?: string }
): Promise<{
  aliases: string[];
  canonicalUserId: string;
  userFullName?: string;
  isInactive?: boolean;
  inactiveReason?: string;
  invalidPhone?: boolean;
  lookupError?: string;
  lookupErrorStatus?: number;
}> {
  const cleanPhone = normalizeIndianMobile(phone);
  const phoneNormalized = normalizeIndianMobileE164(cleanPhone);
  const phoneVariants = getIndianMobileVariants(cleanPhone);
  const aliasSet = new Set<string>();

  if (sessionCustomerId && sessionCustomerId.trim()) {
    aliasSet.add(sessionCustomerId.trim());
  }
  if (cleanPhone) {
    aliasSet.add(cleanPhone);
    aliasSet.add(`user-${cleanPhone}`);
    aliasSet.add(`usr_${cleanPhone}`);
  }

  if (options?.ensureDbUser && (!INDIAN_MOBILE_REGEX.test(cleanPhone) || !phoneNormalized)) {
    return {
      aliases: Array.from(aliasSet),
      canonicalUserId: (sessionCustomerId && sessionCustomerId.trim()) || '',
      invalidPhone: true,
    };
  }

  let dbUserId: string | null = null;
  let userFullName: string | undefined;
  let isInactive = false;
  let inactiveReason: string | undefined;

  const lookupCustomerRows = async (): Promise<{ rows: any[]; error: any | null }> => {
    if (phoneNormalized) {
      const byNorm = await supabase
        .from('users')
        .select('*')
        .eq('phone_normalized', phoneNormalized)
        .order('created_at', { ascending: true });

      if (!byNorm.error) {
        const matchedNorm = (byNorm.data || []).filter(isCustomerRoleRow);
        if (matchedNorm.length > 0) {
          return { rows: matchedNorm, error: null };
        }
      } else if (!isMissingColumnError(byNorm.error, 'phone_normalized')) {
        return { rows: [], error: byNorm.error };
      }
    }

    const baseVarQuery = supabase.from('users').select('*');
    const digitWildcardPattern = `%${cleanPhone.split('').join('%')}%`;
    const filteredVarQuery =
      typeof (baseVarQuery as any).ilike === 'function'
        ? (baseVarQuery as any).ilike('phone', digitWildcardPattern)
        : baseVarQuery.in('phone', phoneVariants.length > 0 ? phoneVariants : [cleanPhone, `+91${cleanPhone}`]);

    const byVars = await filteredVarQuery.order('updated_at', { ascending: false });
    if (byVars.error) {
      return { rows: [], error: byVars.error };
    }

    const matchedVars = (byVars.data || []).filter(
      (row: any) =>
        isCustomerRoleRow(row) && normalizeExistingPhoneForLookup(row?.phone) === cleanPhone
    );
    return { rows: matchedVars, error: null };
  };

  const applyResolvedCustomerRows = (rows: any[]) => {
    for (const u of rows) {
      if (u?.id) {
        aliasSet.add(String(u.id));
        if (!dbUserId && !String(u.id).startsWith('user-')) {
          dbUserId = String(u.id);
        }
      }
      const candidateName = cleanText(u?.full_name ?? u?.name);
      if (!userFullName && candidateName) {
        userFullName = candidateName;
      }
    }
    if (!dbUserId && rows[0]?.id) {
      dbUserId = String(rows[0].id);
    }
    if (rows[0]?.status && String(rows[0].status).toUpperCase() !== 'ACTIVE') {
      isInactive = true;
      inactiveReason = rows[0].inactive_reason || undefined;
    }
  };

  const resolveOrCreate = async (): Promise<{
    lookupError?: string;
    lookupErrorStatus?: number;
    invalidPhone?: boolean;
  } | null> => {
    const { rows: userRows, error: lookupErr } = await lookupCustomerRows();
    if (lookupErr) {
      return {
        lookupError: lookupErr.message || 'Database customer lookup failed.',
        lookupErrorStatus: 500,
      };
    }

    if (userRows.length > 0) {
      applyResolvedCustomerRows(userRows);
      return null;
    }

    if (options?.ensureDbUser) {
      if (!INDIAN_MOBILE_REGEX.test(cleanPhone) || !phoneNormalized) {
        return { invalidPhone: true };
      }
      const nowIso = new Date().toISOString();
      const newUserId = isUuid(sessionCustomerId) ? sessionCustomerId!.trim() : crypto.randomUUID();
      const seedName = cleanText(options?.fallbackFullName);
      let insertRes = await supabase
        .from('users')
        .insert({
          id: newUserId,
          full_name: seedName,
          phone: cleanPhone,
          phone_normalized: phoneNormalized,
          role: 'CUSTOMER',
          status: 'ACTIVE',
          created_at: nowIso,
          updated_at: nowIso,
        })
        .select('id')
        .single();

      if (
        insertRes.error &&
        !isUniqueViolationError(insertRes.error) &&
        isMissingColumnError(insertRes.error, 'phone_normalized')
      ) {
        insertRes = await supabase
          .from('users')
          .insert({
            id: newUserId,
            full_name: seedName,
            phone: cleanPhone,
            role: 'CUSTOMER',
            status: 'ACTIVE',
            created_at: nowIso,
            updated_at: nowIso,
          })
          .select('id')
          .single();
      }

      if (
        insertRes.error &&
        !isUniqueViolationError(insertRes.error) &&
        (insertRes.error.code === 'PGRST204' ||
          insertRes.error.code === '42703' ||
          /full_name|status/i.test(String(insertRes.error.message || '')))
      ) {
        insertRes = await supabase
          .from('users')
          .insert({
            id: newUserId,
            name: seedName,
            phone: cleanPhone,
            role: 'CUSTOMER',
            updated_at: nowIso,
          })
          .select('id')
          .single();
      }

      if (!insertRes.error && insertRes.data?.id) {
        dbUserId = String(insertRes.data.id);
        aliasSet.add(dbUserId);
        if (seedName) userFullName = seedName;
        return null;
      }

      if (insertRes.error && isUniqueViolationError(insertRes.error)) {
        const { rows: raceRows, error: raceErr } = await lookupCustomerRows();
        if (raceErr) {
          return {
            lookupError: raceErr.message || 'Database lookup failed during duplicate conflict recovery.',
            lookupErrorStatus: 500,
          };
        }
        if (raceRows.length > 0) {
          applyResolvedCustomerRows(raceRows);
          return null;
        }
        return {
          lookupError:
            'Customer mobile conflict detected during registration, and existing customer record could not be resolved.',
          lookupErrorStatus: 409,
        };
      }

      if (insertRes.error) {
        return {
          lookupError: insertRes.error.message || 'Failed to initialize customer record.',
          lookupErrorStatus: 500,
        };
      }
    }

    return null;
  };

  if (cleanPhone && INDIAN_MOBILE_REGEX.test(cleanPhone)) {
    const failure = options?.ensureDbUser
      ? await withAddressPhoneCreationLock(cleanPhone, resolveOrCreate)
      : await resolveOrCreate();

    if (failure) {
      return {
        aliases: Array.from(aliasSet),
        canonicalUserId: (sessionCustomerId && sessionCustomerId.trim()) || '',
        ...(failure.invalidPhone ? { invalidPhone: true } : {}),
        ...(failure.lookupError
          ? {
              lookupError: failure.lookupError,
              lookupErrorStatus: failure.lookupErrorStatus || 500,
            }
          : {}),
      };
    }
  }

  const canonicalUserId =
    dbUserId ||
    (sessionCustomerId && sessionCustomerId.trim()) ||
    (cleanPhone ? `user-${cleanPhone}` : '');

  return {
    aliases: Array.from(aliasSet),
    canonicalUserId,
    userFullName,
    isInactive,
    inactiveReason,
  };
}

async function fetchSortedCustomerAddresses(
  supabase: SupabaseClient,
  aliases: string[]
): Promise<{ addresses: ApiAddress[]; error?: string }> {
  if (aliases.length === 0) {
    return { addresses: [] };
  }

  let { data, error } = await supabase
    .from('addresses')
    .select('*')
    .in('user_id', aliases)
    .order('is_default', { ascending: false })
    .order('created_at', { ascending: true });

  if (error && isUuidSyntaxError(error)) {
    const uuidAliases = aliases.filter(isUuid);
    if (uuidAliases.length === 0) {
      return { addresses: [] };
    }
    const retry = await supabase
      .from('addresses')
      .select('*')
      .in('user_id', uuidAliases)
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });
    data = retry.data;
    error = retry.error;
  }

  if (error) {
    return { addresses: [], error: error.message };
  }

  const mapped = (data || []).map(mapAddressRow);

  // Defensive guarantee: never expose more than one isDefault=true item
  let defaultSeen = false;
  const normalized = mapped.map((addr) => {
    if (addr.isDefault) {
      if (!defaultSeen) {
        defaultSeen = true;
        return addr;
      }
      return { ...addr, isDefault: false };
    }
    return addr;
  });

  return { addresses: normalized };
}

async function updateAddressesForUserIds(
  supabase: SupabaseClient,
  aliases: string[],
  fields: Record<string, any>,
  excludeId?: string
): Promise<{ error: any }> {
  if (aliases.length === 0) return { error: null };

  let q = supabase.from('addresses').update(fields).in('user_id', aliases);
  if (fields.is_default === false) q = q.eq('is_default', true);
  if (excludeId) q = q.neq('id', excludeId);
  let { error } = await q;

  if (error && isUuidSyntaxError(error)) {
    const uuidAliases = aliases.filter(isUuid);
    if (uuidAliases.length === 0) return { error: null };
    let rq = supabase.from('addresses').update(fields).in('user_id', uuidAliases);
    if (fields.is_default === false) rq = rq.eq('is_default', true);
    if (excludeId) rq = rq.neq('id', excludeId);
    const retry = await rq;
    error = retry.error;
  }

  return { error };
}

export async function processAddressesRequest(
  supabase: SupabaseClient,
  auth: AddressAuthContext,
  method: string,
  query?: { id?: string | null; userId?: string | null; phone?: string | null },
  body?: any
): Promise<{ statusCode: number; payload: any }> {
  const isShopkeeper = Boolean(auth?.adminSession && auth.adminSession.role === 'SHOPKEEPER');
  const customerSession =
    auth?.customerSession && auth.customerSession.role === 'CUSTOMER'
      ? auth.customerSession
      : null;

  if (!isShopkeeper && !customerSession) {
    return {
      statusCode: 401,
      payload: {
        success: false,
        error: 'Unauthorized: Verified customer or shopkeeper session required to manage addresses.',
      },
    };
  }

  // Resolve authorized customer identity scope
  let aliases: string[] = [];
  let canonicalUserId = '';
  let resolvedUserFullName = '';
  let resolvedUserPhone = '';

  if (customerSession) {
    const sessionCleanPhone = normalizeIndianMobile(customerSession.phone);
    const requestedPhone = (query?.phone || body?.phone || '').toString().trim();
    if (requestedPhone) {
      const cleanRequestedPhone = normalizeIndianMobile(requestedPhone);
      if (!cleanRequestedPhone || !INDIAN_MOBILE_REGEX.test(cleanRequestedPhone)) {
        return {
          statusCode: 400,
          payload: {
            success: false,
            code: 'INVALID_MOBILE',
            error: INVALID_INDIAN_MOBILE_MESSAGE,
          },
        };
      }
      if (!sessionCleanPhone || cleanRequestedPhone !== sessionCleanPhone) {
        return {
          statusCode: 403,
          payload: {
            success: false,
            error: 'Forbidden: You can only access or modify your own delivery addresses.',
          },
        };
      }
    }

    if (method === 'POST') {
      if (!sessionCleanPhone || !INDIAN_MOBILE_REGEX.test(sessionCleanPhone)) {
        return {
          statusCode: 400,
          payload: {
            success: false,
            code: 'INVALID_MOBILE',
            error: INVALID_INDIAN_MOBILE_MESSAGE,
          },
        };
      }
      const rawRecipientPhoneCheck = body?.recipientPhone ?? body?.recipient_phone;
      if (rawRecipientPhoneCheck !== undefined && String(rawRecipientPhoneCheck).trim() !== '') {
        const cleanRecipientCheck = normalizeIndianMobile(rawRecipientPhoneCheck);
        if (!cleanRecipientCheck || !INDIAN_MOBILE_REGEX.test(cleanRecipientCheck)) {
          return {
            statusCode: 400,
            payload: {
              success: false,
              code: 'INVALID_MOBILE',
              error: INVALID_INDIAN_MOBILE_MESSAGE,
            },
          };
        }
      }
    }

    const identity = await resolveCustomerIdentity(
      supabase,
      sessionCleanPhone || customerSession.phone,
      customerSession.customerId,
      {
        ensureDbUser: method === 'POST',
        fallbackFullName: cleanText(body?.recipientName),
      }
    );
    if (identity.invalidPhone) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          code: 'INVALID_MOBILE',
          error: INVALID_INDIAN_MOBILE_MESSAGE,
        },
      };
    }
    if (identity.lookupError) {
      return {
        statusCode: identity.lookupErrorStatus || 500,
        payload: {
          success: false,
          error: identity.lookupError,
        },
      };
    }
    if (identity.isInactive) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: `Customer account is inactive${identity.inactiveReason ? `: ${identity.inactiveReason}` : '.'}`,
        },
      };
    }
    aliases = identity.aliases;
    canonicalUserId = identity.canonicalUserId;
    resolvedUserFullName = identity.userFullName || '';
    resolvedUserPhone = sessionCleanPhone;

    const requestedUserId = (query?.userId || body?.userId || '').toString().trim();
    if (requestedUserId && !aliases.includes(requestedUserId)) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: You cannot access or modify another customer’s delivery addresses.',
        },
      };
    }
  } else if (isShopkeeper) {
    const targetPhone = (query?.phone || body?.phone || '').toString().trim();
    const targetUserId = (query?.userId || body?.userId || '').toString().trim();
    if (targetPhone) {
      const cleanTargetPhone = normalizeIndianMobile(targetPhone);
      if (!cleanTargetPhone || !INDIAN_MOBILE_REGEX.test(cleanTargetPhone)) {
        return {
          statusCode: 400,
          payload: {
            success: false,
            code: 'INVALID_MOBILE',
            error: INVALID_INDIAN_MOBILE_MESSAGE,
          },
        };
      }
      if (method === 'POST') {
        const rawRecipientPhoneCheck = body?.recipientPhone ?? body?.recipient_phone;
        if (rawRecipientPhoneCheck !== undefined && String(rawRecipientPhoneCheck).trim() !== '') {
          const cleanRecipientCheck = normalizeIndianMobile(rawRecipientPhoneCheck);
          if (!cleanRecipientCheck || !INDIAN_MOBILE_REGEX.test(cleanRecipientCheck)) {
            return {
              statusCode: 400,
              payload: {
                success: false,
                code: 'INVALID_MOBILE',
                error: INVALID_INDIAN_MOBILE_MESSAGE,
              },
            };
          }
        }
      }
      const identity = await resolveCustomerIdentity(
        supabase,
        cleanTargetPhone,
        targetUserId || undefined,
        {
          ensureDbUser: method === 'POST',
          fallbackFullName: cleanText(body?.recipientName),
        }
      );
      if (identity.invalidPhone) {
        return {
          statusCode: 400,
          payload: {
            success: false,
            code: 'INVALID_MOBILE',
            error: INVALID_INDIAN_MOBILE_MESSAGE,
          },
        };
      }
      if (identity.lookupError) {
        return {
          statusCode: identity.lookupErrorStatus || 500,
          payload: {
            success: false,
            error: identity.lookupError,
          },
        };
      }
      aliases = identity.aliases;
      canonicalUserId = identity.canonicalUserId;
      resolvedUserFullName = identity.userFullName || '';
      resolvedUserPhone = cleanTargetPhone;
    } else if (targetUserId) {
      if (isUuid(targetUserId)) {
        const { data: userRow } = await supabase
          .from('users')
          .select('*')
          .eq('id', targetUserId)
          .limit(1);
        if (userRow && userRow.length > 0 && userRow[0].phone) {
          const identity = await resolveCustomerIdentity(supabase, userRow[0].phone, targetUserId);
          if (identity.lookupError) {
            return {
              statusCode: identity.lookupErrorStatus || 500,
              payload: {
                success: false,
                error: identity.lookupError,
              },
            };
          }
          aliases = identity.aliases;
          canonicalUserId = identity.canonicalUserId;
          resolvedUserFullName =
            identity.userFullName || cleanText(userRow[0].full_name ?? userRow[0].name);
          resolvedUserPhone = normalizeIndianMobile(userRow[0].phone);
        } else {
          aliases = [targetUserId];
          canonicalUserId = targetUserId;
        }
      } else {
        aliases = [targetUserId];
        canonicalUserId = targetUserId;
      }
    } else if (method === 'GET' || method === 'POST') {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: 'Customer userId or phone is required for shopkeeper address operations.',
        },
      };
    }
  }

  // 1. GET — Fetch all customer addresses
  if (method === 'GET') {
    const { addresses, error } = await fetchSortedCustomerAddresses(supabase, aliases);
    if (error) {
      return { statusCode: 500, payload: { success: false, error } };
    }
    return {
      statusCode: 200,
      payload: {
        success: true,
        addresses,
        customerId: canonicalUserId,
      },
    };
  }

  // 2. POST — Add a new delivery address
  if (method === 'POST') {
    const rawLabel = body?.addressLabel ?? body?.address_label ?? body?.label;
    if (!isValidProvidedLabel(rawLabel)) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: 'Address label must be one of HOME, SHOP, OFFICE, or OTHER.',
        },
      };
    }

    const addressLabel = normalizeAddressLabel(rawLabel);
    const recipientName =
      cleanText(body?.recipientName ?? body?.recipient_name) || resolvedUserFullName;
    const rawRecipientPhone = body?.recipientPhone ?? body?.recipient_phone;
    const hasExplicitRecipientPhone =
      rawRecipientPhone !== undefined && String(rawRecipientPhone).trim() !== '';
    const recipientPhone = hasExplicitRecipientPhone
      ? normalizeIndianMobile(rawRecipientPhone)
      : resolvedUserPhone;
    const addressLine1 =
      cleanText(body?.addressLine1 ?? body?.address_line1) ||
      cleanText(body?.fullAddress ?? body?.full_address);
    const addressLine2 = cleanText(body?.addressLine2 ?? body?.address_line2);
    const landmark = cleanText(body?.landmark);
    const city = cleanText(body?.city);
    const state = cleanText(body?.state);
    const pincode = cleanText(body?.pincode);

    if (!recipientName) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'Recipient name is required.' },
      };
    }

    if (!recipientPhone || !INDIAN_MOBILE_REGEX.test(recipientPhone)) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          code: 'INVALID_MOBILE',
          error: INVALID_INDIAN_MOBILE_MESSAGE,
        },
      };
    }

    if (!addressLine1) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'Address line 1 is required.' },
      };
    }

    if (!city) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'City is required.' },
      };
    }

    if (!state) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'State is required.' },
      };
    }

    if (!pincode || !/^\d{6}$/.test(pincode)) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'Please enter a valid 6-digit pincode.' },
      };
    }

    const { addresses: existingAddresses, error: fetchErr } = await fetchSortedCustomerAddresses(
      supabase,
      aliases
    );
    if (fetchErr) {
      return { statusCode: 500, payload: { success: false, error: fetchErr } };
    }

    const shouldBeDefault = Boolean(body?.isDefault ?? body?.is_default) || existingAddresses.length === 0;
    const nowIso = new Date().toISOString();

    if (shouldBeDefault && existingAddresses.length > 0) {
      const { error: clearErr } = await updateAddressesForUserIds(supabase, aliases, {
        is_default: false,
        updated_at: nowIso,
      });

      if (clearErr) {
        return { statusCode: 500, payload: { success: false, error: clearErr.message } };
      }
    }

    const newId =
      typeof body?.id === 'string' && isUuid(body.id)
        ? body.id.trim()
        : crypto.randomUUID();

    const insertRow = {
      id: newId,
      user_id: canonicalUserId,
      address_label: addressLabel,
      recipient_name: recipientName,
      recipient_phone: recipientPhone,
      address_line1: addressLine1,
      address_line2: addressLine2 || null,
      landmark: landmark || null,
      city,
      state,
      pincode,
      is_default: shouldBeDefault,
      created_at: nowIso,
      updated_at: nowIso,
    };

    const { data: inserted, error: insertErr } = await supabase
      .from('addresses')
      .insert(insertRow)
      .select()
      .single();

    if (insertErr) {
      return { statusCode: 500, payload: { success: false, error: insertErr.message } };
    }

    const { addresses: refreshed, error: refreshErr } = await fetchSortedCustomerAddresses(
      supabase,
      aliases
    );
    if (refreshErr) {
      return { statusCode: 500, payload: { success: false, error: refreshErr } };
    }

    return {
      statusCode: 201,
      payload: {
        success: true,
        address: inserted ? mapAddressRow(inserted) : refreshed.find((a) => a.id === newId),
        addresses: refreshed,
      },
    };
  }

  // 3. PUT — Update existing address OR set single default address
  if (method === 'PUT') {
    const targetId = String(body?.id || body?.addressId || query?.id || '').trim();
    if (!targetId) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'Address id is required for update.' },
      };
    }

    const { data: existingRow, error: lookupErr } = await supabase
      .from('addresses')
      .select('*')
      .eq('id', targetId)
      .limit(1);

    if (lookupErr) {
      return { statusCode: 500, payload: { success: false, error: lookupErr.message } };
    }
    if (!existingRow || existingRow.length === 0) {
      return { statusCode: 404, payload: { success: false, error: 'Address not found.' } };
    }

    const currentRow = existingRow[0];

    // Strict IDOR / Ownership verification
    if (customerSession && !aliases.includes(String(currentRow.user_id))) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: You cannot modify another customer’s delivery address.',
        },
      };
    }

    // If shopkeeper didn't pass phone/userId on PUT, scope refresh aliases to the row owner
    if (isShopkeeper && aliases.length === 0) {
      const ownerId = String(currentRow.user_id);
      if (isUuid(ownerId)) {
        const { data: ownerUser } = await supabase
          .from('users')
          .select('*')
          .eq('id', ownerId)
          .limit(1);
        if (ownerUser && ownerUser.length > 0 && ownerUser[0].phone) {
          const identity = await resolveCustomerIdentity(supabase, ownerUser[0].phone, ownerId);
          aliases = identity.aliases;
          canonicalUserId = identity.canonicalUserId;
          resolvedUserFullName =
            identity.userFullName || cleanText(ownerUser[0].full_name ?? ownerUser[0].name);
          resolvedUserPhone = normalizeIndianMobile(ownerUser[0].phone);
        } else {
          aliases = [ownerId];
          canonicalUserId = ownerId;
        }
      } else {
        aliases = [ownerId];
        canonicalUserId = ownerId;
      }
    }

    const nowIso = new Date().toISOString();

    // Case A: Atomic Set Default Address (clear other active defaults first to respect addresses_one_default_idx)
    if (body?.action === 'set_default' || body?.setDefaultOnly === true) {
      const { error: clearErr } = await updateAddressesForUserIds(
        supabase,
        aliases,
        {
          is_default: false,
          updated_at: nowIso,
        },
        targetId
      );

      if (clearErr) {
        return { statusCode: 500, payload: { success: false, error: clearErr.message } };
      }

      const { data: updatedRow, error: setErr } = await supabase
        .from('addresses')
        .update({ is_default: true, updated_at: nowIso })
        .eq('id', targetId)
        .select()
        .single();

      if (setErr) {
        return { statusCode: 500, payload: { success: false, error: setErr.message } };
      }

      const { addresses: refreshed, error: refreshErr } = await fetchSortedCustomerAddresses(
        supabase,
        aliases
      );
      if (refreshErr) {
        return { statusCode: 500, payload: { success: false, error: refreshErr } };
      }

      return {
        statusCode: 200,
        payload: {
          success: true,
          address: updatedRow ? mapAddressRow(updatedRow) : refreshed.find((a) => a.id === targetId),
          addresses: refreshed,
        },
      };
    }

    // Case B: Update address details (reusing existing valid DB columns when omitted)
    const parsedExisting = mapAddressRow(currentRow);

    const incomingLabelRaw =
      body?.addressLabel !== undefined
        ? body.addressLabel
        : body?.address_label !== undefined
        ? body.address_label
        : body?.label;
    if (incomingLabelRaw !== undefined && !isValidProvidedLabel(incomingLabelRaw)) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: 'Address label must be one of HOME, SHOP, OFFICE, or OTHER.',
        },
      };
    }

    const nextLabel =
      incomingLabelRaw !== undefined
        ? normalizeAddressLabel(incomingLabelRaw)
        : parsedExisting.addressLabel;

    const rawRecipientName =
      body?.recipientName !== undefined ? body.recipientName : body?.recipient_name;
    const nextRecipientName =
      rawRecipientName !== undefined
        ? cleanText(rawRecipientName)
        : parsedExisting.recipientName || resolvedUserFullName;

    if (!nextRecipientName) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'Recipient name cannot be empty.' },
      };
    }

    const rawRecipientPhone =
      body?.recipientPhone !== undefined ? body.recipientPhone : body?.recipient_phone;
    const nextRecipientPhone =
      rawRecipientPhone !== undefined
        ? normalizeIndianMobile(rawRecipientPhone)
        : parsedExisting.recipientPhone || resolvedUserPhone;

    if (!nextRecipientPhone || !INDIAN_MOBILE_REGEX.test(nextRecipientPhone)) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          code: 'INVALID_MOBILE',
          error: INVALID_INDIAN_MOBILE_MESSAGE,
        },
      };
    }

    const rawLine1 =
      body?.addressLine1 !== undefined
        ? body.addressLine1
        : body?.address_line1 !== undefined
        ? body.address_line1
        : body?.fullAddress !== undefined
        ? body.fullAddress
        : body?.full_address;
    const nextAddressLine1 =
      rawLine1 !== undefined ? cleanText(rawLine1) : parsedExisting.addressLine1;

    if (!nextAddressLine1) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'Address line 1 cannot be empty.' },
      };
    }

    const rawLine2 =
      body?.addressLine2 !== undefined ? body.addressLine2 : body?.address_line2;
    const nextAddressLine2 =
      rawLine2 !== undefined ? cleanText(rawLine2) : parsedExisting.addressLine2;

    const nextLandmark =
      body?.landmark !== undefined ? cleanText(body.landmark) : parsedExisting.landmark;

    const nextCity =
      body?.city !== undefined ? cleanText(body.city) : parsedExisting.city;

    if (!nextCity) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'City is required and cannot be empty.' },
      };
    }

    const nextState =
      body?.state !== undefined ? cleanText(body.state) : parsedExisting.state;

    if (!nextState) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'State is required and cannot be empty.' },
      };
    }

    const nextPincode =
      body?.pincode !== undefined ? cleanText(body.pincode) : parsedExisting.pincode;

    if (!nextPincode || !/^\d{6}$/.test(nextPincode)) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'Please enter a valid 6-digit pincode.' },
      };
    }

    const { addresses: existingAll, error: existingFetchErr } = await fetchSortedCustomerAddresses(
      supabase,
      aliases
    );
    if (existingFetchErr) {
      return { statusCode: 500, payload: { success: false, error: existingFetchErr } };
    }

    const rawIsDefault =
      body?.isDefault !== undefined ? body.isDefault : body?.is_default;
    let nextIsDefault =
      rawIsDefault !== undefined ? Boolean(rawIsDefault) : Boolean(currentRow.is_default);

    if (existingAll.length <= 1) {
      nextIsDefault = true;
    }

    // Clear other active defaults BEFORE setting this row as default to avoid violating addresses_one_default_idx
    if (nextIsDefault) {
      const { error: clearErr } = await updateAddressesForUserIds(
        supabase,
        aliases,
        { is_default: false, updated_at: nowIso },
        targetId
      );

      if (clearErr) {
        return { statusCode: 500, payload: { success: false, error: clearErr.message } };
      }
    }

    const updateFields = {
      address_label: nextLabel,
      recipient_name: nextRecipientName,
      recipient_phone: nextRecipientPhone,
      address_line1: nextAddressLine1,
      address_line2: nextAddressLine2 || null,
      landmark: nextLandmark || null,
      city: nextCity,
      state: nextState,
      pincode: nextPincode,
      is_default: nextIsDefault,
      updated_at: nowIso,
    };

    const { data: updatedRow, error: updateErr } = await supabase
      .from('addresses')
      .update(updateFields)
      .eq('id', targetId)
      .select()
      .single();

    if (updateErr) {
      return { statusCode: 500, payload: { success: false, error: updateErr.message } };
    }

    // If unsetting default on the current default row when other addresses exist,
    // promote a replacement AFTER unsetting targetId so addresses_one_default_idx is never violated.
    if (!nextIsDefault && Boolean(currentRow.is_default)) {
      const { addresses: afterUpdate, error: afterErr } = await fetchSortedCustomerAddresses(
        supabase,
        aliases
      );
      if (afterErr) {
        return { statusCode: 500, payload: { success: false, error: afterErr } };
      }
      if (afterUpdate.length > 0 && !afterUpdate.some((a) => a.isDefault)) {
        const replacement = afterUpdate.find((a) => a.id !== targetId) || afterUpdate[0];
        const { error: promoteErr } = await supabase
          .from('addresses')
          .update({ is_default: true, updated_at: nowIso })
          .eq('id', replacement.id);
        if (promoteErr) {
          return { statusCode: 500, payload: { success: false, error: promoteErr.message } };
        }
      }
    }

    const { addresses: refreshed, error: refreshErr } = await fetchSortedCustomerAddresses(
      supabase,
      aliases
    );
    if (refreshErr) {
      return { statusCode: 500, payload: { success: false, error: refreshErr } };
    }

    return {
      statusCode: 200,
      payload: {
        success: true,
        address: updatedRow ? mapAddressRow(updatedRow) : refreshed.find((a) => a.id === targetId),
        addresses: refreshed,
      },
    };
  }

  // 4. DELETE — Delete an address & re-assign default if needed
  if (method === 'DELETE') {
    const targetId = String(query?.id || body?.id || body?.addressId || '').trim();
    if (!targetId) {
      return {
        statusCode: 400,
        payload: { success: false, error: 'Address id is required for deletion.' },
      };
    }

    const { data: existingRow, error: lookupErr } = await supabase
      .from('addresses')
      .select('*')
      .eq('id', targetId)
      .limit(1);

    if (lookupErr) {
      return { statusCode: 500, payload: { success: false, error: lookupErr.message } };
    }
    if (!existingRow || existingRow.length === 0) {
      return { statusCode: 404, payload: { success: false, error: 'Address not found.' } };
    }

    const currentRow = existingRow[0];

    // Strict IDOR / Ownership verification
    if (customerSession && !aliases.includes(String(currentRow.user_id))) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: You cannot delete another customer’s delivery address.',
        },
      };
    }

    if (isShopkeeper && aliases.length === 0) {
      const ownerId = String(currentRow.user_id);
      if (isUuid(ownerId)) {
        const { data: ownerUser } = await supabase
          .from('users')
          .select('id, phone')
          .eq('id', ownerId)
          .limit(1);
        if (ownerUser && ownerUser.length > 0 && ownerUser[0].phone) {
          const identity = await resolveCustomerIdentity(supabase, ownerUser[0].phone, ownerId);
          aliases = identity.aliases;
          canonicalUserId = identity.canonicalUserId;
        } else {
          aliases = [ownerId];
          canonicalUserId = ownerId;
        }
      } else {
        aliases = [ownerId];
        canonicalUserId = ownerId;
      }
    }

    // Perform primary delete; rely on Master SQL promote_default_address_after_delete trigger
    const { data: deletedRows, error: deleteErr } = await supabase
      .from('addresses')
      .delete()
      .eq('id', targetId)
      .select('id');

    if (deleteErr) {
      const statusCode = deleteErr.code === '23503' ? 409 : 500;
      return {
        statusCode,
        payload: {
          success: false,
          error: deleteErr.message || 'Failed to delete delivery address.',
        },
      };
    }

    if (!deletedRows || deletedRows.length === 0) {
      return {
        statusCode: 404,
        payload: {
          success: false,
          error: 'Address not found or could not be deleted.',
        },
      };
    }

    let { addresses: refreshed, error: refreshErr } = await fetchSortedCustomerAddresses(
      supabase,
      aliases
    );
    if (refreshErr) {
      return { statusCode: 500, payload: { success: false, error: refreshErr } };
    }

    // Defensive fallback if DB trigger promote_default_address_after_delete did not promote a replacement
    if (currentRow.is_default && refreshed.length > 0 && !refreshed.some((a) => a.isDefault)) {
      const { error: promoteErr } = await supabase
        .from('addresses')
        .update({ is_default: true, updated_at: new Date().toISOString() })
        .eq('id', refreshed[0].id);
      if (!promoteErr) {
        const reSorted = await fetchSortedCustomerAddresses(supabase, aliases);
        if (!reSorted.error) {
          refreshed = reSorted.addresses;
        }
      }
    }

    return {
      statusCode: 200,
      payload: {
        success: true,
        deletedId: targetId,
        addresses: refreshed,
      },
    };
  }

  return { statusCode: 405, payload: { success: false, error: 'Method Not Allowed' } };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const method = req.method?.toUpperCase() || 'GET';
  const adminSession = verifyAdminSession(req);
  const customerSession = verifyCustomerSession(req);

  if (!adminSession && !customerSession) {
    return sendJson(res, 401, {
      success: false,
      error: 'Unauthorized: Verified customer or shopkeeper session required.',
    });
  }

  const supabase = getSupabaseServiceClient();
  if (!supabase) {
    return sendJson(res, 503, {
      success: false,
      error: 'Database service unavailable: SUPABASE_SERVICE_ROLE_KEY is not configured on the server.',
    });
  }

  const url = new URL(req.url || '/api/addresses', `http://${req.headers.host || 'localhost'}`);
  const query = {
    id: url.searchParams.get('id'),
    userId: url.searchParams.get('userId'),
    phone: url.searchParams.get('phone'),
  };

  let body: any = {};
  if (method === 'POST' || method === 'PUT' || method === 'DELETE') {
    try {
      body = await parseJsonBody(req);
    } catch (err: any) {
      return sendJson(res, 400, { success: false, error: err?.message || 'Invalid JSON body' });
    }
  }

  const result = await processAddressesRequest(
    supabase,
    { adminSession, customerSession },
    method,
    query,
    body
  );
  return sendJson(res, result.statusCode, result.payload);
}
