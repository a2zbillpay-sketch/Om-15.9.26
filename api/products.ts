import { IncomingMessage, ServerResponse } from 'http';
import fs from 'node:fs';
import path from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';
import {
  normalizeAndValidateProduct,
  saveProductWithCascadeSync,
  deleteProductWithCascade,
} from '../src/lib/product-service.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const PRODUCTS_FILE = path.resolve(DATA_DIR, 'products.json');

function loadProductsFromFile(): any[] {
  try {
    if (fs.existsSync(PRODUCTS_FILE)) {
      const content = fs.readFileSync(PRODUCTS_FILE, 'utf8');
      if (content.trim()) {
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) return parsed;
      }
    }
  } catch (err) {
    console.error('Failed to read products.json:', err);
  }
  return [];
}

function saveProductsToFile(products: any[]): void {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    const tempFile = `${PRODUCTS_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(products, null, 2), 'utf8');
    fs.renameSync(tempFile, PRODUCTS_FILE);
  } catch (err) {
    console.error('Failed to write products.json:', err);
  }
}

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end(JSON.stringify(data));
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 5 * 1024 * 1024) {
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
      } catch (err) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const method = req.method?.toUpperCase();

  // Public GET: Fetch authoritative products from Supabase via Service Role (with file fallback if unconfigured)
  if (method === 'GET') {
    const supabase = getServerSupabaseClient();
    const fileProducts = loadProductsFromFile();

    if (!supabase) {
      return sendJson(res, 200, { success: true, products: fileProducts });
    }

    try {
      const { data: dbProducts, error: prodError } = await supabase
        .from('products')
        .select('*');

      if (prodError) {
        return sendJson(res, 500, {
          success: false,
          error: prodError.message || 'Failed to fetch products from database',
        });
      }

      if (!dbProducts || dbProducts.length === 0) {
        return sendJson(res, 200, { success: true, products: [] });
      }

      const productIds = dbProducts.map((p: any) => p.id);
      const variantsByProduct: Record<string, any[]> = {};
      const tieredPricesByVariant: Record<string, any[]> = {};

      // Query product_variants with wildcard select to avoid assuming missing columns (e.g. pack_size, display_order)
      try {
        const { data: dbVariants, error: varError } = await supabase
          .from('product_variants')
          .select('*')
          .in('product_id', productIds);

        const variantIds = !varError && dbVariants ? dbVariants.map((v: any) => v.id) : [];
        const allTargetIds = [...variantIds, ...productIds];

        if (allTargetIds.length > 0) {
          try {
            const { data: tpData, error: tpError } = await supabase
              .from('tiered_prices')
              .select('*')
              .in('variant_id', allTargetIds);

            if (!tpError && tpData) {
              for (const tp of tpData) {
                if (!tieredPricesByVariant[tp.variant_id]) {
                  tieredPricesByVariant[tp.variant_id] = [];
                }
                tieredPricesByVariant[tp.variant_id].push({
                  id: tp.id,
                  variantId: tp.variant_id,
                  minQty: Number(tp.min_qty),
                  maxQty: Number(tp.max_qty),
                  unitPrice: Number(tp.unit_price),
                });
              }
            }
          } catch {
            // Relational tiered_prices table not available; JSONB fallback handles slabs
          }
        }

        if (!varError && dbVariants && dbVariants.length > 0) {
          for (const v of dbVariants) {
            if (!variantsByProduct[v.product_id]) {
              variantsByProduct[v.product_id] = [];
            }
            const resolvedPackSize = Number(v.pack_size ?? v.weight_per_unit_kg ?? 1);
            const resolvedUnit = v.unit || 'KG';
            variantsByProduct[v.product_id].push({
              id: v.id,
              productId: v.product_id,
              unit: resolvedUnit,
              packSize: resolvedPackSize,
              packLabel: v.pack_label || `${resolvedPackSize} ${resolvedUnit}`,
              mrp: Number(v.mrp || 0),
              baseSellingPrice: Number(v.base_selling_price || 0),
              purchasePrice:
                v.purchase_price !== undefined && v.purchase_price !== null
                  ? Number(v.purchase_price)
                  : undefined,
              discount:
                v.discount !== undefined && v.discount !== null
                  ? Number(v.discount)
                  : undefined,
              stockQuantity: Number(v.stock_quantity || 0),
              maxOrderLimit: Number(v.max_order_limit || 20),
              tieredPrices: tieredPricesByVariant[v.id] || [],
              barcode: v.barcode ? String(v.barcode).trim() : null,
              imageUrl: v.image_url ? String(v.image_url).trim() : undefined,
              displayOrder:
                typeof v.display_order === 'number' ? v.display_order : undefined,
            });
          }
        }
      } catch {
        // product_variants table not available; fallback to embedded JSONB
      }

      const fileOrderById = new Map<string, number>();
      for (let i = 0; i < fileProducts.length; i++) {
        const fp = fileProducts[i];
        if (fp?.id && typeof fp.displayOrder === 'number') {
          fileOrderById.set(String(fp.id), fp.displayOrder);
        }
      }

      const assembledProducts = dbProducts.map((p: any) => {
        const categoryId = p.category_id || p.category || '';

        const embeddedVariantById = new Map<string, any>();
        if (Array.isArray(p.wholesale_tier_discount)) {
          for (const ev of p.wholesale_tier_discount) {
            if (ev && ev.id) {
              embeddedVariantById.set(String(ev.id), ev);
            }
          }
        }

        let variants: any[] = (variantsByProduct[p.id] || []).map((relV) => {
          const embedded = embeddedVariantById.get(relV.id);
          if (!embedded) return relV;

          const embeddedTieredPrices = Array.isArray(embedded.tieredPrices)
            ? embedded.tieredPrices.map((tp: any, tpIdx: number) => ({
                id: tp.id || `tp_${relV.id}_${tpIdx}`,
                variantId: tp.variantId || tp.variant_id || relV.id,
                minQty: Number(tp.minQty ?? tp.min_qty ?? 1),
                maxQty: Number(tp.maxQty ?? tp.max_qty ?? 9999),
                unitPrice: Number(tp.unitPrice ?? tp.unit_price ?? relV.baseSellingPrice ?? 0),
              }))
            : [];

          const resolvedPurchasePrice =
            relV.purchasePrice !== undefined
              ? relV.purchasePrice
              : embedded.purchasePrice !== undefined && embedded.purchasePrice !== null
              ? Number(embedded.purchasePrice)
              : embedded.purchase_price !== undefined && embedded.purchase_price !== null
              ? Number(embedded.purchase_price)
              : undefined;

          const resolvedDiscount =
            relV.discount !== undefined
              ? relV.discount
              : embedded.discount !== undefined && embedded.discount !== null
              ? Number(embedded.discount)
              : undefined;

          const resolvedLowStock =
            relV.lowStockThreshold !== undefined
              ? relV.lowStockThreshold
              : embedded.lowStockThreshold !== undefined && embedded.lowStockThreshold !== null
              ? Number(embedded.lowStockThreshold)
              : undefined;

          return {
            ...relV,
            purchasePrice: resolvedPurchasePrice,
            discount: resolvedDiscount,
            lowStockThreshold: resolvedLowStock,
            tieredPrices:
              relV.tieredPrices && relV.tieredPrices.length > 0
                ? relV.tieredPrices
                : embeddedTieredPrices,
          };
        });

        if (
          variants.length === 0 &&
          Array.isArray(p.wholesale_tier_discount) &&
          p.wholesale_tier_discount.length > 0
        ) {
          const hasVariantShape = p.wholesale_tier_discount.some(
            (item: any) =>
              item &&
              (item.packSize || item.pack_size || item.packLabel || item.pack_label || item.unit)
          );
          if (hasVariantShape) {
            variants = p.wholesale_tier_discount.map((v: any, idx: number) => {
              const vUnit = v.unit || 'KG';
              const vPackSize = Number(v.packSize ?? v.pack_size ?? 1);
              const vPackLabel = v.packLabel || v.pack_label || `${vPackSize} ${vUnit}`;
              const vTieredPrices = Array.isArray(v.tieredPrices)
                ? v.tieredPrices.map((tp: any, tpIdx: number) => ({
                    id: tp.id || `tp_${v.id || idx}_${tpIdx}`,
                    variantId: tp.variantId || tp.variant_id || v.id || `var_${p.id}_${idx}`,
                    minQty: Number(tp.minQty ?? tp.min_qty ?? 1),
                    maxQty: Number(tp.maxQty ?? tp.max_qty ?? 999),
                    unitPrice: Number(
                      tp.unitPrice ?? tp.unit_price ?? v.baseSellingPrice ?? v.base_selling_price ?? p.price ?? 0
                    ),
                  }))
                : [];

              return {
                id: v.id || `var_${p.id}_${idx + 1}`,
                productId: p.id,
                unit: vUnit,
                packSize: vPackSize,
                packLabel: vPackLabel,
                mrp: Number(v.mrp || p.mrp || 0),
                baseSellingPrice: Number(v.baseSellingPrice ?? v.base_selling_price ?? p.price ?? 0),
                purchasePrice:
                  v.purchasePrice !== undefined && v.purchasePrice !== null
                    ? Number(v.purchasePrice)
                    : v.purchase_price !== undefined
                    ? Number(v.purchase_price)
                    : undefined,
                discount:
                  v.discount !== undefined && v.discount !== null ? Number(v.discount) : undefined,
                stockQuantity: Number(v.stockQuantity ?? v.stock_quantity ?? p.stock ?? 0),
                maxOrderLimit: Number(v.maxOrderLimit ?? v.max_order_limit ?? 20),
                tieredPrices: vTieredPrices,
                lowStockThreshold:
                  v.lowStockThreshold !== undefined && v.lowStockThreshold !== null
                    ? Number(v.lowStockThreshold)
                    : undefined,
                barcode: v.barcode ? String(v.barcode).trim() : null,
                imageUrl:
                  v.imageUrl || v.image_url ? String(v.imageUrl || v.image_url).trim() : undefined,
                displayOrder:
                  typeof v.displayOrder === 'number'
                    ? v.displayOrder
                    : typeof v.display_order === 'number'
                    ? v.display_order
                    : idx + 1,
              };
            });
          }
        }

        if (variants.length > 0) {
          variants.sort((a, b) => {
            if (typeof a.displayOrder === 'number' && typeof b.displayOrder === 'number') {
              return a.displayOrder - b.displayOrder;
            }
            if (typeof a.displayOrder === 'number') return -1;
            if (typeof b.displayOrder === 'number') return 1;
            return 0;
          });
        }

        const prodTieredPrices =
          tieredPricesByVariant[p.id] ||
          (Array.isArray(p.tiered_prices)
            ? p.tiered_prices.map((tp: any, tpIdx: number) => ({
                id: tp.id || `tp_${p.id}_${tpIdx}`,
                variantId: tp.variantId || tp.variant_id || p.id,
                minQty: Number(tp.minQty ?? tp.min_qty ?? 1),
                maxQty: Number(tp.maxQty ?? tp.max_qty ?? 999),
                unitPrice: Number(tp.unitPrice ?? tp.unit_price ?? p.price ?? 0),
              }))
            : []);

        const resolvedDisplayOrder =
          typeof p.display_order === 'number'
            ? p.display_order
            : fileOrderById.get(String(p.id));

        return {
          id: p.id,
          name: p.name,
          brand: p.brand || p.sub_category || '',
          description: p.description || '',
          categoryId,
          imageUrl:
            p.image_url && String(p.image_url).trim() ? String(p.image_url).trim() : undefined,
          barcode: p.barcode ? String(p.barcode).trim() : null,
          isDiscountExcluded: p.is_discount_excluded ?? false,
          searchKeywords: (p.search_keywords || p.badge || '').trim() || undefined,
          purchasePrice:
            p.purchase_price !== undefined && p.purchase_price !== null
              ? Number(p.purchase_price)
              : variants[0]?.purchasePrice,
          discount:
            p.discount !== undefined && p.discount !== null
              ? Number(p.discount)
              : variants[0]?.discount,
          displayOrder: resolvedDisplayOrder,
          price: p.price !== undefined ? Number(p.price) : variants[0]?.baseSellingPrice || 0,
          mrp: p.mrp !== undefined ? Number(p.mrp) : variants[0]?.mrp || 0,
          baseSellingPrice:
            p.price !== undefined ? Number(p.price) : variants[0]?.baseSellingPrice || 0,
          stock:
            variants.length > 0
              ? variants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0)
              : Number(p.stock || p.stock_quantity || 0),
          stockQuantity:
            variants.length > 0
              ? variants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0)
              : Number(p.stock || p.stock_quantity || 0),
          unit: p.unit || variants[0]?.unit || 'NOS',
          packSize:
            p.pack_size !== undefined
              ? Number(p.pack_size)
              : p.weight_per_unit_kg !== undefined
              ? Number(p.weight_per_unit_kg)
              : 1,
          packLabel: p.pack_label || (p.unit ? String(p.unit) : undefined),
          maxOrderLimit: Number(
            p.max_order_limit ?? (p.min_order_qty ? p.min_order_qty * 10 : 20)
          ),
          tieredPrices: prodTieredPrices,
          variants,
          createdAt: p.created_at || p.updated_at || new Date().toISOString(),
        };
      });

      assembledProducts.sort((a: any, b: any) => {
        if (typeof a.displayOrder === 'number' && typeof b.displayOrder === 'number') {
          return a.displayOrder - b.displayOrder;
        }
        if (typeof a.displayOrder === 'number') return -1;
        if (typeof b.displayOrder === 'number') return 1;
        return 0;
      });

      return sendJson(res, 200, { success: true, products: assembledProducts });
    } catch (err: any) {
      return sendJson(res, 500, {
        success: false,
        error: err?.message || 'Server error fetching products',
      });
    }
  }

  // Enforce Shopkeeper/Admin authorization for mutations
  const session = verifyAdminSession(req);
  if (!session || session.role !== 'SHOPKEEPER') {
    return sendJson(res, 401, {
      error: 'Unauthorized: Shopkeeper session required. Please log in.',
    });
  }

  if (method !== 'POST' && method !== 'PUT' && method !== 'DELETE') {
    res.setHeader('Allow', 'POST, PUT, DELETE');
    return sendJson(res, 405, { error: `Method ${method} Not Allowed` });
  }

  const supabase = getServerSupabaseClient();
  if (!supabase) {
    return sendJson(res, 500, {
      error: 'Database service is not configured or unavailable.',
    });
  }

  if (method === 'POST') {
    try {
      const body = await parseJsonBody(req);

      // Reorder Action: Updates display order sequence across all products
      if (body.action === 'reorder' && Array.isArray(body.products)) {
        const reordered = body.products.map((p: any, idx: number) => ({
          ...p,
          displayOrder: idx + 1,
        }));
        saveProductsToFile(reordered);

        return sendJson(res, 200, { success: true, products: reordered });
      }

      const validation = normalizeAndValidateProduct(body);

      if (!validation.valid || !validation.product) {
        return sendJson(res, 400, { error: validation.error || 'Invalid product data' });
      }

      const product = validation.product;

      // Also persist to products.json
      const currentProducts = loadProductsFromFile();
      const existingIdx = currentProducts.findIndex((p: any) => p.id === product.id);
      if (existingIdx >= 0) {
        currentProducts[existingIdx] = product;
      } else {
        product.displayOrder = currentProducts.length + 1;
        currentProducts.push(product);
      }
      saveProductsToFile(currentProducts);

      // If Supabase is configured, persist with cascade sync
      if (supabase) {
        const dbResult = await saveProductWithCascadeSync(supabase, product);
        if (!dbResult.success) {
          return sendJson(res, 500, { error: dbResult.error || 'Failed to save product to database' });
        }
      }

      return sendJson(res, 201, { success: true, product });
    } catch (err: any) {
      return sendJson(res, 500, { error: err?.message || 'Server error creating product' });
    }
  }

  if (method === 'PUT') {
    try {
      const body = await parseJsonBody(req);
      const validation = normalizeAndValidateProduct(body);

      if (!validation.valid || !validation.product) {
        return sendJson(res, 400, { error: validation.error || 'Invalid product data' });
      }

      const product = validation.product;

      // Update in products.json
      const currentProducts = loadProductsFromFile();
      const existingIdx = currentProducts.findIndex((p: any) => p.id === product.id);
      if (existingIdx >= 0) {
        currentProducts[existingIdx] = {
          ...currentProducts[existingIdx],
          ...product,
          displayOrder: currentProducts[existingIdx].displayOrder ?? product.displayOrder ?? (existingIdx + 1),
        };
        saveProductsToFile(currentProducts);
      } else {
        product.displayOrder = currentProducts.length + 1;
        currentProducts.push(product);
        saveProductsToFile(currentProducts);
      }

      if (supabase) {
        const dbResult = await saveProductWithCascadeSync(supabase, product);
        if (!dbResult.success) {
          return sendJson(res, 500, { error: dbResult.error || 'Failed to update product in database' });
        }
      }

      return sendJson(res, 200, { success: true, product });
    } catch (err: any) {
      return sendJson(res, 500, { error: err?.message || 'Server error updating product' });
    }
  }

  if (method === 'DELETE') {
    try {
      const url = new URL(req.url || '', 'http://localhost');
      let productId = url.searchParams.get('id');

      if (!productId) {
        const body = await parseJsonBody(req).catch(() => ({}));
        productId = body.id;
      }

      if (!productId) {
        return sendJson(res, 400, { error: 'Product ID is required for deletion' });
      }

      // Remove from products.json
      const currentProducts = loadProductsFromFile();
      const updatedList = currentProducts.filter((p: any) => p.id !== productId);
      if (updatedList.length !== currentProducts.length) {
        saveProductsToFile(updatedList);
      }

      if (supabase) {
        const dbResult = await deleteProductWithCascade(supabase, productId);
        if (!dbResult.success) {
          return sendJson(res, 500, { error: dbResult.error || 'Failed to delete product' });
        }
      }

      return sendJson(res, 200, { success: true, deletedId: productId });
    } catch (err: any) {
      return sendJson(res, 500, { error: err?.message || 'Server error deleting product' });
    }
  }

  // Unsupported method
  res.setHeader('Allow', 'POST, PUT, DELETE');
  return sendJson(res, 405, { error: `Method ${method} Not Allowed` });
}
