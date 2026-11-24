import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Order, OrderItem, Address, Role, OrderStatus, PaymentMethod, PaymentStatus, UnitType, Product, ProductVariant, TieredPrice, SystemSetting, WalletTransaction, ProductRequest, Category, GoogleLocation, formatFullAddress, normalizeAddressLabel } from '../types';
import { INITIAL_SETTINGS } from '../data/seedData';
import {
  saveProductWithCascadeSync,
  deleteProductWithCascade,
} from './product-service';

// Retrieve credentials from Vite environment variables (with safe fallback for server/testing)
const supabaseUrl =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && (process.env?.VITE_SUPABASE_URL || process.env?.SUPABASE_URL)) ||
  '';
const supabaseAnonKey =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && (process.env?.VITE_SUPABASE_ANON_KEY || process.env?.SUPABASE_ANON_KEY)) ||
  '';

export const isSupabaseConfigured = Boolean(
  supabaseUrl &&
  supabaseAnonKey &&
  supabaseUrl !== 'https://your-project.supabase.co' &&
  supabaseAnonKey !== 'your-anon-key'
);

let supabaseInstance: SupabaseClient | null = null;

if (isSupabaseConfigured) {
  try {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  } catch (err) {
    console.error('Failed to initialize Supabase client:', err);
  }
}

export const supabase = supabaseInstance;

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



function parseCustomerAddress(rawAddress?: unknown): {
  id?: string;
  addressLabel?: string;
  recipientName?: string;
  recipientPhone?: string;
  addressLine1?: string;
  addressLine2?: string;
  fullAddress: string;
  landmark: string;
  city?: string;
  state?: string;
  pincode: string;
  googleLocation?: GoogleLocation;
} {
  const fromObject = (obj: Record<string, any>) => {
    const addressLine1 = String(obj.address_line1 ?? obj.addressLine1 ?? '').trim();
    const addressLine2 = String(obj.address_line2 ?? obj.addressLine2 ?? '').trim();
    const landmark = String(obj.landmark ?? '').trim();
    const city = String(obj.city ?? '').trim();
    const state = String(obj.state ?? '').trim();
    const pincode = obj.pincode !== undefined && obj.pincode !== null ? String(obj.pincode).trim() : '';
    const rawFull = String(obj.full_address ?? obj.fullAddress ?? obj.address ?? '').trim();
    const addressLabel =
      obj.address_label || obj.label ? normalizeAddressLabel(obj.address_label ?? obj.label) : undefined;
    const recipientName = String(obj.recipient_name ?? obj.recipientName ?? '').trim() || undefined;
    const recipientPhone = String(obj.recipient_phone ?? obj.recipientPhone ?? '').trim() || undefined;
    const rawGoogle = obj.google_location ?? obj.googleLocation;
    const googleLocation: GoogleLocation | undefined =
      rawGoogle && typeof rawGoogle === 'object' && typeof rawGoogle.latitude === 'number'
        ? rawGoogle
        : undefined;

    const derivedFull =
      formatFullAddress({
        addressLine1,
        addressLine2,
        landmark,
        city,
        state,
        pincode,
        fullAddress: rawFull,
      }) || rawFull;

    return {
      ...(obj.id ? { id: String(obj.id) } : {}),
      ...(addressLabel ? { addressLabel } : {}),
      ...(recipientName ? { recipientName } : {}),
      ...(recipientPhone ? { recipientPhone } : {}),
      ...(addressLine1 ? { addressLine1 } : {}),
      ...(addressLine2 ? { addressLine2 } : {}),
      fullAddress: derivedFull,
      landmark,
      ...(city ? { city } : {}),
      ...(state ? { state } : {}),
      pincode,
      ...(googleLocation ? { googleLocation } : {}),
    };
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
      // Ignore JSON parse error, treat as raw string
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

/**
 * Safely fetches the customer's persistent wallet balance calculated authoritatively
 * via the authenticated server endpoint (/api/auth/customer-wallet).
 */
export async function getCustomerWalletBalanceFromLedger(
  customerId?: string,
  phone?: string,
  options?: { skipLocalFallback?: boolean }
): Promise<number> {
  const cleanPhone = normalizeIndianMobile(phone) || (phone ? phone.replace(/\D/g, '').slice(-10) : '');

  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const res = await fetch('/api/auth/customer-wallet', {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      });
      if (res.ok) {
        const json = await res.json().catch(() => null);
        if (json?.success && typeof json.balance === 'number') {
          return json.balance;
        }
      }
    } catch (err) {
      console.warn('Error querying /api/auth/customer-wallet for wallet balance:', err);
    }
  }

  if (options?.skipLocalFallback) {
    return 0;
  }

  // Fallback to localStorage cache only when offline / API unavailable
  if (typeof localStorage !== 'undefined') {
    try {
      const txStr = localStorage.getItem('om_wallet_transactions');
      if (txStr) {
        const txList = JSON.parse(txStr);
        if (Array.isArray(txList)) {
          const match = txList.find(
            (t: any) =>
              (cleanPhone && t.userPhone && t.userPhone.replace(/\D/g, '').slice(-10) === cleanPhone) ||
              (customerId && t.userId === customerId)
          );
          if (match && typeof match.balanceAfter === 'number') {
            return Number(match.balanceAfter);
          }
        }
      }
    } catch {}

    if (cleanPhone) {
      try {
        const cached = localStorage.getItem(`om_profile_${cleanPhone}`);
        if (cached) {
          const parsed = JSON.parse(cached);
          if (typeof parsed.walletBalance === 'number' && parsed.walletBalance >= 0) {
            return parsed.walletBalance;
          }
        }
      } catch {}
    }
  }

  return 0;
}

/**
 * Fetches all persistent wallet transactions via authenticated server endpoint (/api/auth/customer-wallet).
 */
export async function fetchWalletTransactionsFromSupabase(
  _customerId?: string,
  _phone?: string
): Promise<WalletTransaction[] | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;

  try {
    const res = await fetch('/api/auth/customer-wallet', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json?.success || !Array.isArray(json.transactions)) return null;
    return json.transactions as WalletTransaction[];
  } catch (err) {
    console.warn('Error fetching wallet transactions from /api/auth/customer-wallet:', err);
    return null;
  }
}

/**
 * Fetches both authoritative wallet balance and wallet transaction history via /api/auth/customer-wallet.
 * Never falls back to localStorage cache when querying live database.
 */
export async function fetchCustomerWalletSummaryFromSupabase(
  _customerId?: string,
  _phone?: string
): Promise<{ balance: number; transactions: WalletTransaction[] } | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;

  try {
    const res = await fetch('/api/auth/customer-wallet', {
      method: 'GET',
      credentials: 'include',
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (
      !json?.success ||
      typeof json.balance !== 'number' ||
      !Array.isArray(json.transactions)
    ) {
      return null;
    }
    return {
      balance: json.balance,
      transactions: json.transactions as WalletTransaction[],
    };
  } catch (err) {
    console.warn('Error fetching customer wallet summary from /api/auth/customer-wallet:', err);
    return null;
  }
}

/**
 * Deterministically resolves or creates a customer via the server-side /api/auth/customer-login endpoint.
 */
export async function getOrCreateCustomerByPhone(
  phone: string,
  role: Role = Role.CUSTOMER,
  name?: string
): Promise<User | null> {
  if (role !== Role.CUSTOMER) return null;

  const cleanPhone = normalizeIndianMobile(phone);
  if (!INDIAN_MOBILE_REGEX.test(cleanPhone)) return null;

  const res = await loginCustomerServerSession(cleanPhone, { name });
  if (!res.authenticated || !res.user) return null;

  return {
    id: res.user.id || res.customerId || `user-${cleanPhone}`,
    name: res.user.name || name || '',
    phone: res.user.phone || cleanPhone,
    role: (res.user.role as Role) || Role.CUSTOMER,
    walletBalance: Number(res.user.walletBalance || 0),
    outstandingBalance: Number(res.user.outstandingBalance || 0),
    codOrderCount: Number(res.user.codOrderCount || 0),
    addresses: Array.isArray(res.user.addresses) ? res.user.addresses : [],
    createdAt: res.user.createdAt || new Date().toISOString(),
    isDatabaseVerified: true,
  };
}

/**
 * Saves or updates an authenticated customer profile via PUT /api/auth/customer-profile.
 */
export async function saveCustomerProfileToSupabase(
  _userId: string,
  phone: string,
  name: string,
  fullAddress: string,
  landmark: string = '',
  pincode: string = '',
  newPhone?: string
): Promise<User | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  const cleanPhone = normalizeIndianMobile(phone);
  if (!INDIAN_MOBILE_REGEX.test(cleanPhone)) return null;

  try {
    const res = await fetch('/api/auth/customer-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        name: name.trim(),
        fullAddress: fullAddress.trim(),
        landmark: landmark.trim(),
        pincode: pincode.trim(),
        ...(typeof newPhone === 'string' && newPhone.trim() ? { newPhone: newPhone.trim() } : {}),
      }),
    });

    const json = await res.json().catch(() => null);
    if (res.status === 409 || json?.code === 'DUPLICATE_CUSTOMER') {
      throw Object.assign(new Error(json?.error || DUPLICATE_CUSTOMER_MESSAGE), {
        code: 'DUPLICATE_CUSTOMER',
      });
    }
    if (!res.ok || !json?.success || !json.user) {
      console.warn('Error saving customer profile via /api/auth/customer-profile:', json?.error || res.status);
      return null;
    }

    return json.user as User;
  } catch (err: any) {
    if (err?.code === 'DUPLICATE_CUSTOMER') {
      throw err;
    }
    console.error('Error saving customer profile via /api/auth/customer-profile:', err);
    return null;
  }
}

