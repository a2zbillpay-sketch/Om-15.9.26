import { Order, OrderItem, Product, ProductVariant } from '../types';

const STOCK_DEDUCTED_KEY = 'om_stock_deducted_orders';
const STOCK_RESTORED_KEY = 'om_stock_restored_orders';

/**
 * Returns a Set of order IDs and numbers for which stock has already been deducted.
 */
export function getDeductedOrderIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STOCK_DEDUCTED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Returns a Set of order IDs and numbers for which stock has already been restored.
 */
export function getRestoredOrderIds(): Set<string> {
  if (typeof localStorage === 'undefined') return new Set();
  try {
    const raw = localStorage.getItem(STOCK_RESTORED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

/**
 * Checks whether stock deduction has already been performed for this order.
 */
export function isStockDeductedForOrder(
  orderId: string,
  orderNumber?: string,
  order?: Order
): boolean {
  if (order?.stockDeducted === true) return true;
  const deductedSet = getDeductedOrderIds();
  if (orderId && deductedSet.has(orderId)) return true;
  if (orderNumber && deductedSet.has(orderNumber)) return true;
  return false;
}

/**
 * Marks an order as having its stock deducted in persistent storage.
 */
export function markStockDeductedForOrder(orderId: string, orderNumber?: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const deducted = getDeductedOrderIds();
    if (orderId) deducted.add(orderId);
    if (orderNumber) deducted.add(orderNumber);
    localStorage.setItem(STOCK_DEDUCTED_KEY, JSON.stringify(Array.from(deducted)));

    // Clean up restored status if re-accepted
    const restored = getRestoredOrderIds();
    if (orderId) restored.delete(orderId);
    if (orderNumber) restored.delete(orderNumber);
    localStorage.setItem(STOCK_RESTORED_KEY, JSON.stringify(Array.from(restored)));
  } catch {}
}

/**
 * Checks whether stock restoration has already been performed for this order.
 */
export function isStockRestoredForOrder(
  orderId: string,
  orderNumber?: string,
  order?: Order
): boolean {
  if (order?.stockRestored === true) return true;
  const restoredSet = getRestoredOrderIds();
  if (orderId && restoredSet.has(orderId)) return true;
  if (orderNumber && restoredSet.has(orderNumber)) return true;
  return false;
}

/**
 * Marks an order as having its stock restored in persistent storage.
 */
export function markStockRestoredForOrder(orderId: string, orderNumber?: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const restored = getRestoredOrderIds();
    if (orderId) restored.add(orderId);
    if (orderNumber) restored.add(orderNumber);
    localStorage.setItem(STOCK_RESTORED_KEY, JSON.stringify(Array.from(restored)));

    // Clean up deducted status
    const deducted = getDeductedOrderIds();
    if (orderId) deducted.delete(orderId);
    if (orderNumber) deducted.delete(orderNumber);
    localStorage.setItem(STOCK_DEDUCTED_KEY, JSON.stringify(Array.from(deducted)));
  } catch {}
}

/**
 * Helper to match an OrderItem to a Product and ProductVariant within the current catalog.
 */
export function findProductAndVariant(
  item: OrderItem,
  products: Product[]
): { product: Product; variant: ProductVariant } | null {
  // 1. Match product by item.productId
  let matchedProduct: Product | undefined;
  if (item.productId) {
    matchedProduct = products.find((p) => p.id === item.productId);
  }

  // 2. If not matched, find product by item.variantId across all products
  if (!matchedProduct && item.variantId) {
    matchedProduct = products.find((p) =>
      p.variants?.some((v) => v.id === item.variantId)
    );
  }

  // 3. If not matched, find product by exact or fuzzy name match
  if (!matchedProduct && item.productName) {
    const rawSearch = item.productName.trim().toLowerCase();
    const strippedSearch = rawSearch.replace(/\s*\([^)]+\)/g, '').trim();

    // 3a. Exact product name match
    matchedProduct = products.find((p) => {
      const pName = p.name.trim().toLowerCase();
      return pName === rawSearch || (strippedSearch && pName === strippedSearch);
    });

    // 3b. Substring match
    if (!matchedProduct) {
      matchedProduct = products.find((p) => {
        const pName = p.name.trim().toLowerCase();
        return (
          rawSearch.includes(pName) ||
          pName.includes(rawSearch) ||
          (strippedSearch && (strippedSearch.includes(pName) || pName.includes(strippedSearch)))
        );
      });
    }
  }

  if (!matchedProduct || !matchedProduct.variants || matchedProduct.variants.length === 0) {
    return null;
  }

  // Find variant within matched product
  let matchedVariant: ProductVariant | undefined;

  // 1. Match by variantId
  if (item.variantId) {
    matchedVariant = matchedProduct.variants.find((v) => v.id === item.variantId);
  }

  // 2. Match by exact variantName or packLabel
  if (!matchedVariant && item.variantName) {
    const searchVName = item.variantName.trim().toLowerCase();
    matchedVariant = matchedProduct.variants.find(
      (v) => (v.packLabel || '').trim().toLowerCase() === searchVName
    );
  }

  // 3. Match by unit and packSize
  if (!matchedVariant && item.unit && item.packSize !== undefined) {
    matchedVariant = matchedProduct.variants.find(
      (v) =>
        v.unit?.toUpperCase() === item.unit?.toUpperCase() &&
        Number(v.packSize) === Number(item.packSize)
    );
  }

  // 4. Match by searching variant label or packSize+unit in item.productName or item.variantName
  if (!matchedVariant) {
    const combinedSearch = `${item.productName || ''} ${item.variantName || ''}`.toLowerCase();
    matchedVariant = matchedProduct.variants.find((v) => {
      const vLabel = (v.packLabel || '').trim().toLowerCase();
      const vSizeUnit = `${v.packSize} ${v.unit}`.toLowerCase();
      const vSizeUnitNoSpace = `${v.packSize}${v.unit}`.toLowerCase();
      return (
        (vLabel && combinedSearch.includes(vLabel)) ||
        (vSizeUnit && combinedSearch.includes(vSizeUnit)) ||
        (vSizeUnitNoSpace && combinedSearch.includes(vSizeUnitNoSpace))
      );
    });
  }

  // 5. Match by unit price / selling price
  if (!matchedVariant && item.unitPrice && matchedProduct.variants.length > 1) {
    matchedVariant = matchedProduct.variants.find(
      (v) =>
        Number(v.baseSellingPrice) === Number(item.unitPrice) ||
        Number(v.mrp) === Number(item.unitPrice)
    );
  }

  // 6. Default to the first variant if specific variant couldn't be matched
  if (!matchedVariant) {
    matchedVariant = matchedProduct.variants[0];
  }

  return { product: matchedProduct, variant: matchedVariant };
}

