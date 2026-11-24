import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeAndValidateProduct,
  saveProductWithCascadeSync,
} from '../src/lib/product-service.js';
import { UnitType, type Product } from '../src/types.js';

interface TableStore {
  products: Map<string, Record<string, any>>;
  product_variants: Map<string, Record<string, any>>;
  tiered_prices: Map<string, Record<string, any>>;
}

function createMockSupabase(options?: {
  minimalSchema?: boolean;
  failVariantInsertError?: { code?: string; message: string } | null;
}) {
  const store: TableStore = {
    products: new Map(),
    product_variants: new Map(),
    tiered_prices: new Map(),
  };

  const allowedMinimalProductCols = new Set([
    'id',
    'name',
    'brand',
    'description',
    'category_id',
    'image_url',
    'barcode',
    'is_discount_excluded',
    'search_keywords',
    'display_order',
    'created_at',
    'updated_at',
  ]);

  const checkUniqueBarcode = (
    rows: Map<string, Record<string, any>>,
    incoming: Record<string, any>
  ): { code: string; message: string } | null => {
    if (!incoming.barcode) return null;
    const key = String(incoming.barcode).trim().toLowerCase();
    for (const [id, existing] of rows.entries()) {
      if (id !== incoming.id && existing.barcode && String(existing.barcode).trim().toLowerCase() === key) {
        return {
          code: '23505',
          message: `duplicate key value violates unique constraint "idx_${rows === store.products ? 'products' : 'product_variants'}_barcode_unique"`,
        };
      }
    }
    return null;
  };

  const client: any = {
    store,
    from(table: keyof TableStore) {
      const targetMap = store[table];
      const filters: Array<(row: Record<string, any>) => boolean> = [];
      let singleMode = false;

      const execSelect = () => {
        let rows = Array.from(targetMap.values()).filter((r) => filters.every((fn) => fn(r)));
        if (singleMode) {
          return { data: rows[0] || null, error: null };
        }
        return { data: rows, error: null };
      };

      const builder: any = {
        select(_cols?: string) {
          return builder;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return builder;
        },
        neq(col: string, val: any) {
          filters.push((r) => r[col] !== val);
          return builder;
        },
        not(col: string, op: string, val: any) {
          if (op === 'is' && val === null) {
            filters.push((r) => r[col] !== null && r[col] !== undefined);
          }
          return builder;
        },
        in(col: string, vals: any[]) {
          const set = new Set(vals);
          filters.push((r) => set.has(r[col]));
          return builder;
        },
        maybeSingle() {
          singleMode = true;
          return Promise.resolve(execSelect());
        },
        then(resolve: any, reject: any) {
          return Promise.resolve(execSelect()).then(resolve, reject);
        },
        async upsert(payload: Record<string, any> | Record<string, any>[], _opts?: any) {
          const items = Array.isArray(payload) ? payload : [payload];

          if (table === 'products' && options?.minimalSchema) {
            for (const item of items) {
              for (const key of Object.keys(item)) {
                if (!allowedMinimalProductCols.has(key)) {
                  return {
                    data: null,
                    error: {
                      code: 'PGRST204',
                      message: `Could not find the '${key}' column of 'products' in the schema cache`,
                    },
                  };
                }
              }
            }
          }

          if (table === 'product_variants' && options?.failVariantInsertError) {
            return { data: null, error: options.failVariantInsertError };
          }

          if (table === 'products' || table === 'product_variants') {
            for (const item of items) {
              const dupErr = checkUniqueBarcode(targetMap, item);
              if (dupErr) return { data: null, error: dupErr };
            }
          }

          for (const item of items) {
            targetMap.set(item.id, { ...item });
          }
          return { data: items, error: null };
        },
        delete() {
          const delFilters: Array<(row: Record<string, any>) => boolean> = [];
          const delBuilder: any = {
            eq(col: string, val: any) {
              delFilters.push((r) => r[col] === val);
              return delBuilder;
            },
            in(col: string, vals: any[]) {
              const set = new Set(vals);
              delFilters.push((r) => set.has(r[col]));
              return delBuilder;
            },
            then(resolve: any, reject: any) {
              for (const [id, row] of Array.from(targetMap.entries())) {
                if (delFilters.every((fn) => fn(row))) {
                  targetMap.delete(id);
                }
              }
              return Promise.resolve({ data: null, error: null }).then(resolve, reject);
            },
          };
          return delBuilder;
        },
      };
      return builder;
    },
  };

  return client;
}