export async function updateCustomerPhoneInSupabase(
  _userId: string,
  newPhone: string
): Promise<{
  success: boolean;
  code?: string;
  error?: string;
  phone?: string;
  phoneNormalized?: string;
}> {
  const cleanPhone = normalizeIndianMobile(newPhone);
  const phoneNormalized = normalizeIndianMobileE164(newPhone);
  if (!INDIAN_MOBILE_REGEX.test(cleanPhone) || !phoneNormalized) {
    return {
      success: false,
      code: 'INVALID_PHONE',
      error: INVALID_INDIAN_MOBILE_MESSAGE,
    };
  }

  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return { success: false, code: 'NO_NETWORK', error: 'Network unavailable.' };
  }

  try {
    const res = await fetch('/api/auth/customer-profile', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        action: 'update_phone',
        newPhone: cleanPhone,
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      return {
        success: false,
        code: json?.code || 'UPDATE_FAILED',
        error: json?.error || 'Failed to update customer mobile number.',
      };
    }

    return {
      success: true,
      phone: json.phone || cleanPhone,
      phoneNormalized: json.phoneNormalized || phoneNormalized,
    };
  } catch (err: any) {
    return {
      success: false,
      code: 'UPDATE_FAILED',
      error: err?.message || 'Failed to update customer mobile number.',
    };
  }
}

export async function loginCustomerServerSession(
  phone: string,
  options?: {
    name?: string;
    isExisting?: boolean;
    isNewRegistration?: boolean;
    mode?: 'NEW' | 'EXISTING';
    customerId?: string;
  }
): Promise<{
  authenticated: boolean;
  customerId?: string;
  phone?: string;
  user?: Partial<User> | null;
  error?: string;
  code?: string;
  redirectToLogin?: boolean;
  status?: number;
}> {
  try {
    const resp = await fetch('/api/auth/customer-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        phone,
        name: options?.name,
        isExisting: options?.isExisting,
        isNewRegistration: options?.isNewRegistration,
        mode: options?.mode,
        customerId: options?.customerId,
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      return {
        authenticated: false,
        error: data?.error || 'Customer authentication failed.',
        code: data?.code,
        redirectToLogin: Boolean(data?.redirectToLogin),
        phone: data?.phone,
        status: resp.status,
      };
    }
    return {
      authenticated: Boolean(data?.authenticated),
      customerId: data?.customerId,
      phone: data?.phone,
      user: data?.user || null,
      status: resp.status,
    };
  } catch (err: any) {
    return {
      authenticated: false,
      error: err?.message || 'Network error while establishing customer session.',
    };
  }
}

