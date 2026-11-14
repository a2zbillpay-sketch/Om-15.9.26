import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Order, OrderItem, Address, Role, OrderStatus, PaymentMethod, PaymentStatus, UnitType, Product, ProductVariant, TieredPrice, SystemSetting, WalletTransaction, ProductRequest, Category } from '../types';
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
        walletBalance: dbCredits,
        outstandingBalance: dbOutstanding,
        codOrderCount: Number(existingUser.cod_order_count || 0),
        addresses: formattedAddresses,
        createdAt: existingUser.updated_at || existingUser.created_at || new Date().toISOString(),
      };
    }

    // 2. User does not exist, create deterministic customer record in Supabase users table
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

    // Best-effort insert into public.addresses (permitted by RLS FOR INSERT policy)
    const finalAddressObj: Address = {
      id: `addr-${targetUser?.id || userId}`,
      userId: targetUser?.id || userId,
      fullAddress: fullAddress.trim(),
      landmark: landmark.trim(),
      pincode: pincode.trim(),
      isDefault: true,
    };

    saveAddressToSupabase(finalAddressObj).catch(() => {});

    const dbOutstanding = Number(targetUser?.outstanding_balance || 0);
    const ledgerCredits = await getCustomerWalletBalanceFromLedger(targetUser?.id || userId, cleanPhone);
    const dbCredits = Math.max(Number(targetUser?.wallet_balance || 0), ledgerCredits);

    return {
      id: targetUser?.id || userId,
      name: targetUser?.name || name.trim(),
      phone: cleanPhone,
      role: Role.CUSTOMER,
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
 * Inserts a newly added delivery address row into public.addresses (matches RLS INSERT policy).
 */
export async function saveAddressToSupabase(address: Address): Promise<boolean> {
  if (!supabase) return false;
  if (!address.userId || !address.fullAddress || !address.fullAddress.trim()) return false;

  try {
    const { error } = await supabase.from('addresses').insert({
      id: address.id || `addr-${Date.now()}`,
      user_id: address.userId,
      full_address: address.fullAddress.trim(),
      landmark: address.landmark?.trim() || null,
      pincode: address.pincode?.trim() || '422001',
      is_default: Boolean(address.isDefault),
      google_location: address.googleLocation || null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    });

    if (error) {
      // Duplicate primary key or RLS notice handled non-destructively
      return false;
    }
    return true;
  } catch {
    return false;
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
    addressId: 'addr-' + o.id,
    address: {
      id: 'addr-' + o.id,
      userId: o.customer_id || fallbackCustomerId || '',
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
  order?: {
    id: string;
    orderNumber: string;
    customerPhone?: string;
    subtotal?: number;
    deliveryFee?: number;
    codCharge?: number;
    discountAmount?: number;
    finalAmount: number;
    walletAmountUsed?: number;
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
        address: order.address,
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

/**
 * Updates order status (and optional cancellation wallet refund) via verified /api/orders PUT endpoint.
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
    items?: OrderItem[];
    paymentStatus?: PaymentStatus | string;
    refundAmount?: number;
    refundDescription?: string;
    customerId?: string;
    customerPhone?: string;
    customerName?: string;
  }
): Promise<boolean> {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;

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

    if (!res.ok) {
      console.warn('updateOrderStatusInSupabase rejected by /api/orders:', res.status);
      return false;
    }

    const json = await res.json().catch(() => null);
    return Boolean(json?.success);
  } catch (err) {
    console.error('Exception in updateOrderStatusInSupabase:', err);
    return false;
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
      return false;
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
      return false;
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
      return false;
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
    const tieredPricesByVariant: Record<string, TieredPrice[]> = {};

    // 1. Check if separate relational product_variants table exists
    try {
      const { data: dbVariants, error: varError } = await supabase
        .from('product_variants')
        .select('id, product_id, unit, pack_size, pack_label, mrp, base_selling_price, stock_quantity, max_order_limit, barcode, image_url, display_order')
        .in('product_id', productIds);

      const variantIds = (!varError && dbVariants) ? dbVariants.map((v) => v.id) : [];
      const allTargetIds = [...variantIds, ...productIds];

      if (allTargetIds.length > 0) {
        try {
          const { data: tpData, error: tpError } = await supabase
            .from('tiered_prices')
            .select('*')
            .in('variant_id', allTargetIds);

          if (!tpError && tpData) {
            for (const tp of tpData) {
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
          }
        } catch {
          // Relational tiered prices table not present
        }
      }

      if (!varError && dbVariants && dbVariants.length > 0) {
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
            purchasePrice: (v as any).purchase_price !== undefined && (v as any).purchase_price !== null ? Number((v as any).purchase_price) : undefined,
            discount: (v as any).discount !== undefined && (v as any).discount !== null ? Number((v as any).discount) : undefined,
            stockQuantity: Number(v.stock_quantity || 0),
            maxOrderLimit: Number(v.max_order_limit || 20),
            tieredPrices: tieredPricesByVariant[v.id] || [],
            barcode: v.barcode ? String(v.barcode).trim() : null,
            imageUrl: v.image_url ? String(v.image_url).trim() : undefined,
            displayOrder: typeof v.display_order === 'number' ? v.display_order : undefined,
          });
        }
      }
    } catch {
      // product_variants table not available, fallback to embedded JSONB
    }

    // Assemble final Product list
    const assembledProducts: Product[] = dbProducts.map((p) => {
      // Prioritize explicit category_id or category from database
      const categoryId = p.category_id || p.category || '';

      // 1. Use relational variants if resolved
      let variants: ProductVariant[] = variantsByProduct[p.id] || [];

      // 2. Otherwise extract from embedded wholesale_tier_discount (JSONB) if it contains variant objects
      if (variants.length === 0 && Array.isArray(p.wholesale_tier_discount) && p.wholesale_tier_discount.length > 0) {
        // Only treat as variants if elements have packSize, packLabel, or variant IDs
        const hasVariantShape = p.wholesale_tier_discount.some((item: any) => item && (item.packSize || item.pack_size || item.packLabel || item.pack_label || item.unit));
        if (hasVariantShape) {
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
              barcode: v.barcode ? String(v.barcode).trim() : null,
              imageUrl: v.imageUrl || v.image_url ? String(v.imageUrl || v.image_url).trim() : undefined,
              displayOrder: typeof v.displayOrder === 'number' ? v.displayOrder : (typeof v.display_order === 'number' ? v.display_order : idx + 1),
            };
          });
        }
      }

      // Sort variants strictly by displayOrder
      if (variants.length > 0) {
        variants.sort((a, b) => {
          if (typeof a.displayOrder === 'number' && typeof b.displayOrder === 'number') {
            return a.displayOrder - b.displayOrder;
          }
          if (typeof a.displayOrder === 'number') return -1;
          if (typeof b.displayOrder === 'number') return 1;
          return 0;
        });
      }

      // Product-level tiered prices (for variant-less products or product-level wholesale slabs)
      const prodTieredPrices: TieredPrice[] = tieredPricesByVariant[p.id] || (
        Array.isArray(p.tiered_prices)
          ? p.tiered_prices.map((tp: any, tpIdx: number) => ({
              id: tp.id || `tp_${p.id}_${tpIdx}`,
              variantId: tp.variantId || tp.variant_id || p.id,
              minQty: Number(tp.minQty ?? tp.min_qty ?? 1),
              maxQty: Number(tp.maxQty ?? tp.max_qty ?? 999),
              unitPrice: Number(tp.unitPrice ?? tp.unit_price ?? p.price ?? 0),
            }))
          : []
      );

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
        price: p.price !== undefined ? Number(p.price) : (variants[0]?.baseSellingPrice || 0),
        mrp: p.mrp !== undefined ? Number(p.mrp) : (variants[0]?.mrp || 0),
        baseSellingPrice: p.price !== undefined ? Number(p.price) : (variants[0]?.baseSellingPrice || 0),
        stock: variants.length > 0
          ? variants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0)
          : Number(p.stock || p.stock_quantity || 0),
        stockQuantity: variants.length > 0
          ? variants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0)
          : Number(p.stock || p.stock_quantity || 0),
        unit: p.unit || (variants[0]?.unit ?? UnitType.NOS),
        packSize: p.pack_size !== undefined ? Number(p.pack_size) : (p.weight_per_unit_kg !== undefined ? Number(p.weight_per_unit_kg) : 1),
        packLabel: p.pack_label || (p.unit ? String(p.unit) : undefined),
        maxOrderLimit: Number(p.max_order_limit ?? (p.min_order_qty ? p.min_order_qty * 10 : 20)),
        tieredPrices: prodTieredPrices,
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
 * and preserves requested default values: COD ₹0, Free Delivery above ₹249, Delivery Fee ₹11, Referral Credit ₹0.
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
        : (base.advancePaymentDiscountPct ?? 3.0),
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
 * Persists an out-of-stock product request to Supabase.
 * Gracefully handles table availability, foreign key safety, and column compatibility.
 */
export async function saveProductRequestToSupabase(req: ProductRequest): Promise<boolean> {
  if (!supabase) return false;

  try {
    const cleanPhone = (req.customerPhone || '').replace(/\D/g, '').slice(-10);
    if (!cleanPhone || cleanPhone.length < 10) return false;

    const requestId =
      req.id && req.id.trim()
        ? req.id.trim()
        : `preq-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    const payload: Record<string, any> = {
      id: requestId,
      customer_id: (req.customerId && req.customerId.trim()) || `usr_${cleanPhone}`,
      customer_name: (req.customerName || req.customer?.name || 'Customer').trim(),
      customer_phone: cleanPhone,
      product_id: (req.productId && req.productId.trim()) || req.product?.id || 'unknown',
      product_name: (req.productName || req.product?.name || 'Requested Item').trim(),
      variant_id: req.variantId ? String(req.variantId).trim() : null,
      variant_name: req.variantName || req.product?.variantName || null,
      pack_size: req.packSize || req.product?.packSize || null,
      quantity: Math.max(1, Number(req.quantity) || 1),
      request_date: req.requestDate || req.createdAt || new Date().toISOString(),
      created_at: req.createdAt || new Date().toISOString(),
    };

    const { error } = await supabase.from('product_requests').insert(payload);

    if (error) {
      console.warn('Notice saving product_requests to Supabase:', error.message);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn('Exception saving product_requests to Supabase:', err?.message || err);
    return false;
  }
}

/**
 * Loads recent product requests for the Shopkeeper management center.
 * Strictly queries the verified server API (/api/product-requests).
 * If the API is unauthorized, fails, or is unavailable, it does NOT attempt direct client
 * Supabase reads of sensitive customer requests, returning null safely.
 */
export async function fetchProductRequestsFromSupabase(): Promise<ProductRequest[] | null> {
  try {
    const res = await fetch('/api/product-requests', {
      method: 'GET',
      credentials: 'include',
    });

    if (res.ok) {
      const json = await res.json();
      if (json && json.success && Array.isArray(json.requests)) {
        return json.requests.map((row: any) => ({
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
        }));
      }
    }

    // If API responded with 401, 500, or unexpected format, safely return null
    return null;
  } catch (err) {
    console.warn('Notice reading product_requests via server API:', err);
    return null;
  }
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
 * Fetches all categories from Supabase ordered by display_order.
 */
export async function fetchCategoriesFromSupabase(): Promise<Category[] | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('display_order', { ascending: true });

    if (error) {
      console.warn('Failed to fetch categories from Supabase:', error.message);
      return null;
    }

    if (!data) return [];

    return data.map((row: any) => ({
      id: String(row.id),
      name: String(row.name || ''),
      imageUrl: row.image_url ? String(row.image_url) : '',
      displayOrder: typeof row.display_order === 'number' ? row.display_order : 1,
    }));
  } catch (err) {
    console.warn('Error fetching categories from Supabase:', err);
    return null;
  }
}

/**
 * Saves or updates a Category in Supabase.
 */
export async function saveCategoryToSupabase(
  category: Category
): Promise<{ success: boolean; error?: string; category?: Category }> {
  if (!supabase) {
    return { success: false, error: 'Supabase is not configured.' };
  }
  try {
    const cleanId = (category.id || `cat_${Date.now()}`).trim();
    const cleanName = (category.name || '').trim();
    if (!cleanName) {
      return { success: false, error: 'Category name is required.' };
    }

    const payload = {
      id: cleanId,
      name: cleanName,
      image_url: category.imageUrl ? category.imageUrl.trim() : null,
      display_order: typeof category.displayOrder === 'number' ? category.displayOrder : 1,
      updated_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from('categories')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .maybeSingle();

    if (error) {
      console.error('Failed to save category to Supabase:', error.message);
      return { success: false, error: error.message };
    }

    const savedCat: Category = {
      id: data?.id || cleanId,
      name: data?.name || cleanName,
      imageUrl: data?.image_url || category.imageUrl || '',
      displayOrder: data?.display_order ?? category.displayOrder ?? 1,
    };

    return { success: true, category: savedCat };
  } catch (err: any) {
    console.error('Exception saving category to Supabase:', err);
    return { success: false, error: err?.message || 'Database error occurred while saving category.' };
  }
}

/**
 * Deletes a Category from Supabase.
 */
export async function deleteCategoryFromSupabase(
  categoryId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase is not configured.' };
  }
  try {
    // Nullify category references on products
    try {
      await supabase
        .from('products')
        .update({ category_id: null })
        .eq('category_id', categoryId);
    } catch {}

    const { error } = await supabase
      .from('categories')
      .delete()
      .eq('id', categoryId);

    if (error) {
      console.error('Failed to delete category from Supabase:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error('Exception deleting category from Supabase:', err);
    return { success: false, error: err?.message || 'Database error occurred while deleting category.' };
  }
}

/**
 * Reorders categories in Supabase.
 */
export async function reorderCategoriesInSupabase(
  categoryList: Category[]
): Promise<{ success: boolean; error?: string }> {
  if (!supabase) {
    return { success: false, error: 'Supabase is not configured.' };
  }
  try {
    const updates = categoryList.map((cat, idx) => ({
      id: cat.id,
      name: cat.name,
      image_url: cat.imageUrl || null,
      display_order: idx + 1,
      updated_at: new Date().toISOString(),
    }));

    const { error } = await supabase
      .from('categories')
      .upsert(updates, { onConflict: 'id' });

    if (error) {
      console.warn('Reorder categories sync failed:', error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.warn('Exception reordering categories in Supabase:', err);
    return { success: false, error: err?.message };
  }
}



