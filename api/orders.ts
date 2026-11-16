import type { IncomingMessage, ServerResponse } from 'http';
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
  buildOrderNotesWithMeta,
} from './_codLateFee.js';

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
  // 3. PUT: Order Status, Edits, Refunds & Payment Updates (Verified Shopkeeper Session ONLY)
  // ============================================================================
  if (method === 'PUT') {
    const adminSession = verifyAdminSession(req);
    if (!adminSession || adminSession.role !== 'SHOPKEEPER') {
      return sendJson(res, 401, {
        success: false,
        error: 'Unauthorized: Shopkeeper session required to update orders',
      });
    }

    try {
      const body = await parseJsonBody(req);
      const rawOrderId = String(body.id || body.orderId || '').trim();
      if (!rawOrderId) {
        return sendJson(res, 400, { success: false, error: 'Order ID is required' });
      }

      // Resolve existing order row (by id or order_number)
      const { data: existingOrder } = rawOrderId.startsWith('OM-')
        ? await supabase.from('orders').select('*').eq('order_number', rawOrderId).maybeSingle()
        : await supabase.from('orders').select('*').eq('id', rawOrderId).maybeSingle();

      const resolvedOrderId = existingOrder?.id || rawOrderId;

      const updatePayload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };

      if (body.status) updatePayload.status = body.status;

      if (body.paymentStatus) {
        updatePayload.payment_status = body.paymentStatus;
        if (body.paymentStatus === 'RECEIVED') {
          updatePayload.is_paid = true;
        } else if (body.paymentStatus === 'PENDING' || body.paymentStatus === 'REFUNDED' || body.paymentStatus === 'FAILED') {
          updatePayload.is_paid = false;
        }
      }

      if (body.isPaid !== undefined) {
        updatePayload.is_paid = Boolean(body.isPaid);
        if (body.isPaid && !updatePayload.payment_status) {
          updatePayload.payment_status = 'RECEIVED';
        } else if (!body.isPaid && !updatePayload.payment_status) {
          updatePayload.payment_status = 'PENDING';
        }
      }

      if (body.subtotal !== undefined && !isNaN(Number(body.subtotal))) {
        updatePayload.subtotal = Number(body.subtotal);
      }
      if (body.discountAmount !== undefined && !isNaN(Number(body.discountAmount))) {
        updatePayload.discount_amount = Number(body.discountAmount);
      }
      const resolvedFinalTotal =
        body.finalAmount !== undefined ? Number(body.finalAmount) :
        body.finalTotal !== undefined ? Number(body.finalTotal) :
        undefined;
      if (resolvedFinalTotal !== undefined && !isNaN(resolvedFinalTotal)) {
        updatePayload.final_total = resolvedFinalTotal;
      }
      if (typeof body.productNameSerialized === 'string') {
        updatePayload['Product Name'] = body.productNameSerialized;
      }
      if (body.weightKg !== undefined && body.weightKg !== null && !isNaN(Number(body.weightKg))) {
        updatePayload.weight_kg = Number(body.weightKg);
      }
      if (body.notes !== undefined || body.status === 'DELIVERED') {
        const { orderNumber: existingOrdNum, meta: existingMeta } = parseCodMetaFromNotes(existingOrder?.notes);
        const { orderNumber: incomingOrdNum, meta: incomingMeta } = parseCodMetaFromNotes(body.notes);
        const resolvedNum =
          existingOrder?.order_number ||
          incomingOrdNum ||
          existingOrdNum ||
          resolvedOrderId.replace(/^ord[-_]/i, '').slice(0, 8);

        const nowISO = new Date().toISOString();
        const isDeliveredTransition = body.status === 'DELIVERED';
        const mergedMeta: Record<string, any> = {
          ...existingMeta,
          ...incomingMeta,
          ...(existingMeta.codCharge !== undefined
            ? { codCharge: Math.max(Number(existingMeta.codCharge) || 0, Number(incomingMeta.codCharge) || 0) }
            : {}),
          ...(existingMeta.codLateFeeApplied
            ? {
                codLateFeeApplied: true,
                codLateFeeAmount: Number(existingMeta.codLateFeeAmount) || 0,
                codLateFeeAppliedAt: existingMeta.codLateFeeAppliedAt,
              }
            : {}),
        };

        if (isDeliveredTransition && !mergedMeta.deliveredAt) {
          mergedMeta.deliveredAt = body.deliveredAt || nowISO;
        }

        // Protect authoritative late-fee-adjusted final_total if late fee already applied
        if (existingMeta.codLateFeeApplied && existingOrder?.final_total !== undefined) {
          updatePayload.final_total = Number(existingOrder.final_total);
          mergedMeta.totalPayable = Number(existingOrder.final_total);
        }

        updatePayload.notes = buildOrderNotesWithMeta(String(resolvedNum), mergedMeta);
      }

      // Idempotent server-side wallet refund on Shopkeeper order cancellation
      const refundAmount = Number(body.refundAmount) || 0;
      if (body.status === 'CANCELLED' && refundAmount > 0) {
        const cleanPhone = String(
          body.customerPhone || existingOrder?.customer_phone || ''
        )
          .replace(/\D/g, '')
          .slice(-10);
        const customerId = String(
          body.customerId || existingOrder?.customer_id || (cleanPhone ? `usr_${cleanPhone}` : 'Customer')
        );
        const customerName = String(
          body.customerName || existingOrder?.customer_name || 'Customer'
        );

        // Check existing CREDIT refund in ledger to prevent duplicates
        const { data: existingRefunds } = await supabase
          .from('ledger')
          .select('id, amount')
          .eq('order_id', resolvedOrderId)
          .eq('type', 'CREDIT');

        const alreadyCredited = (existingRefunds || []).reduce(
          (sum: number, row: any) => sum + (Number(row.amount) || 0),
          0
        );

        if (alreadyCredited < refundAmount) {
          const amountToCredit = Math.round((refundAmount - alreadyCredited) * 100) / 100;
          let currentWallet = 0;

          if (cleanPhone) {
            const { data: dbUser } = await supabase
              .from('users')
              .select('id, wallet_balance')
              .eq('phone', cleanPhone)
              .maybeSingle();
            if (dbUser && dbUser.wallet_balance !== undefined) {
              currentWallet = Math.max(0, Number(dbUser.wallet_balance) || 0);
            }
          }

          const newBalanceAfter = Math.round((currentWallet + amountToCredit) * 100) / 100;
          const refundDesc =
            typeof body.refundDescription === 'string' && body.refundDescription.trim()
              ? body.refundDescription.trim()
              : `Refund for Cancelled Order #${existingOrder?.order_number || resolvedOrderId}`;

          const { error: ledgerErr } = await supabase.from('ledger').insert({
            id: `wtx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
            customer_id: customerId,
            customer_name: customerName,
            order_id: resolvedOrderId,
            date: new Date().toISOString(),
            type: 'CREDIT',
            amount: amountToCredit,
            description: refundDesc,
            balance_after: newBalanceAfter,
          });

          if (!ledgerErr) {
            if (cleanPhone) {
              await supabase
                .from('users')
                .update({
                  wallet_balance: newBalanceAfter,
                  updated_at: new Date().toISOString(),
                })
                .eq('phone', cleanPhone);
            }
            updatePayload.payment_status = 'REFUNDED';
            updatePayload.is_paid = false;
          }
        } else {
          updatePayload.payment_status = 'REFUNDED';
          updatePayload.is_paid = false;
        }
      }

      const { error } = await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', resolvedOrderId);

      if (error) return sendJson(res, 500, { success: false, error: error.message });

      // Relational order_items sync if updated items are provided (edited order)
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

      return sendJson(res, 200, { success: true });
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Server error updating order' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT');
  return sendJson(res, 405, { success: false, error: `Method ${method} Not Allowed` });
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

  // Check customer active status in database
  const { data: dbCustomer } = await supabase
    .from('users')
    .select('*')
    .eq('phone', cleanPhone)
    .maybeSingle();

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
      id: item.id || `item-${Date.now()}-${i}`,
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
    walletAmountUsed = Math.min(authoritativeWalletBalance, orderFinalAmount);
  }

  const finalPayable = Math.max(0, Math.round((orderFinalAmount - walletAmountUsed) * 100) / 100);

  // Construct verified order payload
  const orderId = body.orderId || `ord-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const orderNumber = body.orderNumber || `OM-${Math.floor(10000 + Math.random() * 90000)}`;

  const metaPayload = JSON.stringify({
    codCollected: 0,
    codCharge,
    codLateFeeApplied: false,
    codLateFeeAmount: 0,
    prevOutstanding: Number(body.previousOutstanding) || 0,
    totalPayable: isAdvance ? finalPayable : orderFinalAmount,
    walletAmountUsed,
    previousOnlinePaid: isAdvance ? finalPayable : 0,
    stockDeducted: false,
    stockRestored: false,
    items: verifiedLineItems,
  });

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

  // 1. Insert into public.orders table
  const insertPayload = {
    id: orderId,
    order_number: orderNumber,
    customer_id: customerId,
    customer_name: customerName,
    customer_phone: cleanPhone,
    shop_name: shopName,
    'Product Name': productNameSerialized,
    subtotal: verifiedSubtotal,
    discount_amount: advanceDiscountAmount,
    final_total: orderFinalAmount,
    status: 'ORDER_ACCEPTED',
    payment_method: isAdvance ? 'ADVANCE_ONLINE' : 'COD',
    payment_status: isAdvance && finalPayable === 0 ? 'RECEIVED' : 'PENDING',
    is_paid: isAdvance && finalPayable === 0,
    address_id: verifiedAddressId,
    delivery_address: deliveryAddressJsonb,
    preferred_slot: body.deliveryDate || body.preferredSlot || new Date().toISOString().split('T')[0],
    notes: `Order #${orderNumber} | COD_META:${metaPayload}`,
    weight_kg: Number(body.weightKg) || null,
    razorpay_order_id: body.razorpayOrderId || null,
    razorpay_payment_id: body.razorpayPaymentId || null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  const { error: insertOrderError } = await supabase.from('orders').insert(insertPayload);

  if (insertOrderError) {
    return { statusCode: 500, payload: { success: false, error: insertOrderError.message } };
  }

  // 2. Insert line items into public.order_items table (Relational Line-Item Mirror)
  const orderItemsPayload = verifiedLineItems.map((it, idx) => ({
    id: it.id || `item-${Date.now()}-${idx}`,
    order_id: orderId,
    product_id: it.productId || null,
    product_variant_id: it.variantId || null,
    product_name: it.productName,
    variant_name: it.variantName || null,
    brand: it.brand || null,
    unit: it.unit || 'PIECE',
    pack_size: it.packSize || 1,
    quantity: it.quantity,
    unit_price: it.unitPrice,
    total_price: it.price,
    is_discount_excluded: it.isDiscountExcluded,
    created_at: new Date().toISOString(),
  }));

  const { error: insertItemsError } = await supabase
    .from('order_items')
    .insert(orderItemsPayload);

  if (insertItemsError) {
    // Log warning but proceed since orders table has COD_META and "Product Name" redundancy
    console.warn('Warning: Could not mirror order items into public.order_items:', insertItemsError.message);
  }

  // 3. If wallet was used, record debit in ledger and deduct user's wallet_balance
  if (walletAmountUsed > 0) {
    const remainingWallet = Math.max(0, authoritativeWalletBalance - walletAmountUsed);
    await supabase.from('ledger').insert({
      id: `wtx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      customer_id: customerId,
      customer_name: customerName,
      order_id: orderId,
      date: new Date().toISOString(),
      type: 'DEBIT',
      amount: walletAmountUsed,
      description: `Wallet Applied on Order #${orderNumber}`,
      balance_after: remainingWallet,
    });

    await supabase
      .from('users')
      .update({ wallet_balance: remainingWallet, updated_at: new Date().toISOString() })
      .eq('phone', cleanPhone);
  }

  return {
    statusCode: 201,
    payload: {
      success: true,
      order: {
        id: orderId,
        orderNumber,
        customerPhone: cleanPhone,
        subtotal: verifiedSubtotal,
        deliveryFee,
        codCharge,
        discountAmount: advanceDiscountAmount,
        finalAmount: orderFinalAmount,
        walletAmountUsed,
        totalPayable: isAdvance ? finalPayable : orderFinalAmount,
        paymentMethod: isAdvance ? 'ADVANCE_ONLINE' : 'COD',
        items: verifiedLineItems,
      },
    },
  };
}

