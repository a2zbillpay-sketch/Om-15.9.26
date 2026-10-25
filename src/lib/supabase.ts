import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Order, OrderItem, Address, Role, OrderStatus, PaymentMethod, PaymentStatus, UnitType, Product, ProductVariant, TieredPrice, SystemSetting, WalletTransaction } from '../types';
import { INITIAL_CATEGORIES, INITIAL_SETTINGS } from '../data/seedData';
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

function parseCustomerAddress(rawAddress?: string | null): {
  fullAddress: string;
  landmark: string;
  pincode: string;
} {
  let savedAddressText = (rawAddress || '').trim();
  let savedLandmark = '';
  let savedPincode = '';

  if (!savedAddressText) {
    return { fullAddress: '', landmark: '', pincode: '' };
  }

  if (savedAddressText.startsWith('{') && savedAddressText.endsWith('}')) {
    try {
      const parsed = JSON.parse(savedAddressText);
      return {
        fullAddress: parsed.fullAddress || parsed.address || savedAddressText,
        landmark: parsed.landmark || '',
        pincode: parsed.pincode || '',
      };
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
 * Safely resolves all known identity aliases for a customer (canonical db ID, phone, synthetic user-ID)
 */
async function resolveCustomerIdentityAliases(
  customerId?: string,
  phone?: string
): Promise<{ canonicalId: string; allIds: string[]; cleanPhone: string }> {
  let cleanPhone = phone ? phone.replace(/\D/g, '').slice(-10) : '';
  if (!cleanPhone && customerId && customerId.startsWith('user-')) {
    const raw = customerId.slice(5).replace(/\D/g, '').slice(-10);
    if (raw.length === 10) cleanPhone = raw;
  }

  const targetIds = new Set<string>();
  if (customerId) targetIds.add(customerId);
  if (cleanPhone) {
    targetIds.add(cleanPhone);
    targetIds.add(`user-${cleanPhone}`);
  }

  let canonicalId = customerId && !customerId.startsWith('user-') ? customerId : '';

  if (supabase) {
    try {
      if (cleanPhone) {
        const { data: dbUsers } = await supabase
          .from('users')
          .select('id, phone')
          .eq('phone', cleanPhone)
          .limit(5);

        if (dbUsers && dbUsers.length > 0) {
          dbUsers.forEach((u) => {
            if (u.id) {
              targetIds.add(u.id);
              if (!canonicalId) canonicalId = u.id;
            }
          });
        }
      } else if (customerId && !cleanPhone) {
        const { data: userRow } = await supabase
          .from('users')
          .select('id, phone')
          .eq('id', customerId)
          .maybeSingle();

        if (userRow?.phone) {
          const userPhone = userRow.phone.replace(/\D/g, '').slice(-10);
          if (userPhone) {
            cleanPhone = userPhone;
            targetIds.add(userPhone);
            targetIds.add(`user-${userPhone}`);
          }
        }
      }
    } catch {}
  }

  if (!canonicalId) {
    canonicalId = customerId || (cleanPhone ? `usr_${cleanPhone}` : 'Customer');
  }

  return {
    canonicalId,
    allIds: Array.from(targetIds).filter(Boolean),
    cleanPhone,
  };
}

/**
 * Filter strictly for wallet transactions (excludes COD collections and order debts)
 */
function isWalletLedgerEntry(r: any): boolean {
  if (!r) return false;
  const desc = (r.description || '').toLowerCase();
  if (desc.includes('cod payment') || desc.includes('cod collection')) return false;
  if (r.id && (r.id.startsWith('cod_tx_') || r.id.startsWith('led_ord_'))) return false;

  if (r.type === 'DEBIT' && (desc.includes('wallet') || r.id?.startsWith('wtx_'))) return true;
  if (
    r.type === 'CREDIT' &&
    (desc.includes('refund') || desc.includes('wallet') || r.id?.startsWith('wtx_'))
  )
    return true;

  return false;
}

/**
 * Safely fetches the customer's persistent wallet balance calculated authoritatively
 * from Supabase's ledger table across all linked customer IDs.
 */
export async function getCustomerWalletBalanceFromLedger(
  customerId?: string,
  phone?: string
): Promise<number> {
  const { allIds, cleanPhone } = await resolveCustomerIdentityAliases(customerId, phone);
  if (allIds.length === 0) return 0;

  if (supabase) {
    try {
      const filters = allIds.map((id) => `customer_id.eq.${id}`);
      const { data: ledgerRows, error } = await supabase
        .from('ledger')
        .select('id, balance_after, date, type, amount, description')
        .or(filters.join(','))
        .order('date', { ascending: true }); // chronological order

      if (!error && ledgerRows && ledgerRows.length > 0) {
        const walletRows = ledgerRows.filter(isWalletLedgerEntry);

        if (walletRows.length > 0) {
          // Authoritative replay of all wallet transactions (credits - debits)
          let running = 0;
          for (const tx of walletRows) {
            const amt = Number(tx.amount) || 0;
            if (tx.type === 'CREDIT') {
              running += amt;
            } else if (tx.type === 'DEBIT') {
              running = Math.max(0, running - amt);
            }
          }
          return Math.round(running * 100) / 100;
        }
      }
    } catch (err) {
      console.warn('Error querying ledger for wallet balance:', err);
    }
  }

  // Fallback to localStorage cache only if offline or no Supabase ledger rows exist
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
 * Fetches all persistent wallet transactions from Supabase ledger for a customer across linked IDs.
 */
export async function fetchWalletTransactionsFromSupabase(
  customerId?: string,
  phone?: string
): Promise<WalletTransaction[] | null> {
  if (!supabase) return null;
  const { allIds, cleanPhone } = await resolveCustomerIdentityAliases(customerId, phone);
  if (allIds.length === 0) return null;

  try {
    const filters = allIds.map((id) => `customer_id.eq.${id}`);
    const { data: rows, error } = await supabase
      .from('ledger')
      .select('*')
      .or(filters.join(','))
      .order('date', { ascending: false });

    if (error || !rows) return null;

    const walletRows = rows.filter(isWalletLedgerEntry);

    return walletRows.map((r) => {
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
  } catch (err) {
    console.warn('Error fetching wallet transactions from Supabase:', err);
    return null;
  }
}

/**
 * Deterministically resolves or creates a customer by their phone number.
 * This guarantees that Chrome, Samsung Internet, Safari, Firefox, Edge, etc.
 * all resolve to the EXACT SAME customer account.
 */
export async function getOrCreateCustomerByPhone(
  phone: string,
  role: Role = Role.CUSTOMER,
  name?: string
): Promise<User | null> {
  if (!supabase) return null;

  const cleanPhone = phone.replace(/\D/g, '');

  try {
    // 1. Check if user with this phone and role exists in Supabase users table
    const { data: existingRows } = await supabase
      .from('users')
      .select('*')
      .eq('phone', cleanPhone)
      .eq('role', role)
      .order('updated_at', { ascending: false })
      .limit(1);

    const existingUser = existingRows && existingRows.length > 0 ? existingRows[0] : null;

    if (existingUser) {
      const { fullAddress, landmark, pincode } = parseCustomerAddress(existingUser.address);
      const formattedAddresses: Address[] = fullAddress
        ? [
            {
              id: `addr-${existingUser.id}`,
              userId: existingUser.id,
              fullAddress,
              landmark,
              pincode,
              isDefault: true,
            },
          ]
        : [];

      const dbOutstanding = Number(existingUser.outstanding_balance || 0);
      const ledgerCredits = await getCustomerWalletBalanceFromLedger(existingUser.id, cleanPhone);
      const dbCredits = Math.max(Number(existingUser.wallet_balance || 0), ledgerCredits);

      return {
        id: existingUser.id,
        name: existingUser.name || name || '',
        phone: existingUser.phone,
        role: (existingUser.role as Role) || role,
        referralCode: existingUser.referral_code || `OM${cleanPhone.slice(-4)}`,
        walletBalance: dbCredits,
        outstandingBalance: dbOutstanding,
        codOrderCount: Number(existingUser.cod_order_count || 0),
        addresses: formattedAddresses,
        createdAt: existingUser.updated_at || existingUser.created_at || new Date().toISOString(),
      };
    }

    // 2. User does not exist, create deterministic customer record in Supabase users table
    const referralCode = `OM${Math.floor(1000 + Math.random() * 9000)}`;
    const newCustomerPayload = {
      id: `usr_${Date.now()}_${Math.floor(100 + Math.random() * 900)}`,
      phone: cleanPhone,
      name: name || (role === Role.SHOPKEEPER ? 'Om Prakash Sharma' : ''),
      role,
      shop_name: name ? `${name}'s Kirana Store` : (role === Role.SHOPKEEPER ? 'Om Distributors' : ''),
      address: '',
      outstanding_balance: 0,
      wallet_balance: 0,
      updated_at: new Date().toISOString(),
    };

    const { data: insertedUser, error: insertError } = await supabase
      .from('users')
      .upsert(newCustomerPayload, { onConflict: 'id' })
      .select()
      .single();

    if (insertError) {
      // If error (such as duplicate key or unique constraint), safely fetch existing record
      const { data: fallbackUser } = await supabase
        .from('users')
        .select('*')
        .eq('phone', cleanPhone)
        .eq('role', role)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (fallbackUser && fallbackUser.length > 0) {
        const u = fallbackUser[0];
        const { fullAddress, landmark, pincode } = parseCustomerAddress(u.address);
        return {
          id: u.id,
          name: u.name || '',
          phone: u.phone,
          role: u.role as Role,
          referralCode,
          walletBalance: Number(u.wallet_balance || 0),
          codOrderCount: 0,
          addresses: fullAddress ? [{ id: `addr-${u.id}`, userId: u.id, fullAddress, landmark, pincode, isDefault: true }] : [],
          createdAt: u.updated_at || new Date().toISOString(),
        };
      }
      console.warn('Error in getOrCreateCustomerByPhone upsert:', insertError.message);
      return null;
    }

    return {
      id: insertedUser.id,
      name: insertedUser.name || '',
      phone: insertedUser.phone,
      role: insertedUser.role as Role,
      referralCode,
      walletBalance: 0,
      codOrderCount: 0,
      addresses: [],
      createdAt: insertedUser.updated_at || new Date().toISOString(),
    };
  } catch (err) {
    console.error('Error in getOrCreateCustomerByPhone:', err);
    return null;
  }
}

/**
 * Saves or updates a customer profile (Name, Address, Landmark, Pincode) in Supabase.
 * Stores address directly in users.address and never queries or touches non-existent addresses table.
 * Uses an UPSERT-safe workflow so an existing user is updated instead of attempting a duplicate insert.
 */
export async function saveCustomerProfileToSupabase(
  userId: string,
  phone: string,
  name: string,
  fullAddress: string,
  landmark: string = '',
  pincode: string = ''
): Promise<User | null> {
  if (!supabase) return null;
  const cleanPhone = phone.replace(/\D/g, '');

  try {
    let completeAddress = fullAddress.trim();
    if (landmark.trim() && !completeAddress.toLowerCase().includes(landmark.trim().toLowerCase())) {
      completeAddress = `${completeAddress} (Landmark: ${landmark.trim()})`;
    }
    if (pincode.trim() && !completeAddress.includes(pincode.trim())) {
      completeAddress = `${completeAddress} - ${pincode.trim()}`;
    }

    // 1. Locate existing record in users table by ID or phone to prevent duplicate insert on users_pkey
    let targetUser: any = null;

    // Check by ID if valid existing user ID provided (excluding temporary client-side IDs like 'user-...')
    if (userId && !userId.startsWith('user-')) {
      const { data: userById } = await supabase
        .from('users')
        .select('*')
        .eq('id', userId)
        .limit(1);
      if (userById && userById.length > 0) {
        targetUser = userById[0];
      }
    }

    // Check by phone if not found by ID
    if (!targetUser && cleanPhone) {
      const { data: existingRows } = await supabase
        .from('users')
        .select('*')
        .eq('phone', cleanPhone)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (existingRows && existingRows.length > 0) {
        targetUser = existingRows[0];
      }
    }

    if (targetUser) {
      // Update existing customer record in users table
      const updatePayload: Record<string, any> = {
        address: completeAddress,
        updated_at: new Date().toISOString(),
      };
      if (name.trim()) {
        updatePayload.name = name.trim();
      }
      if (!targetUser.shop_name && name.trim()) {
        updatePayload.shop_name = `${name.trim()}'s Kirana Store`;
      }
      if (targetUser.role !== Role.SHOPKEEPER && targetUser.role !== Role.SECONDARY_ADMIN) {
        updatePayload.role = 'CUSTOMER';
      }

      const { data: updated, error: updateError } = await supabase
        .from('users')
        .update(updatePayload)
        .eq('id', targetUser.id)
        .select()
        .single();

      if (updateError) {
        console.warn('Supabase update customer profile warning:', updateError.message);
      } else if (updated) {
        targetUser = updated;
      }
    } else {
      // User not found -> UPSERT-safe insert into users table to prevent users_pkey collisions
      const newUserId = userId && !userId.startsWith('user-') ? userId : `usr_${Date.now()}`;
      const insertPayload = {
        id: newUserId,
        name: name.trim() || `Customer (${cleanPhone.slice(-4)})`,
        phone: cleanPhone,
        role: 'CUSTOMER',
        shop_name: name.trim() ? `${name.trim()}'s Kirana Store` : `Customer (${cleanPhone.slice(-4)})`,
        address: completeAddress,
        outstanding_balance: 0,
        updated_at: new Date().toISOString(),
      };

      const { data: upserted, error: upsertError } = await supabase
        .from('users')
        .upsert(insertPayload, { onConflict: 'id' })
        .select()
        .single();

      if (upsertError) {
        // If users_pkey or duplicate key error occurs, safely update the existing row
        if (
          upsertError.message?.includes('users_pkey') ||
          upsertError.message?.includes('duplicate key') ||
          (upsertError as any).code === '23505'
        ) {
          const updatePayload: Record<string, any> = {
            address: completeAddress,
            updated_at: new Date().toISOString(),
          };
          if (name.trim()) updatePayload.name = name.trim();

          const { data: fallbackUpdated } = await supabase
            .from('users')
            .update(updatePayload)
            .or(`id.eq.${newUserId},phone.eq.${cleanPhone}`)
            .select()
            .limit(1);

          if (fallbackUpdated && fallbackUpdated.length > 0) {
            targetUser = fallbackUpdated[0];
          }
        } else {
          console.warn('Supabase upsert customer profile warning:', upsertError.message);
        }
      } else if (upserted) {
        targetUser = upserted;
      }
    }

    // Do NOT insert or update non-existent addresses table
    const finalAddressObj: Address = {
      id: `addr-${targetUser?.id || userId}`,
      userId: targetUser?.id || userId,
      fullAddress: fullAddress.trim(),
      landmark: landmark.trim(),
      pincode: pincode.trim(),
      isDefault: true,
    };

    const dbOutstanding = Number(targetUser?.outstanding_balance || 0);
    const ledgerCredits = await getCustomerWalletBalanceFromLedger(targetUser?.id || userId, cleanPhone);
    const dbCredits = Math.max(Number(targetUser?.wallet_balance || 0), ledgerCredits);

    return {
      id: targetUser?.id || userId,
      name: targetUser?.name || name.trim(),
      phone: cleanPhone,
      role: Role.CUSTOMER,
      referralCode: `OM${cleanPhone.slice(-4)}`,
      walletBalance: dbCredits,
      outstandingBalance: dbOutstanding,
      codOrderCount: 0,
      addresses: [finalAddressObj],
      createdAt: targetUser?.updated_at || new Date().toISOString(),
      isDatabaseVerified: true,
    };
  } catch (err) {
    console.error('Error saving customer profile to Supabase:', err);
    return null;
  }
}

/**
 * Fetch customer profile (Name, Address, Landmark, Contact Number) from Supabase by phone.
 * Queries public.users filtering strictly by phone AND role = CUSTOMER.
 * Does not query non-existent public.addresses table.
 */
export async function fetchCustomerProfileFromSupabase(phone: string): Promise<User | null> {
  if (!supabase) return null;
  const cleanPhone = phone.replace(/\D/g, '');

  try {
    // 1. Safe query: Filter strictly by phone AND role = 'CUSTOMER'
    // Order by updated_at descending with limit(1) to avoid PGRST116 if multiple rows exist
    const { data: userRows, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('phone', cleanPhone)
      .eq('role', 'CUSTOMER')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (userError) {
      console.warn('Error fetching customer from Supabase users:', userError.message);
      return null;
    }

    if (!userRows || userRows.length === 0) {
      return null;
    }

    const dbUser = userRows[0];

    // 2. Read the saved customer address directly from users.address
    let { fullAddress, landmark, pincode } = parseCustomerAddress(dbUser.address);

    // 3. Fallback: If users.address is empty, optionally use the most recent valid orders.delivery_address
    if (!fullAddress) {
      try {
        const { data: recentOrders } = await supabase
          .from('orders')
          .select('delivery_address')
          .or(`customer_id.eq.${dbUser.id},customer_phone.eq.${cleanPhone}`)
          .not('delivery_address', 'is', null)
          .order('created_at', { ascending: false })
          .limit(1);

        if (recentOrders && recentOrders.length > 0 && recentOrders[0].delivery_address) {
          const fallbackParsed = parseCustomerAddress(recentOrders[0].delivery_address);
          if (fallbackParsed.fullAddress) {
            fullAddress = fallbackParsed.fullAddress;
            if (!landmark) landmark = fallbackParsed.landmark;
            if (!pincode) pincode = fallbackParsed.pincode;
          }
        }
      } catch (orderErr) {
        console.warn('Fallback order delivery_address lookup failed:', orderErr);
      }
    }

    // Do NOT query the non-existent addresses table
    // Do NOT invent or hard-code a customer pincode. If not stored, leave blank.
    const formattedAddresses: Address[] = fullAddress
      ? [
          {
            id: `addr-${dbUser.id}`,
            userId: dbUser.id,
            fullAddress,
            landmark,
            pincode, // Blank if not stored!
            isDefault: true,
          },
        ]
      : [];

    const dbOutstanding = Number(dbUser.outstanding_balance || 0);
    const ledgerCredits = await getCustomerWalletBalanceFromLedger(dbUser.id, cleanPhone);
    const dbCredits = Math.max(Number(dbUser.wallet_balance || 0), ledgerCredits);

    return {
      id: dbUser.id,
      name: dbUser.name || '',
      phone: dbUser.phone,
      role: Role.CUSTOMER,
      referralCode: dbUser.referral_code || `OM${cleanPhone.slice(-4)}`,
      walletBalance: dbCredits,
      outstandingBalance: dbOutstanding,
      codOrderCount: Number(dbUser.cod_order_count || 0),
      addresses: formattedAddresses,
      createdAt: dbUser.updated_at || new Date().toISOString(),
      isDatabaseVerified: true,
    };
  } catch (err) {
    console.warn('Error fetching customer profile from Supabase:', err);
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
 * Fetch all orders for a customer across any browser using customer ID and phone number.
 */
export async function fetchCustomerOrdersFromSupabase(
  customerId: string,
  phone: string
): Promise<Order[] | null> {
  if (!supabase) return null;

  try {
    const cleanPhone = phone.trim().replace(/^\+91/, '').replace(/\D/g, '');
    const { data: ordersData, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .or(`customer_id.eq.${customerId},customer_phone.eq.${cleanPhone}`)
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.warn('Error fetching orders from Supabase:', ordersError.message);
      return null;
    }

    if (!ordersData) return [];

    return ordersData.map((o: any) => {
      const finalAmount = Number(o.final_total ?? o.subtotal ?? 0);
      const subtotal = Number(o.subtotal ?? finalAmount);
      const discountAmount = Number(o.discount_amount ?? 0);
      const deliveryFee = Math.max(0, finalAmount - (subtotal - discountAmount));
      let items = parseOrderItemsFromProductName(o['Product Name'], o.id, finalAmount);
      const parsedAddress = parseCustomerAddress(o.delivery_address);

      let orderNumber = '';
      let codCollectedAmount = 0;
      let previousOutstanding = 0;
      let totalPayable = finalAmount;
      let previousOnlinePaid = 0;
      let walletAmountUsed = 0;
      let stockDeducted = false;
      let stockRestored = false;

      const rawNotes = o.notes || '';
      if (rawNotes.includes('COD_META:')) {
        const parts = rawNotes.split('COD_META:');
        orderNumber = parts[0].replace(/\|/g, '').replace(/^Order\s*#?/i, '').trim();
        try {
          const meta = JSON.parse(parts[1].trim());
          codCollectedAmount = Number(meta.codCollected) || 0;
          previousOutstanding = Number(meta.prevOutstanding) || 0;
          totalPayable = meta.totalPayable !== undefined ? Number(meta.totalPayable) : finalAmount;
          walletAmountUsed = Number(meta.walletAmountUsed) || 0;
          previousOnlinePaid = Number(meta.previousOnlinePaid) || 0;
          stockDeducted = Boolean(meta.stockDeducted);
          stockRestored = Boolean(meta.stockRestored);
          if (Array.isArray(meta.items) && meta.items.length > 0) {
            items = meta.items;
          }
        } catch {
          // ignore parsing error
        }
      } else {
        orderNumber = rawNotes.replace(/^Order\s*#?/i, '').trim() || o.id.replace(/^ord[-_]/i, '').slice(0, 8);
      }
      if (!orderNumber) {
        orderNumber = o.id.replace(/^ord[-_]/i, '').slice(0, 8);
      }

      if (o.is_paid && codCollectedAmount === 0) {
        codCollectedAmount = finalAmount;
      }

      let paymentStatus: PaymentStatus = PaymentStatus.PENDING;
      if (o.is_paid || codCollectedAmount >= totalPayable) {
        paymentStatus = PaymentStatus.RECEIVED;
      } else if (codCollectedAmount > 0) {
        paymentStatus = PaymentStatus.PARTIALLY_COLLECTED;
      }

      const resolvedWalletAmountUsed = walletAmountUsed;

      return {
        id: o.id,
        orderNumber: orderNumber || `OM-${o.id.slice(0, 5)}`,
        userId: o.customer_id || customerId,
        userName: o.customer_name || 'Customer',
        userPhone: o.customer_phone || cleanPhone,
        addressId: 'addr-' + o.id,
        address: {
          id: 'addr-' + o.id,
          userId: o.customer_id || customerId,
          fullAddress: parsedAddress.fullAddress || (o.delivery_address ? String(o.delivery_address).trim() : '') || 'Address not specified',
          landmark: parsedAddress.landmark || '',
          pincode: parsedAddress.pincode || '',
          isDefault: true,
        },
        status: (o.status as OrderStatus) || OrderStatus.ORDER_PENDING,
        paymentMethod: (o.payment_method as PaymentMethod) || PaymentMethod.COD,
        paymentStatus,
        deliveryDate: o.preferred_slot || (o.created_at ? o.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
        subtotal,
        discountAmount,
        deliveryFee,
        codCharge: 0,
        finalAmount,
        previousOutstanding,
        totalPayable: (o.payment_method === PaymentMethod.COD || o.payment_method === 'COD') ? finalAmount : totalPayable,
        previousOnlinePaid,
        walletAmountUsed: resolvedWalletAmountUsed,
        codCollectedAmount,
        stockDeducted,
        stockRestored,
        createdAt: o.created_at || new Date().toISOString(),
        items,
      };
    });
  } catch (err) {
    console.error('Failed to query orders from Supabase:', err);
    return null;
  }
}

/**
 * Saves a new order centrally to Supabase.
 * Strictly uses the 20 columns supported by the live orders table.
 */
export async function saveOrderToSupabase(order: Order): Promise<boolean> {
  if (!supabase) return false;

  try {
    const metaPayload = JSON.stringify({
      codCollected: order.codCollectedAmount || 0,
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
        variantId: it.variantId,
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

    const orderPayload = {
      id: order.id,
      customer_id: order.userId,
      customer_name: order.userName || 'Customer',
      customer_phone: order.userPhone || '',
      shop_name: order.userName || 'Customer',
      'Product Name': serializeOrderItemsToProductName(order.items),
      subtotal: order.subtotal,
      discount_amount: order.discountAmount,
      final_total: order.finalAmount,
      status: order.status,
      payment_method: order.paymentMethod,
      is_paid: order.paymentStatus === PaymentStatus.RECEIVED,
      delivery_address:
        typeof order.address === 'string'
          ? order.address
          : order.address?.fullAddress || '',
      preferred_slot: order.deliveryDate || order.createdAt?.split('T')[0] || '',
      notes: orderNotes,
      weight_kg: (order as any).weightKg || null,
      created_at: order.createdAt || new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    const { error: orderError } = await supabase.from('orders').insert(orderPayload);
    if (orderError) {
      console.error('Failed to save order to Supabase:', orderError);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Exception in saveOrderToSupabase:', err);
    return false;
  }
}

/**
 * Updates an edited order centrally in Supabase.
 * Preserves the existing order ID, number, status, customer, address, payment method and timestamps,
 * while updating items, subtotal, discount, final_total, and COD_META.
 */
export async function saveEditedOrderToSupabase(order: Order): Promise<boolean> {
  if (!supabase) return false;

  try {
    const metaPayload = JSON.stringify({
      codCollected: order.codCollectedAmount || 0,
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
        variantId: it.variantId,
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

    const updatePayload = {
      'Product Name': serializeOrderItemsToProductName(order.items),
      subtotal: order.subtotal,
      discount_amount: order.discountAmount,
      final_total: order.finalAmount,
      notes: orderNotes,
      is_paid: order.paymentStatus === PaymentStatus.RECEIVED,
      payment_status: order.paymentStatus,
      updated_at: new Date().toISOString(),
    };

    let query = supabase.from('orders').update(updatePayload);
    if (order.id.startsWith('OM-')) {
      query = query.ilike('notes', `%${order.id}%`);
    } else {
      query = query.eq('id', order.id);
    }

    const { error } = await query;
    if (error) {
      console.error('Failed to update edited order in Supabase:', error);
      return false;
    }

    return true;
  } catch (err) {
    console.error('Exception in saveEditedOrderToSupabase:', err);
    return false;
  }
}

/**
 * Fetch all orders for the Shopkeeper admin view.
 */
export async function fetchAllOrdersForAdmin(): Promise<Order[] | null> {
  if (!supabase) return null;

  try {
    const { data: ordersData, error: ordersError } = await supabase
      .from('orders')
      .select('*')
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.warn('Error fetching all orders for admin:', ordersError.message);
      return null;
    }

    if (!ordersData) return [];

    return ordersData.map((o: any) => {
      const finalAmount = Number(o.final_total ?? o.subtotal ?? 0);
      const subtotal = Number(o.subtotal ?? finalAmount);
      const discountAmount = Number(o.discount_amount ?? 0);
      const deliveryFee = Math.max(0, finalAmount - (subtotal - discountAmount));
      let items = parseOrderItemsFromProductName(o['Product Name'], o.id, finalAmount);
      const parsedAddress = parseCustomerAddress(o.delivery_address);

      let orderNumber = '';
      let codCollectedAmount = 0;
      let previousOutstanding = 0;
      let totalPayable = finalAmount;
      let walletAmountUsed = 0;
      let previousOnlinePaid = 0;
      let stockDeducted = false;
      let stockRestored = false;

      const rawNotes = o.notes || '';
      if (rawNotes.includes('COD_META:')) {
        const parts = rawNotes.split('COD_META:');
        orderNumber = parts[0].replace(/\|/g, '').replace(/^Order\s*#?/i, '').trim();
        try {
          const meta = JSON.parse(parts[1].trim());
          codCollectedAmount = Number(meta.codCollected) || 0;
          previousOutstanding = Number(meta.prevOutstanding) || 0;
          totalPayable = meta.totalPayable !== undefined ? Number(meta.totalPayable) : finalAmount;
          walletAmountUsed = Number(meta.walletAmountUsed) || 0;
          previousOnlinePaid = Number(meta.previousOnlinePaid) || 0;
          stockDeducted = Boolean(meta.stockDeducted);
          stockRestored = Boolean(meta.stockRestored);
          if (Array.isArray(meta.items) && meta.items.length > 0) {
            items = meta.items;
          }
        } catch {
          // ignore parsing error
        }
      } else {
        orderNumber = rawNotes.replace(/^Order\s*#?/i, '').trim() || o.id.replace(/^ord[-_]/i, '').slice(0, 8);
      }
      if (!orderNumber) {
        orderNumber = o.id.replace(/^ord[-_]/i, '').slice(0, 8);
      }

      if (o.is_paid && codCollectedAmount === 0) {
        codCollectedAmount = finalAmount;
      }

      let paymentStatus: PaymentStatus = PaymentStatus.PENDING;
      if (o.is_paid || codCollectedAmount >= totalPayable) {
        paymentStatus = PaymentStatus.RECEIVED;
      } else if (codCollectedAmount > 0) {
        paymentStatus = PaymentStatus.PARTIALLY_COLLECTED;
      }

      const resolvedWalletAmountUsed = walletAmountUsed;

      return {
        id: o.id,
        orderNumber: orderNumber || `OM-${o.id.slice(0, 5)}`,
        userId: o.customer_id || '',
        userName: o.customer_name || 'Customer',
        userPhone: o.customer_phone || '',
        addressId: 'addr-' + o.id,
        address: {
          id: 'addr-' + o.id,
          userId: o.customer_id || '',
          fullAddress: parsedAddress.fullAddress || (o.delivery_address ? String(o.delivery_address).trim() : '') || 'Address not specified',
          landmark: parsedAddress.landmark || '',
          pincode: parsedAddress.pincode || '',
          isDefault: true,
        },
        status: (o.status as OrderStatus) || OrderStatus.ORDER_PENDING,
        paymentMethod: (o.payment_method as PaymentMethod) || PaymentMethod.COD,
        paymentStatus,
        deliveryDate: o.preferred_slot || (o.created_at ? o.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
        subtotal,
        discountAmount,
        deliveryFee,
        codCharge: 0,
        finalAmount,
        previousOutstanding,
        totalPayable: (o.payment_method === PaymentMethod.COD || o.payment_method === 'COD') ? finalAmount : totalPayable,
        previousOnlinePaid,
        walletAmountUsed: resolvedWalletAmountUsed,
        codCollectedAmount,
        stockDeducted,
        stockRestored,
        createdAt: o.created_at || new Date().toISOString(),
        items,
      };
    });
  } catch (err) {
    console.error('Exception fetching admin orders:', err);
    return null;
  }
}

/**
 * Updates order status in Supabase.
 */
export async function updateOrderStatusInSupabase(
  orderId: string,
  newStatus: OrderStatus,
  isPaid?: boolean,
  meta?: {
    codCollected?: number;
    prevOutstanding?: number;
    totalPayable?: number;
    orderNumber?: string;
    walletAmountUsed?: number;
    stockDeducted?: boolean;
    stockRestored?: boolean;
    items?: OrderItem[];
  }
): Promise<boolean> {
  if (!supabase) return false;

  try {
    const updatePayload: Record<string, any> = {
      status: newStatus,
      updated_at: new Date().toISOString(),
    };

    if (typeof isPaid === 'boolean') {
      updatePayload.is_paid = isPaid;
    }

    if (meta) {
      const orderNum = meta.orderNumber || orderId.slice(0, 8);
      const metaString = JSON.stringify({
        codCollected: meta.codCollected || 0,
        prevOutstanding: meta.prevOutstanding || 0,
        totalPayable: meta.totalPayable || 0,
        walletAmountUsed: meta.walletAmountUsed || 0,
        stockDeducted: meta.stockDeducted ?? false,
        stockRestored: meta.stockRestored ?? false,
        ...(meta.items && meta.items.length > 0 ? { items: meta.items } : {}),
      });
      updatePayload.notes = `Order #${orderNum} | COD_META:${metaString}`;
    }

    let orderQuery = supabase.from('orders').update(updatePayload);
    if (orderId.startsWith('OM-')) {
      orderQuery = orderQuery.ilike('notes', `%${orderId}%`);
    } else {
      orderQuery = orderQuery.eq('id', orderId);
    }

    const { error } = await orderQuery;

    if (error) {
      console.error('Failed to update order status in Supabase:', error);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception in updateOrderStatusInSupabase:', err);
    return false;
  }
}

/**
 * Directly updates product stock and wholesale variant definitions in Supabase.
 */
export async function updateProductStockInSupabase(
  productId: string,
  variants: ProductVariant[]
): Promise<boolean> {
  if (!supabase) return false;

  try {
    const totalStock = (variants || []).reduce(
      (sum, v) => sum + (Number(v.stockQuantity) || 0),
      0
    );

    const { error } = await supabase
      .from('products')
      .update({
        stock: totalStock,
        wholesale_tier_discount: variants || [],
        updated_at: new Date().toISOString(),
      })
      .eq('id', productId);

    if (error) {
      console.warn('Failed to update product stock directly in Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exception in updateProductStockInSupabase:', err);
    return false;
  }
}

/**
 * Permanently logs a COD Collection transaction in Supabase's ledger and updates the customer's balance.
 */
export async function recordCodCollectionInSupabase(tx: {
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
  if (!supabase) return false;

  try {
    // 1. Insert into Supabase 'ledger' table
    const { error: ledgerError } = await supabase.from('ledger').insert({
      id: tx.id,
      customer_id: tx.customerId || tx.customerPhone,
      customer_name: tx.customerName || 'Customer',
      order_id: tx.orderId,
      date: tx.createdAt,
      type: 'CREDIT',
      amount: tx.amount,
      description: `COD Collection for Order #${tx.orderNumber}`,
      balance_after: tx.remainingOutstanding,
    });

    if (ledgerError) {
      console.warn('Error inserting to Supabase ledger:', ledgerError.message);
    }

    // 2. Update Supabase 'users.outstanding_balance'
    if (tx.customerPhone) {
      const cleanPhone = tx.customerPhone.replace(/\D/g, '').slice(-10);
      await supabase
        .from('users')
        .update({
          outstanding_balance: tx.remainingOutstanding,
          updated_at: new Date().toISOString(),
        })
        .eq('phone', cleanPhone);
    }

    return true;
  } catch (err) {
    console.warn('Exception in recordCodCollectionInSupabase:', err);
    return false;
  }
}

/**
 * Permanently logs a Wallet Credit / Refund transaction in Supabase's ledger and updates the customer's wallet_balance.
 */
export async function creditCustomerWalletInSupabase(tx: {
  userId?: string;
  customerPhone: string;
  customerName?: string;
  orderId?: string;
  orderNumber?: string;
  amount: number;
  newWalletBalance: number;
  description: string;
}): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { canonicalId, cleanPhone } = await resolveCustomerIdentityAliases(
      tx.userId,
      tx.customerPhone
    );

    // 0. Prevent duplicate ledger entry for the same order refund
    if (tx.orderId || tx.orderNumber) {
      try {
        let dupQuery = supabase.from('ledger').select('id, amount').eq('type', 'CREDIT');
        if (tx.orderId && tx.orderNumber) {
          dupQuery = dupQuery.or(`order_id.eq.${tx.orderId},description.ilike.%${tx.orderNumber}%`);
        } else if (tx.orderId) {
          dupQuery = dupQuery.eq('order_id', tx.orderId);
        } else if (tx.orderNumber) {
          dupQuery = dupQuery.ilike('description', `%${tx.orderNumber}%`);
        }
        const { data: existingLedger } = await dupQuery;
        if (existingLedger && existingLedger.length > 0) {
          const totalAlreadyCredited = existingLedger.reduce(
            (sum, r: any) => sum + (Number(r.amount) || 0),
            0
          );
          if (totalAlreadyCredited >= tx.amount) {
            return true; // Already credited full amount, do not duplicate
          }
        }
      } catch (dupErr) {
        console.warn('Error checking duplicate ledger entry:', dupErr);
      }
    }

    // 1. Authoritatively calculate current balance from persisted ledger records before credit
    const currentAuthoritativeBalance = await getCustomerWalletBalanceFromLedger(
      canonicalId,
      cleanPhone
    );
    const authoritativeBalanceAfter =
      Math.round((currentAuthoritativeBalance + tx.amount) * 100) / 100;

    // 2. Insert into Supabase 'ledger' table using canonical customer ID
    const ledgerPayload = {
      id: `led_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      customer_id: canonicalId,
      customer_name: tx.customerName || 'Customer',
      order_id: tx.orderId || null,
      date: new Date().toISOString(),
      type: 'CREDIT',
      amount: tx.amount,
      description: tx.description,
      balance_after: authoritativeBalanceAfter,
    };

    const { error: ledgerError } = await supabase.from('ledger').insert(ledgerPayload);
    if (ledgerError) {
      console.warn('Error inserting wallet credit to Supabase ledger:', ledgerError.message);
    }

    // 3. Safely attempt updating Supabase 'users.wallet_balance' if column exists
    try {
      const updatePayload = {
        wallet_balance: authoritativeBalanceAfter,
        updated_at: new Date().toISOString(),
      };

      if (cleanPhone) {
        await supabase
          .from('users')
          .update(updatePayload)
          .eq('phone', cleanPhone);
      } else if (canonicalId) {
        await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', canonicalId);
      }
    } catch {
      // Ignored if column does not exist on users table
    }

    return true;
  } catch (err) {
    console.warn('Exception in creditCustomerWalletInSupabase:', err);
    return false;
  }
}

/**
 * Permanently logs a Wallet Debit transaction in Supabase's ledger and updates the customer's wallet_balance.
 */
export async function debitCustomerWalletInSupabase(tx: {
  userId?: string;
  customerPhone: string;
  customerName?: string;
  orderId?: string;
  orderNumber?: string;
  amount: number;
  newWalletBalance: number;
  description: string;
}): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { canonicalId, cleanPhone } = await resolveCustomerIdentityAliases(
      tx.userId,
      tx.customerPhone
    );

    // 0. Prevent duplicate ledger entry for the same order debit
    if (tx.orderId || tx.orderNumber) {
      try {
        let dupQuery = supabase.from('ledger').select('id').eq('type', 'DEBIT');
        if (tx.orderId && tx.orderNumber) {
          dupQuery = dupQuery.or(`order_id.eq.${tx.orderId},description.ilike.%${tx.orderNumber}%`);
        } else if (tx.orderId) {
          dupQuery = dupQuery.eq('order_id', tx.orderId);
        } else if (tx.orderNumber) {
          dupQuery = dupQuery.ilike('description', `%${tx.orderNumber}%`);
        }
        const { data: existingLedger } = await dupQuery;
        if (existingLedger && existingLedger.length > 0) {
          return true; // Already debited, do not duplicate
        }
      } catch (dupErr) {
        console.warn('Error checking duplicate ledger debit entry:', dupErr);
      }
    }

    // 1. Authoritatively calculate current balance from persisted ledger records before debit
    const currentAuthoritativeBalance = await getCustomerWalletBalanceFromLedger(
      canonicalId,
      cleanPhone
    );
    const authoritativeBalanceAfter =
      Math.max(0, Math.round((currentAuthoritativeBalance - tx.amount) * 100) / 100);

    // 2. Insert into Supabase 'ledger' table using canonical customer ID
    const ledgerPayload = {
      id: `led_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      customer_id: canonicalId,
      customer_name: tx.customerName || 'Customer',
      order_id: tx.orderId || null,
      date: new Date().toISOString(),
      type: 'DEBIT',
      amount: tx.amount,
      description: tx.description,
      balance_after: authoritativeBalanceAfter,
    };

    const { error: ledgerError } = await supabase.from('ledger').insert(ledgerPayload);
    if (ledgerError) {
      console.warn('Error inserting wallet debit to Supabase ledger:', ledgerError.message);
    }

    // 3. Safely attempt updating Supabase 'users.wallet_balance' if column exists
    try {
      const updatePayload = {
        wallet_balance: authoritativeBalanceAfter,
        updated_at: new Date().toISOString(),
      };

      if (cleanPhone) {
        await supabase
          .from('users')
          .update(updatePayload)
          .eq('phone', cleanPhone);
      } else if (canonicalId) {
        await supabase
          .from('users')
          .update(updatePayload)
          .eq('id', canonicalId);
      }
    } catch {
      // Ignored if column does not exist on users table
    }

    return true;
  } catch (err) {
    console.warn('Exception in debitCustomerWalletInSupabase:', err);
    return false;
  }
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
 * Loads all products with variants and wholesale slabs from Supabase.
 */
export async function fetchProductsFromSupabase(): Promise<Product[] | null> {
  if (!supabase) return null;

  try {
    // Attempt ordering by display_order first, then updated_at (fallback to unsorted if columns unavailable)
    let prodResult = await supabase
      .from('products')
      .select('*')
      .order('display_order', { ascending: true });

    if (prodResult.error) {
      prodResult = await supabase
        .from('products')
        .select('*')
        .order('updated_at', { ascending: false });
    }

    if (prodResult.error) {
      console.warn('Ordering products failed, falling back to unordered select:', prodResult.error.message);
      prodResult = await supabase.from('products').select('*');
    }

    const { data: dbProducts, error: prodError } = prodResult;

    if (prodError) {
      console.error('Failed to fetch products from Supabase:', prodError);
      return null;
    }

    if (!dbProducts || dbProducts.length === 0) {
      return [];
    }

    const productIds = dbProducts.map((p) => p.id);
    const variantsByProduct: Record<string, ProductVariant[]> = {};

    // 1. Check if separate relational product_variants table exists
    try {
      const { data: dbVariants, error: varError } = await supabase
        .from('product_variants')
        .select('*')
        .in('product_id', productIds);

      if (!varError && dbVariants && dbVariants.length > 0) {
        const variantIds = dbVariants.map((v) => v.id);
        let dbTieredPrices: any[] = [];
        try {
          const { data: tpData, error: tpError } = await supabase
            .from('tiered_prices')
            .select('*')
            .in('variant_id', variantIds);

          if (!tpError && tpData) {
            dbTieredPrices = tpData;
          }
        } catch {
          // Relational tiered prices table not present
        }

        const tieredPricesByVariant: Record<string, TieredPrice[]> = {};
        for (const tp of dbTieredPrices) {
          if (!tieredPricesByVariant[tp.variant_id]) {
            tieredPricesByVariant[tp.variant_id] = [];
          }
          tieredPricesByVariant[tp.variant_id].push({
            id: tp.id,
            variantId: tp.variant_id,
            minQty: Number(tp.min_qty),
            maxQty: Number(tp.max_qty),
            unitPrice: Number(tp.unit_price),
          });
        }

        for (const v of dbVariants) {
          if (!variantsByProduct[v.product_id]) {
            variantsByProduct[v.product_id] = [];
          }
          variantsByProduct[v.product_id].push({
            id: v.id,
            productId: v.product_id,
            unit: (v.unit as UnitType) || UnitType.KG,
            packSize: Number(v.pack_size || 1),
            packLabel: v.pack_label || `${v.pack_size || 1} ${v.unit || 'KG'}`,
            mrp: Number(v.mrp || 0),
            baseSellingPrice: Number(v.base_selling_price || 0),
            purchasePrice: v.purchase_price !== undefined && v.purchase_price !== null ? Number(v.purchase_price) : undefined,
            discount: v.discount !== undefined && v.discount !== null ? Number(v.discount) : undefined,
            stockQuantity: Number(v.stock_quantity || 0),
            maxOrderLimit: Number(v.max_order_limit || 20),
            tieredPrices: tieredPricesByVariant[v.id] || [],
          });
        }
      }
    } catch {
      // product_variants table not available, fallback to embedded JSONB
    }

    // Assemble final Product list
    const assembledProducts: Product[] = dbProducts.map((p) => {
      // Match categoryId from INITIAL_CATEGORIES or fallback gracefully
      const matchedCategory = INITIAL_CATEGORIES.find(
        (c) =>
          c.name.toLowerCase() === (p.category || '').toLowerCase() ||
          c.id === p.category_id ||
          c.id === p.category
      );
      const categoryId = matchedCategory ? matchedCategory.id : (p.category_id || p.category || 'cat-15');

      // 1. Use relational variants if resolved
      let variants: ProductVariant[] = variantsByProduct[p.id] || [];

      // 2. Otherwise extract from embedded wholesale_tier_discount (JSONB)
      if (variants.length === 0 && Array.isArray(p.wholesale_tier_discount) && p.wholesale_tier_discount.length > 0) {
        variants = p.wholesale_tier_discount.map((v: any, idx: number) => {
          const vUnit = (v.unit as UnitType) || UnitType.KG;
          const vPackSize = Number(v.packSize ?? v.pack_size ?? 1);
          const vPackLabel = v.packLabel || v.pack_label || `${vPackSize} ${vUnit}`;
          const vTieredPrices: TieredPrice[] = Array.isArray(v.tieredPrices)
            ? v.tieredPrices.map((tp: any, tpIdx: number) => ({
                id: tp.id || `tp_${v.id || idx}_${tpIdx}`,
                variantId: tp.variantId || tp.variant_id || v.id || `var_${p.id}_${idx}`,
                minQty: Number(tp.minQty ?? tp.min_qty ?? 1),
                maxQty: Number(tp.maxQty ?? tp.max_qty ?? 999),
                unitPrice: Number(tp.unitPrice ?? tp.unit_price ?? v.baseSellingPrice ?? v.base_selling_price ?? p.price ?? 0),
              }))
            : [];

          return {
            id: v.id || `var_${p.id}_${idx + 1}`,
            productId: p.id,
            unit: vUnit,
            packSize: vPackSize,
            packLabel: vPackLabel,
            mrp: Number(v.mrp || p.mrp || 0),
            baseSellingPrice: Number(v.baseSellingPrice ?? v.base_selling_price ?? p.price ?? 0),
            purchasePrice: v.purchasePrice !== undefined && v.purchasePrice !== null ? Number(v.purchasePrice) : (v.purchase_price !== undefined ? Number(v.purchase_price) : undefined),
            discount: v.discount !== undefined && v.discount !== null ? Number(v.discount) : undefined,
            stockQuantity: Number(v.stockQuantity ?? v.stock_quantity ?? p.stock ?? 0),
            maxOrderLimit: Number(v.maxOrderLimit ?? v.max_order_limit ?? 20),
            tieredPrices: vTieredPrices,
          };
        });
      }

      // 3. Fallback: create primary variant from base product columns if variants array is empty
      if (variants.length === 0) {
        const defaultPack = p.unit ? String(p.unit) : '1 KG';
        variants = [
          {
            id: `var_${p.id}_1`,
            productId: p.id,
            unit: UnitType.KG,
            packSize: Number(p.weight_per_unit_kg || 1),
            packLabel: defaultPack,
            mrp: Number(p.mrp || p.price || 0),
            baseSellingPrice: Number(p.price || p.mrp || 0),
            purchasePrice: p.purchase_price !== undefined ? Number(p.purchase_price) : undefined,
            discount: p.discount !== undefined ? Number(p.discount) : undefined,
            stockQuantity: Number(p.stock || 0),
            maxOrderLimit: Number(p.min_order_qty ? p.min_order_qty * 10 : 20),
            tieredPrices: [],
          },
        ];
      }

      return {
        id: p.id,
        name: p.name,
        brand: p.brand || p.sub_category || '',
        description: p.description || '',
        categoryId,
        imageUrl: p.image_url && String(p.image_url).trim() ? String(p.image_url).trim() : undefined,
        barcode: p.barcode ? String(p.barcode).trim() : null,
        isDiscountExcluded: p.is_discount_excluded ?? false,
        searchKeywords: (p.search_keywords || p.badge || '').trim() || undefined,
        purchasePrice: p.purchase_price !== undefined ? Number(p.purchase_price) : (variants[0]?.purchasePrice || undefined),
        discount: p.discount !== undefined ? Number(p.discount) : (variants[0]?.discount || undefined),
        displayOrder: typeof p.display_order === 'number' ? p.display_order : undefined,
        variants,
        createdAt: p.created_at || p.updated_at || new Date().toISOString(),
      };
    });

    assembledProducts.sort((a, b) => {
      if (typeof a.displayOrder === 'number' && typeof b.displayOrder === 'number') {
        return a.displayOrder - b.displayOrder;
      }
      if (typeof a.displayOrder === 'number') return -1;
      if (typeof b.displayOrder === 'number') return 1;
      return 0;
    });

    return assembledProducts;
  } catch (err) {
    console.error('Exception in fetchProductsFromSupabase:', err);
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
 * and preserves requested default values: COD ₹50, Free Delivery above ₹249, Delivery Fee ₹11, Referral Credit ₹0.
 */
export function mapSupabaseRowToSettings(
  row: any,
  fallbackSettings?: SystemSetting
): SystemSetting {
  const base = fallbackSettings || INITIAL_SETTINGS;
  if (!row || typeof row !== 'object') return base;

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
    advancePaymentDiscountPct:
      row.advance_discount_percentage !== undefined && !isNaN(Number(row.advance_discount_percentage))
        ? Number(row.advance_discount_percentage)
        : (row.advance_payment_discount_pct !== undefined && !isNaN(Number(row.advance_payment_discount_pct))
          ? Number(row.advance_payment_discount_pct)
          : (base.advancePaymentDiscountPct ?? 3.0)),
    codBaseCharge:
      row.cod_base_charge !== undefined && !isNaN(Number(row.cod_base_charge))
        ? Number(row.cod_base_charge)
        : (base.codBaseCharge ?? 50.0),
    freeShippingMinAmount:
      row.free_shipping_min_amount !== undefined && !isNaN(Number(row.free_shipping_min_amount))
        ? Number(row.free_shipping_min_amount)
        : (base.freeShippingMinAmount ?? 249.0),
    baseDeliveryFee:
      row.base_delivery_fee !== undefined && !isNaN(Number(row.base_delivery_fee))
        ? Number(row.base_delivery_fee)
        : (base.baseDeliveryFee ?? 11.0),
    referralRewardAmount:
      row.referral_reward_amount !== undefined && !isNaN(Number(row.referral_reward_amount))
        ? Number(row.referral_reward_amount)
        : (base.referralRewardAmount ?? 0.0),
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
      referral_reward_amount: settings.referralRewardAmount,
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