export async function logoutCustomerServerSession(): Promise<void> {
  try {
    await fetch('/api/auth/customer-logout', {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // ignore network errors
  }
}

export async function checkCustomerServerSession(): Promise<{
  authenticated: boolean;
  customerId?: string;
  phone?: string;
}> {
  try {
    const resp = await fetch('/api/auth/customer-me', {
      method: 'GET',
      credentials: 'include',
    });
    if (!resp.ok) return { authenticated: false };
    const data = await resp.json().catch(() => ({}));
    return {
      authenticated: Boolean(data?.authenticated),
      customerId: data?.customerId,
      phone: data?.phone,
    };
  } catch {
    return { authenticated: false };
  }
}

/**
 * Fetches all delivery addresses belonging to the authenticated customer from Supabase public.addresses via /api/addresses.
 */
export async function fetchAddressesFromSupabase(): Promise<{
  success: boolean;
  addresses: Address[];
  error?: string;
  status?: number;
}> {
  try {
    const resp = await fetch('/api/addresses', {
      method: 'GET',
      credentials: 'include',
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      return {
        success: false,
        addresses: [],
        error: data?.error || 'Failed to load delivery addresses from database.',
        status: resp.status,
      };
    }
    return {
      success: true,
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
      status: resp.status,
    };
  } catch (err: any) {
    return {
      success: false,
      addresses: [],
      error: err?.message || 'Network error loading delivery addresses.',
    };
  }
}

export async function createAddressInSupabase(
  address: Omit<Address, 'id' | 'userId'>
): Promise<{
  success: boolean;
  address?: Address;
  addresses: Address[];
  error?: string;
}> {
  try {
    const resolvedLabel = normalizeAddressLabel(address.addressLabel ?? address.label);
    const resp = await fetch('/api/addresses', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        addressLabel: resolvedLabel,
        label: resolvedLabel,
        recipientName: address.recipientName?.trim() || '',
        recipientPhone: address.recipientPhone?.trim() || '',
        addressLine1: (address.addressLine1 ?? address.fullAddress ?? '').trim(),
        addressLine2: address.addressLine2?.trim() || '',
        landmark: address.landmark?.trim() || '',
        city: address.city?.trim() || '',
        state: address.state?.trim() || '',
        pincode: address.pincode?.trim() || '',
        isDefault: Boolean(address.isDefault),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      return {
        success: false,
        addresses: [],
        error: data?.error || 'Failed to save delivery address.',
      };
    }
    return {
      success: true,
      address: data.address,
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
    };
  } catch (err: any) {
    return {
      success: false,
      addresses: [],
      error: err?.message || 'Network error saving delivery address.',
    };
  }
}

export async function updateAddressInSupabase(
  id: string,
  updates: Partial<Address>
): Promise<{
  success: boolean;
  address?: Address;
  addresses: Address[];
  error?: string;
}> {
  try {
    const resolvedLabel =
      updates.addressLabel !== undefined || updates.label !== undefined
        ? normalizeAddressLabel(updates.addressLabel ?? updates.label)
        : undefined;

    const resp = await fetch('/api/addresses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id,
        ...(resolvedLabel !== undefined ? { addressLabel: resolvedLabel, label: resolvedLabel } : {}),
        ...(updates.recipientName !== undefined ? { recipientName: updates.recipientName } : {}),
        ...(updates.recipientPhone !== undefined ? { recipientPhone: updates.recipientPhone } : {}),
        ...(updates.addressLine1 !== undefined ? { addressLine1: updates.addressLine1 } : {}),
        ...(updates.addressLine2 !== undefined ? { addressLine2: updates.addressLine2 } : {}),
        ...(updates.landmark !== undefined ? { landmark: updates.landmark } : {}),
        ...(updates.city !== undefined ? { city: updates.city } : {}),
        ...(updates.state !== undefined ? { state: updates.state } : {}),
        ...(updates.pincode !== undefined ? { pincode: updates.pincode } : {}),
        ...(updates.isDefault !== undefined ? { isDefault: updates.isDefault } : {}),
      }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      return {
        success: false,
        addresses: [],
        error: data?.error || 'Failed to update delivery address.',
      };
    }
    return {
      success: true,
      address: data.address,
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
    };
  } catch (err: any) {
    return {
      success: false,
      addresses: [],
      error: err?.message || 'Network error updating delivery address.',
    };
  }
}

export async function deleteAddressInSupabase(id: string): Promise<{
  success: boolean;
  addresses: Address[];
  error?: string;
}> {
  try {
    const resp = await fetch(`/api/addresses?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      return {
        success: false,
        addresses: [],
        error: data?.error || 'Failed to delete delivery address.',
      };
    }
    return {
      success: true,
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
    };
  } catch (err: any) {
    return {
      success: false,
      addresses: [],
      error: err?.message || 'Network error deleting delivery address.',
    };
  }
}

export async function setDefaultAddressInSupabase(id: string): Promise<{
  success: boolean;
  address?: Address;
  addresses: Address[];
  error?: string;
}> {
  try {
    const resp = await fetch('/api/addresses', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ id, action: 'set_default' }),
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.success) {
      return {
        success: false,
        addresses: [],
        error: data?.error || 'Failed to update default delivery address.',
      };
    }
    return {
      success: true,
      address: data.address,
      addresses: Array.isArray(data.addresses) ? data.addresses : [],
    };
  } catch (err: any) {
    return {
      success: false,
      addresses: [],
      error: err?.message || 'Network error updating default delivery address.',
    };
  }
}

/**
 * Inserts a newly added delivery address row via the authenticated /api/addresses endpoint.
 */
export async function saveAddressToSupabase(address: Address): Promise<boolean> {
  const line1 = (address.addressLine1 ?? address.fullAddress ?? '').trim();
  if (!line1) return false;
  const resolvedLabel = normalizeAddressLabel(address.addressLabel ?? address.label);
  const res = await createAddressInSupabase({
    label: resolvedLabel,
    addressLabel: resolvedLabel,
    recipientName: address.recipientName?.trim() || '',
    recipientPhone: address.recipientPhone?.trim() || '',
    addressLine1: line1,
    addressLine2: address.addressLine2?.trim() || '',
    fullAddress: address.fullAddress?.trim() || line1,
    landmark: address.landmark?.trim() || '',
    city: address.city?.trim() || '',
    state: address.state?.trim() || '',
    pincode: address.pincode?.trim() || '',
    isDefault: Boolean(address.isDefault),
  });
  return res.success;
}

/**
 * Fetch authenticated customer profile (Name, Address, Wallet, Balances) via /api/auth/customer-profile.
 */
export async function fetchCustomerProfileFromSupabase(
  phone: string,
  options?: { includeLedger?: boolean }
): Promise<User | null> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return null;
  const cleanPhone = normalizeIndianMobile(phone);
  if (!INDIAN_MOBILE_REGEX.test(cleanPhone)) return null;

  try {
    const includeLedger = options?.includeLedger !== false;
    const res = await fetch(
      `/api/auth/customer-profile?includeLedger=${includeLedger ? 'true' : 'false'}`,
      {
        method: 'GET',
        credentials: 'include',
        cache: 'no-store',
      }
    );

    if (!res.ok) return null;
    const json = await res.json().catch(() => null);
    if (!json?.success || !json.user) return null;

    return json.user as User;
  } catch (err) {
    console.warn('Error fetching customer profile from /api/auth/customer-profile:', err);
    return null;
  }
}

/**
 * Serializes order line items into the human-readable "Product Name" text format
 * stored in the live Supabase orders table.
 * Example output: "1. Aashirvaad Sharbati Select Whole Wheat Atta (1 KG) (Aashirvaad) - 1 Qty @ ₹60 = ₹60"
 */
export function serializeOrderItemsToProductName(items: OrderItem[]): string {
  if (!items || items.length === 0) return '';
  return items
    .map((item, idx) => {
      const parts: string[] = [];
      const prodName = (item.productName || 'Grocery Item').trim();
      parts.push(prodName);

      if (item.variantName && !prodName.includes(item.variantName)) {
        parts.push(`(${item.variantName.trim()})`);
      }
      if (item.brand && !prodName.includes(item.brand)) {
        parts.push(`(${item.brand.trim()})`);
      }

      const label = parts.join(' ');
      const qty = item.quantity || 1;
      const unitPrice = item.unitPrice || 0;
      const lineTotal = item.price || unitPrice * qty;

      return `${idx + 1}. ${label} - ${qty} Qty @ ₹${unitPrice} = ₹${lineTotal}`;
    })
    .join('\n');
}

/**
 * Parses the newline-separated "Product Name" column from the live orders table
 * back into typed OrderItem structures.
 */
export function parseOrderItemsFromProductName(
  rawText: string | null | undefined,
  orderId: string,
  fallbackTotal: number = 0
): OrderItem[] {
  if (!rawText || typeof rawText !== 'string' || !rawText.trim()) {
    return [
      {
        id: `item-${orderId}-1`,
        orderId,
        variantId: '',
        productName: 'Grocery Items',
        quantity: 1,
        unitPrice: fallbackTotal,
        price: fallbackTotal,
      },
    ];
  }

  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  if (lines.length === 0) {
    return [
      {
        id: `item-${orderId}-1`,
        orderId,
        variantId: '',
        productName: 'Grocery Items',
        quantity: 1,
        unitPrice: fallbackTotal,
        price: fallbackTotal,
      },
    ];
  }

  const items: OrderItem[] = [];

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx];
    const pattern = /^(?:\d+\.\s*)?(.+?)\s*-\s*(\d+(?:\.\d+)?)\s*Qty(?:\s*@\s*₹?\s*(\d+(?:\.\d+)?))?(?:\s*=\s*₹?\s*(\d+(?:\.\d+)?))?/i;
    const match = line.match(pattern);

    if (match) {
      const rawLabel = match[1].trim();
      const qty = parseFloat(match[2]) || 1;
      const parsedUnitPrice = match[3] ? parseFloat(match[3]) : undefined;
      const parsedTotalPrice = match[4] ? parseFloat(match[4]) : undefined;

      const unitPrice =
        parsedUnitPrice !== undefined
          ? parsedUnitPrice
          : parsedTotalPrice !== undefined
          ? Math.round(parsedTotalPrice / qty)
          : Math.round(fallbackTotal / lines.length);

      const totalPrice =
        parsedTotalPrice !== undefined
          ? parsedTotalPrice
          : unitPrice * qty;

      // Extract parenthesized information: e.g. "Red Lable Tea (100 G) (UNILIVER)"
      const parenMatches = [...rawLabel.matchAll(/\(([^)]+)\)/g)].map((m) => m[1].trim());
      const cleanName = rawLabel.replace(/\s*\([^)]+\)/g, '').trim();

      const unitRegex = /^(\d+(?:\.\d+)?)\s*(KG|G|GM|ML|LITER|LITRE|LTR|NOS|PCS|PACK|POUCH)\b/i;
      let variantName = '';
      let packSize: number | undefined = undefined;
      let unit: UnitType | undefined = undefined;
      let brand = '';

      for (const p of parenMatches) {
        const uMatch = p.match(unitRegex);
        if (uMatch) {
          variantName = p;
          packSize = parseFloat(uMatch[1]);
          let rawUnit = uMatch[2].toUpperCase();
          if (rawUnit === 'GM') rawUnit = 'G';
          if (rawUnit === 'LITRE' || rawUnit === 'LTR') rawUnit = 'LITER';
          unit = rawUnit as UnitType;
        } else if (!brand) {
          brand = p;
        }
      }

      items.push({
        id: `item-${orderId}-${idx + 1}`,
        orderId,
        productId: '',
        variantId: '',
        productName: cleanName || rawLabel,
        variantName: variantName || undefined,
        brand: brand || undefined,
        unit,
        packSize,
        quantity: qty,
        unitPrice,
        price: totalPrice,
      });
    } else {
      const cleaned = line.replace(/^\d+\.\s*/, '').trim();
      const unitPrice = idx === 0 ? fallbackTotal : 0;
      items.push({
        id: `item-${orderId}-${idx + 1}`,
        orderId,
        productId: '',
        variantId: '',
        productName: cleaned || 'Grocery Item',
        quantity: 1,
        unitPrice,
        price: unitPrice,
      });
    }
  }

  return items.length > 0
    ? items
    : [
        {
          id: `item-${orderId}-1`,
          orderId,
          variantId: '',
          productName: rawText.trim(),
          quantity: 1,
          unitPrice: fallbackTotal,
          price: fallbackTotal,
        },
      ];
}

/**
 * Maps raw database orders rows (including "Product Name" serialization and COD_META JSON)
 * into typed application Order structures.
 */
export function mapDatabaseRowToOrder(o: any, fallbackCustomerId?: string, fallbackPhone?: string): Order {
  const finalAmount = Number(o.final_total ?? o.subtotal ?? 0);
  const subtotal = Number(o.subtotal ?? finalAmount);
  const discountAmount = Number(o.discount_amount ?? 0);

  // Prefer relational order_items returned by /api/orders when present
  let items: OrderItem[] =
    Array.isArray(o.items) && o.items.length > 0
      ? o.items.map((it: any, idx: number) => ({
          id: it.id || `item-${o.id}-${idx + 1}`,
          orderId: it.orderId || o.id,
          productId: it.productId || it.product_id || undefined,
          variantId: it.variantId ?? it.product_variant_id ?? null,
          productName: it.productName || it.product_name || 'Grocery Item',
          variantName: it.variantName || it.variant_name || undefined,
          brand: it.brand || undefined,
          unit: it.unit || undefined,
          packSize: it.packSize !== undefined ? Number(it.packSize) : (it.pack_size !== undefined ? Number(it.pack_size) : undefined),
          quantity: Math.max(1, Number(it.quantity) || 1),
          unitPrice: Number(it.unitPrice ?? it.unit_price ?? 0),
          price: Number(it.price ?? it.total_price ?? 0),
          isDiscountExcluded: Boolean(it.isDiscountExcluded ?? it.is_discount_excluded),
        }))
      : parseOrderItemsFromProductName(o['Product Name'], o.id, finalAmount);

  const parsedAddress = parseCustomerAddress(o.delivery_address);

  let orderNumber = o.order_number ? String(o.order_number).trim() : '';
  let codCollectedAmount = 0;
  let previousOutstanding = 0;
  let totalPayable = finalAmount;
  let previousOnlinePaid = 0;
  let walletAmountUsed = 0;
  let codCharge = Number(o.cod_charge ?? 0) || 0;
  let deliveredAt: string | undefined = o.delivered_at || undefined;
  let codLateFeeApplied = Boolean(o.cod_late_fee_applied);
  let codLateFeeAmount = 0;
  let codLateFeeAppliedAt: string | undefined = o.cod_late_fee_applied_at || undefined;
  let stockDeducted = false;
  let stockRestored = false;

  const rawNotes = o.notes || '';
  if (rawNotes.includes('COD_META:')) {
    const parts = rawNotes.split('COD_META:');
    if (!orderNumber) {
      orderNumber = parts[0].replace(/\|/g, '').replace(/^Order\s*#?/i, '').trim();
    }
    try {
      const meta = JSON.parse(parts[1].trim());
      codCollectedAmount = Number(meta.codCollected) || 0;
      previousOutstanding = Number(meta.prevOutstanding) || 0;
      totalPayable = meta.totalPayable !== undefined ? Number(meta.totalPayable) : finalAmount;
      walletAmountUsed = Number(meta.walletAmountUsed) || 0;
      previousOnlinePaid = Number(meta.previousOnlinePaid) || 0;
      if (meta.codCharge !== undefined && !isNaN(Number(meta.codCharge))) {
        codCharge = Number(meta.codCharge);
      }
      if (meta.deliveredAt) {
        deliveredAt = String(meta.deliveredAt);
      }
      if (meta.codLateFeeApplied !== undefined) {
        codLateFeeApplied = Boolean(meta.codLateFeeApplied);
      }
      if (meta.codLateFeeAmount !== undefined && !isNaN(Number(meta.codLateFeeAmount))) {
        codLateFeeAmount = Number(meta.codLateFeeAmount);
      }
      if (meta.codLateFeeAppliedAt) {
        codLateFeeAppliedAt = String(meta.codLateFeeAppliedAt);
      }
      stockDeducted = Boolean(meta.stockDeducted);
      stockRestored = Boolean(meta.stockRestored);
      if ((!Array.isArray(o.items) || o.items.length === 0) && Array.isArray(meta.items) && meta.items.length > 0) {
        items = meta.items;
      }
    } catch {
      // ignore parsing error
    }
  } else if (!orderNumber) {
    orderNumber = rawNotes.replace(/^Order\s*#?/i, '').trim() || o.id.replace(/^ord[-_]/i, '').slice(0, 8);
  }
  if (!orderNumber) {
    orderNumber = o.id.replace(/^ord[-_]/i, '').slice(0, 8);
  }

  if (o.is_paid && codCollectedAmount === 0) {
    codCollectedAmount = finalAmount;
  }

  // Respect explicit database payment_status (REFUNDED, FAILED, PARTIALLY_COLLECTED, RECEIVED, PENDING)
  let paymentStatus: PaymentStatus = PaymentStatus.PENDING;
  const dbPaymentStatus = String(o.payment_status || '').toUpperCase();
  if (dbPaymentStatus === 'REFUNDED') {
    paymentStatus = PaymentStatus.REFUNDED;
  } else if (dbPaymentStatus === 'FAILED') {
    paymentStatus = PaymentStatus.FAILED;
  } else if (dbPaymentStatus === 'RECEIVED' || dbPaymentStatus === 'PAID' || o.is_paid || (totalPayable > 0 && codCollectedAmount >= totalPayable)) {
    paymentStatus = PaymentStatus.RECEIVED;
  } else if (dbPaymentStatus === 'PARTIALLY_COLLECTED' || codCollectedAmount > 0) {
    paymentStatus = PaymentStatus.PARTIALLY_COLLECTED;
  }

  const resolvedWalletAmountUsed = walletAmountUsed;

  const deliveryFee = Math.max(0, finalAmount - (subtotal + codCharge - discountAmount));

  return {
    id: o.id,
    orderNumber: orderNumber || `OM-${o.id.slice(0, 5)}`,
    userId: o.customer_id || fallbackCustomerId || '',
    userName: o.customer_name || 'Customer',
    userPhone: o.customer_phone || fallbackPhone || '',
    addressId: o.address_id || parsedAddress.id || ('addr-' + o.id),
    address: {
      id: o.address_id || parsedAddress.id || ('addr-' + o.id),
      userId: o.customer_id || fallbackCustomerId || '',
      ...(parsedAddress.addressLabel
        ? { label: parsedAddress.addressLabel, addressLabel: parsedAddress.addressLabel }
        : {}),
      ...(parsedAddress.recipientName ? { recipientName: parsedAddress.recipientName } : {}),
      ...(parsedAddress.recipientPhone ? { recipientPhone: parsedAddress.recipientPhone } : {}),
      ...(parsedAddress.addressLine1 ? { addressLine1: parsedAddress.addressLine1 } : {}),
      ...(parsedAddress.addressLine2 ? { addressLine2: parsedAddress.addressLine2 } : {}),
      fullAddress:
        parsedAddress.fullAddress ||
        (typeof o.delivery_address === 'string' ? o.delivery_address.trim() : '') ||
        'Address not specified',
      landmark: parsedAddress.landmark || '',
      ...(parsedAddress.city ? { city: parsedAddress.city } : {}),
      ...(parsedAddress.state ? { state: parsedAddress.state } : {}),
      pincode: parsedAddress.pincode || '',
      isDefault: true,
      ...(parsedAddress.googleLocation ? { googleLocation: parsedAddress.googleLocation } : {}),
    },
    ...(parsedAddress.googleLocation ? { googleLocation: parsedAddress.googleLocation } : {}),
    status: (o.status as OrderStatus) || OrderStatus.ORDER_PENDING,
    paymentMethod: (o.payment_method as PaymentMethod) || PaymentMethod.COD,
    paymentStatus,
    deliveryDate: o.preferred_slot || (o.created_at ? o.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
    subtotal,
    discountAmount,
    deliveryFee,
    codCharge,
    finalAmount,
    previousOutstanding,
    totalPayable: (o.payment_method === PaymentMethod.COD || o.payment_method === 'COD') ? finalAmount : totalPayable,
    previousOnlinePaid,
    walletAmountUsed: resolvedWalletAmountUsed,
    codCollectedAmount,
    deliveredAt,
    codLateFeeApplied,
    codLateFeeAmount,
    codLateFeeAppliedAt,
    stockDeducted,
    stockRestored,
    createdAt: o.created_at || new Date().toISOString(),
    ...(o.updated_at ? { updatedAt: String(o.updated_at) } : {}),
    items,
  };
}

/**
 * Fetch all orders for a customer across any browser using phone number.
 * Strictly uses verified server endpoint (/api/orders?phone=...) to ensure customer data isolation under RLS.
 */
export async function fetchCustomerOrdersFromSupabase(
  customerId: string,
  phone: string
): Promise<Order[] | null> {
  const cleanPhone = phone.trim().replace(/^\+91/, '').replace(/\D/g, '').slice(-10);
  if (cleanPhone.length !== 10) return null;

  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const res = await fetch(`/api/orders?phone=${encodeURIComponent(cleanPhone)}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.orders)) {
          return json.orders.map((o: any) => mapDatabaseRowToOrder(o, customerId, cleanPhone));
        }
      }
      return null;
    } catch (err) {
      console.warn('Error fetching customer orders via /api/orders:', err);
      return null;
    }
  }

  return null;
}
export interface SaveOrderResult {
  success: boolean;
  deduplicated?: boolean;
  order?: {
    id: string;
    orderNumber: string;
    customerPhone?: string;
    status?: string;
    paymentStatus?: string;
    isPaid?: boolean;
    createdAt?: string;
    previousOutstanding?: number;
    subtotal?: number;
    deliveryFee?: number;
    codCharge?: number;
    discountAmount?: number;
    finalAmount: number;
    walletAmountUsed?: number;
    remainingWalletBalance?: number;
    totalPayable?: number;
    paymentMethod?: string;
    items?: any[];
  };
  error?: string;
}

