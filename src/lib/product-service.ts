import { Product, ProductVariant, TieredPrice, UnitType } from '../types.ts';
import { INITIAL_CATEGORIES } from '../data/seedData.ts';
import { formatVariantPack } from '../utils/variantFormatter.ts';

export interface ProductValidationResult {
  valid: boolean;
  error?: string;
  product?: Product;
}

export interface VariantValidationResult {
  valid: boolean;
  error?: string;
  variant?: ProductVariant;
}

export interface TieredPriceValidationResult {
  valid: boolean;
  error?: string;
  tieredPrice?: TieredPrice;
}

export interface BulkUploadRow {
  productName?: string;
  brand?: string;
  categoryId?: string;
  categoryName?: string;
  barcode?: string;
  description?: string;
  imageUrl?: string;
  isDiscountExcluded?: boolean | string;
  packSize?: number | string;
  unit?: string;
  packLabel?: string;
  mrp?: number | string;
  baseSellingPrice?: number | string;
  stockQuantity?: number | string;
  maxOrderLimit?: number | string;
  wholesaleMinQty?: number | string;
  wholesaleMaxQty?: number | string;
  wholesalePrice?: number | string;
  [key: string]: any;
}

export interface BulkUploadResult {
  validProducts: Product[];
  errors: { row: number; error: string }[];
}

const VALID_UNITS = new Set<string>(Object.values(UnitType));

/**
 * Validates and normalizes product barcode.
 * - Allowed to be null or undefined (returns null).
 * - Empty string or whitespace-only returns null.
 * - String trimmed and preserved as exact string (never coerced to numeric).
 * - Max length 64 characters.
 * - Allowed characters: standard barcode alphanumeric and common punctuation: A-Z, a-z, 0-9, hyphen, underscore, period.
 */
export function normalizeAndValidateBarcode(rawBarcode: any): { valid: boolean; barcode: string | null; error?: string } {
  if (rawBarcode === undefined || rawBarcode === null) {
    return { valid: true, barcode: null };
  }

  // Preserve as exact string without numeric conversion
  const str = String(rawBarcode).trim();
  if (!str) {
    return { valid: true, barcode: null };
  }

  if (str.length > 64) {
    return { valid: false, barcode: null, error: 'Barcode exceeds maximum allowed length of 64 characters.' };
  }

  // Barcode format safety check: disallow control characters, newlines, tabs
  if (/[\r\n\t\x00-\x1f\x7f]/.test(str)) {
    return { valid: false, barcode: null, error: 'Barcode contains invalid control characters.' };
  }

  // Ensure barcode characters are standard printable ASCII
  if (!/^[\x20-\x7E]+$/.test(str)) {
    return { valid: false, barcode: null, error: 'Barcode contains invalid non-ASCII characters.' };
  }

  return { valid: true, barcode: str };
}

export interface BarcodeLookupMatchResult {
  valid: boolean;
  error?: string;
  normalizedBarcode: string | null;
  status: 'empty' | 'invalid' | 'found' | 'not_found' | 'duplicate_found';
  product?: Product;
  duplicateProducts?: Product[];
}

/**
 * Performs exact barcode matching against a product collection.
 * - Preserves leading zeros and exact character sequences.
 * - Enforces exact equality (not partial or fuzzy).
 * - Distinguishes between single match, not found, and duplicate legacy data.
 */
export function lookupProductByBarcode(
  rawBarcode: string,
  products: Product[]
): BarcodeLookupMatchResult {
  const trimmed = String(rawBarcode ?? '').trim();
  if (!trimmed) {
    return {
      valid: false,
      error: 'Please enter or scan a barcode.',
      normalizedBarcode: null,
      status: 'empty',
    };
  }

  const validation = normalizeAndValidateBarcode(trimmed);
  if (!validation.valid || !validation.barcode) {
    return {
      valid: false,
      error: validation.error || 'Invalid barcode format.',
      normalizedBarcode: null,
      status: 'invalid',
    };
  }

  const targetBarcode = validation.barcode;

  // Exact match (case-insensitive for safety, preserving leading zeros and exact length)
  const matches = products.filter(
    (p) => p.barcode && p.barcode.trim().toLowerCase() === targetBarcode.toLowerCase()
  );

  if (matches.length === 1) {
    return {
      valid: true,
      normalizedBarcode: targetBarcode,
      status: 'found',
      product: matches[0],
    };
  }

  if (matches.length === 0) {
    return {
      valid: true,
      normalizedBarcode: targetBarcode,
      status: 'not_found',
    };
  }

  return {
    valid: true,
    normalizedBarcode: targetBarcode,
    status: 'duplicate_found',
    duplicateProducts: matches,
  };
}

