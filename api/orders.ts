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
  enforceOverdueCodLateFees,
  parseCodMetaFromNotes,
} from './_codLateFee.js';
import { processCancelOrderRequest } from './_orderCancellation.js';

export interface OrderAuthContext {
  adminSession: AdminSession | null;
  customerSession: CustomerSession | null;
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

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
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

export async function processGetOrdersRequest(
  supabase: SupabaseClient,
  auth: OrderAuthContext,
  query?: { phoneParam?: string | null; allParam?: string | null }
): Promise<{ statusCode: number; payload: any }> {
  const isShopkeeper = Boolean(auth?.adminSession && auth.adminSession.role === 'SHOPKEEPER');
  const customerSession =
    auth?.customerSession && auth.customerSession.role === 'CUSTOMER'
      ? auth.customerSession
      : null;

  const phoneParam = query?.phoneParam ?? null;
  const allParam = query?.allParam ?? null;

  // 1. Admin shopkeeper view: Authorized strictly by verified SHOPKEEPER cookie session
  if (isShopkeeper) {
    try {
      const cleanAdminPhoneFilter = phoneParam ? phoneParam.replace(/\D/g, '').slice(-10) : '';
      const adminLateFeeRes = await enforceOverdueCodLateFees(
        supabase,
        cleanAdminPhoneFilter ? { phone: cleanAdminPhoneFilter } : undefined
      );
      if (adminLateFeeRes.errors.length > 0) {
        console.error('COD late fee enforcement errors (admin GET):', adminLateFeeRes.errors);
      }

      let dbQuery = supabase.from('orders').select('*').order('created_at', { ascending: false });
      if (cleanAdminPhoneFilter) {
        dbQuery = dbQuery.eq('customer_phone', cleanAdminPhoneFilter);
      }
      const { data: ordersData, error: ordersErr } = await dbQuery;
      if (ordersErr) return { statusCode: 500, payload: { success: false, error: ordersErr.message } };

      const orders = ordersData || [];
      const orderIds = orders.map((o: any) => o.id).filter(Boolean);

      // Fetch relational order_items mirror
      const itemsByOrder = new Map<string, any[]>();
      if (orderIds.length > 0) {
        const { data: itemsData } = await supabase
          .from('order_items')
          .select('*')
          .in('order_id', orderIds);

        if (itemsData) {
          for (const it of itemsData) {
            if (!itemsByOrder.has(it.order_id)) {
              itemsByOrder.set(it.order_id, []);
            }
            itemsByOrder.get(it.order_id)!.push({
              id: it.id,
              orderId: it.order_id,
              productId: it.product_id,
              variantId: it.product_variant_id,
              productName: it.product_name,
              variantName: it.variant_name,
              brand: it.brand,
              unit: it.unit,
              packSize: Number(it.pack_size) || 1,
              quantity: Number(it.quantity) || 1,
              unitPrice: Number(it.unit_price) || 0,
              price: Number(it.total_price) || 0,
              isDiscountExcluded: Boolean(it.is_discount_excluded),
            });
          }
        }
      }

      const enrichedOrders = orders.map((o: any) => {
        const relationalItems = itemsByOrder.get(o.id);
        if (relationalItems && relationalItems.length > 0) {
          return { ...o, items: relationalItems };
        }
        return o;
      });

      return { statusCode: 200, payload: { success: true, orders: enrichedOrders } };
    } catch (err: any) {
      return { statusCode: 500, payload: { success: false, error: err?.message || 'Server error' } };
    }
  }

  // 2. Customer view: STRICTLY requires a verified server-side CUSTOMER session
  // NEVER grants access solely from URL ?phone=... or unauthenticated request params
  if (!customerSession) {
    return {
      statusCode: 401,
      payload: {
        success: false,
        error: 'Unauthorized: Verified customer or shopkeeper session required to view orders.',
      },
    };
  }

  // Separate Shopkeeper vs Customer capabilities cleanly
  if (allParam === 'true') {
    return {
      statusCode: 403,
      payload: {
        success: false,
        error: 'Forbidden: Shopkeeper authorization required to view all store orders.',
      },
    };
  }

  // Ownership check: If query specifies ?phone=..., it MUST match the authenticated customer's verified phone
  if (phoneParam && phoneParam.trim()) {
    const requestedPhone = phoneParam.replace(/\D/g, '').slice(-10);
    if (requestedPhone.length !== 10) {
      return { statusCode: 400, payload: { success: false, error: 'Invalid 10-digit phone number' } };
    }
    if (requestedPhone !== customerSession.phone) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: You can only view your own orders.',
        },
      };
    }
  }

  const authorizedPhone = customerSession.phone;

  try {
    const custLateFeeRes = await enforceOverdueCodLateFees(supabase, { phone: authorizedPhone });
    if (custLateFeeRes.errors.length > 0) {
      console.error('COD late fee enforcement errors (customer GET):', custLateFeeRes.errors);
    }

    const { data: ordersData, error: ordersErr } = await supabase
      .from('orders')
      .select('*')
      .eq('customer_phone', authorizedPhone)
      .order('created_at', { ascending: false });

    if (ordersErr) {
      return { statusCode: 500, payload: { success: false, error: ordersErr.message } };
    }

    const orders = (ordersData || []).filter((o: any) => {
      const orderPhone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
      return orderPhone === authorizedPhone;
    });
    const orderIds = orders.map((o: any) => o.id).filter(Boolean);

    // Fetch relational order_items mirror
    const itemsByOrder = new Map<string, any[]>();
    if (orderIds.length > 0) {
      const { data: itemsData } = await supabase
        .from('order_items')
        .select('*')
        .in('order_id', orderIds);

      if (itemsData) {
        for (const it of itemsData) {
          if (!itemsByOrder.has(it.order_id)) {
            itemsByOrder.set(it.order_id, []);
          }
          itemsByOrder.get(it.order_id)!.push({
            id: it.id,
            orderId: it.order_id,
            productId: it.product_id,
            variantId: it.product_variant_id,
            productName: it.product_name,
            variantName: it.variant_name,
            brand: it.brand,
            unit: it.unit,
            packSize: Number(it.pack_size) || 1,
            quantity: Number(it.quantity) || 1,
            unitPrice: Number(it.unit_price) || 0,
            price: Number(it.total_price) || 0,
            isDiscountExcluded: Boolean(it.is_discount_excluded),
          });
        }
      }
    }

    const enrichedOrders = orders.map((o: any) => {
      const relationalItems = itemsByOrder.get(o.id);
      if (relationalItems && relationalItems.length > 0) {
        return { ...o, items: relationalItems };
      }
      return o;
    });

    return { statusCode: 200, payload: { success: true, orders: enrichedOrders } };
  } catch (err: any) {
    return { statusCode: 500, payload: { success: false, error: err?.message || 'Server error' } };
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const method = req.method?.toUpperCase();
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const supabase = getServerSupabaseClient();

  if (!supabase) {
    return sendJson(res, 500, {
      success: false,
      error: 'Database service is not configured or unavailable.',
    });
  }

  // ============================================================================
  // 1. GET: Fetch Orders (Admin sees all; Verified Customer sees ONLY their own orders)
  // ============================================================================
  if (method === 'GET') {
    const adminSession = verifyAdminSession(req);
    const customerSession = verifyCustomerSession(req);
    const phoneParam = url.searchParams.get('phone');
    const allParam = url.searchParams.get('all');

    const result = await processGetOrdersRequest(
      supabase,
      { adminSession, customerSession },
      { phoneParam, allParam }
    );
    return sendJson(res, result.statusCode, result.payload);
  }

  // ============================================================================
  // 2. POST: Secure Server-Side Checkout & Order Placement
  // ============================================================================
  if (method === 'POST') {
    try {
      const adminSession = verifyAdminSession(req);
      const customerSession = verifyCustomerSession(req);
      const body = await parseJsonBody(req);
      const result = await processCreateOrderRequest(supabase, body, {
        adminSession,
        customerSession,
      });
      return sendJson(res, result.statusCode, result.payload);
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Server error creating order' });
    }
  }

  // ============================================================================
  // 3. PUT: Order Status, Edits, Refunds & Payment Updates
  //    - Cancellation (status === 'CANCELLED'): Verified SHOPKEEPER session only
  //      (Customers cannot cancel orders under any circumstances; HTTP 403)
  //    - All other status transitions/edits: Verified SHOPKEEPER session only
  // ============================================================================
  if (method === 'PUT') {
    const adminSession = verifyAdminSession(req);
    const customerSession = !adminSession || adminSession.role !== 'SHOPKEEPER'
      ? verifyCustomerSession(req)
      : null;

    try {
      const body = await parseJsonBody(req);
      const result = await processUpdateOrderRequest(supabase, body, {
        adminSession,
        customerSession,
      });
      return sendJson(res, result.statusCode, result.payload);
    } catch (err: any) {
      return sendJson(res, 500, {
        success: false,
        error: err?.message || 'Server error updating order',
      });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT');
  return sendJson(res, 405, { success: false, error: `Method ${method} Not Allowed` });
}

export async function processUpdateOrderRequest(
  supabase: SupabaseClient,
  body: any,
  auth: OrderAuthContext
): Promise<{ statusCode: number; payload: any }> {
  const isShopkeeper = Boolean(auth?.adminSession && auth.adminSession.role === 'SHOPKEEPER');
  const customerSession =
    !isShopkeeper && auth?.customerSession && auth.customerSession.role === 'CUSTOMER'
      ? auth.customerSession
      : null;

  if (!isShopkeeper && !customerSession) {
    return {
      statusCode: 401,
      payload: {
        success: false,
        error: 'Unauthorized: Verified session required to update orders',
      },
    };
  }

  const normalizedStatus = String(body?.status || '').trim().toUpperCase();

  // Route cancellation requests strictly for verified SHOPKEEPER only; reject Customers with 403 before RPC
  if (normalizedStatus === 'CANCELLED') {
    if (!isShopkeeper) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: Customers cannot cancel orders. Only the shopkeeper can cancel orders.',
        },
      };
    }
    return processCancelOrderRequest(supabase, body, {
      adminSession: auth?.adminSession || null,
      customerSession: null,
    });
  }

  if (!isShopkeeper) {
    return {
      statusCode: 403,
      payload: {
        success: false,
        error: 'Forbidden: Only the shopkeeper can update or cancel orders.',
      },
    };
  }

  const rawOrderId = String(body?.id || body?.orderId || '').trim();
  if (!rawOrderId) {
    return { statusCode: 400, payload: { success: false, error: 'Order ID is required' } };
  }

  const resolvedFinalTotal =
    body.finalAmount !== undefined
      ? Number(body.finalAmount)
      : body.finalTotal !== undefined
      ? Number(body.finalTotal)
      : null;

  const parsedSubtotal =
    body.subtotal !== undefined && !isNaN(Number(body.subtotal)) ? Number(body.subtotal) : null;
  const parsedDiscount =
    body.discountAmount !== undefined && !isNaN(Number(body.discountAmount))
      ? Number(body.discountAmount)
      : null;
  const parsedWeightKg =
    body.weightKg !== undefined && body.weightKg !== null && !isNaN(Number(body.weightKg))
      ? Number(body.weightKg)
      : null;

  const { data: rpcData, error: rpcError } = await supabase.rpc('transition_order_status_atomic', {
    p_order_id: rawOrderId,
    p_new_status: body.status ? String(body.status) : null,
    p_payment_status: body.paymentStatus ? String(body.paymentStatus) : null,
    p_is_paid: typeof body.isPaid === 'boolean' ? body.isPaid : null,
    p_subtotal: parsedSubtotal,
    p_discount_amount: parsedDiscount,
    p_final_total:
      resolvedFinalTotal !== null && !isNaN(resolvedFinalTotal) ? resolvedFinalTotal : null,
    p_product_name_serialized:
      typeof body.productNameSerialized === 'string' ? body.productNameSerialized : null,
    p_weight_kg: parsedWeightKg,
    p_notes: typeof body.notes === 'string' ? body.notes : null,
    p_delivered_at: body.deliveredAt ? String(body.deliveredAt) : null,
    p_deduct_stock: Boolean(body.deductStockOnAccept),
    p_expected_updated_at: body.expectedUpdatedAt ? String(body.expectedUpdatedAt) : null,
  });

  if (rpcError) {
    const code = String(rpcError.code || '').trim();
    const msg = String(rpcError.message || 'Atomic order update RPC failed');
    const isMissingRpc =
      code === '42883' ||
      code === 'PGRST202' ||
      /could not find the function|transition_order_status_atomic/i.test(msg);

    return {
      statusCode: 500,
      payload: {
        success: false,
        error: isMissingRpc
          ? 'Atomic order transition database function is not installed. Please apply supabase_order_cancellation_atomic_v2.sql.'
          : msg,
      },
    };
  }

  if (!rpcData || typeof rpcData !== 'object') {
    return {
      statusCode: 500,
      payload: {
        success: false,
        error: 'Atomic order transition returned an empty database response.',
      },
    };
  }

  const rpcStatusCode = Number(rpcData.statusCode) || (rpcData.ok ? 200 : 500);
  if (!rpcData.ok) {
    return {
      statusCode: rpcStatusCode,
      payload: {
        success: false,
        error: String(rpcData.error || 'Failed to update order.'),
      },
    };
  }

  const resolvedOrderId = String(rpcData.order?.id || rawOrderId);

  if (Array.isArray(body.items) && body.items.length > 0) {
    await supabase.from('order_items').delete().eq('order_id', resolvedOrderId);
    const orderItemsPayload = body.items.map((it: any, idx: number) => ({
      id: it.id || `item-${Date.now()}-${idx}`,
      order_id: resolvedOrderId,
      product_id: it.productId || null,
      product_variant_id: it.variantId || null,
      product_name: it.productName || 'Grocery Item',
      variant_name: it.variantName || null,
      brand: it.brand || null,
      unit: it.unit || 'PIECE',
      pack_size: Number(it.packSize) || 1,
      quantity: Math.max(1, Number(it.quantity) || 1),
      unit_price: Number(it.unitPrice) || 0,
      total_price: Number(it.price) || 0,
      is_discount_excluded: Boolean(it.isDiscountExcluded),
      created_at: new Date().toISOString(),
    }));
    await supabase.from('order_items').insert(orderItemsPayload);
  }

  return {
    statusCode: 200,
    payload: {
      success: true,
      stockDeducted: Boolean(rpcData.stockDeducted),
      order: rpcData.order,
    },
  };
}