/**
 * Saves a new order centrally to Supabase via the authoritative /api/orders server endpoint.
 * Returns authoritative server-verified order data or error message.
 * Never performs direct unverified browser inserts.
 */
export async function saveOrderToSupabase(order: Order): Promise<SaveOrderResult> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return { success: false, error: 'Network service is unavailable in this environment' };
  }

  try {
    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        orderId: order.id,
        orderNumber: order.orderNumber,
        customerId: order.userId,
        customerName: order.userName,
        customerPhone: order.userPhone,
        shopName: order.userName,
        paymentMethod: order.paymentMethod,
        addressId: order.addressId,
        address: order.address,
        googleLocation: order.googleLocation || order.address?.googleLocation,
        deliveryDate: order.deliveryDate,
        previousOutstanding: order.previousOutstanding,
        useWallet: (order.walletAmountUsed || 0) > 0,
        items: order.items,
        weightKg: (order as any).weightKg || null,
        razorpayOrderId: order.razorpayOrderId || null,
        razorpayPaymentId: order.razorpayPaymentId || null,
      }),
    });

    let json: any = null;
    try {
      json = await res.json();
    } catch {
      return {
        success: false,
        error: `Server returned an invalid response (HTTP ${res.status})`,
      };
    }

    if (!res.ok || !json?.success) {
      return {
        success: false,
        error: json?.error || `Order creation failed with server status ${res.status}`,
      };
    }

    return {
      success: true,
      deduplicated: Boolean(json.deduplicated),
      order: json.order,
    };
  } catch (err: any) {
    console.error('Exception in saveOrderToSupabase:', err);
    return {
      success: false,
      error: err?.message || 'Network error while placing order. Please check your connection.',
    };
  }
}

