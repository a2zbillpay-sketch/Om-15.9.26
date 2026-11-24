import { UnitType, type Product, type ProductVariant, type TieredPrice } from '../types.js';
import { formatVariantPack } from '../utils/variantFormatter.js';

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
  name?: string;
  brand?: string;
  categoryId?: string;
  categoryName?: string;
  category?: string;
  barcode?: string;
  description?: string;
  imageUrl?: string;
  isDiscountExcluded?: boolean | string;
  packSize?: number | string;
  unit?: string;
  packLabel?: string;
  purchasePrice?: number | string;
  mrp?: number | string;
  salePrice?: number | string;
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
    (p) =>
      (p.barcode && p.barcode.trim().toLowerCase() === targetBarcode.toLowerCase()) ||
      (Array.isArray(p.variants) &&
        p.variants.some((v) => v.barcode && v.barcode.trim().toLowerCase() === targetBarcode.toLowerCase()))
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

  const id = raw.id || `tp-${variantId}-${minQty}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

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

  // Base Selling Price - allow decimal values such as ₹9.50, ₹9.5, ₹10.25 (never restrict to whole numbers)
  const rawBaseSelling =
    typeof raw.baseSellingPrice === 'string'
      ? raw.baseSellingPrice.replace(/,/g, '.').replace(/[^0-9.]/g, '')
      : raw.baseSellingPrice;
  const baseSellingPrice = Number(rawBaseSelling);
  if (isNaN(baseSellingPrice) || baseSellingPrice <= 0) {
    return { valid: false, error: `Variant #${index + 1}: Retail selling price must be greater than 0 (e.g. ₹9.50, ₹10.25).` };
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
      ? Math.max(0, Math.floor(Number(raw.stockQuantity) || 0))
      : 0;

  // Max Order Limit (defaults to 12 if left empty)
  const maxOrderLimit =
    raw.maxOrderLimit !== undefined && raw.maxOrderLimit !== null && String(raw.maxOrderLimit).trim() !== ''
      ? Math.max(1, Number(raw.maxOrderLimit))
      : 12;

  const variantId = raw.id || `var-${productId}-${index + 1}-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`;

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

  const barcodeValidation = normalizeAndValidateBarcode(raw.barcode);
  if (!barcodeValidation.valid) {
    return {
      valid: false,
      error: `Variant #${index + 1}: ${barcodeValidation.error || 'Invalid barcode format.'}`,
    };
  }
  const variantBarcode = barcodeValidation.barcode;
  const variantImageUrl = raw.imageUrl || raw.image_url ? String(raw.imageUrl || raw.image_url).trim() : undefined;
  const purchasePrice =
    raw.purchasePrice !== undefined && raw.purchasePrice !== null && !isNaN(Number(raw.purchasePrice))
      ? Number(raw.purchasePrice)
      : (raw.purchase_price !== undefined && raw.purchase_price !== null && !isNaN(Number(raw.purchase_price)) ? Number(raw.purchase_price) : undefined);
  const displayOrder = typeof raw.displayOrder === 'number'
    ? raw.displayOrder
    : (typeof raw.display_order === 'number' ? raw.display_order : index + 1);

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
      purchasePrice,
      discount:
        raw.discount !== undefined && raw.discount !== null && !isNaN(Number(raw.discount))
          ? Number(raw.discount)
          : undefined,
      stockQuantity,
      maxOrderLimit,
      tieredPrices,
      lowStockThreshold:
        raw.lowStockThreshold !== undefined && raw.lowStockThreshold !== null && !isNaN(Number(raw.lowStockThreshold))
          ? Math.max(1, Number(raw.lowStockThreshold))
          : undefined,
      barcode: variantBarcode,
      imageUrl: variantImageUrl,
      displayOrder,
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
  const searchKeywords = raw.searchKeywords && String(raw.searchKeywords).trim()
    ? String(raw.searchKeywords).trim()
    : undefined;

  // Barcode normalization & validation
  const barcodeValidation = normalizeAndValidateBarcode(raw.barcode);
  if (!barcodeValidation.valid) {
    return { valid: false, error: barcodeValidation.error };
  }
  const barcode = barcodeValidation.barcode;

  const rawVariants = Array.isArray(raw.variants) ? raw.variants : [];
  const normalizedVariants: ProductVariant[] = [];
  const seenBarcodes = new Set<string>();
  if (barcode) {
    seenBarcodes.add(barcode.toLowerCase());
  }

  for (let i = 0; i < rawVariants.length; i++) {
    const vResult = normalizeAndValidateVariant(rawVariants[i], productId, i);
    if (!vResult.valid || !vResult.variant) {
      return { valid: false, error: vResult.error };
    }
    const vBarcode = vResult.variant.barcode;
    if (vBarcode) {
      const normalizedKey = vBarcode.toLowerCase();
      if (barcode && normalizedKey === barcode.toLowerCase()) {
        return {
          valid: false,
          error: `Variant #${i + 1}: Variant barcode "${vBarcode}" cannot be the same as the master product barcode.`,
        };
      }
      if (seenBarcodes.has(normalizedKey)) {
        return {
          valid: false,
          error: `Variant #${i + 1}: Duplicate barcode "${vBarcode}" within the same product. Each variant must have a unique barcode.`,
        };
      }
      seenBarcodes.add(normalizedKey);
    }
    normalizedVariants.push(vResult.variant);
  }

  // Parse product-level tiered prices (if product has 0 variants)
  const productTieredPrices: TieredPrice[] = [];
  if (normalizedVariants.length === 0 && Array.isArray(raw.tieredPrices)) {
    for (const rawTp of raw.tieredPrices) {
      const tpResult = normalizeAndValidateTieredPrice(rawTp, productId, Number(raw.baseSellingPrice ?? raw.price ?? 0));
      if (tpResult.valid && tpResult.tieredPrice) {
        productTieredPrices.push(tpResult.tieredPrice);
      }
    }
  }

  const basePrice = normalizedVariants[0]?.baseSellingPrice ?? Number(raw.baseSellingPrice ?? raw.price ?? 0);
  const mrpVal = normalizedVariants[0]?.mrp ?? Number(raw.mrp ?? raw.price ?? 0);
  const stockVal = normalizedVariants.length > 0
    ? normalizedVariants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0)
    : Number(raw.stockQuantity ?? raw.stock ?? 0);

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
      searchKeywords,
      purchasePrice:
        raw.purchasePrice !== undefined && raw.purchasePrice !== null && !isNaN(Number(raw.purchasePrice))
          ? Number(raw.purchasePrice)
          : normalizedVariants[0]?.purchasePrice,
      discount:
        raw.discount !== undefined && raw.discount !== null && !isNaN(Number(raw.discount))
          ? Number(raw.discount)
          : normalizedVariants[0]?.discount,
      isDiscountExcluded,
      price: basePrice,
      baseSellingPrice: basePrice,
      mrp: mrpVal,
      stock: stockVal,
      stockQuantity: stockVal,
      unit: raw.unit || (normalizedVariants[0]?.unit ?? UnitType.NOS),
      packSize: Number(raw.packSize || normalizedVariants[0]?.packSize || 1),
      packLabel: raw.packLabel || normalizedVariants[0]?.packLabel,
      maxOrderLimit: Number(raw.maxOrderLimit || normalizedVariants[0]?.maxOrderLimit || 20),
      tieredPrices: normalizedVariants.length === 0 ? productTieredPrices : undefined,
      lowStockThreshold:
        raw.lowStockThreshold !== undefined && raw.lowStockThreshold !== null && !isNaN(Number(raw.lowStockThreshold))
          ? Math.max(1, Number(raw.lowStockThreshold))
          : undefined,
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
function isMissingTableError(error: any, tableName?: string): boolean {
  if (!error) return false;
  const code = String(error.code || '').toUpperCase();
  const msg = String(error.message || '').toLowerCase();
  if (code === '42P01' || code === 'PGRST205') return true;
  if (msg.includes('could not find the table') || (msg.includes('relation') && msg.includes('does not exist'))) {
    if (!tableName) return true;
    return msg.includes(tableName.toLowerCase());
  }
  return false;
}

