import { calculateCheckoutTotals, VariantCartItem, SystemSettings, UserContext } from '../src/lib/engine/checkout-calculator';

function assert(condition: boolean, message: string) {
  if (!condition) {
    console.error(`❌ ASSERTION FAILED: ${message}`);
    process.exit(1);
  }
  console.log(`✅ ${message}`);
}

const mockSettings: SystemSettings = {
  advancePaymentDiscountPct: 3,
  codBaseCharge: 40,
  freeShippingMinAmount: 500,
  baseDeliveryFee: 50,
};

const mockUser: UserContext = {
  codOrderCount: 5,
};

console.log('--- TEST 1: Excluded Product Only in Cart ---');
const excludedOnlyItems: VariantCartItem[] = [
  {
    variantId: 'var-salt-1',
    quantity: 10,
    baseSellingPrice: 26,
    isDiscountExcluded: true, // Tata Salt: Price Regulated
    tieredPrices: [],
  },
];

const breakdown1 = calculateCheckoutTotals(excludedOnlyItems, mockUser, mockSettings, 0);
console.log('Test 1 Breakdown:', breakdown1);
assert(breakdown1.subtotal === 260, 'Subtotal is exactly ₹260');
assert(breakdown1.eligibleSubtotal === 0, 'Eligible subtotal is ₹0 because product is discount-excluded');
assert(breakdown1.excludedSubtotal === 260, 'Excluded subtotal is ₹260');
assert(breakdown1.advanceDiscountAmount === 0, 'Advance discount amount is strictly ₹0 (no discount applied)');
assert(breakdown1.advanceFinalTotal === 260 + breakdown1.deliveryFee, 'Price of excluded product remains completely unchanged');

console.log('\n--- TEST 2: Mixed Cart (Both Eligible & Excluded Products) ---');
const mixedItems: VariantCartItem[] = [
  {
    variantId: 'var-oil-1',
    quantity: 5,
    baseSellingPrice: 200, // ₹1,000 subtotal
    isDiscountExcluded: false, // Eligible product
    tieredPrices: [],
  },
  {
    variantId: 'var-salt-1',
    quantity: 10,
    baseSellingPrice: 50, // ₹500 subtotal
    isDiscountExcluded: true, // Price Regulated / Excluded
    tieredPrices: [],
  },
];

const breakdown2 = calculateCheckoutTotals(mixedItems, mockUser, mockSettings, 0);
console.log('Test 2 Breakdown:', breakdown2);
assert(breakdown2.subtotal === 1500, 'Subtotal is ₹1,500 (₹1,000 oil + ₹500 salt)');
assert(breakdown2.eligibleSubtotal === 1000, 'Eligible subtotal is ₹1,000 (only oil)');
assert(breakdown2.excludedSubtotal === 500, 'Excluded subtotal is ₹500 (only salt)');
assert(breakdown2.advanceDiscountAmount === 30, 'Discount is strictly ₹30 (3% of ₹1,000 eligible subtotal; ₹0 from salt)');
assert(breakdown2.advanceFinalTotal === 1500 - 30, 'Advance total is ₹1,470 (salt price of ₹500 is completely preserved without discount)');

console.log('\n--- TEST 3: Eligible Product Only in Cart ---');
const eligibleOnlyItems: VariantCartItem[] = [
  {
    variantId: 'var-oil-1',
    quantity: 5,
    baseSellingPrice: 200, // ₹1,000
    isDiscountExcluded: false,
    tieredPrices: [],
  },
];

const breakdown3 = calculateCheckoutTotals(eligibleOnlyItems, mockUser, mockSettings, 0);
console.log('Test 3 Breakdown:', breakdown3);
assert(breakdown3.subtotal === 1000, 'Subtotal is ₹1,000');
assert(breakdown3.eligibleSubtotal === 1000, 'Eligible subtotal is ₹1,000');
assert(breakdown3.advanceDiscountAmount === 30, 'Discount is ₹30 (3% of ₹1,000)');
assert(breakdown3.advanceFinalTotal === 970, 'Advance total is ₹970');

console.log('\n--- TEST 4: COD & Customer Outstanding Compatibility ---');
const breakdown4 = calculateCheckoutTotals(mixedItems, mockUser, mockSettings, 600);
console.log('Test 4 Breakdown:', breakdown4);
assert(breakdown4.subtotal === 1500, 'Subtotal is ₹1,500');
assert(breakdown4.codFinalTotal === 1500 + mockSettings.codBaseCharge, 'COD final total preserved');
assert(breakdown4.previousOutstanding === 600, 'Previous outstanding is ₹600');
assert(breakdown4.codTotalPayable === breakdown4.codFinalTotal + 600, 'Total payable is New Order + Previous Outstanding');

console.log('\n🎉 ALL DISCOUNT LOGIC TESTS PASSED SUCCESSFULLY!');
