import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import handler, {
  processGetProductRequests,
  processCreateProductRequest,
  verifySameOriginOrRequestedHeader,
} from '../api/product-requests.js';

interface MockDbState {
  product_requests: any[];
  users: any[];
  insertError?: { message: string; code?: string } | null;
  selectError?: { message: string; code?: string } | null;
}

function createMockSupabase(state: MockDbState): SupabaseClient {
  return {
    from(table: string) {
      const filters: Array<{ col: string; val: any }> = [];
      let orderCol: string | null = null;
      let orderAsc = true;
      let insertPayload: any = null;
      let mode: 'select' | 'insert' = 'select';
      let singleMode: 'none' | 'single' | 'maybeSingle' = 'none';

      const chain: any = {
        select() {
          return chain;
        },
        eq(col: string, val: any) {
          filters.push({ col, val });
          return chain;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return chain;
        },
        insert(payload: any) {
          mode = 'insert';
          insertPayload = payload;
          return chain;
        },
        single() {
          singleMode = 'single';
          return chain;
        },
        maybeSingle() {
          singleMode = 'maybeSingle';
          return chain;
        },
        then(resolve: (val: any) => void, reject?: (err: any) => void) {
          try {
            if (mode === 'insert' && table === 'product_requests') {
              if (state.insertError) {
                resolve({ data: null, error: state.insertError });
                return;
              }
              const duplicate = state.product_requests.find((r) => r.id === insertPayload.id);
              if (duplicate) {
                resolve({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value violates unique constraint' },
                });
                return;
              }
              const inserted = { ...insertPayload };
              state.product_requests.push(inserted);
              resolve({ data: inserted, error: null });
              return;
            }

            if (table === 'product_requests' && state.selectError) {
              resolve({ data: null, error: state.selectError });
              return;
            }

            const source =
              table === 'product_requests'
                ? state.product_requests
                : table === 'users'
                ? state.users
                : [];

            let rows = source.filter((row) =>
              filters.every((f) => String(row?.[f.col] ?? '') === String(f.val ?? ''))
            );

            if (orderCol) {
              rows = [...rows].sort((a, b) => {
                const av = String(a?.[orderCol!] || '');
                const bv = String(b?.[orderCol!] || '');
                return orderAsc ? av.localeCompare(bv) : bv.localeCompare(av);
              });
            }

            if (singleMode === 'maybeSingle') {
              resolve({ data: rows[0] || null, error: null });
              return;
            }
            if (singleMode === 'single') {
              resolve({ data: rows[0] || null, error: rows[0] ? null : { message: 'Not found' } });
              return;
            }
            resolve({ data: rows, error: null });
          } catch (err) {
            if (reject) reject(err);
          }
        },
      };
      return chain;
    },
  } as unknown as SupabaseClient;
}

