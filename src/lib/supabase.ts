import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { User, Order, Address, Role, OrderStatus, PaymentMethod, PaymentStatus, UnitType, Product } from '../types';

// Retrieve credentials from Vite environment variables
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || '';
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

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
    // 1. Check if user with this phone exists in Supabase
    const { data: existingUser, error: selectError } = await supabase
      .from('users')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (selectError && selectError.code !== 'PGRST116') {
      console.warn('Supabase select user warning:', selectError.message);
    }

    if (existingUser) {
      // Fetch associated addresses
      const { data: addresses } = await supabase
        .from('addresses')
        .select('*')
        .eq('user_id', existingUser.id);

      const formattedAddresses: Address[] = (addresses || []).map((a: any) => ({
        id: a.id,
        userId: a.user_id,
        fullAddress: a.full_address || a.fullAddress || '',
        landmark: a.landmark || '',
        pincode: a.pincode || '',
        isDefault: Boolean(a.is_default || a.isDefault),
      }));

      return {
        id: existingUser.id,
        name: existingUser.name || name || '',
        phone: existingUser.phone,
        role: (existingUser.role as Role) || role,
        referralCode: existingUser.referral_code || existingUser.referralCode || `OM${cleanPhone.slice(-4)}`,
        walletBalance: Number(existingUser.wallet_balance || existingUser.walletBalance || 0),
        codOrderCount: Number(existingUser.cod_order_count || existingUser.codOrderCount || 0),
        addresses: formattedAddresses,
        createdAt: existingUser.created_at || new Date().toISOString(),
      };
    }

    // 2. User does not exist, create deterministic customer record in Supabase
    const referralCode = `OM${Math.floor(1000 + Math.random() * 9000)}`;
    const newCustomerPayload = {
      phone: cleanPhone,
      name: name || (role === Role.SHOPKEEPER ? 'Om Prakash Sharma' : ''),
      role,
      referral_code: referralCode,
      wallet_balance: 100, // Welcome ₹100 bonus
      cod_order_count: 0,
      created_at: new Date().toISOString(),
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

    // For a brand new customer, Address and Landmark are initially blank
    return {
      id: insertedUser.id,
      name: insertedUser.name || '',
      phone: insertedUser.phone,
      role: insertedUser.role as Role,
      referralCode: insertedUser.referral_code || referralCode,
      walletBalance: Number(insertedUser.wallet_balance || 100),
      codOrderCount: Number(insertedUser.cod_order_count || 0),
      addresses: [],
      createdAt: insertedUser.created_at,
    };
  } catch (err) {
    console.error('Error in getOrCreateCustomerByPhone:', err);
    return null;
  }
}

/**
 * Saves or updates a customer profile (Name, Address, Landmark) in Supabase.
 */
export async function saveCustomerProfileToSupabase(
  userId: string,
  phone: string,
  name: string,
  fullAddress: string,
  landmark: string,
  pincode: string = '422001'
): Promise<User | null> {
  if (!supabase) return null;
  const cleanPhone = phone.replace(/\D/g, '');

  try {
    // 1. Update user name in Supabase users table
    const { data: updatedUser, error: userError } = await supabase
      .from('users')
      .update({ name: name.trim() })
      .eq('phone', cleanPhone)
      .select()
      .maybeSingle();

    if (userError) {
      console.warn('Supabase update user name warning:', userError.message);
    }

    const targetUserId = updatedUser?.id || userId;

    // 2. Upsert customer address in Supabase addresses table
    const { data: existingAddresses } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', targetUserId)
      .limit(1);

    let finalAddress: Address;

    if (existingAddresses && existingAddresses.length > 0) {
      const existingAddrId = existingAddresses[0].id;
      const { data: updatedAddr } = await supabase
        .from('addresses')
        .update({
          full_address: fullAddress.trim(),
          landmark: landmark.trim(),
          pincode: pincode.trim(),
          is_default: true,
        })
        .eq('id', existingAddrId)
        .select()
        .single();

      finalAddress = {
        id: existingAddrId,
        userId: targetUserId,
        fullAddress: fullAddress.trim(),
        landmark: landmark.trim(),
        pincode: pincode.trim(),
        isDefault: true,
      };
    } else {
      const newAddrId = `addr-${targetUserId}-1`;
      await supabase.from('addresses').insert({
        id: newAddrId,
        user_id: targetUserId,
        full_address: fullAddress.trim(),
        landmark: landmark.trim(),
        pincode: pincode.trim(),
        is_default: true,
      });

      finalAddress = {
        id: newAddrId,
        userId: targetUserId,
        fullAddress: fullAddress.trim(),
        landmark: landmark.trim(),
        pincode: pincode.trim(),
        isDefault: true,
      };
    }

    return {
      id: targetUserId,
      name: updatedUser?.name || name.trim(),
      phone: cleanPhone,
      role: (updatedUser?.role as Role) || Role.CUSTOMER,
      referralCode: updatedUser?.referral_code || `OM${cleanPhone.slice(-4)}`,
      walletBalance: Number(updatedUser?.wallet_balance || 0),
      codOrderCount: Number(updatedUser?.cod_order_count || 0),
      addresses: [finalAddress],
      createdAt: updatedUser?.created_at || new Date().toISOString(),
    };
  } catch (err) {
    console.error('Error saving customer profile to Supabase:', err);
    return null;
  }
}