/**
 * Updates an edited order centrally in Supabase.
 * Preserves the existing order ID, number, status, customer, address, payment method and timestamps,
 * while updating items, subtotal, discount, final_total, and COD_META.
 */
/**
 * Updates an edited order centrally via the authoritative /api/orders server endpoint.
 * Note: PUT /api/orders requires a verified Shopkeeper session cookie.
 */
export async function saveEditedOrderToSupabase(order: Order): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;

  try {
    const metaPayload = JSON.stringify({
      codCollected: order.codCollectedAmount || 0,
      codCharge: order.codCharge || 0,
      ...(order.deliveredAt ? { deliveredAt: order.deliveredAt } : {}),
      ...(order.codLateFeeApplied ? {
        codLateFeeApplied: true,
        codLateFeeAmount: Number(order.codLateFeeAmount) || 0,
        codLateFeeAppliedAt: order.codLateFeeAppliedAt,
      } : {}),
      prevOutstanding: order.previousOutstanding || 0,
      totalPayable: order.paymentMethod === PaymentMethod.COD ? order.finalAmount : (order.totalPayable !== undefined ? order.totalPayable : order.finalAmount),
      walletAmountUsed: order.walletAmountUsed || 0,
      previousOnlinePaid: order.previousOnlinePaid || 0,
      stockDeducted: order.stockDeducted ?? false,
      stockRestored: order.stockRestored ?? false,
      items: order.items?.map((it) => ({
        id: it.id,
        orderId: it.orderId || order.id,
        productId: it.productId,
        variantId: it.variantId ?? null,
        variantName: it.variantName,
        productName: it.productName,
        brand: it.brand,
        unit: it.unit,
        packSize: it.packSize,
        quantity: it.quantity,
        unitPrice: it.unitPrice,
        price: it.price,
        isDiscountExcluded: it.isDiscountExcluded,
      })),
    });
    const orderNotes = `Order #${order.orderNumber} | COD_META:${metaPayload}`;

    const res = await fetch('/api/orders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: order.id,
        orderId: order.id,
        status: order.status,
        paymentStatus: order.paymentStatus,
        isPaid: order.paymentStatus === PaymentStatus.RECEIVED,
        subtotal: order.subtotal,
        discountAmount: order.discountAmount,
        finalAmount: order.finalAmount,
        productNameSerialized: serializeOrderItemsToProductName(order.items),
        notes: orderNotes,
        items: order.items,
      }),
    });

    if (!res.ok) {
      console.warn('saveEditedOrderToSupabase rejected by server API:', res.status);
      return false;
    }

    const json = await res.json().catch(() => null);
    return Boolean(json?.success);
  } catch (err) {
    console.error('Exception in saveEditedOrderToSupabase:', err);
    return false;
  }
}

/**
 * Fetch all orders for the Shopkeeper admin view.
 * Strictly routes through verified admin endpoint /api/orders?all=true.
 */
export async function fetchAllOrdersForAdmin(): Promise<Order[] | null> {
  if (typeof window !== 'undefined' && typeof fetch === 'function') {
    try {
      const res = await fetch('/api/orders?all=true', { credentials: 'include' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.orders)) {
          return json.orders.map((o: any) => mapDatabaseRowToOrder(o));
        }
      }
      return null;
    } catch (err) {
      console.warn('Error fetching admin orders via /api/orders:', err);
      return null;
    }
  }

  return null;
}

export interface UpdateOrderStatusResult {
  success: boolean;
  statusCode?: number;
  stockDeducted?: boolean;
  order?: Order;
  error?: string;
}

/**
 * Updates order status atomically via verified /api/orders PUT endpoint (`transition_order_status_atomic`).
 */
