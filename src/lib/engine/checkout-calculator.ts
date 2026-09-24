// lib/engine/checkout-calculator.ts

export interface VariantCartItem {
  variantId: string;
  quantity: number;
  baseSellingPrice: number;
  isDiscountExcluded: boolean;
  tieredPrices: { minQty: number; maxQty: number; unitPrice: number }[];
}

export interface UserContext {
  codOrderCount: number;
}

export interface SystemSettings {
  advancePaymentDiscountPct: number;
  codBaseCharge: number;
  freeShippingMinAmount: number;
  baseDeliveryFee: number;
}

export interface CheckoutBreakdown {
  subtotal: number;
  eligibleSubtotal: number;
  appliedUnitPriceSum: number;
  deliveryFee: number;
  codCharge: number;
  advanceDiscountAmount: number;
  codFinalTotal: number;
  advanceFinalTotal: number;
  previousOutstanding?: number;
  codTotalPayable?: number;
}

/**
 * Determines active unit price based on tiered/wholesale quantity slabs
 */
export function getActiveUnitPrice(
  baseSellingPrice: number,
  quantity: number,
  tieredPrices: { minQty: number; maxQty: number; unitPrice: number }[]
): number {
  if (!tieredPrices || tieredPrices.length === 0) {
    return baseSellingPrice;
  }
  const sortedSlabs = [...tieredPrices].sort((a, b) => b.minQty - a.minQty);
  for (const slab of sortedSlabs) {
    if (quantity >= slab.minQty && quantity <= slab.maxQty) {
      return slab.unitPrice;
    }
  }
  return baseSellingPrice;
}

export function calculateCheckoutTotals(
  items: VariantCartItem[],
  user: UserContext,
  settings: SystemSettings,
  previousOutstanding: number = 0
): CheckoutBreakdown {
  let subtotal = 0;
  let eligibleSubtotal = 0;

  items.forEach((item) => {
    // 1. Determine Tiered / Slab Price
    const activePrice = getActiveUnitPrice(item.baseSellingPrice, item.quantity, item.tieredPrices);
    const itemTotal = activePrice * item.quantity;
    subtotal += itemTotal;

    // Track subtotal of items eligible for dynamic discounts
    if (!item.isDiscountExcluded) {
      eligibleSubtotal += itemTotal;
    }
  });

  // 2. Delivery Fee Calculation (Free delivery if subtotal >= freeShippingMinAmount)
  const deliveryFee = subtotal >= settings.freeShippingMinAmount ? 0 : settings.baseDeliveryFee;

  // 3. COD Charge Calculation (First 3 COD orders are FREE)
  const codCharge = user.codOrderCount < 3 ? 0 : settings.codBaseCharge;

  // 4. Advance Payment Discount Calculation (Applied only to non-excluded items)
  const advanceDiscountAmount = Math.round((eligibleSubtotal * settings.advancePaymentDiscountPct) / 100);

  // Final Calculations
  const codFinalTotal = Math.max(0, subtotal + deliveryFee + codCharge);
  const advanceFinalTotal = Math.max(0, subtotal + deliveryFee - advanceDiscountAmount);
  const cleanOutstanding = Math.max(0, Number(previousOutstanding) || 0);
  const codTotalPayable = codFinalTotal + cleanOutstanding;

  return {
    subtotal,
    eligibleSubtotal,
    appliedUnitPriceSum: subtotal,
    deliveryFee,
    codCharge,
    advanceDiscountAmount,
    codFinalTotal,
    advanceFinalTotal,
    previousOutstanding: cleanOutstanding,
    codTotalPayable,
  };
}

// 15-Minute Cancellation Window Check
export function canCancelOrder(createdAt: string | Date): boolean {
  const windowMs = 15 * 60 * 1000; // 15 minutes
  const orderTime = typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt.getTime();
  const elapsed = Date.now() - orderTime;
  return elapsed >= 0 && elapsed <= windowMs;
}

export function getRemainingCancellationMinutes(createdAt: string | Date): number {
  const windowMs = 15 * 60 * 1000;
  const orderTime = typeof createdAt === 'string' ? new Date(createdAt).getTime() : createdAt.getTime();
  const elapsed = Date.now() - orderTime;
  const remainingMs = Math.max(0, windowMs - elapsed);
  return Math.ceil(remainingMs / (60 * 1000));
}
