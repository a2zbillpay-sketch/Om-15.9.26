import assert from 'node:assert/strict';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { SupabaseClient } from '@supabase/supabase-js';
import handler, {
  processCustomersRequest,
  isAuthorizedCustomerDirectoryRow,
} from '../api/customers.js';

interface MockDbState {
  users: any[];
  addresses: any[];
  usersError?: { message: string; code?: string } | null;
  addressesError?: { message: string; code?: string } | null;
}

function createMockSupabase(state: MockDbState): SupabaseClient {
  return {
    from(table: string) {
      const chain: any = {
        _table: table,
        _orders: [] as Array<{ column: string; ascending: boolean }>,
        select() {
          return chain;
        },
        order(column: string, opts?: { ascending?: boolean }) {
          chain._orders.push({ column, ascending: opts?.ascending !== false });
          return chain;
        },
        then(resolve: (val: any) => void, reject?: (err: any) => void) {
          try {
            if (table === 'users') {
              if (state.usersError) {
                resolve({ data: null, error: state.usersError });
                return;
              }
              const rows = [...state.users];
              for (const ord of [...chain._orders].reverse()) {
                rows.sort((a, b) => {
                  const av = String(a?.[ord.column] || '');
                  const bv = String(b?.[ord.column] || '');
                  return ord.ascending ? av.localeCompare(bv) : bv.localeCompare(av);
                });
              }
              resolve({ data: rows, error: null });
              return;
            }
            if (table === 'addresses') {
              if (state.addressesError) {
                resolve({ data: null, error: state.addressesError });
                return;
              }
              const rows = [...state.addresses];
              for (const ord of [...chain._orders].reverse()) {
                rows.sort((a, b) => {
                  const av = a?.[ord.column];
                  const bv = b?.[ord.column];
                  if (typeof av === 'boolean' || typeof bv === 'boolean') {
                    return ord.ascending ? Number(av) - Number(bv) : Number(bv) - Number(av);
                  }
                  return ord.ascending
                    ? String(av || '').localeCompare(String(bv || ''))
                    : String(bv || '').localeCompare(String(av || ''));
                });
              }
              resolve({ data: rows, error: null });
              return;
            }
            resolve({ data: [], error: null });
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
  console.log('1. Testing role guard & authentication enforcement...');
  const emptyMock = createMockSupabase({ users: [], addresses: [] });

  const unauthRes = await processCustomersRequest(emptyMock, { isAdmin: false, role: null });
  assert.equal(unauthRes.statusCode, 401);
  assert.equal(unauthRes.payload.success, false);

  const customerRoleRes = await processCustomersRequest(emptyMock, {
    isAdmin: true,
    role: 'CUSTOMER',
  });
  assert.equal(customerRoleRes.statusCode, 401);
  assert.equal(customerRoleRes.payload.success, false);

  const missingDbRes = await processCustomersRequest(null, {
    isAdmin: true,
    role: 'SHOPKEEPER',
  });
  assert.equal(missingDbRes.statusCode, 503);
  assert.equal(missingDbRes.payload.success, false);

  console.log('2. Testing HTTP handler method & cookie auth guards...');
  let statusCode = 0;
  let bodyText = '';
  const headers: Record<string, string> = {};
  const mockRes = {
    setHeader(k: string, v: string) {
      headers[k.toLowerCase()] = v;
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

  await handler({ method: 'POST', headers: {} } as IncomingMessage, mockRes);
  assert.equal(statusCode, 405);
  assert.equal(headers['allow'], 'GET');
  assert.equal(JSON.parse(bodyText).success, false);

  await handler({ method: 'GET', headers: {} } as IncomingMessage, mockRes);
  assert.equal(statusCode, 401);
  assert.equal(headers['cache-control'], 'no-cache, no-store, must-revalidate');
  assert.equal(headers['access-control-allow-origin'], undefined);

  console.log('3. Testing zero-customer reset state (only admin/shopkeeper rows in DB)...');
  const resetDb = createMockSupabase({
    users: [
      {
        id: 'user-shopkeeper',
        name: 'Om Distributors Owner',
        phone: '9876543210',
        role: 'SHOPKEEPER',
        wallet_balance: 0,
        outstanding_balance: 0,
        cod_order_count: 0,
      },
      {
        id: 'admin-1',
        name: 'System Admin',
        phone: '9999999999',
        role: 'ADMIN',
      },
      {
        id: 'sec-1',
        name: 'Accounts Staff',
        phone: '9888888888',
        role: 'ACCOUNTS',
      },
    ],
    addresses: [],
  });
  const resetRes = await processCustomersRequest(resetDb, {
    isAdmin: true,
    role: 'SHOPKEEPER',
  });
  assert.equal(resetRes.statusCode, 200);
  assert.equal(resetRes.payload.success, true);
  assert.deepEqual(resetRes.payload.customers, []);

  console.log('4. Testing explicit DB error propagation (fail-closed)...');
  const errDb = createMockSupabase({
    users: [],
    addresses: [],
    usersError: { message: 'relation "public.users" permission denied', code: '42501' },
  });
  const errRes = await processCustomersRequest(errDb, {
    isAdmin: true,
    role: 'SHOPKEEPER',
  });
  assert.equal(errRes.statusCode, 500);
  assert.equal(errRes.payload.success, false);
  assert.match(errRes.payload.error || '', /permission denied/i);

  console.log('5. Testing customer mapping, role exclusion, address enrichment & balance preservation...');
  assert.equal(isAuthorizedCustomerDirectoryRow({ id: 'u1', role: 'SHOPKEEPER' }), false);
  assert.equal(isAuthorizedCustomerDirectoryRow({ id: 'u2', role: 'ADMIN' }), false);
  assert.equal(isAuthorizedCustomerDirectoryRow({ id: 'u3', role: 'SECONDARY_ADMIN' }), false);
  assert.equal(isAuthorizedCustomerDirectoryRow({ id: 'u4', role: 'ACCOUNTS' }), false);
  assert.equal(isAuthorizedCustomerDirectoryRow({ id: 'user-shopkeeper', role: 'CUSTOMER' }), false);
  assert.equal(isAuthorizedCustomerDirectoryRow({ id: 'u5', role: 'CUSTOMER' }), true);
  assert.equal(isAuthorizedCustomerDirectoryRow({ id: 'u6', role: null }), true);

  const populatedDb = createMockSupabase({
    users: [
      {
        id: 'user-shopkeeper',
        name: 'Owner',
        phone: '9876543210',
        role: 'SHOPKEEPER',
      },
      {
        id: 'admin-2',
        name: 'Admin User',
        phone: '9111111111',
        role: 'ADMIN',
      },
      {
        id: 'cust-uuid-1',
        full_name: 'Ramesh Traders',
        phone: '+91 9822001122',
        role: 'CUSTOMER',
        status: 'ACTIVE',
        wallet_balance: 250.5,
        outstanding_balance: 1400,
        cod_order_count: 7,
        created_at: '2026-10-01T10:00:00.000Z',
      },
      {
        id: 'usr_9822003344',
        name: 'Suresh Kirana',
        phone: '9822003344',
        role: 'CUSTOMER',
        status: 'INACTIVE',
        wallet_balance: 0,
        outstanding_balance: 320,
        cod_order_count: 2,
        address: 'Main Bazaar Road (Landmark: Old Post Office) - 422001',
        created_at: '2026-09-15T08:30:00.000Z',
      },
    ],
    addresses: [
      {
        id: 'addr-1',
        user_id: 'cust-uuid-1',
        address_label: 'SHOP',
        recipient_name: 'Ramesh',
        recipient_phone: '9822001122',
        address_line1: 'Shop 4, Market Yard',
        address_line2: 'Phase 2',
        landmark: 'Water Tank',
        city: 'Nashik',
        state: 'Maharashtra',
        pincode: '422003',
        is_default: true,
      },
    ],
  });

  const populatedRes = await processCustomersRequest(populatedDb, {
    isAdmin: true,
    role: 'SHOPKEEPER',
  });
  assert.equal(populatedRes.statusCode, 200);
  assert.equal(populatedRes.payload.success, true);
  assert.equal(populatedRes.payload.customers?.length, 2);

  const c1 = populatedRes.payload.customers?.find((c) => c.id === 'cust-uuid-1');
  assert.ok(c1);
  assert.equal(c1.name, 'Ramesh Traders');
  assert.equal(c1.phone, '9822001122');
  assert.equal(c1.status, 'ACTIVE');
  assert.equal(c1.walletBalance, 250.5);
  assert.equal(c1.outstandingBalance, 1400);
  assert.equal(c1.codOrderCount, 7);
  assert.equal(c1.createdAt, '2026-10-01T10:00:00.000Z');
  assert.equal(c1.addresses.length, 1);
  assert.equal(c1.addresses[0].pincode, '422003');
  assert.match(c1.addresses[0].fullAddress, /Shop 4, Market Yard/);

  const c2 = populatedRes.payload.customers?.find((c) => c.id === 'usr_9822003344');
  assert.ok(c2);
  assert.equal(c2.name, 'Suresh Kirana');
  assert.equal(c2.status, 'INACTIVE');
  assert.equal(c2.outstandingBalance, 320);
  assert.equal(c2.addresses.length, 1);
  assert.equal(c2.addresses[0].fullAddress, 'Main Bazaar Road');
  assert.equal(c2.addresses[0].landmark, 'Old Post Office');
  assert.equal(c2.addresses[0].pincode, '422001');

  console.log('ALL CUSTOMER DIRECTORY VERIFICATION CHECKS PASSED!');
}

run().catch((err) => {
  console.error('Verification failed:', err);
  process.exit(1);
});