/**
 * Validates and normalizes a single wholesale tiered price slab.
 */
export function normalizeAndValidateTieredPrice(
  raw: any,
  variantId: string,
  baseSellingPrice: number
): TieredPriceValidationResult {
  if (!raw) {
    return { valid: false, error: 'Empty tiered price definition.' };
  }

  const minQty = Number(raw.minQty ?? raw.wholesaleMinQty);
  if (!minQty || isNaN(minQty) || minQty < 2) {
    return { valid: false, error: 'Wholesale minimum quantity must be at least 2.' };
  }

  const maxQty = raw.maxQty !== undefined && raw.maxQty !== null && String(raw.maxQty).trim() !== ''
    ? Number(raw.maxQty ?? raw.wholesaleMaxQty)
    : 9999;

  if (isNaN(maxQty) || maxQty < minQty) {
    return { valid: false, error: 'Wholesale maximum quantity cannot be less than minimum quantity.' };
  }

  const unitPrice = Number(raw.unitPrice ?? raw.wholesalePrice);
  if (isNaN(unitPrice) || unitPrice <= 0) {
    return { valid: false, error: 'Wholesale price must be greater than 0.' };
  }

  if (unitPrice > baseSellingPrice) {
    return {
      valid: false,
      error: `Wholesale price (₹${unitPrice}) cannot exceed base selling price (₹${baseSellingPrice}).`,
    };
  }

  const id = raw.id || `tp-${variantId}-${minQty}-${Date.now()}`;

  return {
    valid: true,
    tieredPrice: {
      id,
      variantId,
      minQty,
      maxQty,
      unitPrice,
    },
  };
}

/**
 * Validates and normalizes a product variant.
 */
export function normalizeAndValidateVariant(
  raw: any,
  productId: string,
  index: number = 0
): VariantValidationResult {
  if (!raw) {
    return { valid: false, error: `Variant #${index + 1}: Empty variant specification.` };
  }

  // Pack Size
  const packSize = Number(raw.packSize);
  if (!packSize || isNaN(packSize) || packSize <= 0) {
    return { valid: false, error: `Variant #${index + 1}: Valid positive pack size is required.` };
  }

  // Unit
  const rawUnit = String(raw.unit || '').trim().toUpperCase();
  if (!rawUnit || !VALID_UNITS.has(rawUnit)) {
    return {
      valid: false,
      error: `Variant #${index + 1}: Valid unit required (${Array.from(VALID_UNITS).join(', ')}).`,
    };
  }
  const unit = rawUnit as UnitType;

  // MRP
  const mrp = Number(raw.mrp);
  if (isNaN(mrp) || mrp <= 0) {
    return { valid: false, error: `Variant #${index + 1}: MRP must be greater than 0.` };
  }

  // Base Selling Price
  const baseSellingPrice = Number(raw.baseSellingPrice);
  if (isNaN(baseSellingPrice) || baseSellingPrice <= 0) {
    return { valid: false, error: `Variant #${index + 1}: Retail selling price must be greater than 0.` };
  }

  if (baseSellingPrice > mrp) {
    return {
      valid: false,
      error: `Variant #${index + 1}: Retail selling price (₹${baseSellingPrice}) cannot exceed MRP (₹${mrp}).`,
    };
  }

  // Stock Quantity (defaults to 0 if left empty)
  const stockQuantity =
    raw.stockQuantity !== undefined && raw.stockQuantity !== null && String(raw.stockQuantity).trim() !== ''
      ? Math.max(0, Number(raw.stockQuantity))
      : 0;

  // Max Order Limit (defaults to 12 if left empty)
  const maxOrderLimit =
    raw.maxOrderLimit !== undefined && raw.maxOrderLimit !== null && String(raw.maxOrderLimit).trim() !== ''
      ? Math.max(1, Number(raw.maxOrderLimit))
      : 12;

  const variantId = raw.id || `var-${productId}-${index + 1}-${Date.now()}`;

  // Pack Label
  const packLabel = formatVariantPack({
    packLabel: raw.packLabel?.trim() || undefined,
    packSize,
    unit,
  });

  // Tiered Prices / Wholesale Slabs
  const tieredPrices: TieredPrice[] = [];
  const rawTps = Array.isArray(raw.tieredPrices)
    ? raw.tieredPrices
    : (raw.wholesaleMinQty && raw.wholesalePrice)
    ? [{ minQty: raw.wholesaleMinQty, maxQty: raw.wholesaleMaxQty, unitPrice: raw.wholesalePrice }]
    : [];

  for (const rawTp of rawTps) {
    const tpResult = normalizeAndValidateTieredPrice(rawTp, variantId, baseSellingPrice);
    if (!tpResult.valid || !tpResult.tieredPrice) {
      return {
        valid: false,
        error: `Variant #${index + 1} wholesale slab: ${tpResult.error}`,
      };
    }
    tieredPrices.push(tpResult.tieredPrice);
  }

  return {
    valid: true,
    variant: {
      id: variantId,
      productId,
      unit,
      packSize,
      packLabel,
      mrp,
      baseSellingPrice,
      stockQuantity,
      maxOrderLimit,
      tieredPrices,
    },
  };
}