async function run() {
  console.log('1. Testing GET /api/product-requests authorization & ordering...');
  const state: MockDbState = {
    users: [
      { id: 'user-uuid-1', phone: '9822001122', full_name: 'Ramesh Traders', role: 'CUSTOMER' },
    ],
    product_requests: [],
  };
  const db = createMockSupabase(state);

  const unauthGet = await processGetProductRequests(db, { adminSession: null });
  assert.equal(unauthGet.statusCode, 401);
  assert.equal(unauthGet.payload.success, false);

  const customerSession = {
    role: 'CUSTOMER' as const,
    customerId: 'user-uuid-1',
    phone: '9822001122',
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };
  const adminSession = {
    role: 'SHOPKEEPER' as const,
    issuedAt: Date.now(),
    expiresAt: Date.now() + 60_000,
  };

  console.log('2. Testing POST /api/product-requests auth, ownership & input validation...');
  const unauthPost = await processCreateProductRequest(
    db,
    { productId: 'prod-1', productName: 'Sugar', quantity: 2, customerPhone: '9822001122' },
    { adminSession: null, customerSession: null }
  );
  assert.equal(unauthPost.statusCode, 401);

  const spoofPhonePost = await processCreateProductRequest(
    db,
    { productId: 'prod-1', productName: 'Sugar', quantity: 2, customerPhone: '9999988888' },
    { adminSession: null, customerSession }
  );
  assert.equal(spoofPhonePost.statusCode, 403);

  const spoofIdPost = await processCreateProductRequest(
    db,
    {
      id: 'preq-spoof-1',
      customerId: 'other-customer-uuid',
      customerPhone: '9822001122',
      productId: 'prod-1',
      productName: 'Sugar',
      quantity: 2,
    },
    { adminSession: null, customerSession }
  );
  assert.equal(spoofIdPost.statusCode, 403);

  const badQtyPost = await processCreateProductRequest(
    db,
    { productId: 'prod-1', productName: 'Sugar', quantity: 0, customerPhone: '9822001122' },
    { adminSession: null, customerSession }
  );
  assert.equal(badQtyPost.statusCode, 400);

  const missingProductPost = await processCreateProductRequest(
    db,
    { productId: 'prod-1', productName: '   ', quantity: 2, customerPhone: '9822001122' },
    { adminSession: null, customerSession }
  );
  assert.equal(missingProductPost.statusCode, 400);

  console.log('3. Testing valid Customer POST -> Database Save -> Shopkeeper GET retrieval...');
  const createRes = await processCreateProductRequest(
    db,
    {
      id: 'preq-test-1001',
      customerId: 'user-uuid-1',
      customerName: 'Customer',
      customerPhone: '9822001122',
      productId: 'prod-atta-1',
      productName: 'Aashirvaad Atta',
      variantId: 'var-5kg',
      variantName: '5 KG',
      packSize: '5 KG',
      quantity: 3,
      requestDate: '2026-11-23T10:00:00.000Z',
    },
    { adminSession: null, customerSession }
  );
  assert.equal(createRes.statusCode, 201);
  assert.equal(createRes.payload.success, true);
  assert.equal(createRes.payload.request.customer_name, 'Ramesh Traders');
  assert.equal(createRes.payload.request.customer_phone, '9822001122');
  assert.equal(createRes.payload.request.quantity, 3);

  // Idempotent retry for same customer & request ID
  const dupRes = await processCreateProductRequest(
    db,
    {
      id: 'preq-test-1001',
      customerId: 'user-uuid-1',
      customerPhone: '9822001122',
      productId: 'prod-atta-1',
      productName: 'Aashirvaad Atta',
      quantity: 3,
    },
    { adminSession: null, customerSession }
  );
  assert.equal(dupRes.statusCode, 200);
  assert.equal(dupRes.payload.deduplicated, true);
  assert.equal(state.product_requests.length, 1);

  // Shopkeeper GET sees the persisted customer product request
  const adminGet = await processGetProductRequests(db, { adminSession });
  assert.equal(adminGet.statusCode, 200);
  assert.equal(adminGet.payload.success, true);
  assert.equal(adminGet.payload.requests.length, 1);
  assert.equal(adminGet.payload.requests[0].id, 'preq-test-1001');
  assert.equal(adminGet.payload.requests[0].product_name, 'Aashirvaad Atta');
  assert.equal(adminGet.payload.requests[0].quantity, 3);

  console.log('4. Testing HTTP handler CSRF/Origin guard & 405/401 responses...');
  assert.equal(
    verifySameOriginOrRequestedHeader({
      headers: { origin: 'https://om.example.com', host: 'om.example.com' },
    } as IncomingMessage),
    true
  );
  assert.equal(
    verifySameOriginOrRequestedHeader({
      headers: { origin: 'https://evil.example.com', host: 'om.example.com' },
    } as IncomingMessage),
    false
  );
  assert.equal(
    verifySameOriginOrRequestedHeader({
      headers: { 'x-requested-with': 'XMLHttpRequest' },
    } as IncomingMessage),
    true
  );
  assert.equal(
    verifySameOriginOrRequestedHeader({
      headers: {},
    } as IncomingMessage),
    false
  );

  let statusCode = 0;
  let bodyText = '';
  const respHeaders: Record<string, string> = {};
  const mockRes = {
    setHeader(k: string, v: string) {
      respHeaders[k.toLowerCase()] = v;
    },
    end(chunk?: string) {
      bodyText = chunk || '';
    },
    get statusCode() {
      return statusCode;
    },
    set statusCode(code: number) {
      statusCode = code;
    },
  } as unknown as ServerResponse;

  await handler({ method: 'DELETE', headers: {} } as IncomingMessage, mockRes);
  assert.equal(statusCode, 405);
  assert.equal(respHeaders['allow'], 'GET, POST');

  await handler({ method: 'GET', headers: {} } as IncomingMessage, mockRes);
  assert.equal(statusCode, 401);
  assert.equal(respHeaders['access-control-allow-origin'], undefined);

  await handler(
    {
      method: 'POST',
      headers: { origin: 'https://evil.example.com', host: 'om.example.com' },
    } as IncomingMessage,
    mockRes
  );
  assert.equal(statusCode, 403);

  console.log('5. Read-only verification of frontend code, RLS SQL definitions & service_role boundary...');
  const supabaseTs = fs.readFileSync(path.resolve('src/lib/supabase.ts'), 'utf8');
  assert.equal(
    /supabase\.from\(['"]product_requests['"]\)/.test(supabaseTs),
    false,
    'Frontend must not call direct browser supabase.from("product_requests")'
  );
  assert.ok(
    supabaseTs.includes("fetch('/api/product-requests'"),
    'Frontend must route product request writes through /api/product-requests'
  );
  assert.equal(
    /SUPABASE_SERVICE_ROLE_KEY|VITE_.*SERVICE_ROLE/i.test(supabaseTs),
    false,
    'service_role key must never appear in frontend code'
  );

  const setupSql = fs.readFileSync(path.resolve('supabase_setup.sql'), 'utf8');
  assert.ok(
    /ALTER TABLE public\.product_requests ENABLE ROW LEVEL SECURITY;/i.test(setupSql),
    'RLS should remain enabled on public.product_requests'
  );
  assert.ok(
    /CREATE POLICY "Service Role Full Access Product Requests" ON public\.product_requests[\s\S]*FOR ALL TO service_role/i.test(
      setupSql
    ),
    'supabase_setup.sql includes service_role policy for public.product_requests'
  );

  console.log('ALL PRODUCT REQUEST END-TO-END CHECKS PASSED!');
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