export async function updateOrderStatusInSupabase(
  orderId: string,
  newStatus: OrderStatus,
  isPaid?: boolean,
  meta?: {
    codCollected?: number;
    codCharge?: number;
    deliveredAt?: string;
    codLateFeeApplied?: boolean;
    codLateFeeAmount?: number;
    codLateFeeAppliedAt?: string;
    prevOutstanding?: number;
    totalPayable?: number;
    orderNumber?: string;
    walletAmountUsed?: number;
    stockDeducted?: boolean;
    stockRestored?: boolean;
    deductStockOnAccept?: boolean;
    expectedUpdatedAt?: string;
    items?: OrderItem[];
    paymentStatus?: PaymentStatus | string;
    refundAmount?: number;
    refundDescription?: string;
    customerId?: string;
    customerPhone?: string;
    customerName?: string;
  }
): Promise<UpdateOrderStatusResult> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return { success: false, error: 'Browser network environment is unavailable.' };
  }

  try {
    const payload: Record<string, any> = {
      id: orderId,
      orderId,
      status: newStatus,
    };

    if (typeof isPaid === 'boolean') {
      payload.isPaid = isPaid;
    }
    if (meta?.paymentStatus) {
      payload.paymentStatus = meta.paymentStatus;
    }
    if (meta?.deliveredAt) {
      payload.deliveredAt = meta.deliveredAt;
    }
    if (meta?.deductStockOnAccept) {
      payload.deductStockOnAccept = true;
    }
    if (meta?.expectedUpdatedAt) {
      payload.expectedUpdatedAt = meta.expectedUpdatedAt;
    }

    if (meta) {
      const orderNum = meta.orderNumber || orderId.slice(0, 8);
      const metaString = JSON.stringify({
        codCollected: meta.codCollected || 0,
        ...(meta.codCharge !== undefined ? { codCharge: meta.codCharge } : {}),
        ...(meta.deliveredAt ? { deliveredAt: meta.deliveredAt } : {}),
        ...(meta.codLateFeeApplied ? {
          codLateFeeApplied: true,
          codLateFeeAmount: Number(meta.codLateFeeAmount) || 0,
          codLateFeeAppliedAt: meta.codLateFeeAppliedAt,
        } : {}),
        prevOutstanding: meta.prevOutstanding || 0,
        totalPayable: meta.totalPayable || 0,
        walletAmountUsed: meta.walletAmountUsed || 0,
        stockDeducted: meta.stockDeducted ?? false,
        stockRestored: meta.stockRestored ?? false,
        ...(meta.items && meta.items.length > 0 ? { items: meta.items } : {}),
      });
      payload.notes = `Order #${orderNum} | COD_META:${metaString}`;

      if (meta.refundAmount && meta.refundAmount > 0) {
        payload.refundAmount = meta.refundAmount;
        payload.refundDescription = meta.refundDescription;
        payload.customerId = meta.customerId;
        payload.customerPhone = meta.customerPhone;
        payload.customerName = meta.customerName;
      }
    }

    const res = await fetch('/api/orders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      console.warn('updateOrderStatusInSupabase rejected by /api/orders:', res.status, json?.error);
      return {
        success: false,
        statusCode: res.status,
        error: json?.error || `Failed to update order status (${res.status}).`,
      };
    }

    return {
      success: true,
      statusCode: res.status,
      stockDeducted: Boolean(json.stockDeducted),
      order: json.order ? mapDatabaseRowToOrder(json.order) : undefined,
    };
  } catch (err: any) {
    console.error('Exception in updateOrderStatusInSupabase:', err);
    return {
      success: false,
      error: err?.message || 'Network error while updating order status.',
    };
  }
}

export interface CancelOrderApiResult {
  success: boolean;
  statusCode?: number;
  alreadyCancelled?: boolean;
  deduplicated?: boolean;
  stockRestored?: boolean;
  order?: Order;
  refund?: {
    amount: number;
    creditedNow: number;
    walletUsed: number;
    onlinePaid: number;
    codPaid: number;
    refunded: boolean;
    newWalletBalance: number;
    ledgerTransactionId: string | null;
    description: string | null;
  };
  error?: string;
}

/**
 * Cancels an order through the authoritative integrated server workflow (/api/orders PUT).
 * Never sends client-computed stockRestored or refundAmount flags; relies exclusively on DB truth.
 */
export async function cancelOrderInSupabase(orderId: string): Promise<CancelOrderApiResult> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return { success: false, error: 'Browser network environment is unavailable.' };
  }

  try {
    const res = await fetch('/api/orders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        id: orderId,
        orderId,
        status: OrderStatus.CANCELLED,
      }),
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success) {
      return {
        success: false,
        statusCode: res.status,
        error: json?.error || `Cancellation request failed (${res.status}).`,
      };
    }

    const mappedOrder = json.order ? mapDatabaseRowToOrder(json.order) : undefined;
    return {
      success: true,
      statusCode: res.status,
      alreadyCancelled: Boolean(json.alreadyCancelled),
      deduplicated: Boolean(json.deduplicated),
      stockRestored: Boolean(json.stockRestored),
      order: mappedOrder,
      refund: json.refund,
    };
  } catch (err: any) {
    console.error('Exception in cancelOrderInSupabase:', err);
    return {
      success: false,
      error: err?.message || 'Network error while cancelling order.',
    };
  }
}

/**
 * Updates product stock securely via the verified /api/products PUT endpoint.
 */
export async function updateProductStockInSupabase(
  productId: string,
  _variants: ProductVariant[],
  fullProduct?: Product
): Promise<boolean> {
  if (!fullProduct || typeof window === 'undefined' || typeof fetch !== 'function') {
    return false;
  }

  try {
    const res = await fetch('/api/products', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify(fullProduct),
    });

    if (!res.ok) {
      console.warn('updateProductStockInSupabase rejected by /api/products:', res.status);
      return false;
    }
    const json = await res.json().catch(() => null);
    return Boolean(json?.success);
  } catch (err) {
    console.error('Exception in updateProductStockInSupabase:', err);
    return false;
  }
}

/**
 * COD collection ledger/balance updates are handled server-side via /api/cod-collections.
 */
export async function recordCodCollectionInSupabase(_tx: {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  amount: number;
  remainingOutstanding: number;
  createdAt: string;
}): Promise<boolean> {
  return false;
}

/**
 * Wallet credit/refund ledger entries are handled server-side via /api/orders.
 */
export async function creditCustomerWalletInSupabase(_tx: {
  userId?: string;
  customerPhone: string;
  customerName?: string;
  orderId?: string;
  orderNumber?: string;
  amount: number;
  newWalletBalance: number;
  description: string;
}): Promise<boolean> {
  return false;
}

/**
 * Wallet debit ledger entries are handled server-side via /api/orders.
 */
export async function debitCustomerWalletInSupabase(_tx: {
  userId?: string;
  customerPhone: string;
  customerName?: string;
  orderId?: string;
  orderNumber?: string;
  amount: number;
  newWalletBalance: number;
  description: string;
}): Promise<boolean> {
  return false;
}

export interface SaveProductResult {
  success: boolean;
  error?: string;
  product?: Product;
}

/**
 * Permanently saves a Product with all its variants and tiered wholesale prices to Supabase.
 * Uses atomic/upsert operations and handles rollbacks if variants fail.
 */
export async function saveProductToSupabase(product: Product): Promise<SaveProductResult> {
  if (!supabase) {
    return { success: false, error: 'Supabase is not configured or initialized.' };
  }
  return saveProductWithCascadeSync(supabase, product);
}

/**
 * Loads all products with variants and wholesale slabs via the server /api/products endpoint.
 */