/**
 * Fetch customer profile (Name, Address, Landmark, Contact Number) from Supabase by phone.
 */
export async function fetchCustomerProfileFromSupabase(phone: string): Promise<User | null> {
  if (!supabase) return null;
  const cleanPhone = phone.replace(/\D/g, '');

  try {
    const { data: dbUser, error: userError } = await supabase
      .from('users')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (userError || !dbUser) {
      return null;
    }

    const { data: addresses } = await supabase
      .from('addresses')
      .select('*')
      .eq('user_id', dbUser.id);

    const formattedAddresses: Address[] = (addresses || []).map((a: any) => ({
      id: a.id,
      userId: a.user_id,
      fullAddress: a.full_address || a.fullAddress || '',
      landmark: a.landmark || '',
      pincode: a.pincode || '',
      isDefault: Boolean(a.is_default || a.isDefault),
    }));

    return {
      id: dbUser.id,
      name: dbUser.name || '',
      phone: dbUser.phone,
      role: (dbUser.role as Role) || Role.CUSTOMER,
      referralCode: dbUser.referral_code || `OM${cleanPhone.slice(-4)}`,
      walletBalance: Number(dbUser.wallet_balance || 0),
      codOrderCount: Number(dbUser.cod_order_count || 0),
      addresses: formattedAddresses,
      createdAt: dbUser.created_at,
    };
  } catch (err) {
    console.warn('Error fetching customer profile from Supabase:', err);
    return null;
  }
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
    const { data: ordersData, error: ordersError } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .or(`user_id.eq.${customerId},user_phone.eq.${phone}`)
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.warn('Error fetching orders from Supabase:', ordersError.message);
      return null;
    }

    if (!ordersData) return [];

    return ordersData.map((o: any) => ({
      id: o.id,
      orderNumber: o.order_number || o.orderNumber || `OM-${o.id.slice(0, 5)}`,
      userId: o.user_id || customerId,
      userName: o.user_name || o.userName || 'Customer',
      userPhone: o.user_phone || phone,
      addressId: o.address_id || 'addr-default',
      address: o.shipping_address || o.address || {
        id: o.address_id || 'addr-default',
        userId: o.user_id || customerId,
        fullAddress: o.delivery_address || 'Nashik City Doorstep',
        landmark: '',
        pincode: '422001',
        isDefault: true,
      },
      status: (o.status as OrderStatus) || OrderStatus.ORDER_ACCEPTED,
      paymentMethod: (o.payment_method as PaymentMethod) || PaymentMethod.COD,
      paymentStatus: (o.payment_status as PaymentStatus) || PaymentStatus.PENDING,
      deliveryDate: o.delivery_date || new Date().toISOString().split('T')[0],
      subtotal: Number(o.subtotal || 0),
      discountAmount: Number(o.discount_amount || 0),
      deliveryFee: Number(o.delivery_fee || 0),
      codCharge: Number(o.cod_charge || 0),
      finalAmount: Number(o.final_amount || 0),
      razorpayOrderId: o.razorpay_order_id,
      razorpayPaymentId: o.razorpay_payment_id,
      createdAt: o.created_at || new Date().toISOString(),
      items: (o.order_items || []).map((item: any) => ({
        id: item.id,
        orderId: o.id,
        variantId: item.product_variant_id || item.variantId || '',
        variantName: item.variant_name || item.pack_label || '',
        productName: item.product_name || '',
        brand: item.brand || '',
        unit: (item.unit as UnitType) || UnitType.KG,
        packSize: Number(item.pack_size || 1),
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unit_price || 0),
        price: Number(item.total_price || item.price || 0),
      })),
    }));
  } catch (err) {
    console.error('Failed to query orders from Supabase:', err);
    return null;
  }
}

/**
 * Saves a new order centrally to Supabase.
 */