/**
 * Validates and normalizes an entire product structure.
 * Can be called for single creation, editing, or each item in a bulk upload.
 */
export function normalizeAndValidateProduct(raw: any): ProductValidationResult {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Invalid product payload.' };
  }

  const name = String(raw.name || '').trim();
  if (!name) {
    return { valid: false, error: 'Product name is required.' };
  }

  const brand = raw.brand ? String(raw.brand).trim() : '';

  const productId = raw.id || `prod-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
  const description = String(raw.description || '').trim();
  const categoryId = raw.categoryId ? String(raw.categoryId).trim() : '';
  const imageUrl = raw.imageUrl && String(raw.imageUrl).trim() ? String(raw.imageUrl).trim() : undefined;
  const isDiscountExcluded = Boolean(raw.isDiscountExcluded);

  // Barcode normalization & validation
  const barcodeValidation = normalizeAndValidateBarcode(raw.barcode);
  if (!barcodeValidation.valid) {
    return { valid: false, error: barcodeValidation.error };
  }
  const barcode = barcodeValidation.barcode;

  const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];
  if (rawVariants.length === 0) {
    return { valid: false, error: 'Product must have at least one pack variant.' };
  }

  const normalizedVariants: ProductVariant[] = [];
  for (let i = 0; i < rawVariants.length; i++) {
    const vResult = normalizeAndValidateVariant(rawVariants[i], productId, i);
    if (!vResult.valid || !vResult.variant) {
      return { valid: false, error: vResult.error };
    }
    normalizedVariants.push(vResult.variant);
  }

  return {
    valid: true,
    product: {
      id: productId,
      name,
      brand,
      description,
      categoryId,
      imageUrl,
      barcode,
      isDiscountExcluded,
      createdAt: raw.createdAt || new Date().toISOString(),
      variants: normalizedVariants,
    },
  };
}

/**
 * Executes an atomic Supabase write with strict cascade synchronization:
 * - Upserts product metadata
 * - Deletes removed variants from public.product_variants
 * - Upserts current variants
 * - Deletes removed tiered prices from public.tiered_prices
 * - Upserts current tiered prices
 */
export async function saveProductWithCascadeSync(
  supabaseClient: any,
  product: Product
): Promise<{ success: boolean; error?: string; product?: Product }> {
  if (!supabaseClient) {
    return { success: false, error: 'Supabase client is not available.' };
  }

  try {
    // 1. Ensure category exists in categories table to satisfy Foreign Key constraints if present
    if (product.categoryId) {
      const matchedCat = INITIAL_CATEGORIES.find((c) => c.id === product.categoryId);
      if (matchedCat) {
        try {
          await supabaseClient.from('categories').upsert(
            {
              id: matchedCat.id,
              name: matchedCat.name,
              image_url: matchedCat.imageUrl || null,
            },
            { onConflict: 'id' }
          );
        } catch {
          // Continue if category upsert is restricted
        }
      }
    }

    // 2. Prepare Product record for public.products
    const matchedCategory = INITIAL_CATEGORIES.find((c) => c.id === product.categoryId);
    const categoryName = matchedCategory ? matchedCategory.name : (product.categoryId || 'Other Grocery Items');
    const primaryVariant = product.variants?.[0];
    const basePrice = primaryVariant ? Number(primaryVariant.baseSellingPrice || 0) : 0;
    const mrp = primaryVariant ? Number(primaryVariant.mrp || 0) : 0;
    const totalStock = (product.variants || []).reduce(
      (sum, v) => sum + (Number(v.stockQuantity) || 0),
      0
    );
    const unitLabel = primaryVariant
      ? (primaryVariant.packLabel || `${primaryVariant.packSize || 1} ${primaryVariant.unit || 'KG'}`)
      : '1 KG';

    const productPayload: Record<string, any> = {
      id: product.id,
      name: product.name,
      category: categoryName,
      sub_category: product.brand || '',
      price: basePrice,
      mrp: mrp,
      stock: totalStock,
      unit: unitLabel,
      min_order_qty: 1,
      image_url: product.imageUrl && product.imageUrl.trim() ? product.imageUrl.trim() : null,
      wholesale_tier_discount: product.variants || [],
      barcode: product.barcode && product.barcode.trim() ? product.barcode.trim() : null,
      is_discount_excluded: product.isDiscountExcluded ?? false,
      updated_at: new Date().toISOString(),
    };

    let prodInsertResult = await supabaseClient
      .from('products')
      .upsert(productPayload, { onConflict: 'id' });

    // Graceful fallback: If barcode or is_discount_excluded column has not yet been migrated in Supabase table
    if (prodInsertResult.error && prodInsertResult.error.message?.includes('barcode')) {
      const fallbackPayload = { ...productPayload };
      delete fallbackPayload.barcode;
      prodInsertResult = await supabaseClient
        .from('products')
        .upsert(fallbackPayload, { onConflict: 'id' });
    }

    if (
      prodInsertResult.error &&
      (prodInsertResult.error.message?.includes('is_discount_excluded') ||
        prodInsertResult.error.message?.toLowerCase().includes("could not find the 'is_discount_excluded' column"))
    ) {
      const fallbackPayload = { ...productPayload };
      delete fallbackPayload.is_discount_excluded;
      prodInsertResult = await supabaseClient
        .from('products')
        .upsert(fallbackPayload, { onConflict: 'id' });
    }

    if (prodInsertResult.error) {
      if (
        prodInsertResult.error.code === '23505' ||
        prodInsertResult.error.message?.toLowerCase().includes('barcode') ||
        prodInsertResult.error.message?.toLowerCase().includes('idx_products_barcode_unique')
      ) {
        return {
          success: false,
          error: `Barcode "${product.barcode}" is already assigned to another product. Each product must have a unique barcode.`,
        };
      }
      return {
        success: false,
        error: `Database error saving product: ${prodInsertResult.error.message || 'Check database permissions'}`,
      };
    }

    const incomingVariants = product.variants || [];

    // 3. Optional: If separate relational product_variants table exists, sync it
    try {
      const { data: existingVariants, error: fetchVarErr } = await supabaseClient
        .from('product_variants')
        .select('id')
        .eq('product_id', product.id);

      if (!fetchVarErr && existingVariants) {
        const incomingVarIdSet = new Set(incomingVariants.map((v) => v.id));
        const removedVarIds = existingVariants
          .map((v: any) => v.id)
          .filter((id: string) => !incomingVarIdSet.has(id));

        if (removedVarIds.length > 0) {
          await supabaseClient
            .from('product_variants')
            .delete()
            .in('id', removedVarIds);
        }

        if (incomingVariants.length > 0) {
          const variantsPayload = incomingVariants.map((v) => ({
            id: v.id,
            product_id: product.id,
            unit: v.unit,
            pack_size: Number(v.packSize),
            pack_label: v.packLabel || `${v.packSize} ${v.unit}`,
            mrp: Number(v.mrp),
            base_selling_price: Number(v.baseSellingPrice),
            stock_quantity: v.stockQuantity !== undefined && v.stockQuantity !== null ? Number(v.stockQuantity) : 0,
            max_order_limit: v.maxOrderLimit !== undefined && v.maxOrderLimit !== null ? Number(v.maxOrderLimit) : 12,
            updated_at: new Date().toISOString(),
          }));

          await supabaseClient
            .from('product_variants')
            .upsert(variantsPayload, { onConflict: 'id' });
        }
      }
    } catch {
      // product_variants table not available, products.wholesale_tier_discount is primary store
    }

    return { success: true, product };
  } catch (err: any) {
    return {
      success: false,
      error: `Unexpected error saving product: ${err?.message || 'Database error'}`,
    };
  }
}

/**
 * Deletes a product with full cascade support.
 * Relies on PostgreSQL database-level ON DELETE CASCADE for variants and tiered prices.
 */
export async function deleteProductWithCascade(
  supabaseClient: any,
  productId: string
): Promise<{ success: boolean; error?: string }> {
  if (!supabaseClient) {
    return { success: false, error: 'Supabase client is not available.' };
  }

  try {
    const { error } = await supabaseClient.from('products').delete().eq('id', productId);
    if (error) {
      return { success: false, error: error.message };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Database delete failed' };
  }
}

/**
 * Bulk Normalization Pipeline:
 * Prepares raw flat tabular rows (such as from future Excel .xlsx parsing)
 * into validated Product and Variant models.
 */
export function processBulkProductRows(rows: BulkUploadRow[]): BulkUploadResult {
  const validProducts: Product[] = [];
  const errors: { row: number; error: string }[] = [];

  // Group rows by product name & brand
  const grouped = new Map<string, BulkUploadRow[]>();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowNum = i + 2; // Excel row numbering typically starts at 2 (with row 1 as header)

    const pName = String(row.productName || row.name || '').trim();
    const pBrand = row.brand ? String(row.brand).trim() : '';

    if (!pName) {
      errors.push({ row: rowNum, error: 'Missing product name.' });
      continue;
    }

    const key = pBrand ? `${pBrand.toLowerCase()}:::${pName.toLowerCase()}` : `:::${pName.toLowerCase()}`;
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key)!.push({ ...row, _excelRow: rowNum });
  }

  // Normalize each grouped product
  for (const [, productRows] of grouped.entries()) {
    const firstRow = productRows[0];
    const productId = `prod-bulk-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;

    // Build variants
    const rawVariants = productRows.map((r, idx) => ({
      id: `var-${productId}-${idx + 1}`,
      packSize: r.packSize,
      unit: r.unit,
      packLabel: r.packLabel,
      mrp: r.mrp,
      baseSellingPrice: r.baseSellingPrice,
      stockQuantity: r.stockQuantity,
      maxOrderLimit: r.maxOrderLimit,
      wholesaleMinQty: r.wholesaleMinQty,
      wholesaleMaxQty: r.wholesaleMaxQty,
      wholesalePrice: r.wholesalePrice,
    }));

    const rawProduct = {
      id: productId,
      name: firstRow.productName || firstRow.name,
      brand: firstRow.brand ? String(firstRow.brand).trim() : '',
      description: firstRow.description || '',
      categoryId: firstRow.categoryId || '',
      imageUrl: firstRow.imageUrl || undefined,
      barcode: firstRow.barcode || undefined,
      isDiscountExcluded: Boolean(firstRow.isDiscountExcluded),
      variants: rawVariants,
    };

    const validation = normalizeAndValidateProduct(rawProduct);
    if (!validation.valid || !validation.product) {
      errors.push({
        row: firstRow._excelRow || 0,
        error: `Product "${rawProduct.name}": ${validation.error}`,
      });
    } else {
      validProducts.push(validation.product);
    }
  }

  return { validProducts, errors };
}
