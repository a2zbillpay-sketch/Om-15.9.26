import type { SupabaseClient } from '@supabase/supabase-js';
import type { AdminSession, CustomerSession } from './auth/_verify.js';

export interface CancellationAuthContext {
  adminSession: AdminSession | null;
  customerSession: CustomerSession | null;
}

export interface RestoredStockItemSummary {
  productId: string;
  variantId: string | null;
  productName: string;
  variantLabel?: string;
  quantityRestored: number;
  previousStock: number;
  newStock: number;
}

export interface CancellationRefundSummary {
  amount: number;
  creditedNow: number;
  walletUsed: number;
  onlinePaid: number;
  codPaid: number;
  refunded: boolean;
  newWalletBalance: number;
  ledgerTransactionId: string | null;
  description: string | null;
}

export interface ProcessCancelOrderResult {
  statusCode: number;
  payload: {
    success: boolean;
    alreadyCancelled?: boolean;
    deduplicated?: boolean;
    stockRestored?: boolean;
    restoredItemsCount?: number;
    restoredItems?: RestoredStockItemSummary[];
    refund?: CancellationRefundSummary;
    order?: any;
    error?: string;
  };
}

/**
 * Integrated database-atomic server-side cancellation workflow:
 * 1. Authenticates & authorizes CUSTOMER (own order within 15 mins) or SHOPKEEPER.
 * 2. Executes a SINGLE PostgreSQL ACID transaction via `public.cancel_order_atomic`
 *    (row locking via FOR UPDATE on orders, products, product_variants, and users + advisory wallet lock).
 * 3. Returns committed idempotent result on repeated/concurrent calls without restoring stock or crediting twice.
 * 4. Fails closed on any RPC/database error — never falls back to non-atomic multi-step writes.
 */
export async function processCancelOrderRequest(
  supabase: SupabaseClient,
  body: any,
  auth: CancellationAuthContext
): Promise<ProcessCancelOrderResult> {
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
        error: 'Unauthorized: Verified session required to cancel orders.',
      },
    };
  }

  const rawOrderId = String(body?.id || body?.orderId || '').trim();
  if (!rawOrderId) {
    return {
      statusCode: 400,
      payload: { success: false, error: 'Order ID is required' },
    };
  }

  const { data: rpcData, error: rpcError } = await supabase.rpc('cancel_order_atomic', {
    p_order_id: rawOrderId,
    p_actor_role: isShopkeeper ? 'SHOPKEEPER' : 'CUSTOMER',
    p_customer_id: customerSession?.customerId || null,
    p_customer_phone: customerSession?.phone || null,
  });

  if (rpcError) {
    const code = String(rpcError.code || '').trim();
    const msg = String(rpcError.message || 'Atomic order cancellation RPC failed');
    const isMissingRpc =
      code === '42883' ||
      code === 'PGRST202' ||
      /could not find the function|cancel_order_atomic/i.test(msg);

    return {
      statusCode: 500,
      payload: {
        success: false,
        error: isMissingRpc
          ? 'Atomic order cancellation database function is not installed. Please apply supabase_order_cancellation_atomic_v2.sql.'
          : `Failed to cancel order atomically: ${msg}`,
      },
    };
  }

  if (!rpcData || typeof rpcData !== 'object') {
    return {
      statusCode: 500,
      payload: {
        success: false,
        error: 'Atomic cancellation returned an empty or invalid response from database.',
      },
    };
  }

  const statusCode = Number(rpcData.statusCode) || (rpcData.ok ? 200 : 500);
  if (!rpcData.ok) {
    return {
      statusCode,
      payload: {
        success: false,
        error: String(rpcData.error || 'Failed to cancel order.'),
      },
    };
  }

  const restoredItems: RestoredStockItemSummary[] = Array.isArray(rpcData.restoredItems)
    ? rpcData.restoredItems
    : [];

  return {
    statusCode,
    payload: {
      success: true,
      alreadyCancelled: Boolean(rpcData.alreadyCancelled),
      ...(rpcData.deduplicated !== undefined
        ? { deduplicated: Boolean(rpcData.deduplicated) }
        : {}),
      stockRestored: Boolean(rpcData.stockRestored),
      restoredItemsCount:
        typeof rpcData.restoredItemsCount === 'number'
          ? rpcData.restoredItemsCount
          : restoredItems.length,
      restoredItems,
      refund: rpcData.refund || {
        amount: 0,
        creditedNow: 0,
        walletUsed: 0,
        onlinePaid: 0,
        codPaid: 0,
        refunded: false,
        newWalletBalance: 0,
        ledgerTransactionId: null,
        description: null,
      },
      order: rpcData.order,
    },
  };
}