export async function fetchProductsFromSupabase(): Promise<Product[] | null> {
  try {
    const res = await fetch(`/api/products?_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      credentials: 'include',
      cache: 'no-store',
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    if (data && data.success && Array.isArray(data.products)) {
      return data.products as Product[];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Deletes a product and its cascading variants/tiered prices from Supabase.
 */
export async function deleteProductFromSupabase(productId: string): Promise<boolean> {
  if (!supabase) return false;
  const res = await deleteProductWithCascade(supabase, productId);
  return res.success;
}

/**
 * Normalizes a Supabase store_settings database row into a frontend SystemSetting object.
 * Maps actual database columns (app_name, advance_discount_percentage, etc.)
 * and preserves requested default values: COD ₹0, Free Delivery above ₹249, Delivery Fee ₹11, Referral Credit ₹0.
 */
export function mapSupabaseRowToSettings(
  row: any,
  fallbackSettings?: SystemSetting
): SystemSetting {
  const base = fallbackSettings || INITIAL_SETTINGS;
  if (!row || typeof row !== 'object') {
    return {
      ...base,
      advancePaymentDiscountPct: 0.0,
    };
  }

  const rawDiscount = row.advance_discount_percentage;
  const resolvedDiscount =
    rawDiscount !== undefined && rawDiscount !== null && !isNaN(Number(rawDiscount))
      ? Math.max(0, Math.round(Number(rawDiscount) * 100) / 100)
      : 0.0;

  return {
    ...base,
    id: row.id || base.id || 'global_settings',
    appName:
      row.app_name !== undefined && row.app_name !== null && String(row.app_name).trim()
        ? String(row.app_name)
        : (row['app name'] || base.appName),
    logoUrl:
      row.logo_url !== undefined && row.logo_url !== null && String(row.logo_url).trim()
        ? String(row.logo_url)
        : (row['logo url'] || row.logoUrl || base.logoUrl || '/logo.jpg'),
    advancePaymentDiscountPct: resolvedDiscount,
    codBaseCharge:
      row.cod_base_charge !== undefined && !isNaN(Number(row.cod_base_charge))
        ? Number(row.cod_base_charge)
        : (base.codBaseCharge ?? 0.0),
    freeShippingMinAmount:
      row.free_shipping_min_amount !== undefined && !isNaN(Number(row.free_shipping_min_amount))
        ? Number(row.free_shipping_min_amount)
        : (base.freeShippingMinAmount ?? 249.0),
    baseDeliveryFee:
      row.base_delivery_fee !== undefined && !isNaN(Number(row.base_delivery_fee))
        ? Number(row.base_delivery_fee)
        : (base.baseDeliveryFee ?? 11.0),
    referralRewardAmount: 0.0,
    lowStockThreshold:
      row.low_stock_threshold !== undefined && !isNaN(Number(row.low_stock_threshold))
        ? Math.max(1, Number(row.low_stock_threshold))
        : (base.lowStockThreshold ?? 10),
    updatedAt: row.updated_at || row['updated at'] || base.updatedAt || new Date().toISOString(),
  };
}

/**
 * Loads the active store settings from the central Supabase store_settings table.
 * Returns null if Supabase is unavailable or table read fails.
 */
export async function fetchSettingsFromSupabase(
  fallbackSettings?: SystemSetting
): Promise<SystemSetting | null> {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from('store_settings')
      .select('*')
      .eq('id', 'global_settings')
      .maybeSingle();

    if (error) {
      console.warn('Notice reading store_settings from Supabase:', error.message);
      return null;
    }

    if (!data) {
      return null;
    }

    return mapSupabaseRowToSettings(data, fallbackSettings);
  } catch (err) {
    console.warn('Exception reading store_settings from Supabase:', err);
    return null;
  }
}

/**
 * Safely persists store settings to the shared Supabase store_settings table.
 * Attempts full column upsert first, and gracefully falls back to existing base columns
 * if pending column migration is not yet executed in Supabase.
 */
export async function saveSettingsToSupabase(
  settings: SystemSetting
): Promise<{ success: boolean; error?: string; columnMigrationPending?: boolean }> {
  if (!supabase) {
    return { success: false, error: 'Supabase client not configured.' };
  }

  const timestamp = settings.updatedAt || new Date().toISOString();

  // 1. Try full upsert with all extended columns
  try {
    const fullPayload: Record<string, any> = {
      id: settings.id || 'global_settings',
      app_name: settings.appName,
      advance_discount_percentage: settings.advancePaymentDiscountPct,
      logo_url: settings.logoUrl,
      cod_base_charge: settings.codBaseCharge,
      free_shipping_min_amount: settings.freeShippingMinAmount,
      base_delivery_fee: settings.baseDeliveryFee,
      updated_at: timestamp,
    };

    const { error: fullError } = await supabase
      .from('store_settings')
      .upsert(fullPayload, { onConflict: 'id' });

    if (!fullError) {
      return { success: true };
    }

    // Check if error is due to missing column (PostgreSQL 42703 or PostgREST PGRST204)
    if (
      fullError.code === '42703' ||
      fullError.code === 'PGRST204' ||
      String(fullError.message).includes('schema cache') ||
      String(fullError.message).includes('does not exist') ||
      String(fullError.message).includes('column')
    ) {
      console.warn('Pending SQL column migration on store_settings: falling back to base columns');

      // Fallback: update only base columns that currently exist
      const basePayload: Record<string, any> = {
        id: settings.id || 'global_settings',
        app_name: settings.appName,
        advance_discount_percentage: settings.advancePaymentDiscountPct,
        updated_at: timestamp,
      };

      const { error: baseError } = await supabase
        .from('store_settings')
        .upsert(basePayload, { onConflict: 'id' });

      if (baseError) {
        return { success: false, error: baseError.message };
      }

      return { success: true, columnMigrationPending: true };
    }

    return { success: false, error: fullError.message };
  } catch (err: any) {
    console.error('Exception writing store_settings to Supabase:', err);
    return { success: false, error: err?.message || 'Unexpected database error' };
  }
}

/**
 * Subscribes to Supabase postgres_changes on store_settings for real-time synchronization
 * across open browsers, installed PWAs, and AI Studio previews.
 */
export function subscribeToSupabaseSettings(
  onUpdate: (settings: SystemSetting) => void,
  fallbackSettings?: SystemSetting
): (() => void) | null {
  if (!supabase) return null;

  try {
    const channel = supabase
      .channel('realtime:store_settings')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'store_settings' },
        (payload) => {
          if (payload.new && typeof payload.new === 'object') {
            const mapped = mapSupabaseRowToSettings(payload.new, fallbackSettings);
            onUpdate(mapped);
          }
        }
      )
      .subscribe();

    return () => {
      supabase?.removeChannel(channel);
    };
  } catch (err) {
    console.warn('Failed to subscribe to Supabase store_settings realtime channel:', err);
    return null;
  }
}

/**
 * Persists an out-of-stock product request via the authenticated server endpoint (/api/product-requests POST).
 * Keeps service_role strictly on the server and never relies on direct browser anon inserts.
 */
export async function saveProductRequestToSupabase(req: ProductRequest): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;

  try {
    const cleanPhone = normalizeIndianMobile(req.customerPhone);
    if (!cleanPhone || cleanPhone.length < 10) return false;

    const requestId =
      req.id && req.id.trim()
        ? req.id.trim()
        : `preq-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const payload = {
      id: requestId,
      customerId: (req.customerId && req.customerId.trim()) || `usr_${cleanPhone}`,
      customerName: (req.customerName || req.customer?.name || 'Customer').trim(),
      customerPhone: cleanPhone,
      productId: (req.productId && req.productId.trim()) || req.product?.id || '',
      productName: (req.productName || req.product?.name || '').trim(),
      variantId: req.variantId ? String(req.variantId).trim() : null,
      variantName: req.variantName || req.product?.variantName || null,
      packSize: req.packSize || req.product?.packSize || null,
      quantity: Math.max(1, Math.floor(Number(req.quantity) || 1)),
      requestDate: req.requestDate || req.createdAt || new Date().toISOString(),
      createdAt: req.createdAt || new Date().toISOString(),
    };

    const res = await fetch('/api/product-requests', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'X-Requested-With': 'XMLHttpRequest',
      },
      credentials: 'include',
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => null);
      console.warn(
        'Notice saving product request via /api/product-requests:',
        errData?.error || `HTTP ${res.status}`
      );
      return false;
    }

    const json = await res.json().catch(() => null);
    return Boolean(json?.success);
  } catch (err: any) {
    console.warn('Exception saving product request via /api/product-requests:', err?.message || err);
    return false;
  }
}

export interface FetchProductRequestsResult {
  success: boolean;
  requests?: ProductRequest[];
  error?: string;
  status?: number;
}