export interface StockChangeResult {
  updatedProducts: Product[];
  affectedProducts: Product[];
  success: boolean;
}

/**
 * Deducts the exact ordered quantity from stock for every product/variant in the order.
 * Ensures stockQuantity does not drop below 0.
 * Automatically synchronizes product.stock with sum of variant stockQuantities.
 */
export function deductStockForOrder(
  order: Order,
  currentProducts: Product[]
): StockChangeResult {
  if (!order.items || order.items.length === 0) {
    return { updatedProducts: currentProducts, affectedProducts: [], success: false };
  }

  // Clone current products so we don't mutate state in-place
  const productsMap = new Map<string, Product>();
  currentProducts.forEach((p) => {
    productsMap.set(p.id, {
      ...p,
      variants: p.variants.map((v) => ({ ...v })),
    });
  });

  const affectedProductIds = new Set<string>();

  order.items.forEach((item) => {
    const qtyToDeduct = Number(item.quantity) || 0;
    if (qtyToDeduct <= 0) return;

    // Find in cloned products
    const clonedList = Array.from(productsMap.values());
    const match = findProductAndVariant(item, clonedList);
    if (!match) return;

    const prod = productsMap.get(match.product.id);
    if (!prod) return;

    const targetVar = prod.variants.find((v) => v.id === match.variant.id);
    if (targetVar) {
      targetVar.stockQuantity = Math.max(0, Number(targetVar.stockQuantity || 0) - qtyToDeduct);
      // Synchronize overall product stock
      (prod as any).stock = prod.variants.reduce(
        (sum, v) => sum + (Number(v.stockQuantity) || 0),
        0
      );
      affectedProductIds.add(prod.id);
    }
  });

  const updatedProducts = currentProducts.map((p) => {
    if (affectedProductIds.has(p.id)) {
      const updated = productsMap.get(p.id)!;
      return {
        ...updated,
        stock: updated.variants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0),
      };
    }
    return p;
  });

  const affectedProducts = Array.from(affectedProductIds)
    .map((id) => productsMap.get(id)!)
    .filter(Boolean);

  return {
    updatedProducts,
    affectedProducts,
    success: affectedProducts.length > 0,
  };
}

/**
 * Restores exactly the quantity that was deducted for every product/variant in the order.
 * Adds it back to the corresponding variant stock.
 * Automatically synchronizes product.stock with sum of variant stockQuantities.
 */
export function restoreStockForOrder(
  order: Order,
  currentProducts: Product[]
): StockChangeResult {
  if (!order.items || order.items.length === 0) {
    return { updatedProducts: currentProducts, affectedProducts: [], success: false };
  }

  const productsMap = new Map<string, Product>();
  currentProducts.forEach((p) => {
    productsMap.set(p.id, {
      ...p,
      variants: p.variants.map((v) => ({ ...v })),
    });
  });

  const affectedProductIds = new Set<string>();

  order.items.forEach((item) => {
    const qtyToRestore = Number(item.quantity) || 0;
    if (qtyToRestore <= 0) return;

    const clonedList = Array.from(productsMap.values());
    const match = findProductAndVariant(item, clonedList);
    if (!match) return;

    const prod = productsMap.get(match.product.id);
    if (!prod) return;

    const targetVar = prod.variants.find((v) => v.id === match.variant.id);
    if (targetVar) {
      targetVar.stockQuantity = Number(targetVar.stockQuantity || 0) + qtyToRestore;
      // Synchronize overall product stock
      (prod as any).stock = prod.variants.reduce(
        (sum, v) => sum + (Number(v.stockQuantity) || 0),
        0
      );
      affectedProductIds.add(prod.id);
    }
  });

  const updatedProducts = currentProducts.map((p) => {
    if (affectedProductIds.has(p.id)) {
      const updated = productsMap.get(p.id)!;
      return {
        ...updated,
        stock: updated.variants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0),
      };
    }
    return p;
  });

  const affectedProducts = Array.from(affectedProductIds)
    .map((id) => productsMap.get(id)!)
    .filter(Boolean);

  return {
    updatedProducts,
    affectedProducts,
    success: affectedProducts.length > 0,
  };
}
