import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Order, OrderItem, Address, Role, OrderStatus, PaymentMethod, PaymentStatus, UnitType, Product, ProductVariant, TieredPrice } from '../types';
import { INITIAL_CATEGORIES } from '../data/seedData';
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

      return {
        id: existingUser.id,
        name: existingUser.name || name || '',
        phone: existingUser.phone,
        role: (existingUser.role as Role) || role,
        referralCode: existingUser.referral_code || `OM${cleanPhone.slice(-4)}`,
        walletBalance: Number(existingUser.outstanding_balance || existingUser.wallet_balance || 0),
        codOrderCount: Number(existingUser.cod_order_count || 0),
        addresses: formattedAddresses,
        createdAt: existingUser.updated_at || existingUser.created_at || new Date().toISOString(),
      };
    }

    // 2. User does not exist, create deterministic customer record in Supabase users table
    const referralCode = `OM${Math.floor(1000 + Math.random() * 9000)}`;
    const newCustomerPayload = {
      id: `usr_${Date.now()}`,
      phone: cleanPhone,
      name: name || (role === Role.SHOPKEEPER ? 'Om Prakash Sharma' : ''),
      role,
      shop_name: name ? `${name}'s Kirana Store` : (role === Role.SHOPKEEPER ? 'Om Distributors' : ''),
      address: '',
      outstanding_balance: 0,
      updated_at: new Date().toISOString(),
    };

    const { data: insertedUser, error: insertError } = await supabase
      .from('users')
      .insert(newCustomerPayload)
      .select()
      .single();

    if (insertError) {
      console.error('Error inserting new user into Supabase:', insertError);
      return null;
    }

    return {
      id: insertedUser.id,
      name: insertedUser.name || '',
      phone: insertedUser.phone,
      role: insertedUser.role as Role,
      referralCode,
      walletBalance: 100,
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

    // 1. Locate existing CUSTOMER record in users table
    const { data: existingRows } = await supabase
      .from('users')
      .select('*')
      .eq('phone', cleanPhone)
      .eq('role', 'CUSTOMER')
      .order('updated_at', { ascending: false })
      .limit(1);

    let targetUser = existingRows && existingRows.length > 0 ? existingRows[0] : null;

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
      // Insert new customer record into users table
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

      const { data: inserted, error: insertError } = await supabase
        .from('users')
        .insert(insertPayload)
        .select()
        .single();

      if (insertError) {
        console.warn('Supabase insert customer profile warning:', insertError.message);
      } else if (inserted) {
        targetUser = inserted;
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

    return {
      id: targetUser?.id || userId,
      name: targetUser?.name || name.trim(),
      phone: cleanPhone,
      role: Role.CUSTOMER,
      referralCode: `OM${cleanPhone.slice(-4)}`,
      walletBalance: Number(targetUser?.outstanding_balance || 0),
      codOrderCount: 0,
      addresses: [finalAddressObj],
      createdAt: targetUser?.updated_at || new Date().toISOString(),
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

    return {
      id: dbUser.id,
      name: dbUser.name || '',
      phone: dbUser.phone,
      role: Role.CUSTOMER,
      referralCode: dbUser.referral_code || `OM${cleanPhone.slice(-4)}`,
      walletBalance: Number(dbUser.outstanding_balance || 0),
      codOrderCount: Number(dbUser.cod_order_count || 0),
      addresses: formattedAddresses,
      createdAt: dbUser.updated_at || new Date().toISOString(),
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
      const fullLabel = match[1].trim();
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

      items.push({
        id: `item-${orderId}-${idx + 1}`,
        orderId,
        variantId: '',
        productName: fullLabel,
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
      const orderNumber = (o.notes || '').replace(/^Order\s*#?/i, '').trim() || o.id.replace(/^ord[-_]/i, '').slice(0, 8);
      const items = parseOrderItemsFromProductName(o['Product Name'], o.id, finalAmount);
      const parsedAddress = parseCustomerAddress(o.delivery_address);

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
        status: (o.status as OrderStatus) || OrderStatus.ORDER_ACCEPTED,
        paymentMethod: (o.payment_method as PaymentMethod) || PaymentMethod.COD,
        paymentStatus: o.is_paid ? PaymentStatus.RECEIVED : PaymentStatus.PENDING,
        deliveryDate: o.preferred_slot || (o.created_at ? o.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
        subtotal,
        discountAmount,
        deliveryFee,
        codCharge: 0,
        finalAmount,
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
      notes: order.orderNumber ? `Order #${order.orderNumber}` : '',
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
      const orderNumber = (o.notes || '').replace(/^Order\s*#?/i, '').trim() || o.id.replace(/^ord[-_]/i, '').slice(0, 8);
      const items = parseOrderItemsFromProductName(o['Product Name'], o.id, finalAmount);
      const parsedAddress = parseCustomerAddress(o.delivery_address);

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
        status: (o.status as OrderStatus) || OrderStatus.ORDER_ACCEPTED,
        paymentMethod: (o.payment_method as PaymentMethod) || PaymentMethod.COD,
        paymentStatus: o.is_paid ? PaymentStatus.RECEIVED : PaymentStatus.PENDING,
        deliveryDate: o.preferred_slot || (o.created_at ? o.created_at.split('T')[0] : new Date().toISOString().split('T')[0]),
        subtotal,
        discountAmount,
        deliveryFee,
        codCharge: 0,
        finalAmount,
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
  isPaid?: boolean
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

    const { error } = await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', orderId);

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
    // Attempt ordering by updated_at (fallback to unsorted if column is unavailable)
    let prodResult = await supabase
      .from('products')
      .select('*')
      .order('updated_at', { ascending: false });

    if (prodResult.error) {
      console.warn('Ordering products by updated_at failed, falling back to unordered select:', prodResult.error.message);
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
        isDiscountExcluded: Boolean(p.is_discount_excluded),
        variants,
        createdAt: p.created_at || p.updated_at || new Date().toISOString(),
      };
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