function mapServerProductRequestRow(row: any): ProductRequest {
  return {
    id: String(row.id || ''),
    customer: {
      id: row.customer_id || row.user_id || '',
      name: row.customer_name || 'Customer',
      phone: row.customer_phone || '',
    },
    customerId: row.customer_id || row.user_id || '',
    customerName: row.customer_name || 'Customer',
    customerPhone: row.customer_phone || '',
    product: {
      id: row.product_id || '',
      name: row.product_name || '',
      variantId: row.variant_id || '',
      variantName: row.variant_name || row.variant_title || '',
      packSize: row.pack_size || '',
      price: row.price ? Number(row.price) : undefined,
    },
    productId: row.product_id || '',
    productName: row.product_name || '',
    variantId: row.variant_id || '',
    variantName: row.variant_name || row.variant_title || '',
    packSize: row.pack_size || '',
    quantity: Number(row.quantity) || 1,
    requestDate: row.request_date || row.created_at || new Date().toISOString(),
    createdAt: row.created_at || new Date().toISOString(),
  };
}

function sortProductRequestsDesc(list: ProductRequest[]): ProductRequest[] {
  return [...list].sort(
    (a, b) =>
      new Date(b.requestDate || b.createdAt).getTime() -
      new Date(a.requestDate || a.createdAt).getTime()
  );
}

/**
 * Reconciles product requests strictly from the authoritative /api/product-requests result.
 * - Never merges with stale localStorage entries.
 * - Synchronizes om_product_requests with the authoritative API response (clears it on []).
 * - Fails closed on API errors / Unauthorized without falling back to localStorage.
 */
export function resolveAuthoritativeProductRequestsState(
  result: FetchProductRequestsResult,
  storage?: Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> | null
): {
  requests: ProductRequest[];
  error: string | null;
  synchronized: boolean;
} {
  const targetStorage =
    storage !== undefined
      ? storage
      : typeof window !== 'undefined'
      ? window.localStorage
      : null;

  if (result.success && Array.isArray(result.requests)) {
    const authoritative = sortProductRequestsDesc(result.requests);
    try {
      if (targetStorage) {
        if (authoritative.length > 0) {
          targetStorage.setItem('om_product_requests', JSON.stringify(authoritative));
        } else {
          targetStorage.removeItem('om_product_requests');
        }
      }
    } catch {
      // ignore storage quota errors
    }
    return {
      requests: authoritative,
      error: null,
      synchronized: true,
    };
  }

  return {
    requests: [],
    error: result.error || 'Failed to load product requests from server.',
    synchronized: false,
  };
}

/**
 * Loads product requests strictly via the verified server endpoint (GET /api/product-requests).
 * Never reads Supabase directly from the browser and never falls back to localStorage on failure.
 */
export async function fetchProductRequestsFromApi(): Promise<FetchProductRequestsResult> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return {
      success: false,
      error: 'Browser network environment is unavailable.',
    };
  }

  try {
    const res = await fetch(`/api/product-requests?_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      credentials: 'include',
      cache: 'no-store',
    });

    const json = await res.json().catch(() => null);
    if (!res.ok || !json?.success || !Array.isArray(json.requests)) {
      return {
        success: false,
        status: res.status,
        error:
          json?.error ||
          (res.status === 401
            ? 'Unauthorized: Please sign in as Shopkeeper to view product requests.'
            : `Failed to load product requests from server (HTTP ${res.status}).`),
      };
    }

    const mapped = sortProductRequestsDesc(json.requests.map(mapServerProductRequestRow));
    return {
      success: true,
      status: res.status,
      requests: mapped,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Network error while loading product requests from server.',
    };
  }
}

/**
 * Loads recent product requests for the Shopkeeper management center.
 * Strictly queries the verified server API (/api/product-requests).
 * If the API is unauthorized, fails, or is unavailable, returns null safely without localStorage fallback.
 */
export async function fetchProductRequestsFromSupabase(): Promise<ProductRequest[] | null> {
  const result = await fetchProductRequestsFromApi();
  return result.success && Array.isArray(result.requests) ? result.requests : null;
}

/**
 * Subscribes to realtime product requests across devices and open browser sessions.
 * Guarantees a valid cleanup function is returned, never null.
 */
export function subscribeToProductRequests(
  _onNewRequest: (req: ProductRequest) => void
): () => void {
  // Safe no-op: product_requests are strictly restricted to verified SHOPKEEPER server-side API
  // and removed from public Realtime publication to eliminate anonymous eavesdropping.
  return () => {};
}

/**
 * Fetches all categories via the server /api/categories endpoint.
 */
export async function fetchCategoriesFromSupabase(): Promise<Category[] | null> {
  try {
    const res = await fetch(`/api/categories?_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      credentials: 'include',
      cache: 'no-store',
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    if (data && data.success && Array.isArray(data.categories)) {
      return data.categories as Category[];
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Saves or updates a Category via the server /api/categories endpoint.
 */
export async function saveCategoryToSupabase(
  category: Category
): Promise<{ success: boolean; error?: string; category?: Category }> {
  try {
    const cleanId = (category.id || `cat_${Date.now()}`).trim();
    const cleanName = (category.name || '').trim();
    if (!cleanName) {
      return { success: false, error: 'Category name is required.' };
    }

    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        id: cleanId,
        name: cleanName,
        imageUrl: category.imageUrl ? category.imageUrl.trim() : '',
        displayOrder: typeof category.displayOrder === 'number' ? category.displayOrder : 1,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      return {
        success: false,
        error: data?.error || `Failed to save category (HTTP ${res.status}).`,
      };
    }

    return {
      success: true,
      category: data.category || {
        id: cleanId,
        name: cleanName,
        imageUrl: category.imageUrl || '',
        displayOrder: category.displayOrder ?? 1,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Network error occurred while saving category.',
    };
  }
}

/**
 * Deletes a Category via the server /api/categories endpoint.
 */
export async function deleteCategoryFromSupabase(
  categoryId: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/categories?id=${encodeURIComponent(categoryId)}`, {
      method: 'DELETE',
      headers: {
        Accept: 'application/json',
      },
      credentials: 'include',
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      return {
        success: false,
        error: data?.error || `Failed to delete category (HTTP ${res.status}).`,
      };
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Network error occurred while deleting category.',
    };
  }
}

/**
 * Reorders categories via the server /api/categories endpoint.
 */
export async function reorderCategoriesInSupabase(
  categoryList: Category[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/categories', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        action: 'reorder',
        categories: categoryList,
      }),
    });

    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      return {
        success: false,
        error: data?.error || `Failed to reorder categories (HTTP ${res.status}).`,
      };
    }

    return { success: true };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Network error occurred while reordering categories.',
    };
  }
}

export interface FetchCustomersResult {
  success: boolean;
  customers?: User[];
  error?: string;
  status?: number;
}

/**
 * Loads all authorized customer directory records via GET /api/customers.
 * Requires a verified Shopkeeper HttpOnly session cookie.
 * Never silently falls back to localStorage or om_users on failure.
 */
export async function fetchCustomersFromApi(): Promise<FetchCustomersResult> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    return {
      success: false,
      error: 'Browser network environment is unavailable.',
    };
  }

  try {
    const res = await fetch(`/api/customers?_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      credentials: 'include',
      cache: 'no-store',
    });

    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !Array.isArray(data.customers)) {
      return {
        success: false,
        status: res.status,
        error:
          data?.error ||
          (res.status === 401
            ? 'Unauthorized: Please sign in as Shopkeeper to view customers.'
            : `Failed to fetch customers from server (HTTP ${res.status}).`),
      };
    }

    const mapped: User[] = data.customers.map((c: any) => ({
      id: String(c.id),
      name: String(c.name || '').trim() || 'Customer',
      phone: String(c.phone || '').trim(),
      role: Role.CUSTOMER,
      status: c.status ? String(c.status).trim().toUpperCase() : 'ACTIVE',
      walletBalance: Math.max(0, Number(c.walletBalance || 0)),
      outstandingBalance: Math.max(0, Number(c.outstandingBalance || 0)),
      codOrderCount: Math.max(0, Number(c.codOrderCount || 0)),
      addresses: Array.isArray(c.addresses) ? c.addresses : [],
      createdAt: String(c.createdAt || new Date().toISOString()),
      isDatabaseVerified: true,
    }));

    return {
      success: true,
      status: res.status,
      customers: mapped,
    };
  } catch (err: any) {
    return {
      success: false,
      error: err?.message || 'Network error while fetching customers from server.',
    };
  }
}



