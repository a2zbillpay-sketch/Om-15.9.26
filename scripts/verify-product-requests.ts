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
import {
  fetchProductRequestsFromApi,
  fetchProductRequestsFromSupabase,
  resolveAuthoritativeProductRequestsState,
} from '../src/lib/supabase.js';

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

  console.log('6. Testing Single Source of Truth: zero localStorage merge, [] cleanup, & fail-closed errors...');
  const mockStorageMap = new Map<string, string>();
  const mockStorage = {
    getItem(k: string) {
      return mockStorageMap.has(k) ? mockStorageMap.get(k)! : null;
    },
    setItem(k: string, v: string) {
      mockStorageMap.set(k, v);
    },
    removeItem(k: string) {
      mockStorageMap.delete(k);
    },
  };

  const stale21Requests = Array.from({ length: 21 }, (_, idx) => ({
    id: `preq-stale-${idx + 1}`,
    customer: { id: `cust-${idx + 1}`, name: idx === 0 ? 'MC Jadhav' : `Test ${idx + 1}`, phone: '9800000001' },
    customerId: `cust-${idx + 1}`,
    customerName: idx === 0 ? 'MC Jadhav' : `Test ${idx + 1}`,
    customerPhone: '9800000001',
    product: { id: `prod-stale-${idx + 1}`, name: idx === 0 ? 'सह्याद्री इलायची चहा' : `Item ${idx + 1}` },
    productId: `prod-stale-${idx + 1}`,
    productName: idx === 0 ? 'सह्याद्री इलायची चहा' : `Item ${idx + 1}`,
    quantity: 1,
    requestDate: '2026-10-28T09:00:00.000Z',
    createdAt: '2026-10-28T09:00:00.000Z',
  }));

  // 6a: Empty [] response from API must clear stale 21 localStorage items & yield []
  mockStorage.setItem('om_product_requests', JSON.stringify(stale21Requests));
  const emptyResolved = resolveAuthoritativeProductRequestsState(
    { success: true, status: 200, requests: [] },
    mockStorage
  );
  assert.equal(emptyResolved.requests.length, 0);
  assert.equal(emptyResolved.error, null);
  assert.equal(emptyResolved.synchronized, true);
  assert.equal(mockStorage.getItem('om_product_requests'), null);

  // 6b: Non-empty authoritative API response must replace (not merge with) 21 stale items & sync localStorage
  mockStorage.setItem('om_product_requests', JSON.stringify(stale21Requests));
  const newDbRequest = {
    id: adminGet.payload.requests[0].id,
    customer: {
      id: adminGet.payload.requests[0].customer_id,
      name: adminGet.payload.requests[0].customer_name,
      phone: adminGet.payload.requests[0].customer_phone,
    },
    customerId: adminGet.payload.requests[0].customer_id,
    customerName: adminGet.payload.requests[0].customer_name,
    customerPhone: adminGet.payload.requests[0].customer_phone,
    product: {
      id: adminGet.payload.requests[0].product_id,
      name: adminGet.payload.requests[0].product_name,
    },
    productId: adminGet.payload.requests[0].product_id,
    productName: adminGet.payload.requests[0].product_name,
    quantity: adminGet.payload.requests[0].quantity,
    requestDate: adminGet.payload.requests[0].request_date,
    createdAt: adminGet.payload.requests[0].created_at,
  };
  const liveResolved = resolveAuthoritativeProductRequestsState(
    { success: true, status: 200, requests: [newDbRequest] },
    mockStorage
  );
  assert.equal(liveResolved.requests.length, 1);
  assert.equal(liveResolved.requests[0].id, 'preq-test-1001');
  assert.equal(liveResolved.error, null);
  const syncedStorage = JSON.parse(mockStorage.getItem('om_product_requests') || '[]');
  assert.equal(syncedStorage.length, 1);
  assert.equal(syncedStorage[0].id, 'preq-test-1001');

  // 6c: Unauthorized / failed API response must NEVER fall back to stale 21 localStorage items
  mockStorage.setItem('om_product_requests', JSON.stringify(stale21Requests));
  const unauthResolved = resolveAuthoritativeProductRequestsState(
    { success: false, status: 401, error: 'Unauthorized: Please sign in as Shopkeeper to view product requests.' },
    mockStorage
  );
  assert.equal(unauthResolved.requests.length, 0);
  assert.ok(unauthResolved.error && unauthResolved.error.includes('Unauthorized'));
  assert.equal(unauthResolved.synchronized, false);

  // 6d: Test fetchProductRequestsFromApi & fetchProductRequestsFromSupabase with mocked window/fetch
  const origWindow = (globalThis as any).window;
  const origFetch = (globalThis as any).fetch;
  try {
    (globalThis as any).window = { localStorage: mockStorage };

    (globalThis as any).fetch = async () => ({
      ok: false,
      status: 401,
      json: async () => ({ success: false, error: 'Unauthorized: Shopkeeper session required.' }),
    });
    const api401 = await fetchProductRequestsFromApi();
    assert.equal(api401.success, false);
    assert.equal(api401.status, 401);
    assert.equal(await fetchProductRequestsFromSupabase(), null);

    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, requests: [] }),
    });
    const apiEmpty = await fetchProductRequestsFromApi();
    assert.equal(apiEmpty.success, true);
    assert.deepEqual(apiEmpty.requests, []);

    (globalThis as any).fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ success: true, requests: adminGet.payload.requests }),
    });
    const apiLive = await fetchProductRequestsFromApi();
    assert.equal(apiLive.success, true);
    assert.equal(apiLive.requests?.length, 1);
    assert.equal(apiLive.requests?.[0].id, 'preq-test-1001');
  } finally {
    (globalThis as any).window = origWindow;
    (globalThis as any).fetch = origFetch;
  }

  // 6e: Verify AppContext enforces authoritative state with no stale localStorage merge
  const appContextTs = fs.readFileSync(path.resolve('src/context/AppContext.tsx'), 'utf8');
  assert.ok(
    appContextTs.includes('resolveAuthoritativeProductRequestsState(result)'),
    'AppContext must reconcile productRequests via resolveAuthoritativeProductRequestsState'
  );
  assert.equal(
    /prev\.forEach\(\(r\)\s*=>\s*\{\s*if\s*\(!map\.has\(r\.id\)\)/.test(appContextTs),
    false,
    'AppContext must not merge stale prev productRequests back into remote API response'
  );

  console.log('ALL PRODUCT REQUEST END-TO-END CHECKS PASSED!');
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
