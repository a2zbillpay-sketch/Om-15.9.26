import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const LEDGER_FILE = path.join(DATA_DIR, 'cod_ledger.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

interface CodTransactionAllocation {
  orderId: string;
  orderNumber: string;
  amountAllocated: number;
  orderRemainingUnpaid: number;
}

interface CodPaymentTransaction {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  amount: number;
  previousOutstanding: number;
  orderAmount: number;
  totalPayable: number;
  collectedAmount: number;
  remainingOutstanding: number;
  allocations: CodTransactionAllocation[];
  notes?: string;
  createdAt: string;
}

interface OrderRecord {
  id: string;
  orderNumber: string;
  customerPhone: string;
  customerId?: string;
  customerName?: string;
  finalAmount: number;
  previousOutstanding?: number;
  totalPayable?: number;
  codCollectedAmount?: number;
  paymentStatus?: string;
  status?: string;
  createdAt?: string;
  updatedAt: string;
}

interface PersistentLedger {
  version: number;
  transactions: CodPaymentTransaction[];
  orders: Record<string, OrderRecord>;
  customerBalances: Record<string, number>;
}

function loadLedger(): PersistentLedger {
  try {
    if (fs.existsSync(LEDGER_FILE)) {
      const content = fs.readFileSync(LEDGER_FILE, 'utf8');
      if (content.trim()) {
        const parsed = JSON.parse(content);
        return {
          version: parsed.version || 1,
          transactions: Array.isArray(parsed.transactions) ? parsed.transactions : [],
          orders: parsed.orders || {},
          customerBalances: parsed.customerBalances || {},
        };
      }
    }
  } catch (err) {
    console.error('Failed to read cod_ledger.json:', err);
  }
  return {
    version: 1,
    transactions: [],
    orders: {},
    customerBalances: {},
  };
}

function saveLedger(ledger: PersistentLedger): void {
  try {
    const tempFile = `${LEDGER_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(ledger, null, 2), 'utf8');
    fs.renameSync(tempFile, LEDGER_FILE);
  } catch (err) {
    console.error('Failed to write cod_ledger.json:', err);
  }
}

function normalizePhone(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    process.env.SUPABASE_ANON_KEY;

  if (url && key && url !== 'https://your-project.supabase.co' && key !== 'your-anon-key') {
    try {
      return createClient(url, key, { auth: { persistSession: false } });
    } catch {
      return null;
    }
  }
  return null;
}

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json');
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

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const ledger = loadLedger();
  const supabase = getSupabaseClient();

  // GET: Fetch transactions, order states, and customer balances
  if (req.method === 'GET') {
    const phoneFilter = normalizePhone(url.searchParams.get('phone'));

    let transactions = ledger.transactions;
    if (phoneFilter) {
      transactions = transactions.filter(
        (t) => normalizePhone(t.customerPhone) === phoneFilter
      );
    }

    return sendJson(res, 200, {
      success: true,
      transactions,
      ordersMap: ledger.orders,
      customerBalances: ledger.customerBalances,
    });
  }

  // POST: Record collection, allocate in FIFO order across previous unpaid orders, persist permanently
  if (req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const {
        orderId,
        orderNumber,
        customerPhone,
        customerId,
        customerName,
        collectedAmount,
        previousOutstanding = 0,
        orderAmount,
        totalPayable,
        markAsDelivered = false,
        notes = '',
        allCustomerOrders = [], // Optional full order list passed from frontend
      } = body;

      if (!orderId) {
        return sendJson(res, 400, { success: false, error: 'Missing orderId' });
      }

      const cleanPhone = normalizePhone(customerPhone);
      const cleanCollected = Math.max(0, Math.round(Number(collectedAmount) * 100) / 100);

      // Merge order metadata into persistent ledger
      if (allCustomerOrders && Array.isArray(allCustomerOrders)) {
        for (const o of allCustomerOrders) {
          if (o.id) {
            const existing = ledger.orders[o.id] || {};
            ledger.orders[o.id] = {
              ...existing,
              id: o.id,
              orderNumber: o.orderNumber || existing.orderNumber || '',
              customerPhone: cleanPhone || existing.customerPhone || '',
              customerId: customerId || o.userId || existing.customerId,
              customerName: customerName || o.userName || existing.customerName,
              finalAmount: Number(o.finalAmount ?? existing.finalAmount ?? 0),
              previousOutstanding: Number(o.previousOutstanding ?? existing.previousOutstanding ?? 0),
              totalPayable: Number(o.totalPayable ?? existing.totalPayable ?? o.finalAmount),
              codCollectedAmount: Number(o.codCollectedAmount ?? existing.codCollectedAmount ?? 0),
              paymentStatus: o.paymentStatus || existing.paymentStatus || 'PENDING',
              status: o.status || existing.status || 'ORDER_ACCEPTED',
              createdAt: o.createdAt || existing.createdAt || new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            };
          }
        }
      }

      // Ensure the target order exists in the ledger
      if (!ledger.orders[orderId]) {
        ledger.orders[orderId] = {
          id: orderId,
          orderNumber: orderNumber || `OM-${orderId.slice(0, 5)}`,
          customerPhone: cleanPhone,
          customerId,
          customerName,
          finalAmount: Number(orderAmount) || 0,
          previousOutstanding: Number(previousOutstanding) || 0,
          totalPayable: Number(totalPayable) || Number(orderAmount) || 0,
          codCollectedAmount: 0,
          paymentStatus: 'PENDING',
          status: 'ORDER_ACCEPTED',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };
      }

      // Gather all orders belonging to this customer to execute FIFO allocation
      const customerOrdersList = Object.values(ledger.orders)
        .filter(
          (o) =>
            o.status !== 'CANCELLED' &&
            (!cleanPhone || normalizePhone(o.customerPhone) === cleanPhone)
        )
        .sort(
          (a, b) =>
            new Date(a.createdAt || 0).getTime() - new Date(b.createdAt || 0).getTime()
        );

      // Prioritize older unpaid orders first, ending with target orderId
      const olderOrders = customerOrdersList.filter((o) => o.id !== orderId);
      const targetOrder = customerOrdersList.find((o) => o.id === orderId);

      const allocationQueue = [...olderOrders];
      if (targetOrder) {
        allocationQueue.push(targetOrder);
      }

      let cashToAllocate = cleanCollected;
      const allocations: CodTransactionAllocation[] = [];
      const updatedOrdersMap: Record<string, any> = {};

      for (const ord of allocationQueue) {
        const bill = Number(ord.finalAmount) || 0;
        const currentCollected = Number(ord.codCollectedAmount) || 0;
        const unpaid = Math.max(0, bill - currentCollected);

        if (unpaid <= 0) {
          continue;
        }

        const alloc = Math.min(cashToAllocate, unpaid);
        const newCollected = Math.round((currentCollected + alloc) * 100) / 100;
        const remainingUnpaid = Math.max(0, Math.round((bill - newCollected) * 100) / 100);

        let nextPaymentStatus = 'PENDING';
        if (newCollected >= bill) {
          nextPaymentStatus = 'RECEIVED';
        } else if (newCollected > 0) {
          nextPaymentStatus = 'PARTIALLY_COLLECTED';
        }

        allocations.push({
          orderId: ord.id,
          orderNumber: ord.orderNumber,
          amountAllocated: alloc,
          orderRemainingUnpaid: remainingUnpaid,
        });

        const isCurrent = ord.id === orderId;
        const nextStatus = isCurrent && markAsDelivered ? 'DELIVERED' : ord.status;

        ord.codCollectedAmount = newCollected;
        ord.paymentStatus = nextPaymentStatus;
        ord.status = nextStatus;
        ord.updatedAt = new Date().toISOString();

        updatedOrdersMap[ord.id] = {
          codCollectedAmount: newCollected,
          paymentStatus: nextPaymentStatus,
          status: nextStatus,
        };

        cashToAllocate = Math.round((cashToAllocate - alloc) * 100) / 100;
      }

      // Calculate new remaining customer balance across all unpaid orders
      let remainingCustomerDebt = 0;
      for (const ord of Object.values(ledger.orders)) {
        if (
          ord.status !== 'CANCELLED' &&
          (!cleanPhone || normalizePhone(ord.customerPhone) === cleanPhone)
        ) {
          const b = Number(ord.finalAmount) || 0;
          const c = Number(ord.codCollectedAmount) || 0;
          if (ord.paymentStatus !== 'RECEIVED' || c < b) {
            remainingCustomerDebt += Math.max(0, b - c);
          }
        }
      }
      remainingCustomerDebt = Math.round(remainingCustomerDebt * 100) / 100;
      ledger.customerBalances[cleanPhone] = remainingCustomerDebt;

      // Create permanent transaction record
      const txId = `cod_tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const newTransaction: CodPaymentTransaction = {
        id: txId,
        orderId,
        orderNumber: orderNumber || ledger.orders[orderId]?.orderNumber || '',
        customerId: customerId || '',
        customerPhone: cleanPhone,
        customerName: customerName || 'Valued Customer',
        amount: cleanCollected,
        previousOutstanding: Number(previousOutstanding) || 0,
        orderAmount: Number(orderAmount) || ledger.orders[orderId]?.finalAmount || 0,
        totalPayable: Number(totalPayable) || 0,
        collectedAmount: cleanCollected,
        remainingOutstanding: remainingCustomerDebt,
        allocations,
        notes,
        createdAt: new Date().toISOString(),
      };

      ledger.transactions.unshift(newTransaction);

      // Save to persistent file
      saveLedger(ledger);

      // Async sync to Supabase (ledger, users, orders)
      if (supabase) {
        (async () => {
          try {
            // 1. Insert into Supabase 'ledger' table
            await supabase.from('ledger').insert({
              id: txId,
              customer_id: customerId || cleanPhone,
              customer_name: customerName || 'Valued Customer',
              order_id: orderId,
              date: newTransaction.createdAt,
              type: 'CREDIT',
              amount: cleanCollected,
              description: `COD Payment for Order #${newTransaction.orderNumber} (Prev Debt ₹${previousOutstanding}, Collected ₹${cleanCollected})`,
              balance_after: remainingCustomerDebt,
            });

            // 2. Update Supabase 'users.outstanding_balance'
            if (cleanPhone) {
              await supabase
                .from('users')
                .update({
                  outstanding_balance: remainingCustomerDebt,
                  updated_at: new Date().toISOString(),
                })
                .eq('phone', cleanPhone);
            }

            // 3. Update Supabase 'orders' status and notes with COD_META for all updated orders
            for (const [updId, updData] of Object.entries(updatedOrdersMap)) {
              const ordObj = ledger.orders[updId];
              const isPaid = updData.paymentStatus === 'RECEIVED';
              const metaString = JSON.stringify({
                codCollected: updData.codCollectedAmount,
                prevOutstanding: ordObj?.previousOutstanding || 0,
                totalPayable: ordObj?.totalPayable || ordObj?.finalAmount || 0,
              });

              await supabase
                .from('orders')
                .update({
                  status: updData.status,
                  is_paid: isPaid,
                  notes: `Order #${ordObj?.orderNumber || updId.slice(0, 8)} | COD_META:${metaString}`,
                  updated_at: new Date().toISOString(),
                })
                .eq('id', updId);
            }
          } catch (supaErr) {
            console.warn('Background Supabase ledger sync warning:', supaErr);
          }
        })();
      }

      return sendJson(res, 200, {
        success: true,
        transaction: newTransaction,
        updatedOrdersMap,
        remainingOutstanding: remainingCustomerDebt,
      });
    } catch (err: any) {
      console.error('Error in /api/cod-collections POST:', err);
      return sendJson(res, 500, {
        success: false,
        error: err.message || 'Internal server error',
      });
    }
  }

  return sendJson(res, 405, { success: false, error: 'Method Not Allowed' });
}
