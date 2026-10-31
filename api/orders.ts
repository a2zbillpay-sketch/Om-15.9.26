import type { IncomingMessage, ServerResponse } from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY;

  if (url && key && url !== 'https://your-project.supabase.co' && key !== 'your-anon-key') {
    try {
      return createClient(url, key, { auth: { persistSession: false } });
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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const method = req.method?.toUpperCase();
  const url = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
  const supabase = getSupabaseClient();

  if (!supabase) {
    return sendJson(res, 500, { success: false, error: 'Database service is not configured' });
  }

  // ============================================================================
  // 1. GET: Fetch Orders (Admin sees all; Customer sees ONLY their own orders)
  // ============================================================================
  if (method === 'GET') {
    const adminSession = verifyAdminSession(req);
    const phoneParam = url.searchParams.get('phone');
    const allParam = url.searchParams.get('all');

    // Admin shopkeeper view: Can fetch all orders or filter by customer phone
    if (adminSession && adminSession.role === 'SHOPKEEPER') {
      try {
        let query = supabase.from('orders').select('*').order('created_at', { ascending: false });
        if (phoneParam) {
          const clean = phoneParam.replace(/\D/g, '').slice(-10);
          if (clean) query = query.eq('customer_phone', clean);
        }
        const { data, error } = await query;
        if (error) return sendJson(res, 500, { success: false, error: error.message });
        return sendJson(res, 200, { success: true, orders: data || [] });
      } catch (err: any) {
        return sendJson(res, 500, { success: false, error: err?.message || 'Server error' });
      }
    }

    // Customer view: STRICTLY requires customer phone; MUST NEVER return other customers' orders
    if (!phoneParam || !phoneParam.trim()) {
      return sendJson(res, 401, {
        success: false,
        error: 'Unauthorized: Phone parameter or verified shopkeeper session required',
      });
    }

    const cleanPhone = phoneParam.replace(/\D/g, '').slice(-10);
    if (cleanPhone.length !== 10) {
      return sendJson(res, 400, { success: false, error: 'Invalid 10-digit phone number' });
    }

    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*')
        .eq('customer_phone', cleanPhone)
        .order('created_at', { ascending: false });

      if (error) {
        return sendJson(res, 500, { success: false, error: error.message });
      }

      return sendJson(res, 200, { success: true, orders: data || [] });
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Server error' });
    }
  }

  // ============================================================================
  // 2. POST: Secure Server-Side Checkout & Order Placement
  // ============================================================================
  if (method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const rawPhone = String(body.customerPhone || body.phone || body.userPhone || '').trim();
      const cleanPhone = rawPhone.replace(/\D/g, '').slice(-10);

      if (!cleanPhone || cleanPhone.length !== 10) {
        return sendJson(res, 400, {
          success: false,
          error: 'Valid 10-digit customer phone number is required for order verification',
        });
      }

      const rawItems = Array.isArray(body.items) ? body.items : [];
      if (rawItems.length === 0) {
        return sendJson(res, 400, { success: false, error: 'Order must contain at least one item' });
      }

      // Load authoritative settings from database (with standard Om Distributors defaults)
      let advanceDiscountPct = 5.0; // 5% advance payment discount
      let codBaseCharge = 49.0;     // ₹49 COD fee
      let freeShippingMin = 249.0;  // ₹249 free delivery threshold
      let baseDeliveryFee = 11.0;   // ₹11 standard delivery fee

      try {
        const { data: storeSettings } = await supabase
          .from('store_settings')
          .select('*')
          .eq('id', 'global_settings')
          .maybeSingle();

        if (storeSettings) {
          if (storeSettings.advance_payment_discount_pct !== undefined) {
            advanceDiscountPct = Number(storeSettings.advance_payment_discount_pct);
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
        // Fall back to constants
      }

      // Query products, variants, and wholesale slabs from database to authoritatively verify prices
      const variantIds = rawItems.map((it: any) => String(it.variantId || '')).filter(Boolean);
      const productIds = rawItems.map((it: any) => String(it.productId || '')).filter(Boolean);

      const { data: dbProducts } = await supabase
        .from('products')
        .select('*')
        .in('id', productIds.length > 0 ? productIds : ['none']);

      const { data: dbVariants } = await supabase
        .from('product_variants')
        .select('*')
        .in('id', variantIds.length > 0 ? variantIds : ['none']);

      const { data: dbTieredPrices } = await supabase
        .from('tiered_prices')
        .select('*')
        .in('variant_id', variantIds.length > 0 ? variantIds : ['none']);

      const prodMap = new Map((dbProducts || []).map((p: any) => [p.id, p]));
      const varMap = new Map((dbVariants || []).map((v: any) => [v.id, v]));

      // Verify each item server-side against database catalog
      let verifiedSubtotal = 0;
      let verifiedEligibleSubtotal = 0;
      const verifiedLineItems: any[] = [];

      for (let i = 0; i < rawItems.length; i++) {
        const item = rawItems[i];
        const quantity = Math.max(1, Math.floor(Number(item.quantity) || 1));
        const matchedVar = item.variantId ? varMap.get(item.variantId) : null;
        const matchedProd = item.productId
          ? prodMap.get(item.productId)
          : (matchedVar ? prodMap.get(matchedVar.product_id) : null);

        // Authoritative unit price from variant base selling price or item price
        let baseUnitPrice = matchedVar
          ? Number(matchedVar.base_selling_price || matchedVar.mrp || 0)
          : Number(item.unitPrice || item.price || 0);

        // Check tiered wholesale pricing
        if (matchedVar && dbTieredPrices) {
          const slabs = dbTieredPrices.filter((t: any) => t.variant_id === matchedVar.id);
          const sorted = [...slabs].sort((a: any, b: any) => Number(b.min_qty) - Number(a.min_qty));
          for (const slab of sorted) {
            if (quantity >= Number(slab.min_qty) && quantity <= Number(slab.max_qty)) {
              baseUnitPrice = Number(slab.unit_price);
              break;
            }
          }
        }

        const isDiscountExcluded = Boolean(
          matchedProd?.is_discount_excluded === true ||
          matchedProd?.is_discount_excluded === 'true' ||
          item.isDiscountExcluded === true
        );

        const lineTotal = Math.round(baseUnitPrice * quantity * 100) / 100;
        verifiedSubtotal += lineTotal;
        if (!isDiscountExcluded) {
          verifiedEligibleSubtotal += lineTotal;
        }

        verifiedLineItems.push({
          id: item.id || `item-${Date.now()}-${i}`,
          productId: matchedProd?.id || item.productId || '',
          variantId: matchedVar?.id || item.variantId || '',
          productName: matchedProd?.name || item.productName || 'Grocery Item',
          variantName: matchedVar?.pack_label || item.variantName || '',
          brand: matchedProd?.brand || item.brand || '',
          unit: matchedVar?.unit || item.unit || 'PIECE',
          packSize: matchedVar ? Number(matchedVar.pack_size) : (Number(item.packSize) || 1),
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

      // Authoritative COD Charge: First 3 COD orders are free
      const isAdvance =
        body.paymentMethod === 'ADVANCE_ONLINE' ||
        body.paymentMethod === 'ONLINE' ||
        body.paymentMethod === 'UPI';

      let codCharge = 0;
      if (!isAdvance) {
        // Query database count of previous completed/placed COD orders for this phone
        const { count: previousCodCount } = await supabase
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_phone', cleanPhone)
          .eq('payment_method', 'COD');

        const orderCount = previousCodCount !== null ? previousCodCount : 0;
        codCharge = orderCount < 3 ? 0 : codBaseCharge;
      }

      // Authoritative 5% Advance Payment Discount
      const advanceDiscountAmount = isAdvance
        ? Math.round((verifiedEligibleSubtotal * advanceDiscountPct) / 100)
        : 0;

      const orderFinalAmount = isAdvance
        ? Math.max(0, Math.round((verifiedSubtotal + deliveryFee - advanceDiscountAmount) * 100) / 100)
        : Math.round((verifiedSubtotal + deliveryFee + codCharge) * 100) / 100;

      // Authoritative Wallet Usage (Only applicable in Advance Online flow)
      let walletAmountUsed = 0;
      let authoritativeWalletBalance = 0;

      if (isAdvance && body.useWallet) {
        // Query user's persistent wallet balance from database
        const { data: dbUser } = await supabase
          .from('users')
          .select('id, wallet_balance')
          .eq('phone', cleanPhone)
          .maybeSingle();

        if (dbUser && dbUser.wallet_balance) {
          authoritativeWalletBalance = Math.max(0, Number(dbUser.wallet_balance));
        }

        walletAmountUsed = Math.min(authoritativeWalletBalance, orderFinalAmount);
      }

      const finalPayable = Math.max(0, Math.round((orderFinalAmount - walletAmountUsed) * 100) / 100);

      // Construct verified order payload
      const orderId = body.orderId || `ord-${Date.now()}`;
      const orderNumber = body.orderNumber || `OM-${Math.floor(10000 + Math.random() * 90000)}`;

      const metaPayload = JSON.stringify({
        codCollected: 0,
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

      const deliveryAddress =
        typeof body.address === 'string'
          ? body.address
          : body.address?.fullAddress || body.deliveryAddress || 'Address not specified';

      const insertPayload = {
        id: orderId,
        customer_id: body.customerId || `usr_${cleanPhone}`,
        customer_name: body.customerName || `Customer (${cleanPhone.slice(-4)})`,
        customer_phone: cleanPhone,
        shop_name: body.customerName || `Customer (${cleanPhone.slice(-4)})`,
        'Product Name': productNameSerialized,
        subtotal: verifiedSubtotal,
        discount_amount: advanceDiscountAmount,
        final_total: orderFinalAmount,
        status: 'ORDER_ACCEPTED',
        payment_method: isAdvance ? 'ADVANCE_ONLINE' : 'COD',
        is_paid: isAdvance && finalPayable === 0,
        delivery_address: deliveryAddress,
        preferred_slot: body.deliveryDate || body.preferredSlot || new Date().toISOString().split('T')[0],
        notes: `Order #${orderNumber} | COD_META:${metaPayload}`,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      const { error: insertError } = await supabase.from('orders').insert(insertPayload);

      if (insertError) {
        return sendJson(res, 500, { success: false, error: insertError.message });
      }

      // If wallet used, record debit in ledger and deduct user's wallet_balance
      if (walletAmountUsed > 0) {
        const remainingWallet = Math.max(0, authoritativeWalletBalance - walletAmountUsed);
        await supabase.from('ledger').insert({
          id: `wtx_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
          customer_id: body.customerId || `usr_${cleanPhone}`,
          customer_name: body.customerName || 'Customer',
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

      return sendJson(res, 201, {
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
      });
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Server error creating order' });
    }
  }

  // ============================================================================
  // 3. PUT: Order Status & Payment Updates (Verified Shopkeeper Session ONLY)
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
      const orderId = body.id || body.orderId;
      if (!orderId) {
        return sendJson(res, 400, { success: false, error: 'Order ID is required' });
      }

      const updatePayload: Record<string, any> = {
        updated_at: new Date().toISOString(),
      };
      if (body.status) updatePayload.status = body.status;
      if (body.isPaid !== undefined) updatePayload.is_paid = Boolean(body.isPaid);
      if (body.notes) updatePayload.notes = body.notes;

      const { error } = await supabase.from('orders').update(updatePayload).eq('id', orderId);
      if (error) return sendJson(res, 500, { success: false, error: error.message });

      return sendJson(res, 200, { success: true });
    } catch (err: any) {
      return sendJson(res, 500, { success: false, error: err?.message || 'Server error updating order' });
    }
  }

  res.setHeader('Allow', 'GET, POST, PUT');
  return sendJson(res, 405, { success: false, error: `Method ${method} Not Allowed` });
}
