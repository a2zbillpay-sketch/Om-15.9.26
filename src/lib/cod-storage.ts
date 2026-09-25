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

  let runningDebt = 0;

  for (const order of customerOrders) {
    const bill = Number(order.finalAmount) || 0;
    const prevDebt = Number(order.previousOutstanding || 0);
    const payable = Number(order.totalPayable) || (bill + (prevDebt || runningDebt));
    const collected = Number(order.codCollectedAmount) || 0;
    const isReceived = order.paymentStatus === PaymentStatus.RECEIVED;

    if (isReceived || collected >= payable) {
      runningDebt = 0;
    } else {
      runningDebt = Math.max(0, Math.round((payable - collected) * 100) / 100);
    }
  }

  return Math.round(runningDebt * 100) / 100;
}

export interface AllocationResult {
  allocations: CodTransactionAllocation[];
  updatedOrders: Order[];
  remainingOutstanding: number;
  totalCollected: number;
}

/**
 * Allocates collected cash across previous unpaid/partially paid orders in FIFO order,
 * then to the current order.
 *
 * Example:
 * Previous bill ₹1,000, collected ₹400 → Outstanding ₹600.
 * New order ₹500 → Total Payable ₹1,100.
 * When ₹1,100 is collected:
 * - ₹600 is allocated to Previous bill (total collected becomes ₹1,000, remaining ₹0, status RECEIVED).
 * - ₹500 is allocated to New order (total collected becomes ₹500, remaining ₹0, status RECEIVED).
 * - Remaining Outstanding becomes ₹0.
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
  const prevDebt = Number(currentOrder.previousOutstanding) || 0;
  const totalPayable = Number(currentOrder.totalPayable) || (bill + prevDebt);

  // When editing an existing collection, cleanCollected replaces the previous collected total on this order
  const newCollected = cleanCollected;
  const remainingUnpaid = Math.max(0, Math.round((totalPayable - newCollected) * 100) / 100);

  let nextPaymentStatus: PaymentStatus;
  if (newCollected >= totalPayable) {
    nextPaymentStatus = PaymentStatus.RECEIVED;
  } else if (newCollected > 0) {
    nextPaymentStatus = PaymentStatus.PARTIALLY_COLLECTED;
  } else {
    nextPaymentStatus = PaymentStatus.PENDING;
  }

  // Allocate cash across older orders first (FIFO) up to prevDebt
  let cashForOlder = Math.min(cleanCollected, prevDebt);
  for (const olderOrder of olderOrders) {
    const oBill = Number(olderOrder.finalAmount) || 0;
    const oAlready = Number(olderOrder.codCollectedAmount) || 0;
    const oUnpaid = Math.max(0, oBill - oAlready);

    // If newCollected pays full totalPayable, all older orders whose debt was in prevDebt are 100% satisfied
    if (newCollected >= totalPayable) {
      modifiedOrdersMap.set(olderOrder.id, {
        ...olderOrder,
        codCollectedAmount: oBill,
        paymentStatus: PaymentStatus.RECEIVED,
      });
      allocations.push({
        orderId: olderOrder.id,
        orderNumber: olderOrder.orderNumber,
        amountAllocated: oUnpaid,
        orderRemainingUnpaid: 0,
      });
      continue;
    }

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

  // Current order allocation
  const allocToBill = Math.min(Math.max(0, cleanCollected - prevDebt), bill);
  allocations.push({
    orderId: currentOrder.id,
    orderNumber: currentOrder.orderNumber,
    amountAllocated: allocToBill,
    orderRemainingUnpaid: remainingUnpaid,
  });

  modifiedOrdersMap.set(currentOrder.id, {
    ...currentOrder,
    codCollectedAmount: newCollected,
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
