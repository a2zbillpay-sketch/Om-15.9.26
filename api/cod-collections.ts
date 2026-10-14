import type { IncomingMessage, ServerResponse } from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
      } catch {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function parseLedgerRowToTransaction(r: any, defaultPhone: string = ''): CodPaymentTransaction {
  let meta: any = null;
  const desc = r.description || '';
  if (desc.includes('COD_TX_META:')) {
    try {
      const parts = desc.split('COD_TX_META:');
      meta = JSON.parse(parts[1].trim());
    } catch {}
  }

  const orderNumFromDesc = desc.match(/Order #?([^\s|)]+)/i)?.[1] || '';
  const prevDebtFromDesc = desc.match(/Prev Debt ₹?([0-9.]+)/i)?.[1];

  const orderNumber = meta?.orderNumber || orderNumFromDesc || (r.order_id ? r.order_id.replace(/^ord[-_]/i, '').slice(0, 8) : '');
  const prevDebt = meta?.previousOutstanding !== undefined ? Number(meta.previousOutstanding) : (prevDebtFromDesc ? Number(prevDebtFromDesc) : 0);
  const amount = Number(r.amount) || 0;
  const remainingOutstanding = Number(r.balance_after) || 0;

  return {
    id: r.id,
    orderId: meta?.orderId || r.order_id || '',
    orderNumber,
    customerId: meta?.customerId || r.customer_id || '',
    customerPhone: meta?.customerPhone || normalizePhone(r.customer_id) || defaultPhone,
    customerName: meta?.customerName || r.customer_name || 'Valued Customer',
    amount,
    previousOutstanding: prevDebt,
    orderAmount: meta?.orderAmount !== undefined ? Number(meta.orderAmount) : amount,
    totalPayable: meta?.totalPayable !== undefined ? Number(meta.totalPayable) : amount,
    collectedAmount: amount,
    remainingOutstanding,
    allocations: Array.isArray(meta?.allocations)
      ? meta.allocations
      : r.order_id
      ? [
          {
            orderId: r.order_id,
            orderNumber,
            amountAllocated: amount,
            orderRemainingUnpaid: Math.max(0, remainingOutstanding),
          },
        ]
      : [],
    notes: meta?.notes || '',
    createdAt: r.date || new Date().toISOString(),
  };
}

// In-process lock to prevent duplicate concurrent COD collection executions within the same Node process
const inFlightOrderLocks = new Set<string>();

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
  const supabase = getSupabaseClient();

  if (!supabase) {
    return sendJson(res, 500, {
      success: false,
      error: 'Supabase client is not available',
      transactions: [],
      ordersMap: {},
      customerBalances: {},
      customerOutstanding: {},
    });
  }

  // GET: Fetch persistent COD transactions, order states, and customer balances directly from Supabase
  if (req.method === 'GET') {
    try {
      const phoneFilter = normalizePhone(url.searchParams.get('phone'));

      // 1. Fetch COD ledger records from Supabase
      let ledgerQuery = supabase
        .from('ledger')
        .select('*')
        .order('date', { ascending: false });

      if (phoneFilter) {
        ledgerQuery = ledgerQuery.or(
          `customer_id.eq.${phoneFilter},customer_id.eq.usr_${phoneFilter},description.ilike.%${phoneFilter}%`
        );
      }

      const { data: ledgerRows, error: ledgerError } = await ledgerQuery;
      if (ledgerError) {
        console.warn('Error reading COD ledger from Supabase:', ledgerError.message);
      }

      // Filter strictly for COD transactions (excluded from wallet calculations)
      const codRows = (ledgerRows || []).filter((r: any) => {
        if (!r) return false;
        const desc = (r.description || '').toLowerCase();
        return (
          r.id?.startsWith('cod_tx_') ||
          desc.includes('cod payment') ||
          desc.includes('cod collection')
        );
      });

      const transactions: CodPaymentTransaction[] = codRows.map((r: any) =>
        parseLedgerRowToTransaction(r, phoneFilter)
      );

      // 2. Fetch live orders from Supabase (never restoring deleted test data)
      let ordersQuery = supabase.from('orders').select('*');
      if (phoneFilter) {
        ordersQuery = ordersQuery.or(
          `customer_phone.eq.${phoneFilter},customer_phone.eq.+91${phoneFilter}`
        );
      }

      const { data: orderRows, error: ordersError } = await ordersQuery;
      if (ordersError) {
        console.warn('Error reading orders from Supabase:', ordersError.message);
      }

      const sanitizedOrdersMap: Record<string, OrderRecord> = {};
      if (orderRows) {
        for (const o of orderRows) {
          const rawNotes = o.notes || '';
          let codMeta: any = {};
          let orderNumber = '';

          if (rawNotes.includes('COD_META:')) {
            const parts = rawNotes.split('COD_META:');
            orderNumber = parts[0].replace(/\|/g, '').replace(/^Order\s*#?/i, '').trim();
            try {
              codMeta = JSON.parse(parts[1].trim());
            } catch {}
          } else {
            orderNumber = rawNotes.replace(/^Order\s*#?/i, '').trim();
          }

          if (!orderNumber) {
            orderNumber = o.id.replace(/^ord[-_]/i, '').slice(0, 8);
          }

          const finalAmount = Number(o.final_total ?? o.subtotal ?? 0);
          let codCollectedAmount = Number(codMeta.codCollected ?? 0);
          if (o.is_paid && codCollectedAmount === 0) {
            codCollectedAmount = finalAmount;
          }

          let paymentStatus = 'PENDING';
          if (o.is_paid || codCollectedAmount >= finalAmount) {
            paymentStatus = 'RECEIVED';
          } else if (codCollectedAmount > 0) {
            paymentStatus = 'PARTIALLY_COLLECTED';
          }

          sanitizedOrdersMap[o.id] = {
            id: o.id,
            orderNumber,
            customerPhone: normalizePhone(o.customer_phone),
            customerId: o.customer_id,
            customerName: o.customer_name,
            finalAmount,
            previousOutstanding: Number(codMeta.prevOutstanding ?? 0),
            // Rule: totalPayable strictly equals finalAmount only
            totalPayable: finalAmount,
            codCollectedAmount,
            paymentStatus,
            status: o.status,
            createdAt: o.created_at,
            updatedAt: o.updated_at || o.created_at || new Date().toISOString(),
          };
        }
      }

      // 3. Fetch authoritative customer balances from Supabase users table
      let usersQuery = supabase.from('users').select('phone, outstanding_balance');
      if (phoneFilter) {
        usersQuery = usersQuery.eq('phone', phoneFilter);
      }

      const { data: userRows, error: usersError } = await usersQuery;
      if (usersError) {
        console.warn('Error reading customer balances from Supabase:', usersError.message);
      }

      const customerBalances: Record<string, number> = {};
      if (userRows) {
        for (const u of userRows) {
          const p = normalizePhone(u.phone);
          if (p) {
            customerBalances[p] = Number(u.outstanding_balance) || 0;
          }
        }
      }

      return sendJson(res, 200, {
        success: true,
        transactions,
        ordersMap: sanitizedOrdersMap,
        customerBalances,
        customerOutstanding: customerBalances,
      });
    } catch (err: any) {
      console.error('Error in /api/cod-collections GET:', err);
      return sendJson(res, 500, {
        success: false,
        error: err.message || 'Internal server error',
      });
    }
  }

  // POST: Record COD collection, execute FIFO allocation, and write durably to Supabase
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
        markAsDelivered = false,
        notes = '',
      } = body;

      if (!orderId) {
        return sendJson(res, 400, { success: false, error: 'Missing orderId' });
      }

      // Check in-process lock to prevent duplicate concurrent executions within this instance
      if (inFlightOrderLocks.has(orderId)) {
        console.warn(`In-process lock prevented duplicate concurrent collection for order ${orderId}`);
        return sendJson(res, 409, {
          success: false,
          duplicate: true,
          conflict: true,
          error: `Collection is already being processed for order ${orderId}`,
        });
      }

      inFlightOrderLocks.add(orderId);
      try {
        const cleanPhone = normalizePhone(customerPhone);
        const cleanCollected = Math.max(0, Math.round(Number(collectedAmount) * 100) / 100);

        // 1. Verify target order exists in Supabase. Never recreate deleted test data!
        const { data: targetOrderRow, error: targetOrderErr } = await supabase
          .from('orders')
          .select('*')
          .eq('id', orderId)
          .maybeSingle();

        if (targetOrderErr) {
          return sendJson(res, 500, {
            success: false,
            error: `Failed to query target order: ${targetOrderErr.message}`,
          });
        }

        if (!targetOrderRow) {
          return sendJson(res, 404, {
            success: false,
            error: `Order ${orderId} does not exist in Supabase or was deleted.`,
          });
        }

        const targetInitialUpdatedAt = targetOrderRow.updated_at;

      // 2. Prevent duplicate collections: check recent transaction on this order
      const { data: recentTxRows, error: txCheckErr } = await supabase
        .from('ledger')
        .select('*')
        .eq('order_id', orderId)
        .order('date', { ascending: false })
        .limit(1);

      if (!txCheckErr && recentTxRows && recentTxRows.length > 0) {
        const lastTx = recentTxRows[0];
        const timeSinceLastMs = Date.now() - new Date(lastTx.date).getTime();
        // If exact same amount collected within 30 seconds, treat as idempotent duplicate prevention
        if (timeSinceLastMs < 30000 && Number(lastTx.amount) === cleanCollected) {
          console.log(`Prevented duplicate COD collection for order ${orderId}`);
          return sendJson(res, 200, {
            success: true,
            duplicate: true,
            message: 'Collection already processed',
            transaction: parseLedgerRowToTransaction(lastTx, cleanPhone),
            remainingOutstanding: Number(lastTx.balance_after) || 0,
          });
        }
      }

      // Check if order is already fully paid and collected
      const targetRawNotes = targetOrderRow.notes || '';
      let targetExistingMeta: any = {};
      if (targetRawNotes.includes('COD_META:')) {
        try {
          targetExistingMeta = JSON.parse(targetRawNotes.split('COD_META:')[1].trim());
        } catch {}
      }

      const targetFinalBill = Number(targetOrderRow.final_total ?? targetOrderRow.subtotal ?? 0);
      const targetAlreadyCollected = Number(
        targetExistingMeta.codCollected ?? (targetOrderRow.is_paid ? targetFinalBill : 0)
      );

      if (targetOrderRow.is_paid && targetAlreadyCollected >= targetFinalBill && cleanCollected > 0) {
        return sendJson(res, 400, {
          success: false,
          error: `Order ${orderId} is already fully paid (₹${targetAlreadyCollected} collected).`,
        });
      }

      // 3. Fetch all active orders for this customer from Supabase for FIFO allocation
      const resolvedCustomerId = customerId || targetOrderRow.customer_id;
      const resolvedPhone = cleanPhone || normalizePhone(targetOrderRow.customer_phone);

      const customerFilterClauses: string[] = [];
      if (resolvedPhone) {
        customerFilterClauses.push(`customer_phone.eq.${resolvedPhone}`);
        customerFilterClauses.push(`customer_phone.eq.+91${resolvedPhone}`);
      }
      if (resolvedCustomerId) {
        customerFilterClauses.push(`customer_id.eq.${resolvedCustomerId}`);
      }

      let customerOrdersQuery = supabase
        .from('orders')
        .select('*')
        .neq('status', 'CANCELLED')
        .order('created_at', { ascending: true });

      if (customerFilterClauses.length > 0) {
        customerOrdersQuery = customerOrdersQuery.or(customerFilterClauses.join(','));
      }

      const { data: rawCustomerOrders, error: custOrdersErr } = await customerOrdersQuery;
      if (custOrdersErr) {
        return sendJson(res, 500, {
          success: false,
          error: `Failed to fetch customer orders from Supabase: ${custOrdersErr.message}`,
        });
      }

      const parsedCustomerOrders = (rawCustomerOrders || []).map((row: any) => {
        let meta: any = {};
        let ordNum = '';
        const n = row.notes || '';
        if (n.includes('COD_META:')) {
          const parts = n.split('COD_META:');
          ordNum = parts[0].replace(/\|/g, '').replace(/^Order\s*#?/i, '').trim();
          try {
            meta = JSON.parse(parts[1].trim());
          } catch {}
        } else {
          ordNum = n.replace(/^Order\s*#?/i, '').trim();
        }
        if (!ordNum) ordNum = row.id.replace(/^ord[-_]/i, '').slice(0, 8);

        const bill = Number(row.final_total ?? row.subtotal ?? 0);
        let alreadyCollected = Number(meta.codCollected ?? 0);
        if (row.is_paid && alreadyCollected === 0) {
          alreadyCollected = bill;
        }

        return {
          id: row.id,
          orderNumber: ordNum,
          finalAmount: bill,
          previousOutstanding: Number(meta.prevOutstanding ?? 0),
          codCollectedAmount: alreadyCollected,
          paymentStatus:
            row.is_paid || alreadyCollected >= bill
              ? 'RECEIVED'
              : alreadyCollected > 0
              ? 'PARTIALLY_COLLECTED'
              : 'PENDING',
          status: row.status,
          createdAt: row.created_at,
          notes: row.notes,
          meta,
        };
      });

      // Prioritize older unpaid orders first, ending with target orderId
      const olderOrders = parsedCustomerOrders.filter((o) => o.id !== orderId);
      const targetOrder = parsedCustomerOrders.find((o) => o.id === orderId);

      const allocations: CodTransactionAllocation[] = [];
      const updatedOrdersMap: Record<string, any> = {};

      const bill = Number(targetOrder?.finalAmount) || targetFinalBill || Number(orderAmount) || 0;
      const currentAlreadyCollected = Number(targetOrder?.codCollectedAmount) || targetAlreadyCollected || 0;
      const currentRemainingUnpaid = Math.max(0, Math.round((bill - currentAlreadyCollected) * 100) / 100);
      const prevDebt = Number(previousOutstanding) || Number(targetOrder?.previousOutstanding) || 0;

      // 1. Current order remaining unpaid balance is covered first
      const allocToCurrent = Math.min(cleanCollected, currentRemainingUnpaid);

      // 2. Cash beyond current order remaining balance is allocated to settle older debt up to prevDebt
      let cashForOlder = Math.min(Math.max(0, cleanCollected - currentRemainingUnpaid), prevDebt);

      for (const ord of olderOrders) {
        const oBill = Number(ord.finalAmount) || 0;
        const oAlready = Number(ord.codCollectedAmount) || 0;
        const oUnpaid = Math.max(0, oBill - oAlready);

        if (oUnpaid <= 0) {
          continue;
        }

        const alloc = Math.min(cashForOlder, oUnpaid);
        const updatedCollected = Math.round((oAlready + alloc) * 100) / 100;
        const remUnpaid = Math.max(0, Math.round((oBill - updatedCollected) * 100) / 100);

        let status = 'PENDING';
        if (updatedCollected >= oBill) {
          status = 'RECEIVED';
        } else if (updatedCollected > 0) {
          status = 'PARTIALLY_COLLECTED';
        }

        if (alloc > 0) {
          allocations.push({
            orderId: ord.id,
            orderNumber: ord.orderNumber,
            amountAllocated: alloc,
            orderRemainingUnpaid: remUnpaid,
          });

          ord.codCollectedAmount = updatedCollected;
          ord.paymentStatus = status;

          updatedOrdersMap[ord.id] = {
            codCollectedAmount: updatedCollected,
            paymentStatus: status,
            status: ord.status,
            orderNumber: ord.orderNumber,
            existingMeta: ord.meta,
            finalAmount: oBill,
            previousOutstanding: ord.previousOutstanding,
          };

          cashForOlder = Math.round((cashForOlder - alloc) * 100) / 100;
        }
      }

      // 3. Allocate to targetOrder: accumulate on top of currentAlreadyCollected
      if (targetOrder) {
        const nextStatus = markAsDelivered ? 'DELIVERED' : targetOrder.status;
        const updatedCurrentCollected = Math.round((currentAlreadyCollected + allocToCurrent) * 100) / 100;

        let nextPaymentStatus = 'PENDING';
        if (updatedCurrentCollected >= bill) {
          nextPaymentStatus = 'RECEIVED';
        } else if (updatedCurrentCollected > 0) {
          nextPaymentStatus = 'PARTIALLY_COLLECTED';
        }

        const finalCurrentRemainingUnpaid = Math.max(
          0,
          Math.round((bill - updatedCurrentCollected) * 100) / 100
        );

        allocations.push({
          orderId: targetOrder.id,
          orderNumber: targetOrder.orderNumber,
          amountAllocated: allocToCurrent,
          orderRemainingUnpaid: finalCurrentRemainingUnpaid,
        });

        targetOrder.codCollectedAmount = updatedCurrentCollected;
        targetOrder.paymentStatus = nextPaymentStatus;
        targetOrder.status = nextStatus;

        updatedOrdersMap[targetOrder.id] = {
          codCollectedAmount: updatedCurrentCollected,
          paymentStatus: nextPaymentStatus,
          status: nextStatus,
          orderNumber: targetOrder.orderNumber,
          existingMeta: targetOrder.meta,
          finalAmount: bill,
          previousOutstanding: prevDebt,
        };
      }

      // 4. Recalculate customer debt across all chronological orders without recreating/duplicating debt
      let runningCustomerDebt = 0;
      for (const ord of parsedCustomerOrders) {
        const b = Number(ord.finalAmount) || 0;
        const c = Number(ord.codCollectedAmount) || 0;
        const isRecv = ord.paymentStatus === 'RECEIVED';

        if (!isRecv && c < b) {
          runningCustomerDebt += Math.max(0, Math.round((b - c) * 100) / 100);
        }
      }

      const remainingCustomerDebt = Math.round(runningCustomerDebt * 100) / 100;

      // 5. Generate permanent COD transaction record
      const txId = `cod_tx_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const resolvedOrderNumber =
        orderNumber || targetOrder?.orderNumber || `OM-${orderId.slice(0, 5)}`;
      const resolvedCustomerName =
        customerName || targetOrderRow.customer_name || 'Valued Customer';

      const newTransaction: CodPaymentTransaction = {
        id: txId,
        orderId,
        orderNumber: resolvedOrderNumber,
        customerId: resolvedCustomerId || '',
        customerPhone: resolvedPhone,
        customerName: resolvedCustomerName,
        amount: cleanCollected,
        previousOutstanding: Number(prevDebt) || 0,
        orderAmount: bill,
        totalPayable: bill,
        collectedAmount: cleanCollected,
        remainingOutstanding: remainingCustomerDebt,
        allocations,
        notes,
        createdAt: new Date().toISOString(),
      };

      // 6. AWAIT AND VERIFY ALL SUPABASE WRITES BEFORE REPORTING SUCCESS

      // 6a. Perform Optimistic Concurrency Control (OCC) update on the target order FIRST
      const targetUpd = updatedOrdersMap[orderId];
      if (targetUpd) {
        const isPaid = targetUpd.paymentStatus === 'RECEIVED';
        const mergedMeta = {
          ...(targetUpd.existingMeta || {}),
          codCollected: targetUpd.codCollectedAmount,
          prevOutstanding: targetUpd.previousOutstanding || 0,
          totalPayable: targetUpd.finalAmount || 0,
        };
        const metaString = JSON.stringify(mergedMeta);
        const orderNotes = `Order #${targetUpd.orderNumber || orderId.slice(0, 8)} | COD_META:${metaString}`;

        let occQuery = supabase
          .from('orders')
          .update({
            status: targetUpd.status,
            is_paid: isPaid,
            notes: orderNotes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', orderId);

        if (targetInitialUpdatedAt) {
          occQuery = occQuery.eq('updated_at', targetInitialUpdatedAt);
        } else {
          occQuery = occQuery.is('updated_at', null);
        }

        const { data: occResult, error: occErr } = await occQuery.select('id, updated_at');

        if (occErr) {
          console.error(`Failed to update target order ${orderId} in Supabase:`, occErr);
          throw new Error(`Failed to update order ${orderId}: ${occErr.message}`);
        }

        // If OCC updates zero rows, stop all further writes and return a safe conflict response!
        if (!occResult || occResult.length === 0) {
          console.warn(`OCC prevented concurrent duplicate COD collection for order ${orderId}`);

          // Fetch recent ledger record if collection was already processed concurrently
          const { data: latestLedger } = await supabase
            .from('ledger')
            .select('*')
            .eq('order_id', orderId)
            .order('date', { ascending: false })
            .limit(1);

          if (latestLedger && latestLedger.length > 0) {
            return sendJson(res, 200, {
              success: true,
              duplicate: true,
              conflict: true,
              message: 'Collection already processed concurrently',
              transaction: parseLedgerRowToTransaction(latestLedger[0], cleanPhone),
              remainingOutstanding: Number(latestLedger[0].balance_after) || 0,
            });
          }

          return sendJson(res, 409, {
            success: false,
            duplicate: true,
            conflict: true,
            error: 'Conflict: Order was modified concurrently by another request. No changes were applied.',
          });
        }
      }

      // 6b. Update any older orders affected by FIFO allocation
      for (const [updId, updData] of Object.entries(updatedOrdersMap)) {
        if (updId === orderId) continue; // Target order was already atomically updated above
        const isPaid = updData.paymentStatus === 'RECEIVED';
        const mergedMeta = {
          ...(updData.existingMeta || {}),
          codCollected: updData.codCollectedAmount,
          prevOutstanding: updData.previousOutstanding || 0,
          totalPayable: updData.finalAmount || 0,
        };
        const metaString = JSON.stringify(mergedMeta);
        const orderNotes = `Order #${updData.orderNumber || updId.slice(0, 8)} | COD_META:${metaString}`;

        const { error: orderUpdateErr } = await supabase
          .from('orders')
          .update({
            status: updData.status,
            is_paid: isPaid,
            notes: orderNotes,
            updated_at: new Date().toISOString(),
          })
          .eq('id', updId);

        if (orderUpdateErr) {
          console.error(`Failed to update order ${updId} in Supabase:`, orderUpdateErr);
          throw new Error(`Failed to update order ${updId}: ${orderUpdateErr.message}`);
        }
      }

      // 6c. Update Supabase 'users.outstanding_balance'
      if (resolvedPhone) {
        const { error: userUpdateErr } = await supabase
          .from('users')
          .update({
            outstanding_balance: remainingCustomerDebt,
            updated_at: new Date().toISOString(),
          })
          .eq('phone', resolvedPhone);

        if (userUpdateErr) {
          console.error(
            `Failed to update outstanding_balance for phone ${resolvedPhone}:`,
            userUpdateErr
          );
          throw new Error(`Failed to update user balance: ${userUpdateErr.message}`);
        }
      }

      // 6d. Insert into Supabase 'ledger' table (COD transaction excluded from wallet)
      const txMetaJson = JSON.stringify({
        orderId,
        orderNumber: resolvedOrderNumber,
        customerId: resolvedCustomerId || '',
        customerPhone: resolvedPhone,
        customerName: resolvedCustomerName,
        previousOutstanding: Number(prevDebt) || 0,
        orderAmount: bill,
        totalPayable: bill,
        allocations,
        notes,
      });

      const ledgerPayload = {
        id: txId,
        customer_id: resolvedCustomerId || resolvedPhone,
        customer_name: resolvedCustomerName,
        order_id: orderId,
        date: newTransaction.createdAt,
        type: 'CREDIT',
        amount: cleanCollected,
        description: `COD Payment for Order #${resolvedOrderNumber} (Prev Debt ₹${prevDebt}, Collected ₹${cleanCollected}) | COD_TX_META:${txMetaJson}`,
        balance_after: remainingCustomerDebt,
      };

      const { error: ledgerInsertErr } = await supabase.from('ledger').insert(ledgerPayload);
      if (ledgerInsertErr) {
        console.error('Failed to insert into Supabase ledger:', ledgerInsertErr);
        throw new Error(`Failed to record COD ledger: ${ledgerInsertErr.message}`);
      }

      // Return verified success response
      return sendJson(res, 200, {
        success: true,
        transaction: newTransaction,
        updatedOrdersMap,
        remainingOutstanding: remainingCustomerDebt,
      });
    } finally {
      inFlightOrderLocks.delete(orderId);
    }
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