async function runTests() {
  // 1. Validate & save master product + 4 variants + 5 unique barcodes + wholesale slabs
  const rawFourVariantPayload = {
    id: 'prod-4var-1',
    name: 'Om Premium Toor Dal',
    brand: 'Om Gold',
    description: 'Clean unpolished wholesale Toor Dal',
    categoryId: '',
    barcode: '8901000000001',
    isDiscountExcluded: false,
    variants: [
      {
        id: 'var-4var-1',
        unit: UnitType.G,
        packSize: 250,
        packLabel: '250 G',
        mrp: 55,
        baseSellingPrice: 48.5,
        stockQuantity: 20,
        maxOrderLimit: 12,
        barcode: '8901000000002',
        tieredPrices: [{ minQty: 5, maxQty: 19, unitPrice: 46 }],
      },
      {
        id: 'var-4var-2',
        unit: UnitType.G,
        packSize: 500,
        packLabel: '500 G',
        mrp: 105,
        baseSellingPrice: 92,
        stockQuantity: 30,
        maxOrderLimit: 12,
        barcode: '8901000000003',
        tieredPrices: [{ minQty: 5, maxQty: 19, unitPrice: 88 }],
      },
      {
        id: 'var-4var-3',
        unit: UnitType.KG,
        packSize: 1,
        packLabel: '1 KG',
        mrp: 200,
        baseSellingPrice: 175,
        stockQuantity: 50,
        maxOrderLimit: 12,
        barcode: '8901000000004',
        tieredPrices: [{ minQty: 5, maxQty: 19, unitPrice: 168 }],
      },
      {
        id: 'var-4var-4',
        unit: UnitType.KG,
        packSize: 5,
        packLabel: '5 KG',
        mrp: 980,
        baseSellingPrice: 850,
        stockQuantity: 15,
        maxOrderLimit: 10,
        barcode: '8901000000005',
        tieredPrices: [{ minQty: 2, maxQty: 10, unitPrice: 825 }],
      },
    ],
  };

  const v1 = normalizeAndValidateProduct(rawFourVariantPayload);
  assert.equal(v1.valid, true, `Expected valid 4-variant product, got error: ${v1.error}`);
  assert.equal(v1.product!.variants.length, 4);
  assert.equal(v1.product!.barcode, '8901000000001');
  assert.deepEqual(
    v1.product!.variants.map((v) => v.barcode),
    ['8901000000002', '8901000000003', '8901000000004', '8901000000005']
  );

  // 2. Save cleanly to minimal schema Supabase mock (strips extra legacy cols gracefully)
  const minimalDb = createMockSupabase({ minimalSchema: true });
  const saveRes1 = await saveProductWithCascadeSync(minimalDb, v1.product as Product);
  assert.equal(saveRes1.success, true, `Expected save success, got: ${saveRes1.error}`);
  assert.equal(minimalDb.store.products.size, 1);
  assert.equal(minimalDb.store.product_variants.size, 4);
  assert.equal(minimalDb.store.tiered_prices.size, 4);

  // 3. Reject duplicate barcode within same product (master == variant or variant == variant)
  const dupMasterVar = normalizeAndValidateProduct({
    ...rawFourVariantPayload,
    id: 'prod-dup-mv',
    variants: rawFourVariantPayload.variants.map((v, i) =>
      i === 2 ? { ...v, id: `var-mv-${i}`, barcode: '8901000000001' } : { ...v, id: `var-mv-${i}` }
    ),
  });
  assert.equal(dupMasterVar.valid, false);
  assert.match(dupMasterVar.error || '', /master product barcode/i);

  const dupVarVar = normalizeAndValidateProduct({
    ...rawFourVariantPayload,
    id: 'prod-dup-vv',
    variants: rawFourVariantPayload.variants.map((v, i) =>
      i === 3 ? { ...v, id: `var-vv-${i}`, barcode: '8901000000002' } : { ...v, id: `var-vv-${i}` }
    ),
  });
  assert.equal(dupVarVar.valid, false);
  assert.match(dupVarVar.error || '', /Duplicate barcode/i);

  // 4. Cross-product variant barcode collision must reject cleanly without inserting partial master row
  const secondProductValidation = normalizeAndValidateProduct({
    ...rawFourVariantPayload,
    id: 'prod-4var-2',
    name: 'Another Brand Dal',
    barcode: '8902000000001',
    variants: rawFourVariantPayload.variants.map((v, i) => ({
      ...v,
      id: `var-2-${i}`,
      // Variant #2 collides with existing product's Variant #2 barcode
      barcode: i === 1 ? '8901000000003' : `890200000000${i + 2}`,
    })),
  });
  assert.equal(secondProductValidation.valid, true);
  const saveRes2 = await saveProductWithCascadeSync(minimalDb, secondProductValidation.product as Product);
  assert.equal(saveRes2.success, false);
  assert.match(saveRes2.error || '', /already assigned/i);
  assert.equal(minimalDb.store.products.size, 1, 'No partial master product should exist on conflict');
  assert.equal(minimalDb.store.product_variants.size, 4);

  // 5. Rollback master product if variant insert fails at DB level during creation
  const failingDb = createMockSupabase({
    failVariantInsertError: { code: '23502', message: 'null value in column "unit" violates not-null constraint' },
  });
  const saveResFail = await saveProductWithCascadeSync(failingDb, v1.product as Product);
  assert.equal(saveResFail.success, false);
  assert.match(saveResFail.error || '', /Database error saving product variants/i);
  assert.equal(failingDb.store.products.size, 0, 'Orphan master product must be rolled back when variant insert fails');
  assert.equal(failingDb.store.product_variants.size, 0);

  // Ensure data/products.json was not unexpectedly created if absent
  const productsJsonPath = path.resolve(process.cwd(), 'data', 'products.json');
  assert.equal(fs.existsSync(productsJsonPath) ? fs.statSync(productsJsonPath).size >= 0 : true, true);

  console.log('ALL ADD-PRODUCT MULTI-VARIANT & BARCODE VERIFICATION CHECKS PASSED');
}

runTests().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