function extractMissingColumn(error: any, allowedOptionalColumns: Set<string>): string | null {
  if (!error) return null;
  const code = String(error.code || '').toUpperCase();
  const msg = String(error.message || '');
  const isColumnNotFound =
    code === 'PGRST204' ||
    code === '42703' ||
    /could not find the ['"]?([a-zA-Z0-9_]+)['"]? column/i.test(msg) ||
    /column ['"]?([a-zA-Z0-9_]+)['"]? (?:of relation ['"][a-zA-Z0-9_]+['"] )?does not exist/i.test(msg);

  if (!isColumnNotFound) return null;

  const patterns = [
    /could not find the ['"]([a-zA-Z0-9_]+)['"] column/i,
    /column ['"]([a-zA-Z0-9_]+)['"]/i,
    /\.([a-zA-Z0-9_]+)\s+does not exist/i,
  ];
  for (const pat of patterns) {
    const m = msg.match(pat);
    if (m && m[1] && allowedOptionalColumns.has(m[1])) {
      return m[1];
    }
  }
  for (const col of allowedOptionalColumns) {
    if (msg.toLowerCase().includes(`'${col}'`) || msg.toLowerCase().includes(`"${col}"`)) {
      return col;
    }
  }
  return null;
}

export async function saveProductWithCascadeSync(
  supabaseClient: any,
  product: Product
): Promise<{ success: boolean; error?: string; product?: Product }> {
  if (!supabaseClient) {
    return { success: false, error: 'Supabase client is not available.' };
  }

  let wasExistingProduct = false;
  const rollbackCreatedProduct = async () => {
    if (wasExistingProduct) return;
    try {
      await supabaseClient.from('product_variants').delete().eq('product_id', product.id);
    } catch {
      // Ignore missing table or cascade fallback
    }
    try {
      await supabaseClient.from('products').delete().eq('id', product.id);
    } catch {
      // Best-effort cleanup of partial master row
    }
  };

  try {
    // 0. Determine whether this product already exists (for safe rollback on new creation failure)
    try {
      const { data: existingProdRow } = await supabaseClient
        .from('products')
        .select('id')
        .eq('id', product.id)
        .maybeSingle();
      wasExistingProduct = Boolean(existingProdRow?.id);
    } catch {
      wasExistingProduct = false;
    }

    // 0b. Pre-write cross-table barcode uniqueness check (master + all variants)
    const incomingVariants = product.variants || [];
    const candidateBarcodes: string[] = [];
    if (product.barcode && product.barcode.trim()) {
      candidateBarcodes.push(product.barcode.trim());
    }
    for (const v of incomingVariants) {
      if (v.barcode && String(v.barcode).trim()) {
        candidateBarcodes.push(String(v.barcode).trim());
      }
    }

    if (candidateBarcodes.length > 0) {
      const lowerCandidates = new Set(candidateBarcodes.map((b) => b.toLowerCase()));

      try {
        const { data: conflictingProducts, error: prodConflictErr } = await supabaseClient
          .from('products')
          .select('id, name, barcode')
          .neq('id', product.id)
          .not('barcode', 'is', null);

        if (!prodConflictErr && Array.isArray(conflictingProducts)) {
          const hit = conflictingProducts.find(
            (p: any) => p.barcode && lowerCandidates.has(String(p.barcode).trim().toLowerCase())
          );
          if (hit) {
            return {
              success: false,
              error: `Barcode "${hit.barcode}" is already assigned to "${hit.name || 'another product'}". Each product and variant must have a unique barcode.`,
            };
          }
        }
      } catch {
        // Ignore if barcode column isn't migrated yet
      }

      try {
        const { data: conflictingVariants, error: varConflictErr } = await supabaseClient
          .from('product_variants')
          .select('id, product_id, barcode')
          .neq('product_id', product.id)
          .not('barcode', 'is', null);

        if (!varConflictErr && Array.isArray(conflictingVariants)) {
          const hit = conflictingVariants.find(
            (v: any) => v.barcode && lowerCandidates.has(String(v.barcode).trim().toLowerCase())
          );
          if (hit) {
            return {
              success: false,
              error: `Barcode "${hit.barcode}" is already assigned to another product variant. Each product and variant must have a unique barcode.`,
            };
          }
        }
      } catch {
        // Ignore if product_variants table or barcode column isn't migrated yet
      }
    }

    // 1. Resolve category name for public.products (preserve existing category name or categoryId)
    let categoryName = (product as any).category && typeof (product as any).category === 'string'
      ? String((product as any).category).trim()
      : '';
    if (!categoryName) {
      categoryName = product.categoryId || '';
    }
    const primaryVariant = incomingVariants[0];
    const basePrice = primaryVariant ? Number(primaryVariant.baseSellingPrice || 0) : Number(product.baseSellingPrice ?? product.price ?? 0);
    const mrp = primaryVariant ? Number(primaryVariant.mrp || 0) : Number(product.mrp ?? product.price ?? 0);
    const totalStock = incomingVariants.length > 0
      ? incomingVariants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0)
      : Number(product.stockQuantity ?? product.stock ?? 0);
    const unitLabel = primaryVariant
      ? (primaryVariant.packLabel || `${primaryVariant.packSize || 1} ${primaryVariant.unit || 'KG'}`)
      : (product.packLabel || (product.unit ? String(product.unit) : '1 Piece'));

    const keywordsVal = product.searchKeywords && product.searchKeywords.trim() ? product.searchKeywords.trim() : null;

    const productPayload: Record<string, any> = {
      id: product.id,
      name: product.name,
      category: categoryName,
      category_id: product.categoryId || null,
      sub_category: product.brand || '',
      brand: product.brand || '',
      description: product.description || '',
      price: basePrice,
      mrp: mrp,
      stock: totalStock,
      unit: unitLabel,
      min_order_qty: 1,
      image_url: product.imageUrl && product.imageUrl.trim() ? product.imageUrl.trim() : null,
      wholesale_tier_discount: incomingVariants,
      barcode: product.barcode && product.barcode.trim() ? product.barcode.trim() : null,
      is_discount_excluded: product.isDiscountExcluded ?? false,
      search_keywords: keywordsVal,
      badge: keywordsVal,
      display_order: typeof product.displayOrder === 'number' ? product.displayOrder : 1,
      updated_at: new Date().toISOString(),
    };

    const optionalProductCols = new Set([
      'category',
      'category_id',
      'sub_category',
      'brand',
      'description',
      'price',
      'mrp',
      'stock',
      'unit',
      'min_order_qty',
      'image_url',
      'wholesale_tier_discount',
      'barcode',
      'is_discount_excluded',
      'search_keywords',
      'badge',
      'display_order',
      'updated_at',
    ]);

    let prodInsertResult = await supabaseClient
      .from('products')
      .upsert(productPayload, { onConflict: 'id' });

    for (let attempt = 0; attempt < optionalProductCols.size && prodInsertResult.error; attempt++) {
      const missingCol = extractMissingColumn(prodInsertResult.error, optionalProductCols);
      if (!missingCol || !(missingCol in productPayload)) break;
      delete productPayload[missingCol];
      optionalProductCols.delete(missingCol);
      prodInsertResult = await supabaseClient
        .from('products')
        .upsert(productPayload, { onConflict: 'id' });
    }

    if (prodInsertResult.error) {
      if (
        prodInsertResult.error.code === '23505' ||
        prodInsertResult.error.message?.toLowerCase().includes('idx_products_barcode_unique')
      ) {
        return {
          success: false,
          error: `Barcode "${product.barcode}" is already assigned to another product. Each product must have a unique barcode.`,
        };
      }
      if (prodInsertResult.error.code === '23503') {
        return {
          success: false,
          error: 'Selected category does not exist in the database. Please refresh categories or choose another category.',
        };
      }
      return {
        success: false,
        error: `Database error saving product: ${prodInsertResult.error.message || 'Check database permissions'}`,
      };
    }

    // 3. Sync relational product_variants table (if table exists in database)
    const { data: existingVariants, error: fetchVarErr } = await supabaseClient
      .from('product_variants')
      .select('id')
      .eq('product_id', product.id);

    if (fetchVarErr) {
      if (isMissingTableError(fetchVarErr, 'product_variants')) {
        // product_variants table not available; products.wholesale_tier_discount JSONB is primary store
        return { success: true, product };
      }
      await rollbackCreatedProduct();
      return {
        success: false,
        error: `Database error preparing product variants: ${fetchVarErr.message || 'Failed to query product_variants'}`,
      };
    }

    const incomingVarIdSet = new Set(incomingVariants.map((v) => v.id));
    const removedVarIds = (existingVariants || [])
      .map((v: any) => v.id)
      .filter((id: string) => !incomingVarIdSet.has(id));

    if (removedVarIds.length > 0) {
      const { error: delVarErr } = await supabaseClient
        .from('product_variants')
        .delete()
        .in('id', removedVarIds);

      if (delVarErr) {
        await rollbackCreatedProduct();
        return {
          success: false,
          error: `Database error updating product variants: ${delVarErr.message || 'Failed to remove old variants'}`,
        };
      }
    }

    if (incomingVariants.length > 0) {
      const variantsPayload: Record<string, any>[] = incomingVariants.map((v, idx) => ({
        id: v.id,
        product_id: product.id,
        unit: v.unit,
        pack_size: Number(v.packSize),
        pack_label: v.packLabel || `${v.packSize} ${v.unit}`,
        mrp: Number(v.mrp),
        base_selling_price: Number(v.baseSellingPrice),
        purchase_price: v.purchasePrice !== undefined && v.purchasePrice !== null ? Number(v.purchasePrice) : null,
        discount: v.discount !== undefined && v.discount !== null ? Number(v.discount) : null,
        barcode: v.barcode && String(v.barcode).trim() ? String(v.barcode).trim() : null,
        image_url: v.imageUrl && String(v.imageUrl).trim() ? String(v.imageUrl).trim() : null,
        stock_quantity: v.stockQuantity !== undefined && v.stockQuantity !== null ? Number(v.stockQuantity) : 0,
        max_order_limit: v.maxOrderLimit !== undefined && v.maxOrderLimit !== null ? Number(v.maxOrderLimit) : 12,
        low_stock_threshold: v.lowStockThreshold !== undefined && v.lowStockThreshold !== null ? Number(v.lowStockThreshold) : null,
        display_order: typeof v.displayOrder === 'number' ? v.displayOrder : idx + 1,
        updated_at: new Date().toISOString(),
      }));

      const optionalVariantCols = new Set([
        'pack_size',
        'pack_label',
        'purchase_price',
        'discount',
        'barcode',
        'image_url',
        'low_stock_threshold',
        'display_order',
        'updated_at',
      ]);

      let currentVariantsPayload = variantsPayload;
      let varInsert = await supabaseClient
        .from('product_variants')
        .upsert(currentVariantsPayload, { onConflict: 'id' });

      for (let attempt = 0; attempt < optionalVariantCols.size && varInsert.error; attempt++) {
        const missingCol = extractMissingColumn(varInsert.error, optionalVariantCols);
        if (!missingCol) break;
        optionalVariantCols.delete(missingCol);
        currentVariantsPayload = currentVariantsPayload.map((row) => {
          const nextRow = { ...row };
          delete nextRow[missingCol];
          return nextRow;
        });
        varInsert = await supabaseClient
          .from('product_variants')
          .upsert(currentVariantsPayload, { onConflict: 'id' });
      }

      if (varInsert.error) {
        await rollbackCreatedProduct();
        if (varInsert.error.code === '23505') {
          return {
            success: false,
            error: 'Duplicate variant barcode detected. Each variant must have a unique barcode.',
          };
        }
        return {
          success: false,
          error: `Database error saving product variants: ${varInsert.error.message || 'Check variant fields and database constraints'}`,
        };
      }
    }

    // 4. Sync relational tiered_prices table for incoming & removed variants (if table exists)
    const incomingVarIds = incomingVariants.map((v) => v.id);
    const allAffectedVarIds = [...removedVarIds, ...incomingVarIds];
    if (allAffectedVarIds.length > 0) {
      const { error: delTpErr } = await supabaseClient
        .from('tiered_prices')
        .delete()
        .in('variant_id', allAffectedVarIds);

      if (delTpErr && !isMissingTableError(delTpErr, 'tiered_prices')) {
        await rollbackCreatedProduct();
        return {
          success: false,
          error: `Database error updating wholesale price slabs: ${delTpErr.message || 'Failed to sync tiered_prices'}`,
        };
      }

      if (!delTpErr) {
        const allTieredRows: any[] = [];
        for (const v of incomingVariants) {
          if (Array.isArray(v.tieredPrices) && v.tieredPrices.length > 0) {
            for (let tpIdx = 0; tpIdx < v.tieredPrices.length; tpIdx++) {
              const tp = v.tieredPrices[tpIdx];
              allTieredRows.push({
                id: tp.id || `tp-${v.id}-${tp.minQty}-${tpIdx}-${Date.now()}`,
                variant_id: v.id,
                min_qty: Number(tp.minQty),
                max_qty: tp.maxQty !== undefined && tp.maxQty !== null ? Number(tp.maxQty) : 9999,
                unit_price: Number(tp.unitPrice),
              });
            }
          }
        }

        if (allTieredRows.length > 0) {
          const { error: tpInsertErr } = await supabaseClient
            .from('tiered_prices')
            .upsert(allTieredRows, { onConflict: 'id' });

          if (tpInsertErr && !isMissingTableError(tpInsertErr, 'tiered_prices')) {
            await rollbackCreatedProduct();
            return {
              success: false,
              error: `Database error saving wholesale price slabs: ${tpInsertErr.message || 'Failed to save tiered_prices'}`,
            };
          }
        }
      }
    }

    return { success: true, product };
  } catch (err: any) {
    await rollbackCreatedProduct();
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
    try {
      await supabaseClient.from('product_variants').delete().eq('product_id', productId);
    } catch {
      // Fallback relies on ON DELETE CASCADE if direct delete isn't applicable
    }
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
    const rawVariants = productRows.map((r, idx) => {
      let packSize = r.packSize;
      let unit = r.unit;
      if (typeof r.unit === 'string' && (!r.packSize || Number(r.packSize) <= 1)) {
        const str = r.unit.trim();
        const commaMatch = str.match(/^([\d.]+)\s*[,/|\-]?\s*([a-zA-Z]+)(.*)$/);
        if (commaMatch) {
          packSize = parseFloat(commaMatch[1]) || 1;
          unit = commaMatch[2].toUpperCase();
        } else if (/^nos?$/i.test(str)) {
          packSize = 1;
          unit = UnitType.NOS;
        }
      }
      return {
        id: `var-${productId}-${idx + 1}`,
        packSize,
        unit,
        packLabel: r.packLabel,
        mrp: r.mrp,
        baseSellingPrice: r.baseSellingPrice ?? r.salePrice,
        purchasePrice: r.purchasePrice,
        stockQuantity: r.stockQuantity,
        maxOrderLimit: r.maxOrderLimit,
        wholesaleMinQty: r.wholesaleMinQty,
        wholesaleMaxQty: r.wholesaleMaxQty,
        wholesalePrice: r.wholesalePrice,
      };
    });

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

/**
 * Persists the reordered list of products to server & Supabase.
 */
export async function reorderProductsInDb(
  products: Product[]
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/products', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        action: 'reorder',
        products,
      }),
    });

    if (res.ok) {
      const data = await res.json();
      if (data && data.success) {
        if (typeof window !== 'undefined' && window.localStorage) {
          try {
            localStorage.setItem('om_products', JSON.stringify(products));
          } catch {}
        }
        return { success: true };
      }
      return { success: false, error: data?.error || 'Failed to reorder products.' };
    }

    const errorJson = await res.json().catch(() => ({}));
    return {
      success: false,
      error: errorJson?.error || `Server responded with status ${res.status}`,
    };
  } catch (err: any) {
    console.warn('Failed to reorder products:', err);
    return { success: false, error: err?.message || 'Network error reordering products.' };
  }
}
