import type { IncomingMessage, ServerResponse } from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;

const EXCLUDED_NON_CUSTOMER_ROLES = new Set([
  'SHOPKEEPER',
  'ADMIN',
  'SECONDARY_ADMIN',
  'ACCOUNTS',
  'SUPER_ADMIN',
]);

function normalizeIndianMobile(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const digits = String(raw).trim().replace(/\D/g, '');
  let candidate = '';
  if (digits.length === 10) {
    candidate = digits;
  } else if (digits.length === 12 && digits.startsWith('91')) {
    candidate = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    candidate = digits.slice(1);
  } else if (digits.length === 13 && digits.startsWith('091')) {
    candidate = digits.slice(3);
  } else if (digits.length === 14 && digits.startsWith('0091')) {
    candidate = digits.slice(4);
  }
  return INDIAN_MOBILE_REGEX.test(candidate) ? candidate : '';
}

function cleanText(val: unknown): string {
  return typeof val === 'string' ? val.trim() : '';
}

function normalizeAddressLabel(raw?: unknown): 'HOME' | 'SHOP' | 'OFFICE' | 'OTHER' {
  const upper = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (upper === 'HOME' || upper === 'SHOP' || upper === 'OFFICE' || upper === 'OTHER') {
    return upper;
  }
  return 'HOME';
}

