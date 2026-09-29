import {
  Order,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  CodPaymentTransaction,
  CodTransactionAllocation,
} from '../types';

/**
 * Standardizes 10-digit Indian phone numbers for clean cross-session lookups.
 */
export function normalizePhone(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Determines whether two user identifiers match (by normalized phone or userId).
 */
export function isSameCustomer(
  order: { userPhone?: string; userId?: string },
  targetPhoneOrId: string
): boolean {
  if (!targetPhoneOrId) return false;
  const cleanTarget = normalizePhone(targetPhoneOrId);
  const cleanOrderPhone = normalizePhone(order.userPhone);

  if (cleanTarget && cleanOrderPhone && cleanTarget === cleanOrderPhone) {
    return true;
  }
  return Boolean(order.userId && order.userId === targetPhoneOrId);
}

/**
 * Calculates the customer's outstanding balance from all unpaid or partially paid previous orders.
 * Rules:
 * - Only Cash on Delivery (COD) orders count toward COD debt.
 * - Cancelled orders are excluded.
 * - Preserves original bill (finalAmount) of every old order unchanged.
 * - Outstanding of an order = Math.max(0, finalAmount - (codCollectedAmount || 0)).
 * - If excludeOrderId is provided, excludes that specific new order (to calculate "Previous Outstanding").
 */
export function calculateCustomerOutstanding(
  orders: Order[],
  targetPhoneOrId: string,
  excludeOrderId?: string
): number {
  if (!targetPhoneOrId || !Array.isArray(orders)) return 0;

  const customerOrders = orders
    .filter((o) => {
      if (excludeOrderId && o.id === excludeOrderId) return false;
      if (o.status === OrderStatus.CANCELLED) return false;
      if (o.paymentMethod !== PaymentMethod.COD) return false;
      return isSameCustomer(o, targetPhoneOrId);
    })
    .sort(
      (a, b) =>
        new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
    );

  if (customerOrders.length === 0) return 0;

  const latestOrder = customerOrders[customerOrders.length - 1];
  let totalDebt = 0;

  for (const order of customerOrders) {
    if (order.paymentStatus === PaymentStatus.RECEIVED) {
      continue;
    }

    // A newly placed order that is not yet delivered and has no recorded collection
    // is currently in progress, not a "previous COD outstanding" debt.
    const isUndeliveredInProgress =
      order.status !== OrderStatus.DELIVERED &&
      order.paymentStatus !== PaymentStatus.PARTIALLY_COLLECTED &&
      (!order.codCollectedAmount || order.codCollectedAmount <= 0);

    if (order.id === latestOrder.id && isUndeliveredInProgress) {
      continue;
    }

    const bill = Number(order.finalAmount) || 0;
    const collected = Number(order.codCollectedAmount) || 0;
    const unpaid = Math.max(0, bill - collected);
    totalDebt += unpaid;
  }

  return Math.round(totalDebt * 100) / 100;
}

export interface AllocationResult {
  allocations: CodTransactionAllocation[];
  updatedOrders: Order[];
  remainingOutstanding: number;
  totalCollected: number;
}

/**
 * Allocates collected cash:
 * 1. Current order payable is covered first up to its bill amount.
 * 2. Any additional cash collected beyond the current order bill settles previous
 *    outstanding COD debt (FIFO across older unpaid orders), reducing negative wallet balance.
 *
 * Example:
 * Old outstanding ₹18, New order ₹150.
 * If ₹168 is collected:
 * - ₹150 pays Current order (RECEIVED, unpaid ₹0).
 * - ₹18 settles Previous outstanding (RECEIVED, unpaid ₹0).
 * - Customer's Wallet Balance becomes ₹0.
 * If ₹150 is collected:
 * - ₹150 pays Current order (RECEIVED, unpaid ₹0).
 * - Previous outstanding ₹18 remains unpaid, Wallet Balance remains -₹18.
 */
export function allocateCodCollection(
  orders: Order[],
  targetPhoneOrId: string,
  currentOrderId: string,
  collectedAmount: number,
  markAsDelivered: boolean = false
): AllocationResult {
  const cleanCollected = Math.max(0, Math.round(collectedAmount * 100) / 100);

  // 1. Identify all non-cancelled COD orders for this customer
  const customerOrders = orders
    .filter(
      (o) =>
        o.status !== OrderStatus.CANCELLED &&
        o.paymentMethod === PaymentMethod.COD &&
        isSameCustomer(o, targetPhoneOrId)
    )
    .sort(
      (a, b) =>
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
    );

  const olderOrders = customerOrders.filter((o) => o.id !== currentOrderId);
  const currentOrder =
    customerOrders.find((o) => o.id === currentOrderId) ||
    orders.find((o) => o.id === currentOrderId);

  const allocations: CodTransactionAllocation[] = [];
  const modifiedOrdersMap = new Map<string, Order>();

  if (!currentOrder) {
    return {
      allocations: [],
      updatedOrders: orders,
      remainingOutstanding: calculateCustomerOutstanding(orders, targetPhoneOrId),
      totalCollected: cleanCollected,
    };
  }

  const bill = Number(currentOrder.finalAmount) || 0;
  const customerPriorDebt = calculateCustomerOutstanding(orders, targetPhoneOrId, currentOrderId);
  const prevDebt = Math.max(0, Number(currentOrder.previousOutstanding) || customerPriorDebt);

  // Current order bill is covered first
  const allocToCurrent = Math.min(cleanCollected, bill);
  // Cash beyond current bill is allocated to settle older debt up to prevDebt
  let cashForOlder = Math.min(Math.max(0, cleanCollected - bill), prevDebt);

  for (const olderOrder of olderOrders) {
    const oBill = Number(olderOrder.finalAmount) || 0;
    const oAlready = Number(olderOrder.codCollectedAmount) || 0;
    const oUnpaid = Math.max(0, oBill - oAlready);

    if (oUnpaid <= 0) {
      continue;
    }

    const alloc = Math.min(cashForOlder, oUnpaid);
    const updatedCollected = Math.round((oAlready + alloc) * 100) / 100;
    const remUnpaid = Math.max(0, Math.round((oBill - updatedCollected) * 100) / 100);

    let status = PaymentStatus.PENDING;
    if (updatedCollected >= oBill) {
      status = PaymentStatus.RECEIVED;
    } else if (updatedCollected > 0) {
      status = PaymentStatus.PARTIALLY_COLLECTED;
    }

    allocations.push({
      orderId: olderOrder.id,
      orderNumber: olderOrder.orderNumber,
      amountAllocated: alloc,
      orderRemainingUnpaid: remUnpaid,
    });

    modifiedOrdersMap.set(olderOrder.id, {
      ...olderOrder,
      codCollectedAmount: updatedCollected,
      paymentStatus: status,
    });

    cashForOlder = Math.round((cashForOlder - alloc) * 100) / 100;
  }

  // Current order payment status
  let nextPaymentStatus: PaymentStatus;
  if (allocToCurrent >= bill) {
    nextPaymentStatus = PaymentStatus.RECEIVED;
  } else if (allocToCurrent > 0) {
    nextPaymentStatus = PaymentStatus.PARTIALLY_COLLECTED;
  } else {
    nextPaymentStatus = PaymentStatus.PENDING;
  }

  const currentRemainingUnpaid = Math.max(0, Math.round((bill - allocToCurrent) * 100) / 100);

  allocations.push({
    orderId: currentOrder.id,
    orderNumber: currentOrder.orderNumber,
    amountAllocated: allocToCurrent,
    orderRemainingUnpaid: currentRemainingUnpaid,
  });

  modifiedOrdersMap.set(currentOrder.id, {
    ...currentOrder,
    codCollectedAmount: allocToCurrent,
    paymentStatus: nextPaymentStatus,
    status: markAsDelivered ? OrderStatus.DELIVERED : currentOrder.status,
  });

  const updatedOrders = orders.map((o) => {
    if (modifiedOrdersMap.has(o.id)) {
      return modifiedOrdersMap.get(o.id)!;
    }
    return o;
  });

  const remainingOutstanding = calculateCustomerOutstanding(
    updatedOrders,
    targetPhoneOrId
  );

  return {
    allocations,
    updatedOrders,
    remainingOutstanding,
    totalCollected: cleanCollected,
  };
}

/**
 * Client-side helper to record collection via backend persistent API.
 */
export async function recordCodCollectionViaApi(payload: {
  orderId: string;
  orderNumber: string;
  customerPhone: string;
  customerId: string;
  customerName: string;
  collectedAmount: number;
  previousOutstanding: number;
  orderAmount: number;
  totalPayable: number;
  markAsDelivered?: boolean;
  notes?: string;
  allCustomerOrders?: any[];
}): Promise<{
  success: boolean;
  transaction?: CodPaymentTransaction;
  updatedOrdersMap?: Record<
    string,
    { codCollectedAmount: number; paymentStatus: PaymentStatus; status?: OrderStatus }
  >;
  remainingOutstanding?: number;
  error?: string;
}> {
  try {
    const res = await fetch('/api/cod-collections', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      return {
        success: false,
        error: errData.error || `Server responded with ${res.status}`,
      };
    }

    const data = await res.json();
    return data;
  } catch (err: any) {
    console.warn('API call to /api/cod-collections failed:', err);
    return {
      success: false,
      error: err.message || 'Network request failed',
    };
  }
}

/**
 * Client-side helper to fetch all persistent COD collection transactions and balances.
 */
export async function fetchCodCollectionsFromApi(phone?: string): Promise<{
  success: boolean;
  transactions: CodPaymentTransaction[];
  ordersMap: Record<
    string,
    {
      codCollectedAmount?: number;
      previousOutstanding?: number;
      totalPayable?: number;
      paymentStatus?: PaymentStatus;
    }
  >;
  customerOutstanding: Record<string, number>;
}> {
  try {
    const url = phone
      ? `/api/cod-collections?phone=${encodeURIComponent(normalizePhone(phone))}`
      : '/api/cod-collections';
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch (err) {
    console.warn('Failed to fetch from /api/cod-collections:', err);
    return {
      success: false,
      transactions: [],
      ordersMap: {},
      customerOutstanding: {},
    };
  }
}