export async function processCreateOrderRequest(
  supabase: SupabaseClient,
  body: any,
  auth: OrderAuthContext
): Promise<{ statusCode: number; payload: any }> {
  const isShopkeeper = Boolean(auth?.adminSession && auth.adminSession.role === 'SHOPKEEPER');
  const customerSession =
    !isShopkeeper && auth?.customerSession && auth.customerSession.role === 'CUSTOMER'
      ? auth.customerSession
      : null;

  // Fail closed: never grant order creation rights from body/phone alone
  if (!isShopkeeper && !customerSession) {
    return {
      statusCode: 401,
      payload: {
        success: false,
        error: 'Unauthorized: Verified customer or shopkeeper session is required to place an order.',
      },
    };
  }

  const rawPhone = String(body?.customerPhone || body?.phone || body?.userPhone || '').trim();
  const cleanBodyPhone = rawPhone.replace(/\D/g, '').slice(-10);

  let cleanPhone = '';
  if (!isShopkeeper && customerSession) {
    // Customer role: enforce strict ownership against verified session phone & customerId
    if (rawPhone && (cleanBodyPhone.length !== 10 || cleanBodyPhone !== customerSession.phone)) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: You can only place orders for your own verified mobile number.',
        },
      };
    }

    const rawBodyCustomerId =
      body?.customerId !== undefined && body?.customerId !== null
        ? String(body.customerId).trim()
        : '';
    if (rawBodyCustomerId && rawBodyCustomerId !== customerSession.customerId) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: You cannot place an order using another customer ID.',
        },
      };
    }

    cleanPhone = customerSession.phone;
  } else {
    // Shopkeeper role: verified session allows placing orders on behalf of a customer
    if (!cleanBodyPhone || cleanBodyPhone.length !== 10) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: 'Valid 10-digit customer phone number is required for order verification',
        },
      };
    }
    cleanPhone = cleanBodyPhone;
  }

  const rawItems = Array.isArray(body?.items) ? body.items : [];
  if (rawItems.length === 0) {
    return {
      statusCode: 400,
      payload: { success: false, error: 'Order must contain at least one item' },
    };
  }

  const formatExistingOrderPayload = (row: any) => {
    const parsedMeta = parseCodMetaFromNotes(row?.notes)?.meta || {};
    const metaItems = Array.isArray(parsedMeta.items) ? parsedMeta.items : [];
    const subtotalVal = Number(row?.subtotal) || 0;
    const discountVal = Number(row?.discount_amount) || 0;
    const finalVal = Number(row?.final_total) || 0;
    const codChargeVal = Number(parsedMeta.codCharge) || 0;
    const walletUsedVal = Number(parsedMeta.walletAmountUsed) || 0;
    const deliveryVal = Math.max(
      0,
      Math.round((finalVal - subtotalVal + discountVal - codChargeVal) * 100) / 100
    );
    const isRowAdvance =
      row?.payment_method === 'ADVANCE_ONLINE' ||
      row?.payment_method === 'ONLINE' ||
      row?.payment_method === 'UPI';
    const resolvedPaymentStatus =
      row?.payment_status ||
      (row?.is_paid || isRowAdvance ? 'RECEIVED' : 'PENDING');
    return {
      id: row.id,
      orderNumber: row.order_number,
      customerPhone: row.customer_phone,
      status: row.status || 'ORDER_PENDING',
      paymentStatus: resolvedPaymentStatus,
      isPaid: Boolean(
        row?.is_paid ||
          String(resolvedPaymentStatus).toUpperCase() === 'RECEIVED' ||
          String(resolvedPaymentStatus).toUpperCase() === 'PAID'
      ),
      createdAt: row.created_at,
      previousOutstanding: Number(parsedMeta.prevOutstanding) || 0,
      subtotal: subtotalVal,
      deliveryFee: deliveryVal,
      codCharge: codChargeVal,
      discountAmount: discountVal,
      finalAmount: finalVal,
      walletAmountUsed: walletUsedVal,
      totalPayable:
        parsedMeta.totalPayable !== undefined
          ? Number(parsedMeta.totalPayable)
          : isRowAdvance
          ? Math.max(0, Math.round((finalVal - walletUsedVal) * 100) / 100)
          : finalVal,
      paymentMethod: row.payment_method || 'COD',
      items: metaItems,
    };
  };

  // Idempotency Check #1: If client supplies an orderId that already exists, return it idempotently
  const requestedOrderId = typeof body?.orderId === 'string' ? body.orderId.trim() : '';
  if (requestedOrderId) {
    const { data: existingById, error: existingLookupErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', requestedOrderId)
      .maybeSingle();

    if (!existingLookupErr && existingById) {
      const existingPhone = String(existingById.customer_phone || '').replace(/\D/g, '').slice(-10);
      if (!isShopkeeper && existingPhone && existingPhone !== cleanPhone) {
        return {
          statusCode: 409,
          payload: {
            success: false,
            error: 'Order ID already exists for another customer.',
          },
        };
      }
      return {
        statusCode: 200,
        payload: {
          success: true,
          deduplicated: true,
          order: formatExistingOrderPayload(existingById),
        },
      };
    }
  }

  // Check customer active status in database (resolve via phone, UUID, or phone variants)
  let dbCustomer: any = null;
  let dbCustomerLookupError: any = null;

  try {
    const byPhoneRes = await supabase
      .from('users')
      .select('*')
      .eq('phone', cleanPhone)
      .maybeSingle();
    if (byPhoneRes?.error) {
      dbCustomerLookupError = byPhoneRes.error;
    } else if (byPhoneRes?.data) {
      dbCustomer = byPhoneRes.data;
    }
  } catch (err: any) {
    dbCustomerLookupError = err;
  }

  if (!dbCustomer && customerSession?.customerId && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(customerSession.customerId)) {
    try {
      const byIdRes = await supabase
        .from('users')
        .select('*')
        .eq('id', customerSession.customerId)
        .maybeSingle();
      if (byIdRes?.error) {
        dbCustomerLookupError = dbCustomerLookupError || byIdRes.error;
      } else if (byIdRes?.data) {
        dbCustomer = byIdRes.data;
        dbCustomerLookupError = null;
      }
    } catch (err: any) {
      dbCustomerLookupError = dbCustomerLookupError || err;
    }
  }

  if (!dbCustomer) {
    try {
      const byVarRes = await supabase
        .from('users')
        .select('*')
        .in('phone', [cleanPhone, `+91${cleanPhone}`, `91${cleanPhone}`, `0${cleanPhone}`])
        .limit(1);
      if (byVarRes?.error) {
        dbCustomerLookupError = dbCustomerLookupError || byVarRes.error;
      } else if (Array.isArray(byVarRes?.data) && byVarRes.data.length > 0) {
        dbCustomer = byVarRes.data[0];
        dbCustomerLookupError = null;
      }
    } catch (err: any) {
      dbCustomerLookupError = dbCustomerLookupError || err;
    }
  }

  // Load authoritative settings from database (advance discount strictly defaults to 0.00%)
  let advanceDiscountPct = 0.0; // 0.00% safe default advance payment discount
  let codBaseCharge = 0.0;      // ₹0 initial COD fee
  let freeShippingMin = 249.0;  // ₹249 free delivery threshold
  let baseDeliveryFee = 11.0;   // ₹11 standard delivery fee

  try {
    const { data: storeSettings, error: storeSettingsError } = await supabase
      .from('store_settings')
      .select('*')
      .eq('id', 'global_settings')
      .maybeSingle();

    if (!storeSettingsError && storeSettings) {
      const rawDiscount = storeSettings.advance_discount_percentage;
      if (
        rawDiscount !== undefined &&
        rawDiscount !== null &&
        String(rawDiscount).trim() !== '' &&
        Number.isFinite(Number(rawDiscount))
      ) {
        advanceDiscountPct = Math.max(0, Math.round(Number(rawDiscount) * 100) / 100);
      }
      if (storeSettings.cod_base_charge !== undefined) {
        codBaseCharge = Number(storeSettings.cod_base_charge);
      }
      if (storeSettings.free_shipping_min_amount !== undefined) {
        freeShippingMin = Number(storeSettings.free_shipping_min_amount);
      }
      if (storeSettings.base_delivery_fee !== undefined) {
        baseDeliveryFee = Number(storeSettings.base_delivery_fee);
      }
    }
  } catch {
    // Fall back safely to defaults (advanceDiscountPct remains 0.0)
    advanceDiscountPct = 0.0;
  }

  // Query products, variants, and wholesale slabs from database to authoritatively verify stock, limits, and prices
  const variantIds = rawItems.map((it: any) => String(it?.variantId || '').trim()).filter(Boolean);
  const productIds = rawItems.map((it: any) => String(it?.productId || '').trim()).filter(Boolean);

  const { data: dbProducts, error: dbProductsError } = await supabase
    .from('products')
    .select('*')
    .in('id', productIds.length > 0 ? productIds : ['none']);

  if (dbProductsError) {
    console.error('[POST /api/orders] dbProductsError:', {
      operation: 'POST /api/orders -> processCreateOrderRequest (select products)',
      code: dbProductsError.code ?? null,
      message: dbProductsError.message ?? null,
      details: dbProductsError.details ?? null,
      hint: dbProductsError.hint ?? null,
    });
    return {
      statusCode: 500,
      payload: { success: false, error: 'Failed to verify products against database' },
    };
  }

  // Fetch all variants associated with these products to know whether products have variants in the database
  const { data: dbVariants, error: dbVariantsError } = await supabase
    .from('product_variants')
    .select('*')
    .in('product_id', productIds.length > 0 ? productIds : ['none']);

  if (dbVariantsError) {
    console.error('[POST /api/orders] dbVariantsError:', {
      operation: 'POST /api/orders -> processCreateOrderRequest (select product_variants)',
      code: dbVariantsError.code ?? null,
      message: dbVariantsError.message ?? null,
      details: dbVariantsError.details ?? null,
      hint: dbVariantsError.hint ?? null,
    });
    return {
      statusCode: 500,
      payload: { success: false, error: 'Failed to verify product variants against database' },
    };
  }

  const prodMap = new Map<string, any>((dbProducts || []).map((p: any) => [p.id, p]));
  const varMap = new Map<string, any>((dbVariants || []).map((v: any) => [v.id, v]));

  // Resolve any variants referenced directly (or belonging to another product) by ID
  const missingVariantIds = variantIds.filter((vid: string) => !varMap.has(vid));
  if (missingVariantIds.length > 0) {
    const { data: extraVariants, error: extraVarErr } = await supabase
      .from('product_variants')
      .select('*')
      .in('id', missingVariantIds);

    if (extraVarErr) {
      console.error('[POST /api/orders] extraVarErr:', {
        operation: 'POST /api/orders -> processCreateOrderRequest (select missing product_variants)',
        code: extraVarErr.code ?? null,
        message: extraVarErr.message ?? null,
        details: extraVarErr.details ?? null,
        hint: extraVarErr.hint ?? null,
      });
      return {
        statusCode: 500,
        payload: { success: false, error: 'Failed to verify selected variants against database' },
      };
    }

    const extraProdIds: string[] = [];
    for (const ev of extraVariants || []) {
      varMap.set(ev.id, ev);
      if (ev.product_id && !prodMap.has(ev.product_id)) {
        extraProdIds.push(ev.product_id);
      }
    }

    if (extraProdIds.length > 0) {
      const { data: extraProds } = await supabase
        .from('products')
        .select('*')
        .in('id', extraProdIds);
      for (const ep of extraProds || []) {
        prodMap.set(ep.id, ep);
      }

      const { data: extraProdAllVars } = await supabase
        .from('product_variants')
        .select('*')
        .in('product_id', extraProdIds);
      for (const ev2 of extraProdAllVars || []) {
        if (!varMap.has(ev2.id)) {
          varMap.set(ev2.id, ev2);
        }
      }
    }
  }

  // Also fetch tiered prices for both variant IDs and product IDs (for variant-less products)
  const targetIds = Array.from(new Set([...variantIds, ...productIds, ...Array.from(prodMap.keys())]));
  const { data: dbTieredPrices } = await supabase
    .from('tiered_prices')
    .select('*')
    .in('variant_id', targetIds.length > 0 ? targetIds : ['none']);

  // Group variants by product to know whether a product genuinely has variants
  const variantsByProduct = new Map<string, any[]>();
  for (const v of varMap.values()) {
    if (!variantsByProduct.has(v.product_id)) {
      variantsByProduct.set(v.product_id, []);
    }
    variantsByProduct.get(v.product_id)!.push(v);
  }

  // Verify each item server-side against database catalog, stock, and positive-integer quantity
  let verifiedSubtotal = 0;
  let verifiedEligibleSubtotal = 0;
  const verifiedLineItems: any[] = [];
  const requestedQtyByTarget = new Map<string, number>();

  for (let i = 0; i < rawItems.length; i++) {
    const item = rawItems[i];
    const rawQty = item?.quantity;

    // 1. Strict positive-integer quantity validation (never trust client clamping or coerce invalid/decimal inputs)
    if (
      rawQty === null ||
      rawQty === undefined ||
      typeof rawQty === 'boolean' ||
      (typeof rawQty === 'string' && rawQty.trim() === '')
    ) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: `Invalid quantity for "${item?.productName || 'item'}". Quantity must be a positive integer.`,
        },
      };
    }

    const parsedQty = Number(rawQty);
    if (!Number.isFinite(parsedQty) || !Number.isInteger(parsedQty) || parsedQty <= 0) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: `Invalid quantity (${rawQty}) for "${item?.productName || 'item'}". Quantity must be a positive whole number.`,
        },
      };
    }
    const quantity = parsedQty;

    // 2. Authoritative database product & variant lookup
    const rawVariantId =
      item?.variantId !== undefined && item?.variantId !== null
        ? String(item.variantId).trim()
        : '';
    const rawProductId =
      item?.productId !== undefined && item?.productId !== null
        ? String(item.productId).trim()
        : '';

    const matchedVar = rawVariantId ? varMap.get(rawVariantId) || null : null;
    const matchedProd = rawProductId
      ? prodMap.get(rawProductId) || null
      : (matchedVar ? prodMap.get(matchedVar.product_id) || null : null);

    if (!matchedProd) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: `Product "${item?.productName || rawProductId || 'Item'}" was not found in catalog.`,
        },
      };
    }

    // If client supplied a variantId, it MUST exist in database and belong to matchedProd
    if (rawVariantId && (!matchedVar || matchedVar.product_id !== matchedProd.id)) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: `Invalid variant selected for product "${matchedProd.name}".`,
        },
      };
    }

    const prodVariants = variantsByProduct.get(matchedProd.id) || [];
    const productHasVariants = prodVariants.length > 0;

    // If product has variants in the catalog, customer MUST select a valid variant
    if (productHasVariants && !matchedVar) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: `Product "${matchedProd.name}" has multiple pack sizes; a valid variant must be selected.`,
        },
      };
    }

    // 3. Authoritative database stock validation (cumulative across duplicate lines for same SKU)
    const targetKey = matchedVar ? `var:${matchedVar.id}` : `prod:${matchedProd.id}`;
    const cumulativeQty = (requestedQtyByTarget.get(targetKey) || 0) + quantity;
    requestedQtyByTarget.set(targetKey, cumulativeQty);

    const rawDbStock = matchedVar
      ? (matchedVar.stock_quantity ?? matchedVar.stockQuantity ?? matchedVar.stock)
      : (matchedProd.stock_quantity ?? matchedProd.stock);
    const availableStock =
      rawDbStock !== undefined && rawDbStock !== null && Number.isFinite(Number(rawDbStock))
        ? Math.max(0, Number(rawDbStock))
        : 0;

    const itemLabel = matchedVar?.pack_label
      ? `${matchedProd.name} (${matchedVar.pack_label})`
      : matchedProd.name;

    if (availableStock <= 0) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: `"${itemLabel}" is currently out of stock.`,
        },
      };
    }

    if (cumulativeQty > availableStock) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: `Insufficient stock for "${itemLabel}". Requested ${cumulativeQty}, available stock is ${availableStock}.`,
        },
      };
    }

    // 4. Optional database max_order_limit validation (only when explicitly configured in DB; no invented default)
    const rawMaxOrderLimit = matchedVar
      ? (matchedVar.max_order_limit ?? matchedProd.max_order_limit)
      : matchedProd.max_order_limit;
    if (
      rawMaxOrderLimit !== undefined &&
      rawMaxOrderLimit !== null &&
      String(rawMaxOrderLimit).trim() !== ''
    ) {
      const maxOrderLimit = Number(rawMaxOrderLimit);
      if (Number.isFinite(maxOrderLimit) && maxOrderLimit > 0 && cumulativeQty > maxOrderLimit) {
        return {
          statusCode: 400,
          payload: {
            success: false,
            error: `Requested quantity (${cumulativeQty}) for "${itemLabel}" exceeds the maximum allowed limit of ${maxOrderLimit}.`,
          },
        };
      }
    }

    // Authoritative unit price from variant base selling price or base product price
    let baseUnitPrice = matchedVar
      ? Number(matchedVar.base_selling_price || matchedVar.mrp || 0)
      : Number(matchedProd.price ?? matchedProd.base_selling_price ?? matchedProd.mrp ?? 0);

    // Check tiered wholesale pricing
    const slabTargetId = matchedVar ? matchedVar.id : matchedProd.id;
    if (slabTargetId && dbTieredPrices) {
      const slabs = dbTieredPrices.filter((t: any) => t.variant_id === slabTargetId);
      const sorted = [...slabs].sort((a: any, b: any) => Number(b.min_qty) - Number(a.min_qty));
      for (const slab of sorted) {
        if (quantity >= Number(slab.min_qty) && quantity <= Number(slab.max_qty)) {
          baseUnitPrice = Number(slab.unit_price);
          break;
        }
      }
    }

    const isDiscountExcluded = Boolean(
      matchedProd.is_discount_excluded === true ||
      matchedProd.is_discount_excluded === 'true' ||
      item.isDiscountExcluded === true
    );

    const lineTotal = Math.round(baseUnitPrice * quantity * 100) / 100;
    verifiedSubtotal += lineTotal;
    if (!isDiscountExcluded) {
      verifiedEligibleSubtotal += lineTotal;
    }

    verifiedLineItems.push({
      id: item.id || `item-${crypto.randomUUID()}`,
      productId: matchedProd.id,
      variantId: matchedVar ? matchedVar.id : null,
      productName: matchedProd.name,
      variantName: matchedVar ? matchedVar.pack_label : (item.variantName || matchedProd.unit || 'Standard'),
      brand: matchedProd.brand || item.brand || null,
      unit: matchedVar?.unit || item.unit || matchedProd.unit || 'PIECE',
      packSize: matchedVar ? Number(matchedVar.pack_size) : (Number(item.packSize) || Number(matchedProd.pack_size) || 1),
      quantity,
      unitPrice: baseUnitPrice,
      price: lineTotal,
      isDiscountExcluded,
    });
  }

  verifiedSubtotal = Math.round(verifiedSubtotal * 100) / 100;
  verifiedEligibleSubtotal = Math.round(verifiedEligibleSubtotal * 100) / 100;

  // Authoritative Delivery Fee: Free delivery if subtotal >= freeShippingMinAmount (₹249)
  const deliveryFee = verifiedSubtotal >= freeShippingMin ? 0 : baseDeliveryFee;

  // Authoritative COD Charge: Initial COD fee defaults to ₹0 (no count-based free-order rule)
  const isAdvance =
    body.paymentMethod === 'ADVANCE_ONLINE' ||
    body.paymentMethod === 'ONLINE' ||
    body.paymentMethod === 'UPI';

  const codCharge = !isAdvance ? Math.max(0, Number(codBaseCharge) || 0) : 0;

  // Authoritative Advance Payment Discount
  const safeAdvanceDiscountPct = Math.max(0, Number(advanceDiscountPct) || 0);
  const advanceDiscountAmount = isAdvance
    ? Math.round((verifiedEligibleSubtotal * safeAdvanceDiscountPct) / 100)
    : 0;

  const orderFinalAmount = isAdvance
    ? Math.max(0, Math.round((verifiedSubtotal + deliveryFee - advanceDiscountAmount) * 100) / 100)
    : Math.round((verifiedSubtotal + deliveryFee + codCharge) * 100) / 100;

  // Authoritative Wallet Usage (Only applicable in Advance Online flow)
  let walletAmountUsed = 0;
  let authoritativeWalletBalance = dbCustomer?.wallet_balance ? Math.max(0, Number(dbCustomer.wallet_balance)) : 0;

  if (isAdvance && body.useWallet) {
    // If wallet balance was not loaded from dbCustomer, fetch it fresh from database
    if (!dbCustomer) {
      const { data: freshUser } = await supabase
        .from('users')
        .select('wallet_balance')
        .eq('phone', cleanPhone)
        .maybeSingle();
      if (freshUser && freshUser.wallet_balance) {
        authoritativeWalletBalance = Math.max(0, Number(freshUser.wallet_balance));
      }
    }

    // Reconcile against authoritative wallet ledger credits/debits when ledger history exists
    try {
      const walletAliasIds = Array.from(
        new Set(
          [
            dbCustomer?.id,
            customerSession?.customerId,
            cleanPhone,
            `usr_${cleanPhone}`,
            `user-${cleanPhone}`,
          ].filter(Boolean)
        )
      ) as string[];
      if (walletAliasIds.length > 0) {
        let ledgerQ: any = supabase
          .from('ledger')
          .select('id, type, amount, description, date')
          .or(walletAliasIds.map((id) => `customer_id.eq.${id}`).join(','));
        if (typeof ledgerQ?.order === 'function') {
          ledgerQ = ledgerQ.order('date', { ascending: true });
        }
        const { data: ledgerRows } = await ledgerQ;
        if (Array.isArray(ledgerRows) && ledgerRows.length > 0) {
          const walletRows = ledgerRows.filter((r: any) => {
            if (!r) return false;
            const desc = String(r.description || '').toLowerCase();
            if (desc.includes('cod payment') || desc.includes('cod collection')) return false;
            if (r.id && (String(r.id).startsWith('cod_tx_') || String(r.id).startsWith('led_ord_'))) return false;
            if (r.type === 'DEBIT' && (desc.includes('wallet') || String(r.id || '').startsWith('wtx_'))) return true;
            if (r.type === 'CREDIT' && (desc.includes('refund') || desc.includes('wallet') || String(r.id || '').startsWith('wtx_'))) return true;
            return false;
          });
          if (walletRows.some((r: any) => r.type === 'CREDIT')) {
            let running = 0;
            for (const tx of walletRows) {
              const amt = Number(tx.amount) || 0;
              if (tx.type === 'CREDIT') running += amt;
              else if (tx.type === 'DEBIT') running = Math.max(0, running - amt);
            }
            authoritativeWalletBalance = Math.round(running * 100) / 100;
          }
        }
      }
    } catch {
      // Non-fatal: keep dbCustomer.wallet_balance
    }

    walletAmountUsed = Math.round(Math.min(authoritativeWalletBalance, orderFinalAmount) * 100) / 100;
  }

  // Authoritative Previous COD Outstanding Verification (never trust client body.previousOutstanding)
  let authoritativePreviousOutstanding = 0;

  if (!isAdvance) {
    if (!dbCustomer && dbCustomerLookupError) {
      return {
        statusCode: 500,
        payload: {
          success: false,
          error: 'Failed to verify customer profile from database. Unable to process COD order.',
        },
      };
    }

    if (!isShopkeeper && !dbCustomer) {
      return {
        statusCode: 500,
        payload: {
          success: false,
          error: 'Customer profile is missing or incomplete in database. Unable to verify COD outstanding balance.',
        },
      };
    }

    const lateFeeRes = await enforceOverdueCodLateFees(supabase, { phone: cleanPhone });
    if (lateFeeRes.errors.length > 0) {
      return {
        statusCode: 500,
        payload: {
          success: false,
          error: 'Unable to verify overdue COD charges against database. Please try again.',
        },
      };
    }

    const phoneVariants = [cleanPhone, `+91${cleanPhone}`, `91${cleanPhone}`, `0${cleanPhone}`];
    let custOrdersData: any[] | null = null;
    let custOrdersErr: any = null;

    try {
      const custOrdersRes = await supabase
        .from('orders')
        .select('*')
        .in('customer_phone', phoneVariants);
      custOrdersData = custOrdersRes?.data ?? null;
      custOrdersErr = custOrdersRes?.error ?? null;
    } catch (err: any) {
      custOrdersErr = err;
    }

    if (custOrdersErr || !Array.isArray(custOrdersData)) {
      return {
        statusCode: 500,
        payload: {
          success: false,
          error: 'Failed to verify previous COD outstanding balance from database. Please try again.',
        },
      };
    }

    const customerCodOrders = custOrdersData.filter((o: any) => {
      if (!o) return false;
      if (requestedOrderId && o.id === requestedOrderId) return false;
      const oPhone = String(o.customer_phone || '').replace(/\D/g, '').slice(-10);
      if (oPhone && oPhone !== cleanPhone) return false;
      if (String(o.status || '').toUpperCase() === 'CANCELLED') return false;
      if (String(o.payment_method || '').toUpperCase() !== 'COD') return false;
      return true;
    });

    const eligibleUnpaidCodOrders = customerCodOrders.filter((o: any) => {
      const pStatus = String(o.payment_status || '').toUpperCase();
      if (o.is_paid === true || pStatus === 'RECEIVED' || pStatus === 'PAID') return false;

      const { meta } = parseCodMetaFromNotes(o.notes);
      const statusUpper = String(o.status || '').toUpperCase();
      const codCollected = Number(meta?.codCollected ?? 0) || 0;

      const isUnpaidPending =
        statusUpper === 'ORDER_PENDING' ||
        (statusUpper !== 'DELIVERED' && codCollected <= 0);
      if (isUnpaidPending) return false;

      return true;
    });

    if (eligibleUnpaidCodOrders.length > 0) {
      let sumOutstanding = 0;
      for (const o of eligibleUnpaidCodOrders) {
        const { meta } = parseCodMetaFromNotes(o.notes);
        const rawBill = o.final_total ?? o.subtotal;
        const bill = Number(rawBill);
        const collected = Number(meta?.codCollected ?? 0);
        if (
          rawBill === null ||
          rawBill === undefined ||
          !Number.isFinite(bill) ||
          !Number.isFinite(collected)
        ) {
          return {
            statusCode: 500,
            payload: {
              success: false,
              error: 'Incomplete COD order record in database. Unable to verify previous outstanding balance.',
            },
          };
        }
        sumOutstanding += Math.max(0, bill - collected);
      }
      authoritativePreviousOutstanding = Math.round(sumOutstanding * 100) / 100;
    } else if (customerCodOrders.length === 0 && dbCustomer) {
      const rawUserOutstanding = dbCustomer.outstanding_balance;
      if (rawUserOutstanding !== undefined && rawUserOutstanding !== null) {
        const parsedUserOutstanding = Number(rawUserOutstanding);
        if (!Number.isFinite(parsedUserOutstanding)) {
          return {
            statusCode: 500,
            payload: {
              success: false,
              error: 'Incomplete customer outstanding balance record in database. Unable to verify COD order.',
            },
          };
        }
        authoritativePreviousOutstanding = Math.max(
          0,
          Math.round(parsedUserOutstanding * 100) / 100
        );
      }
    }
  }

  // Construct verified order payload
  const orderId = body.orderId || `ord-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
  const orderNumber = body.orderNumber || `OM-${Math.floor(10000 + Math.random() * 90000)}`;

  const productNameSerialized = verifiedLineItems
    .map((it, idx) => `${idx + 1}. ${it.productName} (${it.variantName || it.packSize}) - ${it.quantity} Qty @ ₹${it.unitPrice} = ₹${it.price}`)
    .join('\n');

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const cleanStr = (val: unknown) => (typeof val === 'string' ? val.trim() : '');
  const normalizeOrderLabel = (val: unknown): 'HOME' | 'SHOP' | 'OFFICE' | 'OTHER' => {
    const upper = typeof val === 'string' ? val.trim().toUpperCase() : '';
    if (upper === 'HOME' || upper === 'SHOP' || upper === 'OFFICE' || upper === 'OTHER') {
      return upper;
    }
    return 'HOME';
  };

  const customerId = isShopkeeper
    ? (body.customerId || dbCustomer?.id || `usr_${cleanPhone}`)
    : (customerSession!.customerId || dbCustomer?.id || `usr_${cleanPhone}`);
  const customerName = body.customerName || dbCustomer?.full_name || dbCustomer?.name || `Customer (${cleanPhone.slice(-4)})`;
  const shopName = body.shopName || dbCustomer?.shop_name || customerName;

  const bodyAddr = body.address && typeof body.address === 'object' ? body.address : null;
  const rawAddressId = cleanStr(body.addressId || bodyAddr?.id);
  let verifiedAddressId: string | null = null;
  let dbAddressRow: any = null;

  if (rawAddressId && UUID_RE.test(rawAddressId)) {
    const { data: foundAddr, error: addrLookupErr } = await supabase
      .from('addresses')
      .select('id, user_id, address_label, recipient_name, recipient_phone, address_line1, address_line2, landmark, city, state, pincode')
      .eq('id', rawAddressId)
      .maybeSingle();

    if (!addrLookupErr && foundAddr) {
      if (!isShopkeeper && customerSession) {
        const allowedOwnerIds = new Set<string>(
          [customerSession.customerId, dbCustomer?.id, cleanPhone, `user-${cleanPhone}`, `usr_${cleanPhone}`]
            .filter(Boolean)
            .map(String)
        );
        if (!allowedOwnerIds.has(String(foundAddr.user_id))) {
          const { data: phoneUsers } = await supabase
            .from('users')
            .select('id')
            .in('phone', [cleanPhone, `+91${cleanPhone}`])
            .eq('role', 'CUSTOMER');
          for (const pu of phoneUsers || []) {
            if (pu?.id) allowedOwnerIds.add(String(pu.id));
          }
        }
        if (!allowedOwnerIds.has(String(foundAddr.user_id))) {
          return {
            statusCode: 403,
            payload: {
              success: false,
              error: 'Forbidden: You can only place an order using your own saved delivery address.',
            },
          };
        }
      }
      verifiedAddressId = String(foundAddr.id);
      dbAddressRow = foundAddr;
    }
  }

  const addrLabel = normalizeOrderLabel(
    bodyAddr?.addressLabel ?? bodyAddr?.label ?? dbAddressRow?.address_label
  );
  const recipientName =
    cleanStr(bodyAddr?.recipientName) || cleanStr(dbAddressRow?.recipient_name) || customerName;
  const recipientPhone =
    cleanStr(bodyAddr?.recipientPhone) || cleanStr(dbAddressRow?.recipient_phone) || cleanPhone;
  const addressLine1 =
    cleanStr(bodyAddr?.addressLine1) ||
    cleanStr(dbAddressRow?.address_line1) ||
    (typeof body.address === 'string' ? body.address.trim() : cleanStr(bodyAddr?.fullAddress)) ||
    cleanStr(body.deliveryAddress);
  const addressLine2 =
    cleanStr(bodyAddr?.addressLine2) || cleanStr(dbAddressRow?.address_line2);
  const addrLandmark =
    cleanStr(bodyAddr?.landmark) || cleanStr(dbAddressRow?.landmark);
  const addrCity = cleanStr(bodyAddr?.city) || cleanStr(dbAddressRow?.city);
  const addrState = cleanStr(bodyAddr?.state) || cleanStr(dbAddressRow?.state);
  const addrPincode = cleanStr(bodyAddr?.pincode) || cleanStr(dbAddressRow?.pincode);

  const cityState = [addrCity, addrState].filter(Boolean).join(', ');
  const cityStatePin = addrPincode
    ? cityState
      ? `${cityState} - ${addrPincode}`
      : addrPincode
    : cityState;
  const formattedFullAddress =
    [addressLine1, addressLine2, addrLandmark ? `Near ${addrLandmark}` : '', cityStatePin]
      .filter(Boolean)
      .join(', ') ||
    cleanStr(bodyAddr?.fullAddress) ||
    cleanStr(body.deliveryAddress) ||
    'Address not specified';

  const resolvedGoogleLoc = body.googleLocation || bodyAddr?.googleLocation || undefined;

  const deliveryAddressJsonb: Record<string, any> = {
    ...(verifiedAddressId ? { id: verifiedAddressId } : {}),
    address_label: addrLabel,
    recipient_name: recipientName,
    recipient_phone: recipientPhone,
    address_line1: addressLine1,
    ...(addressLine2 ? { address_line2: addressLine2 } : {}),
    ...(addrLandmark ? { landmark: addrLandmark } : {}),
    ...(addrCity ? { city: addrCity } : {}),
    ...(addrState ? { state: addrState } : {}),
    ...(addrPincode ? { pincode: addrPincode } : {}),
    full_address: formattedFullAddress,
    ...(resolvedGoogleLoc ? { google_location: resolvedGoogleLoc } : {}),
  };

  // Idempotency Check #2: Prevent rapid accidental double-submission (identical phone + paymentMethod + address + total + items within 30s)
  const buildCanonicalItemSignature = (itemsList: any[]): string =>
    [...(itemsList || [])]
      .map(
        (it) =>
          `${String(it?.productId || '').trim()}:${String(it?.variantId || '').trim()}:${Number(it?.quantity) || 0}`
      )
      .sort()
      .join('|');

  const expectedPaymentMethod = isAdvance ? 'ADVANCE_ONLINE' : 'COD';
  const currentItemSignature = buildCanonicalItemSignature(verifiedLineItems);
  try {
    let recentQuery: any = supabase.from('orders').select('*').eq('customer_phone', cleanPhone);
    if (typeof recentQuery?.order === 'function') {
      recentQuery = recentQuery.order('created_at', { ascending: false });
    }
    if (typeof recentQuery?.limit === 'function') {
      recentQuery = recentQuery.limit(5);
    }
    const { data: recentOrders } = await recentQuery;
    if (Array.isArray(recentOrders) && recentOrders.length > 0) {
      const nowMs = Date.now();
      const duplicateRecent = recentOrders.find((ro: any) => {
        if (!ro) return false;
        const createdMs = ro.created_at ? new Date(ro.created_at).getTime() : 0;
        if (!createdMs || nowMs - createdMs > 30000 || nowMs - createdMs < 0) return false;
        if (ro.status === 'CANCELLED') return false;
        if ((ro.payment_method || 'COD') !== expectedPaymentMethod) return false;
        if (Math.abs((Number(ro.final_total) || 0) - orderFinalAmount) >= 0.01) return false;
        if ((ro.address_id || null) !== (verifiedAddressId || null)) return false;
        const roMeta = parseCodMetaFromNotes(ro.notes)?.meta || {};
        if (Math.abs((Number(roMeta.walletAmountUsed) || 0) - walletAmountUsed) >= 0.01) return false;
        const roItems = Array.isArray(roMeta.items) ? roMeta.items : [];
        return buildCanonicalItemSignature(roItems) === currentItemSignature;
      });
      if (duplicateRecent) {
        return {
          statusCode: 200,
          payload: {
            success: true,
            deduplicated: true,
            order: formatExistingOrderPayload(duplicateRecent),
          },
        };
      }
    }
  } catch {
    // Non-fatal: continue to insert
  }

  // Execute single ACID PostgreSQL transaction: lock wallet + verify balance + insert orders + order_items + wallet DEBIT ledger + update users.wallet_balance
  const preferredSlot =
    body.deliveryDate || body.preferredSlot || new Date().toISOString().split('T')[0];

  const { data: rpcData, error: rpcError } = await supabase.rpc(
    'create_order_with_wallet_atomic',
    {
      p_actor_role: isShopkeeper ? 'SHOPKEEPER' : 'CUSTOMER',
      p_session_customer_id: customerSession?.customerId || null,
      p_session_phone: customerSession?.phone || null,
      p_order_id: orderId,
      p_order_number: orderNumber,
      p_customer_id: customerId,
      p_customer_name: customerName,
      p_customer_phone: cleanPhone,
      p_shop_name: shopName,
      p_payment_method: expectedPaymentMethod,
      p_use_wallet: Boolean(isAdvance && body.useWallet),
      p_min_expected_wallet_used:
        isAdvance && body.useWallet && walletAmountUsed > 0 ? walletAmountUsed : null,
      p_subtotal: verifiedSubtotal,
      p_discount_amount: advanceDiscountAmount,
      p_delivery_fee: deliveryFee,
      p_cod_charge: codCharge,
      p_final_total: orderFinalAmount,
      p_previous_outstanding: authoritativePreviousOutstanding,
      p_product_name_serialized: productNameSerialized,
      p_address_id: verifiedAddressId,
      p_delivery_address: deliveryAddressJsonb,
      p_preferred_slot: preferredSlot,
      p_weight_kg: Number(body.weightKg) || null,
      p_razorpay_order_id: isAdvance ? body.razorpayOrderId || null : null,
      p_razorpay_payment_id: isAdvance ? body.razorpayPaymentId || null : null,
      p_items: verifiedLineItems,
    }
  );

  if (rpcError) {
    const code = String(rpcError.code || '').trim();
    const msg = String(rpcError.message || 'Atomic order creation RPC failed');
    const isMissingRpc =
      code === '42883' ||
      code === 'PGRST202' ||
      /could not find the function|create_order_with_wallet_atomic/i.test(msg);

    return {
      statusCode: 500,
      payload: {
        success: false,
        code: isMissingRpc ? 'MISSING_ATOMIC_RPC' : 'ORDER_CREATION_FAILED',
        error: isMissingRpc
          ? 'Atomic order creation database function is not installed. Please apply supabase_order_creation_atomic_v2.sql.'
          : msg,
      },
    };
  }

  if (!rpcData || typeof rpcData !== 'object') {
    return {
      statusCode: 500,
      payload: {
        success: false,
        code: 'ORDER_CREATION_FAILED',
        error: 'Atomic order creation returned an empty database response.',
      },
    };
  }

  if (!rpcData.ok) {
    const errStatus = Number(rpcData.statusCode) || 409;
    return {
      statusCode: errStatus,
      payload: {
        success: false,
        code: rpcData.code || 'ORDER_CREATION_FAILED',
        ...(rpcData.availableBalance !== undefined
          ? { availableBalance: rpcData.availableBalance }
          : {}),
        error: String(rpcData.error || 'Failed to create order atomically.'),
      },
    };
  }

  const responseStatus = Number(rpcData.statusCode) || (rpcData.deduplicated ? 200 : 201);
  return {
    statusCode: responseStatus,
    payload: {
      success: true,
      ...(rpcData.deduplicated ? { deduplicated: true } : {}),
      order: rpcData.order,
    },
  };
}