function formatFullAddressFromComponents(addr: {
  addressLine1?: string;
  addressLine2?: string;
  landmark?: string;
  city?: string;
  state?: string;
  pincode?: string;
  fullAddress?: string;
}): string {
  const line1 = (addr.addressLine1 || '').trim();
  const line2 = (addr.addressLine2 || '').trim();
  const landmark = (addr.landmark || '').trim();
  const city = (addr.city || '').trim();
  const state = (addr.state || '').trim();
  const pincode = (addr.pincode || '').trim();

  if (!line1 && !line2 && !city && !state) {
    return (addr.fullAddress || '').trim();
  }

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

function parseServerCustomerAddress(rawAddress?: unknown): {
  fullAddress: string;
  landmark: string;
  pincode: string;
} {
  const fromObject = (obj: Record<string, any>) => {
    const landmark = String(obj.landmark ?? '').trim();
    const pincode =
      obj.pincode !== undefined && obj.pincode !== null ? String(obj.pincode).trim() : '';
    const fullAddress = String(
      obj.full_address ??
        obj.fullAddress ??
        obj.address ??
        obj.address_line1 ??
        obj.addressLine1 ??
        ''
    ).trim();
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
      // treat as raw text
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

function mapAddressRow(row: any, canonicalUserId: string) {
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
  const rawFullAddress = cleanText(row?.full_address);

  const fullAddress =
    formatFullAddressFromComponents({
      addressLine1,
      addressLine2,
      landmark,
      city,
      state,
      pincode,
      fullAddress: rawFullAddress,
    }) || rawFullAddress;

  return {
    id: String(row.id),
    userId: String(row.user_id || canonicalUserId),
    label: addressLabel,
    addressLabel,
    ...(recipientName ? { recipientName } : {}),
    ...(recipientPhone ? { recipientPhone } : {}),
    ...(addressLine1 ? { addressLine1 } : {}),
    ...(addressLine2 ? { addressLine2 } : {}),
    fullAddress,
    landmark,
    ...(city ? { city } : {}),
    ...(state ? { state } : {}),
    pincode,
    isDefault: Boolean(row.is_default),
    ...(row.google_location ? { googleLocation: row.google_location } : {}),
    ...(row.created_at ? { createdAt: String(row.created_at) } : {}),
    ...(row.updated_at ? { updatedAt: String(row.updated_at) } : {}),
  };
}

export function isAuthorizedCustomerDirectoryRow(row: any): boolean {
  if (!row || typeof row !== 'object') return false;
  if (String(row.id || '').trim() === 'user-shopkeeper') return false;

  const rawRole = row.role;
  if (rawRole === null || rawRole === undefined || String(rawRole).trim() === '') {
    return true;
  }

  const normalizedRole = String(rawRole).trim().toUpperCase();
  if (EXCLUDED_NON_CUSTOMER_ROLES.has(normalizedRole)) {
    return false;
  }

  return normalizedRole === 'CUSTOMER';
}

function getServerSupabaseClient(): SupabaseClient | null {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

  if (
    !url ||
    !key ||
    url === 'https://your-project.supabase.co' ||
    key === 'your-service-role-key' ||
    key === 'your-anon-key'
  ) {
    return null;
  }

  try {
    return createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  } catch {
    return null;
  }
}

export interface CustomersApiAuthContext {
  isAdmin: boolean;
  role?: string | null;
}

export interface CustomersApiResult {
  statusCode: number;
  payload: {
    success: boolean;
    customers?: any[];
    error?: string;
  };
}

export async function processCustomersRequest(
  supabase: SupabaseClient | null,
  auth: CustomersApiAuthContext
): Promise<CustomersApiResult> {
  if (!auth?.isAdmin || auth.role !== 'SHOPKEEPER') {
    return {
      statusCode: 401,
      payload: {
        success: false,
        error: 'Unauthorized: Shopkeeper session required.',
      },
    };
  }

  if (!supabase) {
    return {
      statusCode: 503,
      payload: {
        success: false,
        error: 'Database service is not configured or unavailable.',
      },
    };
  }

  try {
    const { data: userRows, error: usersError } = await supabase
      .from('users')
      .select('*')
      .order('created_at', { ascending: false });

    if (usersError) {
      return {
        statusCode: 500,
        payload: {
          success: false,
          error: usersError.message || 'Failed to query customer records.',
        },
      };
    }

    const customerRows = (userRows || []).filter(isAuthorizedCustomerDirectoryRow);

    if (customerRows.length === 0) {
      return {
        statusCode: 200,
        payload: {
          success: true,
          customers: [],
        },
      };
    }

    // Fetch saved addresses from public.addresses if available
    const addressesByAlias = new Map<string, any[]>();
    const { data: addressRows, error: addressesError } = await supabase
      .from('addresses')
      .select('*')
      .order('is_default', { ascending: false })
      .order('created_at', { ascending: true });

    if (!addressesError && Array.isArray(addressRows)) {
      for (const addrRow of addressRows) {
        const uid = String(addrRow?.user_id || '').trim();
        if (!uid) continue;
        const list = addressesByAlias.get(uid) || [];
        list.push(addrRow);
        addressesByAlias.set(uid, list);
      }
    }

    const customers = customerRows.map((row: any) => {
      const id = String(row.id);
      const cleanPhone = normalizeIndianMobile(row.phone || row.phone_normalized);
      const displayPhone = cleanPhone || String(row.phone || '').trim();

      const aliases = Array.from(
        new Set(
          [
            id,
            cleanPhone,
            cleanPhone ? `user-${cleanPhone}` : '',
            cleanPhone ? `usr_${cleanPhone}` : '',
          ].filter(Boolean)
        )
      );

      const matchedAddressMap = new Map<string, any>();
      for (const alias of aliases) {
        const rowsForAlias = addressesByAlias.get(alias) || [];
        for (const r of rowsForAlias) {
          const rId = String(r.id);
          if (!matchedAddressMap.has(rId)) {
            matchedAddressMap.set(rId, mapAddressRow(r, id));
          }
        }
      }

      let resolvedAddresses = Array.from(matchedAddressMap.values());
      if (resolvedAddresses.length === 0 && row.address) {
        const legacyAddr = parseServerCustomerAddress(row.address);
        if (legacyAddr.fullAddress) {
          resolvedAddresses = [
            {
              id: `addr-${id}`,
              userId: id,
              fullAddress: legacyAddr.fullAddress,
              landmark: legacyAddr.landmark,
              pincode: legacyAddr.pincode,
              isDefault: true,
            },
          ];
        }
      }

      const rawStatus =
        row.status !== undefined && row.status !== null && String(row.status).trim() !== ''
          ? String(row.status).trim().toUpperCase()
          : 'ACTIVE';

      return {
        id,
        name: String(row.full_name ?? row.name ?? '').trim() || 'Customer',
        phone: displayPhone,
        role: 'CUSTOMER',
        status: rawStatus,
        walletBalance: Math.max(0, Number(row.wallet_balance || 0)),
        outstandingBalance: Math.max(0, Number(row.outstanding_balance || 0)),
        codOrderCount: Math.max(0, Number(row.cod_order_count || 0)),
        addresses: resolvedAddresses,
        createdAt: String(row.created_at || row.updated_at || new Date().toISOString()),
        isDatabaseVerified: true,
      };
    });

    return {
      statusCode: 200,
      payload: {
        success: true,
        customers,
      },
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      payload: {
        success: false,
        error: err?.message || 'Internal server error while loading customers.',
      },
    };
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method !== 'GET') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET');
    res.end(
      JSON.stringify({
        success: false,
        error: `Method ${req.method} Not Allowed. Only GET is permitted.`,
      })
    );
    return;
  }

  const session = verifyAdminSession(req);
  const supabase = getServerSupabaseClient();
  const result = await processCustomersRequest(supabase, {
    isAdmin: Boolean(session),
    role: session?.role ?? null,
  });

  res.statusCode = result.statusCode;
  res.end(JSON.stringify(result.payload));
}