export async function saveOrderToSupabase(order: Order): Promise<boolean> {
  if (!supabase) return false;

  try {
    // 1. Insert order header
    const orderPayload = {
      id: order.id,
      order_number: order.orderNumber,
      user_id: order.userId,
      user_name: order.userName,
      user_phone: order.userPhone,
      address_id: order.addressId,
      shipping_address: order.address,
      status: order.status,
      payment_method: order.paymentMethod,
      payment_status: order.paymentStatus,
      delivery_date: order.deliveryDate,
      subtotal: order.subtotal,
      discount_amount: order.discountAmount,
      delivery_fee: order.deliveryFee,
      cod_charge: order.codCharge,
      final_amount: order.finalAmount,
      razorpay_order_id: order.razorpayOrderId || null,
      razorpay_payment_id: order.razorpayPaymentId || null,
      created_at: order.createdAt,
    };

    const { error: orderError } = await supabase.from('orders').insert(orderPayload);
    if (orderError) {
      console.error('Failed to save order to Supabase:', orderError);
      return false;
    }

    // 2. Insert order items
    if (order.items && order.items.length > 0) {
      const itemsPayload = order.items.map((item) => ({
        id: item.id,
        order_id: order.id,
        product_variant_id: item.variantId,
        product_name: item.productName || '',
        variant_name: item.variantName || '',
        brand: item.brand || '',
        unit: item.unit || UnitType.KG,
        pack_size: item.packSize || 1,
        quantity: item.quantity,
        unit_price: item.unitPrice,
        total_price: item.price,
      }));

      const { error: itemsError } = await supabase.from('order_items').insert(itemsPayload);
      if (itemsError) {
        console.warn('Failed to save order items to Supabase:', itemsError);
      }
    }

    // 3. Increment COD count in Supabase if payment was COD
    if (order.paymentMethod === PaymentMethod.COD) {
      try {
        await supabase.rpc('increment_cod_count', { user_id: order.userId });
      } catch {
        // Fallback standard update
        const { data: userRow } = await supabase
          .from('users')
          .select('cod_order_count')
          .eq('id', order.userId)
          .single();
        if (userRow) {
          await supabase
            .from('users')
            .update({ cod_order_count: (userRow.cod_order_count || 0) + 1 })
            .eq('id', order.userId);
        }
      }
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
      .select('*, order_items(*)')
      .order('created_at', { ascending: false });

    if (ordersError) {
      console.warn('Error fetching all orders for admin:', ordersError.message);
      return null;
    }

    if (!ordersData) return [];

    return ordersData.map((o: any) => ({
      id: o.id,
      orderNumber: o.order_number || o.orderNumber || `OM-${o.id.slice(0, 5)}`,
      userId: o.user_id,
      userName: o.user_name || 'Customer',
      userPhone: o.user_phone || '',
      addressId: o.address_id || 'addr-default',
      address: o.shipping_address || o.address || {
        id: o.address_id || 'addr-default',
        userId: o.user_id,
        fullAddress: o.delivery_address || 'Nashik City Doorstep',
        landmark: '',
        pincode: '422001',
        isDefault: true,
      },
      status: (o.status as OrderStatus) || OrderStatus.ORDER_ACCEPTED,
      paymentMethod: (o.payment_method as PaymentMethod) || PaymentMethod.COD,
      paymentStatus: (o.payment_status as PaymentStatus) || PaymentStatus.PENDING,
      deliveryDate: o.delivery_date || new Date().toISOString().split('T')[0],
      subtotal: Number(o.subtotal || 0),
      discountAmount: Number(o.discount_amount || 0),
      deliveryFee: Number(o.delivery_fee || 0),
      codCharge: Number(o.cod_charge || 0),
      finalAmount: Number(o.final_amount || 0),
      razorpayOrderId: o.razorpay_order_id,
      razorpayPaymentId: o.razorpay_payment_id,
      createdAt: o.created_at || new Date().toISOString(),
      items: (o.order_items || []).map((item: any) => ({
        id: item.id,
        orderId: o.id,
        variantId: item.product_variant_id || item.variantId || '',
        variantName: item.variant_name || item.pack_label || '',
        productName: item.product_name || '',
        brand: item.brand || '',
        unit: (item.unit as UnitType) || UnitType.KG,
        packSize: Number(item.pack_size || 1),
        quantity: Number(item.quantity || 1),
        unitPrice: Number(item.unit_price || 0),
        price: Number(item.total_price || item.price || 0),
      })),
    }));
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
  newStatus: OrderStatus
): Promise<boolean> {
  if (!supabase) return false;

  try {
    const { error } = await supabase
      .from('orders')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
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
