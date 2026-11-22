/**
 * Comprehensive verification suite for the Atomic PostgreSQL Order Cancellation,
 * Stock Restoration, Wallet Refund, and Concurrency/Recovery Architecture.
 *
 * Tests the real API handlers:
 *   - api/_orderCancellation.ts (processCancelOrderRequest)
 *   - api/orders.ts (processUpdateOrderRequest, processCreateOrderRequest)
 *   - api/cod-collections.ts (processCodCollectionPost)
 * backed by an ACID PostgreSQL simulator implementing:
 *   - Real async row-level locks (FOR UPDATE) & transaction advisory locks (pg_advisory_xact_lock)
 *   - Full snapshot/rollback ACID transactions for RPCs (`cancel_order_atomic`,
 *     `debit_wallet_for_order_atomic`, `transition_order_status_atomic`)
 *   - Partial unique index `uq_ledger_order_refund_credit`
 *   - Trigger guard `trg_orders_prevent_cancelled_revival`
 *   - Injected stage failures & crash/retry recovery checks
 *   - Direct SQL migration static integrity checks
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import type { SupabaseClient } from '@supabase/supabase-js';
import { processCancelOrderRequest } from '../api/_orderCancellation.js';
import { processUpdateOrderRequest, processCreateOrderRequest } from '../api/orders.js';
import { processCodCollectionPost } from '../api/cod-collections.js';

type FaultStage =
  | 'variant_update'
  | 'product_update'
  | 'ledger_insert'
  | 'user_wallet_update'
  | 'order_finalize'
  | 'create_order_insert'
  | 'create_order_items_insert'
  | 'missing_rpc'
  | null;

interface DbState {
  orders: any[];
  order_items: any[];
  products: any[];
  product_variants: any[];
  tiered_prices: any[];
  users: any[];
  ledger: any[];
  addresses: any[];
  store_settings: any[];
}

function deepClone<T>(val: T): T {
  return JSON.parse(JSON.stringify(val));
}

function normalizePhone10(raw?: string | null): string {
  if (!raw) return '';
  const digits = String(raw).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function phoneVariants(clean10: string): string[] {
  if (!clean10) return [];
  return Array.from(
    new Set([clean10, `+91${clean10}`, `+91 ${clean10}`, `91${clean10}`, `0${clean10}`, `0091${clean10}`])
  );
}

function isWalletLedgerRow(r: any): boolean {
  if (!r) return false;
  const id = String(r.id || '');
  const type = String(r.type || '').toUpperCase();
  const desc = String(r.description || '').toLowerCase();
  if (desc.includes('cod payment') || desc.includes('cod collection')) return false;
  if (id.startsWith('cod_tx_') || id.startsWith('led_ord_')) return false;
  if (type === 'DEBIT' && (desc.includes('wallet') || id.startsWith('wtx_'))) return true;
  if (type === 'CREDIT' && (desc.includes('refund') || desc.includes('wallet') || id.startsWith('wtx_'))) return true;
  return false;
}

function parseNotesMeta(notes: string | null | undefined): { orderNumber: string; meta: Record<string, any> } {
  const s = String(notes || '');
  const idx = s.indexOf('COD_META:');
  if (idx >= 0) {
    const prefix = s.slice(0, idx).replace(/\|/g, '').replace(/^Order\s*#?/i, '').trim();
    const rawMeta = s.slice(idx + 'COD_META:'.length).trim();
    try {
      const parsed = JSON.parse(rawMeta);
      return { orderNumber: prefix, meta: parsed && typeof parsed === 'object' ? parsed : {} };
    } catch {
      return { orderNumber: prefix, meta: {} };
    }
  }
  return { orderNumber: s.replace(/^Order\s*#?/i, '').trim(), meta: {} };
}

class AsyncLockManager {
  private queues = new Map<string, Promise<void>>();

  async acquire(key: string): Promise<() => void> {
    const prev = this.queues.get(key) || Promise.resolve();
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });
    const chained = prev.catch(() => {}).then(() => next);
    this.queues.set(key, chained);
    await prev.catch(() => {});
    return () => {
      release();
      if (this.queues.get(key) === chained) {
        this.queues.delete(key);
      }
    };
  }

  async acquireAllSorted(keys: string[]): Promise<() => void> {
    const uniqueSorted = Array.from(new Set(keys)).sort();
    const releasers: Array<() => void> = [];
    for (const k of uniqueSorted) {
      releasers.push(await this.acquire(k));
    }
    return () => {
      for (let i = releasers.length - 1; i >= 0; i--) {
        releasers[i]();
      }
    };
  }
}

class SimulatedPostgresEngine {
  public db: DbState;
  private locks = new AsyncLockManager();
  public nextFaultStage: FaultStage = null;
  public yieldOnRpcStepMs = 0;

  constructor(initial: Partial<DbState>) {
    this.db = {
      orders: deepClone(initial.orders || []),
      order_items: deepClone(initial.order_items || []),
      products: deepClone(initial.products || []),
      product_variants: deepClone(initial.product_variants || []),
      tiered_prices: deepClone(initial.tiered_prices || []),
      users: deepClone(initial.users || []),
      ledger: deepClone(initial.ledger || []),
      addresses: deepClone(initial.addresses || []),
      store_settings: deepClone(initial.store_settings || []),
    };
  }

  private async maybeYield() {
    if (this.yieldOnRpcStepMs > 0) {
      await new Promise((r) => setTimeout(r, this.yieldOnRpcStepMs));
    } else {
      await Promise.resolve();
    }
  }

  /**
   * Simulates `INSERT INTO public.ledger` with partial unique indexes
   * `uq_ledger_order_refund_credit` and `uq_ledger_order_debit`
   */
  public insertLedgerRow(targetLedger: any[], row: any) {
    if (row.order_id && String(row.type || '').toUpperCase() === 'CREDIT' && String(row.id || '').startsWith('wtx_')) {
      const dup = targetLedger.find(
        (existing) =>
          existing.order_id === row.order_id &&
          String(existing.type || '').toUpperCase() === 'CREDIT' &&
          String(existing.id || '').startsWith('wtx_')
      );
      if (dup) {
        const err: any = new Error(
          `duplicate key value violates unique constraint "uq_ledger_order_refund_credit" (order_id=${row.order_id})`
        );
        err.code = '23505';
        throw err;
      }
    }
    if (row.order_id && String(row.type || '').toUpperCase() === 'DEBIT' && String(row.id || '').startsWith('wtx_')) {
      const dup = targetLedger.find(
        (existing) =>
          existing.order_id === row.order_id &&
          String(existing.type || '').toUpperCase() === 'DEBIT' &&
          String(existing.id || '').startsWith('wtx_')
      );
      if (dup) {
        const err: any = new Error(
          `duplicate key value violates unique constraint "uq_ledger_order_debit" (order_id=${row.order_id})`
        );
        err.code = '23505';
        throw err;
      }
    }
    if (targetLedger.some((existing) => existing.id === row.id)) {
      const err: any = new Error(`duplicate key value violates unique constraint "ledger_pkey" (id=${row.id})`);
      err.code = '23505';
      throw err;
    }
    targetLedger.push(deepClone(row));
  }

  /**
   * Simulates `BEFORE UPDATE ON public.orders` trigger `trg_orders_prevent_cancelled_revival`
   */
  public applyOrderUpdateWithTrigger(oldRow: any, patch: Record<string, any>) {
    const nextRow = { ...oldRow, ...patch };
    if (String(oldRow.status || '').toUpperCase() === 'CANCELLED') {
      if (
        String(nextRow.status || '').toUpperCase() !== 'CANCELLED' ||
        nextRow.payment_status !== oldRow.payment_status ||
        nextRow.is_paid !== oldRow.is_paid ||
        nextRow.notes !== oldRow.notes
      ) {
        const err: any = new Error(`Cancelled order ${oldRow.id} cannot be modified or revived`);
        err.code = 'P0001';
        throw err;
      }
    }
    return nextRow;
  }

  private async runAcidTransaction<T>(
    lockKeysFn: (snapshot: DbState) => string[],
    body: (txDb: DbState) => Promise<T>
  ): Promise<T> {
    // Acquire initial coarse lock keys, re-check, and guarantee ACID commit/rollback via deepClone
    const initialKeys = lockKeysFn(this.db);
    const release = await this.locks.acquireAllSorted(initialKeys);
    const txDb = deepClone(this.db);
    try {
      const result = await body(txDb);
      // Commit
      this.db = txDb;
      return result;
    } catch (err) {
      // Automatic ACID PostgreSQL rollback: discard txDb, keep this.db untouched!
      throw err;
    } finally {
      release();
    }
  }

  private getWalletAdvisoryLockKeys(s: DbState, opts: { userId?: string | null; phones?: Array<string | null | undefined>; fallback?: string | null }) {
    const keys: string[] = [];
    const uidCandidate = String(opts.userId || '').trim();
    const phones = (opts.phones || []).map((p) => normalizePhone10(p)).filter(Boolean);

    const matchedUser =
      (uidCandidate ? s.users.find((u) => u.id === uidCandidate) : null) ||
      phones.map((ph) => s.users.find((u) => phoneVariants(ph).includes(u.phone) && u.role === 'CUSTOMER')).find(Boolean) ||
      null;

    if (matchedUser?.id) {
      keys.push(`wallet:om_wallet_uid:${String(matchedUser.id).toLowerCase()}`);
      const dbPh = normalizePhone10(matchedUser.phone);
      if (dbPh) keys.push(`wallet:om_wallet:${dbPh}`);
    } else if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uidCandidate)) {
      keys.push(`wallet:om_wallet_uid:${uidCandidate.toLowerCase()}`);
    }

    for (const ph of phones) {
      keys.push(`wallet:om_wallet:${ph}`);
    }

    if (keys.length === 0 && opts.fallback) {
      keys.push(`wallet:om_wallet:${opts.fallback}`);
    }
    return Array.from(new Set(keys));
  }

  public async executeRpc(name: string, params: Record<string, any>): Promise<{ data: any; error: any }> {
    try {
      if (this.nextFaultStage === 'missing_rpc') {
        this.nextFaultStage = null;
        return { data: null, error: { code: '42883', message: `Could not find the function public.${name}` } };
      }
      if (name === 'cancel_order_atomic') {
        const res = await this.rpcCancelOrderAtomic(params);
        return { data: res, error: null };
      }
      if (name === 'create_order_with_wallet_atomic') {
        const res = await this.rpcCreateOrderWithWalletAtomic(params);
        return { data: res, error: null };
      }
      if (name === 'update_customer_phone_atomic') {
        const res = await this.rpcUpdateCustomerPhoneAtomic(params);
        return { data: res, error: null };
      }
      if (name === 'debit_wallet_for_order_atomic') {
        const res = await this.rpcDebitWalletAtomic(params);
        return { data: res, error: null };
      }
      if (name === 'transition_order_status_atomic') {
        const res = await this.rpcTransitionOrderStatusAtomic(params);
        return { data: res, error: null };
      }
      return { data: null, error: { code: '42883', message: `Unknown RPC ${name}` } };
    } catch (err: any) {
      return { data: null, error: { code: err?.code || 'P0001', message: err?.message || String(err) } };
    }
  }

  private async rpcCancelOrderAtomic(params: Record<string, any>) {
    const rawOrderId = String(params.p_order_id || '').trim();
    const actorRole = String(params.p_actor_role || '').trim().toUpperCase();
    const customerId = params.p_customer_id ? String(params.p_customer_id) : null;
    const customerPhone = params.p_customer_phone ? String(params.p_customer_phone) : null;
    const nowIso = params.p_now ? String(params.p_now) : new Date().toISOString();

    if (actorRole === 'CUSTOMER') {
      return {
        ok: false,
        statusCode: 403,
        error: 'Forbidden: Customers cannot cancel orders. Only the shopkeeper can cancel orders.',
      };
    }
    if (actorRole !== 'SHOPKEEPER') {
      return { ok: false, statusCode: 401, error: 'Unauthorized: Verified shopkeeper session required to cancel orders.' };
    }
    if (!rawOrderId) {
      return { ok: false, statusCode: 400, error: 'Order ID is required' };
    }

    // Determine lock keys matching SQL migration: orders row, products/variants rows, wallet advisory + user row
    const getLocks = (s: DbState) => {
      const ord = rawOrderId.startsWith('OM-')
        ? s.orders.find((o) => o.order_number === rawOrderId)
        : s.orders.find((o) => o.id === rawOrderId);
      const keys: string[] = ord ? [`order:${ord.id}`] : [`order_lookup:${rawOrderId}`];
      for (const p of s.products) keys.push(`product:${p.id}`);
      for (const pv of s.product_variants) keys.push(`variant:${pv.id}`);
      if (ord) {
        const ledgerUid = s.ledger.find(
          (l) => l.order_id === ord.id && /^[0-9a-f-]{36}$/i.test(String(l.customer_id || ''))
        )?.customer_id;
        keys.push(
          ...this.getWalletAdvisoryLockKeys(s, {
            userId: ord.customer_id || ledgerUid,
            phones: [ord.customer_phone, customerPhone],
            fallback: ord.customer_id || ord.id,
          })
        );
      }
      return keys;
    };

    return this.runAcidTransaction(getLocks, async (txDb) => {
      const ordIdx = rawOrderId.startsWith('OM-')
        ? txDb.orders.findIndex((o) => o.order_number === rawOrderId)
        : txDb.orders.findIndex((o) => o.id === rawOrderId);
      if (ordIdx < 0) {
        return { ok: false, statusCode: 404, error: 'Order not found.' };
      }

      const order = txDb.orders[ordIdx];
      await this.maybeYield();

      const statusUpper = String(order.status || '').toUpperCase();
      if (statusUpper === 'DELIVERED') {
        return { ok: false, statusCode: 400, error: 'Delivered orders cannot be cancelled.' };
      }

      const parsed = parseNotesMeta(order.notes);
      const existingMeta = parsed.meta;
      const resolvedOrdNum = String(order.order_number || parsed.orderNumber || order.id.slice(0, 8)).trim();
      const relItems = txDb.order_items
        .filter((oi) => oi.order_id === order.id)
        .map((oi) => ({
          id: oi.id,
          orderId: oi.order_id,
          productId: oi.product_id,
          variantId: oi.product_variant_id,
          productName: oi.product_name,
          variantName: oi.variant_name,
          unit: oi.unit,
          packSize: Number(oi.pack_size || 1),
          quantity: Number(oi.quantity || 1),
          unitPrice: Number(oi.unit_price || 0),
          price: Number(oi.total_price || 0),
        }));

      if (statusUpper === 'CANCELLED') {
        const walletCredits = txDb.ledger.filter(
          (r) => r.order_id === order.id && r.type === 'CREDIT' && isWalletLedgerRow(r)
        );
        const totalCredited =
          Math.round(walletCredits.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
        const orderOut = relItems.length > 0 ? { ...order, items: relItems } : order;
        return {
          ok: true,
          statusCode: 200,
          alreadyCancelled: true,
          deduplicated: true,
          stockRestored: false,
          restoredItemsCount: 0,
          restoredItems: [],
          refund: {
            amount: totalCredited,
            creditedNow: 0,
            walletUsed: Math.max(0, Number(existingMeta.walletUsedRefund ?? existingMeta.walletAmountUsed ?? 0)),
            onlinePaid: Math.max(0, Number(existingMeta.onlinePaidRefund ?? existingMeta.previousOnlinePaid ?? 0)),
            codPaid: Math.max(0, Number(existingMeta.codPaidRefund ?? existingMeta.codCollected ?? 0)),
            refunded: totalCredited > 0,
            newWalletBalance: Number(
              walletCredits[walletCredits.length - 1]?.balance_after ?? existingMeta.newWalletBalance ?? 0
            ),
            ledgerTransactionId: walletCredits[0]?.id || null,
            description: walletCredits[0]?.description || null,
          },
          order: orderOut,
        };
      }

      // No 15-minute cancellation window restriction for SHOPKEEPER

      const shouldRestoreStock = existingMeta.stockDeducted === true && existingMeta.stockRestored !== true;
      const items = relItems.length > 0 ? relItems : Array.isArray(existingMeta.items) ? existingMeta.items : [];
      const restoredItems: any[] = [];

      if (shouldRestoreStock && items.length > 0) {
        const varDeltas = new Map<string, number>();
        const prodDeltas = new Map<string, number>();

        for (const it of items) {
          const qty = Number(it.quantity) || 0;
          if (qty <= 0) continue;
          if (it.variantId) {
            varDeltas.set(String(it.variantId), (varDeltas.get(String(it.variantId)) || 0) + qty);
          } else if (it.productId) {
            prodDeltas.set(String(it.productId), (prodDeltas.get(String(it.productId)) || 0) + qty);
          }
        }

        const touchedProds = new Set<string>();
        for (const [vid, delta] of Array.from(varDeltas.entries()).sort(([a], [b]) => a.localeCompare(b))) {
          if (this.nextFaultStage === 'variant_update') {
            this.nextFaultStage = null;
            throw new Error('Injected fault at variant_update');
          }
          const v = txDb.product_variants.find((pv) => pv.id === vid);
          if (!v) continue;
          const prev = Number(v.stock_quantity || 0);
          v.stock_quantity = prev + delta;
          v.updated_at = nowIso;
          touchedProds.add(v.product_id);
          const prod = txDb.products.find((p) => p.id === v.product_id);
          restoredItems.push({
            productId: v.product_id,
            variantId: v.id,
            productName: prod?.name || 'Product',
            variantLabel: v.pack_label,
            quantityRestored: delta,
            previousStock: prev,
            newStock: v.stock_quantity,
          });
        }

        for (const pid of Array.from(touchedProds).sort()) {
          if (this.nextFaultStage === 'product_update') {
            this.nextFaultStage = null;
            throw new Error('Injected fault at product_update');
          }
          const p = txDb.products.find((pr) => pr.id === pid);
          if (!p) continue;
          const sumStock = txDb.product_variants
            .filter((pv) => pv.product_id === pid)
            .reduce((s, pv) => s + Number(pv.stock_quantity || 0), 0);
          p.stock = sumStock;
          p.stock_quantity = sumStock;
          p.updated_at = nowIso;
        }

        for (const [pid, delta] of Array.from(prodDeltas.entries()).sort(([a], [b]) => a.localeCompare(b))) {
          if (this.nextFaultStage === 'product_update') {
            this.nextFaultStage = null;
            throw new Error('Injected fault at product_update');
          }
          const p = txDb.products.find((pr) => pr.id === pid);
          if (!p) continue;
          const prev = Number(p.stock_quantity ?? p.stock ?? 0);
          p.stock = prev + delta;
          p.stock_quantity = prev + delta;
          p.updated_at = nowIso;
          restoredItems.push({
            productId: pid,
            variantId: null,
            productName: p.name,
            quantityRestored: delta,
            previousStock: prev,
            newStock: prev + delta,
          });
        }
      }

      // Refund calculation
      const ordLedger = txDb.ledger.filter((r) => r.order_id === order.id);
      const debitTotal = ordLedger
        .filter((r) => r.type === 'DEBIT' && isWalletLedgerRow(r))
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const walletUsed = Math.round(Math.max(debitTotal, Number(existingMeta.walletAmountUsed) || 0) * 100) / 100;
      const finalTotal = Math.max(0, Number(order.final_total ?? order.subtotal ?? 0));
      const pMethod = String(order.payment_method || '').toUpperCase();
      const pStatus = String(order.payment_status || '').toUpperCase();
      const isPaidOrder = order.is_paid === true || pStatus === 'RECEIVED' || pStatus === 'PAID';
      const isAdvance = ['ADVANCE_ONLINE', 'ONLINE', 'UPI'].includes(pMethod);
      const codChargeVal = Math.max(0, Number(existingMeta.codCharge ?? order.cod_charge ?? 0));
      const isNetOfWallet =
        walletUsed > 0 &&
        order.subtotal !== undefined &&
        Math.abs(finalTotal - (Number(order.subtotal) - Number(order.discount_amount || 0) + codChargeVal - walletUsed)) < 2;

      let onlinePaid = 0;
      let codPaid = 0;
      if (isAdvance) {
        if (isPaidOrder) {
          onlinePaid = isNetOfWallet ? finalTotal : Math.max(0, finalTotal - walletUsed);
        } else if (Number(existingMeta.previousOnlinePaid) > 0) {
          onlinePaid = Number(existingMeta.previousOnlinePaid);
        }
      } else {
        const codColl = Math.max(0, Number(existingMeta.codCollected) || 0);
        if (isPaidOrder) codPaid = Math.max(codColl, Math.max(0, finalTotal - walletUsed));
        else if (codColl > 0) codPaid = Math.min(finalTotal, codColl);
      }

      const totalRefundable = Math.round((walletUsed + onlinePaid + codPaid) * 100) / 100;
      const alreadyCredited = ordLedger
        .filter((r) => r.type === 'CREDIT' && isWalletLedgerRow(r))
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const amountToCredit = Math.max(0, Math.round((totalRefundable - alreadyCredited) * 100) / 100);

      const cleanPhone = normalizePhone10(order.customer_phone || customerPhone);
      const variants = phoneVariants(cleanPhone);
      const user =
        txDb.users.find((u) => variants.includes(u.phone) && u.role === 'CUSTOMER') ||
        txDb.users.find((u) => u.id === order.customer_id);

      const aliasIds = new Set(
        [user?.id, order.customer_id, customerId, cleanPhone, cleanPhone ? `user-${cleanPhone}` : '', cleanPhone ? `usr_${cleanPhone}` : ''].filter(Boolean)
      );

      let curWalletBal = Math.max(0, Number(user?.wallet_balance || 0));
      const custLedger = txDb.ledger
        .filter((r) => aliasIds.has(r.customer_id) && isWalletLedgerRow(r))
        .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
      if (custLedger.some((r) => r.type === 'CREDIT')) {
        let rBal = 0;
        for (const r of custLedger) {
          if (r.type === 'CREDIT') rBal += Number(r.amount) || 0;
          else if (r.type === 'DEBIT') rBal = Math.max(0, rBal - (Number(r.amount) || 0));
        }
        curWalletBal = Math.round(rBal * 100) / 100;
      }

      const newWalletBal = Math.round((curWalletBal + amountToCredit) * 100) / 100;
      let txId: string | null = null;
      let refundDesc: string | null = null;

      if (totalRefundable > 0) {
        refundDesc = `Refund for Cancelled Order #${resolvedOrdNum}`;
        if (amountToCredit > 0) {
          if (this.nextFaultStage === 'ledger_insert') {
            this.nextFaultStage = null;
            throw new Error('Injected fault at ledger_insert');
          }
          txId = `wtx_cancel_${order.id}`;
          this.insertLedgerRow(txDb.ledger, {
            id: txId,
            customer_id: user?.id || order.customer_id || `usr_${cleanPhone}`,
            customer_name: order.customer_name || 'Customer',
            order_id: order.id,
            date: nowIso,
            type: 'CREDIT',
            amount: amountToCredit,
            description: refundDesc,
            balance_after: newWalletBal,
          });

          if (user) {
            if (this.nextFaultStage === 'user_wallet_update') {
              this.nextFaultStage = null;
              throw new Error('Injected fault at user_wallet_update');
            }
            user.wallet_balance = newWalletBal;
            user.updated_at = nowIso;
          }
        }
      }

      if (this.nextFaultStage === 'order_finalize') {
        this.nextFaultStage = null;
        throw new Error('Injected fault at order_finalize');
      }

      const finalMeta = {
        ...existingMeta,
        stockDeducted: false,
        stockRestored: shouldRestoreStock ? true : Boolean(existingMeta.stockRestored),
        cancelledAt: nowIso,
        cancelledByRole: actorRole,
        ...(totalRefundable > 0
          ? {
              refundAmountCredited: totalRefundable,
              walletUsedRefund: walletUsed,
              onlinePaidRefund: onlinePaid,
              codPaidRefund: codPaid,
              newWalletBalance: amountToCredit > 0 ? newWalletBal : curWalletBal,
            }
          : {}),
      };

      const nextNotes = `Order #${resolvedOrdNum} | COD_META:${JSON.stringify(finalMeta)}`;
      const updatedOrder = this.applyOrderUpdateWithTrigger(order, {
        status: 'CANCELLED',
        payment_status: totalRefundable > 0 ? 'REFUNDED' : order.payment_status || 'PENDING',
        is_paid: false,
        notes: nextNotes,
        updated_at: nowIso,
      });
      txDb.orders[ordIdx] = updatedOrder;

      return {
        ok: true,
        statusCode: 200,
        alreadyCancelled: false,
        stockRestored: shouldRestoreStock && restoredItems.length > 0,
        restoredItemsCount: restoredItems.length,
        restoredItems,
        refund: {
          amount: totalRefundable,
          creditedNow: amountToCredit,
          walletUsed,
          onlinePaid,
          codPaid,
          refunded: totalRefundable > 0,
          newWalletBalance: amountToCredit > 0 ? newWalletBal : curWalletBal,
          ledgerTransactionId: txId,
          description: refundDesc,
        },
        order: relItems.length > 0 ? { ...updatedOrder, items: relItems } : updatedOrder,
      };
    });
  }

  private async rpcCreateOrderWithWalletAtomic(params: Record<string, any>) {
    const actorRole = String(params.p_actor_role || '').trim().toUpperCase();
    const sessionCid = params.p_session_customer_id ? String(params.p_session_customer_id).trim() : '';
    const sessionPhone = normalizePhone10(params.p_session_phone);
    let cleanPhone = normalizePhone10(params.p_customer_phone);
    let reqCid = params.p_customer_id ? String(params.p_customer_id).trim() : '';

    if (!['CUSTOMER', 'SHOPKEEPER'].includes(actorRole)) {
      return { ok: false, statusCode: 401, error: 'Unauthorized: Verified customer or shopkeeper session is required to place an order.' };
    }

    if (actorRole === 'CUSTOMER') {
      if (sessionPhone.length !== 10 || !sessionCid) {
        return { ok: false, statusCode: 401, error: 'Unauthorized: Valid verified customer session is required.' };
      }
      if (cleanPhone && cleanPhone !== sessionPhone) {
        return { ok: false, statusCode: 403, error: 'Forbidden: You can only place orders for your own verified mobile number.' };
      }
      if (reqCid && reqCid !== sessionCid) {
        return { ok: false, statusCode: 403, error: 'Forbidden: You cannot place an order using another customer ID.' };
      }
      cleanPhone = sessionPhone;
      reqCid = sessionCid;
    } else {
      if (cleanPhone.length !== 10) {
        return { ok: false, statusCode: 400, error: 'Valid 10-digit customer phone number is required for order verification' };
      }
      if (!reqCid) reqCid = `usr_${cleanPhone}`;
    }

    const rawItems = Array.isArray(params.p_items) ? params.p_items : [];
    if (rawItems.length === 0) {
      return { ok: false, statusCode: 400, error: 'Order must contain at least one item' };
    }

    const nowIso = params.p_now ? String(params.p_now) : new Date().toISOString();
    const orderId = String(params.p_order_id || '').trim() || `ord-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const orderNumber = String(params.p_order_number || '').trim() || `OM-${Math.floor(10000 + Math.random() * 90000)}`;
    const isAdvance = ['ADVANCE_ONLINE', 'ONLINE', 'UPI'].includes(String(params.p_payment_method || 'COD').toUpperCase());
    const paymentMethod = isAdvance ? 'ADVANCE_ONLINE' : 'COD';
    const paymentStatus = isAdvance ? 'RECEIVED' : 'PENDING';
    const isPaid = isAdvance;

    const subtotal = Math.round(Math.max(0, Number(params.p_subtotal) || 0) * 100) / 100;
    const discountAmount = isAdvance ? Math.round(Math.max(0, Number(params.p_discount_amount) || 0) * 100) / 100 : 0;
    const deliveryFee = Math.round(Math.max(0, Number(params.p_delivery_fee) || 0) * 100) / 100;
    const codCharge = isAdvance ? 0 : Math.round(Math.max(0, Number(params.p_cod_charge) || 0) * 100) / 100;
    const finalTotal = isAdvance
      ? Math.round(Math.max(0, subtotal + deliveryFee - discountAmount) * 100) / 100
      : Math.round(Math.max(0, subtotal + deliveryFee + codCharge) * 100) / 100;
    const previousOutstanding = isAdvance ? 0 : Math.round(Math.max(0, Number(params.p_previous_outstanding) || 0) * 100) / 100;

    return this.runAcidTransaction(
      (s) =>
        this.getWalletAdvisoryLockKeys(s, {
          userId: reqCid,
          phones: [cleanPhone],
          fallback: reqCid || orderId,
        }),
      async (txDb) => {
        await this.maybeYield();

        const variants = phoneVariants(cleanPhone);
        const user =
          txDb.users.find((u) => variants.includes(u.phone) && u.role === 'CUSTOMER') ||
          txDb.users.find((u) => u.id === reqCid);

        // Idempotency check under lock
        const existingOrd = txDb.orders.find((o) => o.id === orderId);
        if (existingOrd) {
          const exPhone = normalizePhone10(existingOrd.customer_phone);
          if (actorRole === 'CUSTOMER' && exPhone && exPhone !== cleanPhone && existingOrd.customer_id !== (user?.id || reqCid)) {
            return { ok: false, statusCode: 409, error: 'Order ID already exists for another customer.' };
          }
          const exMeta = parseNotesMeta(existingOrd.notes).meta;
          const exRelItems = txDb.order_items.filter((oi) => oi.order_id === existingOrd.id);
          const exItems =
            exRelItems.length > 0
              ? exRelItems.map((oi) => ({
                  id: oi.id,
                  orderId: oi.order_id,
                  productId: oi.product_id,
                  variantId: oi.product_variant_id,
                  productName: oi.product_name,
                  variantName: oi.variant_name,
                  brand: oi.brand,
                  unit: oi.unit,
                  packSize: Number(oi.pack_size || 1),
                  quantity: Number(oi.quantity || 1),
                  unitPrice: Number(oi.unit_price || 0),
                  price: Number(oi.total_price || 0),
                  isDiscountExcluded: Boolean(oi.is_discount_excluded),
                }))
              : Array.isArray(exMeta.items)
              ? exMeta.items
              : [];
          const exDebit = txDb.ledger.find((r) => r.order_id === existingOrd.id && r.type === 'DEBIT' && String(r.id).startsWith('wtx_'));
          const wUsed = Math.round((Number(exDebit?.amount ?? exMeta.walletAmountUsed) || 0) * 100) / 100;
          return {
            ok: true,
            statusCode: 200,
            deduplicated: true,
            ledgerTransactionId: exDebit?.id || null,
            order: {
              id: existingOrd.id,
              orderNumber: existingOrd.order_number,
              customerPhone: existingOrd.customer_phone,
              status: existingOrd.status || 'ORDER_PENDING',
              paymentStatus: existingOrd.payment_status || (existingOrd.is_paid ? 'RECEIVED' : 'PENDING'),
              isPaid: Boolean(existingOrd.is_paid),
              createdAt: existingOrd.created_at,
              previousOutstanding: Number(exMeta.prevOutstanding) || 0,
              subtotal: Number(existingOrd.subtotal) || 0,
              deliveryFee: Math.max(0, Math.round(((Number(existingOrd.final_total) || 0) - (Number(existingOrd.subtotal) || 0) + (Number(existingOrd.discount_amount) || 0) - (Number(exMeta.codCharge) || 0)) * 100) / 100),
              codCharge: Number(exMeta.codCharge) || 0,
              discountAmount: Number(existingOrd.discount_amount) || 0,
              finalAmount: Number(existingOrd.final_total) || 0,
              walletAmountUsed: wUsed,
              totalPayable: exMeta.totalPayable !== undefined ? Number(exMeta.totalPayable) : Math.max(0, (Number(existingOrd.final_total) || 0) - wUsed),
              paymentMethod: existingOrd.payment_method || 'COD',
              items: exItems,
            },
          };
        }

        // Authoritative wallet balance under lock
        const userPhone = normalizePhone10(user?.phone);
        const aliasIds = new Set(
          [
            user?.id,
            reqCid,
            cleanPhone,
            userPhone,
            cleanPhone ? `user-${cleanPhone}` : '',
            cleanPhone ? `usr_${cleanPhone}` : '',
            userPhone ? `user-${userPhone}` : '',
            userPhone ? `usr_${userPhone}` : '',
          ].filter(Boolean)
        );
        let curBal = Math.max(0, Number(user?.wallet_balance || 0));
        const custLedger = txDb.ledger
          .filter((r) => aliasIds.has(r.customer_id) && isWalletLedgerRow(r))
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        if (custLedger.some((r) => r.type === 'CREDIT')) {
          let rBal = 0;
          for (const r of custLedger) {
            if (r.type === 'CREDIT') rBal += Number(r.amount) || 0;
            else if (r.type === 'DEBIT') rBal = Math.max(0, rBal - (Number(r.amount) || 0));
          }
          curBal = Math.round(rBal * 100) / 100;
        }

        let walletUsed = 0;
        if (isAdvance && Boolean(params.p_use_wallet)) {
          if (curBal <= 0) {
            return {
              ok: false,
              statusCode: 409,
              code: 'INSUFFICIENT_WALLET_BALANCE',
              availableBalance: curBal,
              error: `Insufficient live wallet balance (available ₹${curBal}). Please refresh and retry.`,
            };
          }
          const minExp =
            params.p_min_expected_wallet_used !== null && params.p_min_expected_wallet_used !== undefined
              ? Math.round(Number(params.p_min_expected_wallet_used) * 100) / 100
              : 0;
          if (minExp > 0 && curBal + 0.001 < minExp) {
            return {
              ok: false,
              statusCode: 409,
              code: 'INSUFFICIENT_WALLET_BALANCE',
              availableBalance: curBal,
              error: `Insufficient live wallet balance (available ₹${curBal}, required ₹${minExp}). Please refresh and retry.`,
            };
          }
          walletUsed = Math.round(Math.min(curBal, finalTotal) * 100) / 100;
        }

        const finalPayable = Math.max(0, Math.round((finalTotal - walletUsed) * 100) / 100);
        const totalPayable = isAdvance ? finalPayable : finalTotal;
        const previousOnlinePaid = isAdvance ? finalPayable : 0;
        const customerName = String(params.p_customer_name || '').trim() || `Customer (${cleanPhone.slice(-4)})`;
        const shopName = String(params.p_shop_name || '').trim() || customerName;

        const canonicalItems = rawItems.map((it: any, idx: number) => {
          const qty = Number(it.quantity);
          const uPrice = Math.round(Math.max(0, Number(it.unitPrice) || 0) * 100) / 100;
          return {
            id: String(it.id || `item-${orderId}-${idx + 1}`),
            productId: it.productId || null,
            variantId: it.variantId || null,
            productName: it.productName || 'Grocery Item',
            variantName: it.variantName || 'Standard',
            brand: it.brand || null,
            unit: it.unit || 'PIECE',
            packSize: Number(it.packSize) || 1,
            quantity: qty,
            unitPrice: uPrice,
            price: Math.round(uPrice * qty * 100) / 100,
            isDiscountExcluded: Boolean(it.isDiscountExcluded),
          };
        });

        const metaObj = {
          codCollected: 0,
          codCharge,
          codLateFeeApplied: false,
          codLateFeeAmount: 0,
          prevOutstanding: previousOutstanding,
          totalPayable,
          walletAmountUsed: walletUsed,
          previousOnlinePaid,
          stockDeducted: false,
          stockRestored: false,
          items: canonicalItems,
        };
        const notes = `Order #${orderNumber} | COD_META:${JSON.stringify(metaObj)}`;

        if (this.nextFaultStage === 'create_order_insert') {
          this.nextFaultStage = null;
          throw new Error('Injected fault at create_order_insert');
        }
        txDb.orders.push({
          id: orderId,
          order_number: orderNumber,
          customer_id: user?.id || reqCid,
          customer_name: customerName,
          customer_phone: cleanPhone,
          shop_name: shopName,
          'Product Name': params.p_product_name_serialized || '',
          subtotal,
          discount_amount: discountAmount,
          final_total: finalTotal,
          status: 'ORDER_PENDING',
          payment_method: paymentMethod,
          payment_status: paymentStatus,
          is_paid: isPaid,
          address_id: params.p_address_id || null,
          delivery_address: params.p_delivery_address || {},
          preferred_slot: params.p_preferred_slot || nowIso.slice(0, 10),
          notes,
          weight_kg: params.p_weight_kg ?? null,
          razorpay_order_id: isAdvance ? params.p_razorpay_order_id || null : null,
          razorpay_payment_id: isAdvance ? params.p_razorpay_payment_id || null : null,
          created_at: nowIso,
          updated_at: nowIso,
        });

        if (this.nextFaultStage === 'create_order_items_insert') {
          this.nextFaultStage = null;
          throw new Error('Injected fault at create_order_items_insert');
        }
        for (const it of canonicalItems) {
          if (txDb.order_items.some((oi) => oi.id === it.id)) {
            const err: any = new Error(`duplicate key value violates unique constraint "order_items_pkey" (id=${it.id})`);
            err.code = '23505';
            throw err;
          }
          txDb.order_items.push({
            id: it.id,
            order_id: orderId,
            product_id: it.productId,
            product_variant_id: it.variantId,
            product_name: it.productName,
            variant_name: it.variantName,
            brand: it.brand,
            unit: it.unit,
            pack_size: it.packSize,
            quantity: it.quantity,
            unit_price: it.unitPrice,
            total_price: it.price,
            is_discount_excluded: it.isDiscountExcluded,
            created_at: nowIso,
          });
        }

        let newBal = curBal;
        let ledgerTxId: string | null = null;
        if (walletUsed > 0) {
          if (this.nextFaultStage === 'ledger_insert') {
            this.nextFaultStage = null;
            throw new Error('Injected fault at ledger_insert');
          }
          newBal = Math.round(Math.max(0, curBal - walletUsed) * 100) / 100;
          ledgerTxId = `wtx_debit_${orderId}`;
          this.insertLedgerRow(txDb.ledger, {
            id: ledgerTxId,
            customer_id: user?.id || reqCid || `usr_${cleanPhone}`,
            customer_name: customerName,
            order_id: orderId,
            date: nowIso,
            type: 'DEBIT',
            amount: walletUsed,
            description: `Wallet Applied on Order #${orderNumber}`,
            balance_after: newBal,
          });

          if (user) {
            if (this.nextFaultStage === 'user_wallet_update') {
              this.nextFaultStage = null;
              throw new Error('Injected fault at user_wallet_update');
            }
            user.wallet_balance = newBal;
            user.updated_at = nowIso;
          }
        }

        return {
          ok: true,
          statusCode: 201,
          deduplicated: false,
          ledgerTransactionId: ledgerTxId,
          remainingWalletBalance: newBal,
          order: {
            id: orderId,
            orderNumber,
            customerPhone: cleanPhone,
            status: 'ORDER_PENDING',
            paymentStatus,
            isPaid,
            createdAt: nowIso,
            previousOutstanding,
            subtotal,
            deliveryFee,
            codCharge,
            discountAmount,
            finalAmount: finalTotal,
            walletAmountUsed: walletUsed,
            ...(walletUsed > 0 ? { remainingWalletBalance: newBal } : {}),
            totalPayable,
            paymentMethod,
            items: canonicalItems,
          },
        };
      }
    );
  }

  private async rpcUpdateCustomerPhoneAtomic(params: Record<string, any>) {
    const newPhone = normalizePhone10(params.p_new_phone);
    if (!/^[6-9][0-9]{9}$/.test(newPhone)) {
      return { ok: false, statusCode: 400, code: 'INVALID_MOBILE', error: 'Invalid 10-digit Indian mobile number.' };
    }
    const sessPhone = normalizePhone10(params.p_session_phone);
    const reqUid = String(params.p_user_id || '').trim();
    const nowIso = params.p_now ? String(params.p_now) : new Date().toISOString();

    return this.runAcidTransaction(
      (s) =>
        this.getWalletAdvisoryLockKeys(s, {
          userId: reqUid,
          phones: [sessPhone, newPhone],
          fallback: reqUid || sessPhone,
        }),
      async (txDb) => {
        await this.maybeYield();
        const user =
          (reqUid ? txDb.users.find((u) => u.id === reqUid && u.role === 'CUSTOMER') : null) ||
          txDb.users.find((u) => phoneVariants(sessPhone).includes(u.phone) && u.role === 'CUSTOMER');
        if (!user) {
          return { ok: false, statusCode: 404, code: 'NOT_FOUND', error: 'Customer record not found.' };
        }
        const conflict = txDb.users.find(
          (u) => phoneVariants(newPhone).includes(u.phone) && u.id !== user.id
        );
        if (conflict) {
          return { ok: false, statusCode: 409, code: 'DUPLICATE_CUSTOMER', error: 'Duplicate customer mobile.' };
        }
        const prevPhone = normalizePhone10(user.phone);
        user.phone = newPhone;
        user.phone_normalized = `+91${newPhone}`;
        user.updated_at = nowIso;
        if (params.p_update_profile && params.p_name) {
          user.name = String(params.p_name);
        }
        return {
          ok: true,
          statusCode: 200,
          phone: newPhone,
          phoneNormalized: `+91${newPhone}`,
          previousPhone: prevPhone,
          user: deepClone(user),
        };
      }
    );
  }

  private async rpcDebitWalletAtomic(params: Record<string, any>) {
    const orderId = String(params.p_order_id);
    const orderNumber = String(params.p_order_number || orderId.slice(0, 8));
    const customerId = params.p_customer_id ? String(params.p_customer_id) : '';
    const customerName = String(params.p_customer_name || 'Customer');
    const cleanPhone = normalizePhone10(params.p_customer_phone);
    const debitAmt = Math.round(Math.max(0, Number(params.p_requested_amount) || 0) * 100) / 100;
    const nowIso = params.p_now ? String(params.p_now) : new Date().toISOString();

    if (debitAmt <= 0) {
      return { ok: true, statusCode: 200, debitedAmount: 0, newWalletBalance: 0, ledgerTransactionId: null };
    }

    return this.runAcidTransaction(
      (s) =>
        this.getWalletAdvisoryLockKeys(s, {
          userId: customerId,
          phones: [cleanPhone],
          fallback: customerId || orderId,
        }),
      async (txDb) => {
        await this.maybeYield();
        const existingDebit = txDb.ledger.find((r) => r.order_id === orderId && r.type === 'DEBIT');
        if (existingDebit) {
          return {
            ok: true,
            statusCode: 200,
            deduplicated: true,
            debitedAmount: existingDebit.amount,
            newWalletBalance: existingDebit.balance_after,
            ledgerTransactionId: existingDebit.id,
          };
        }

        const variants = phoneVariants(cleanPhone);
        const user =
          txDb.users.find((u) => variants.includes(u.phone) && u.role === 'CUSTOMER') ||
          txDb.users.find((u) => u.id === customerId);

        const aliasIds = new Set(
          [user?.id, customerId, cleanPhone, cleanPhone ? `user-${cleanPhone}` : '', cleanPhone ? `usr_${cleanPhone}` : ''].filter(Boolean)
        );
        let curBal = Math.max(0, Number(user?.wallet_balance || 0));
        const custLedger = txDb.ledger
          .filter((r) => aliasIds.has(r.customer_id) && isWalletLedgerRow(r))
          .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
        if (custLedger.some((r) => r.type === 'CREDIT')) {
          let rBal = 0;
          for (const r of custLedger) {
            if (r.type === 'CREDIT') rBal += Number(r.amount) || 0;
            else if (r.type === 'DEBIT') rBal = Math.max(0, rBal - (Number(r.amount) || 0));
          }
          curBal = Math.round(rBal * 100) / 100;
        }

        if (curBal + 0.001 < debitAmt) {
          return {
            ok: false,
            statusCode: 409,
            code: 'INSUFFICIENT_WALLET_BALANCE',
            availableBalance: curBal,
            error: `Insufficient live wallet balance (available ₹${curBal}, requested ₹${debitAmt}). Please refresh and retry.`,
          };
        }

        const newBal = Math.round(Math.max(0, curBal - debitAmt) * 100) / 100;
        const txId = `wtx_debit_${orderId}`;
        this.insertLedgerRow(txDb.ledger, {
          id: txId,
          customer_id: user?.id || customerId || `usr_${cleanPhone}`,
          customer_name: customerName,
          order_id: orderId,
          date: nowIso,
          type: 'DEBIT',
          amount: debitAmt,
          description: `Wallet Applied on Order #${orderNumber}`,
          balance_after: newBal,
        });

        if (user) {
          user.wallet_balance = newBal;
          user.updated_at = nowIso;
        }

        return {
          ok: true,
          statusCode: 200,
          deduplicated: false,
          debitedAmount: debitAmt,
          newWalletBalance: newBal,
          ledgerTransactionId: txId,
        };
      }
    );
  }

  private async rpcTransitionOrderStatusAtomic(params: Record<string, any>) {
    const rawOrderId = String(params.p_order_id || '').trim();
    const newStatus = params.p_new_status ? String(params.p_new_status).trim() : null;
    const deductStock = Boolean(params.p_deduct_stock);
    const expectedUpdatedAt = params.p_expected_updated_at ? String(params.p_expected_updated_at) : null;
    const nowIso = params.p_now ? String(params.p_now) : new Date().toISOString();

    if (!rawOrderId) {
      return { ok: false, statusCode: 400, error: 'Order ID is required' };
    }

    return this.runAcidTransaction(
      (s) => {
        const ord = rawOrderId.startsWith('OM-')
          ? s.orders.find((o) => o.order_number === rawOrderId)
          : s.orders.find((o) => o.id === rawOrderId);
        const keys: string[] = ord ? [`order:${ord.id}`] : [`order_lookup:${rawOrderId}`];
        if (deductStock) {
          for (const p of s.products) keys.push(`product:${p.id}`);
          for (const pv of s.product_variants) keys.push(`variant:${pv.id}`);
        }
        return keys;
      },
      async (txDb) => {
        const ordIdx = rawOrderId.startsWith('OM-')
          ? txDb.orders.findIndex((o) => o.order_number === rawOrderId)
          : txDb.orders.findIndex((o) => o.id === rawOrderId);
        if (ordIdx < 0) return { ok: false, statusCode: 404, error: 'Order not found.' };

        const order = txDb.orders[ordIdx];
        await this.maybeYield();

        const curStatus = String(order.status || '').toUpperCase();
        const targetStatus = String(newStatus || curStatus).toUpperCase();
        if (curStatus === 'CANCELLED') {
          return { ok: false, statusCode: 409, error: 'Order was already cancelled and cannot be updated.' };
        }
        if (curStatus === 'DELIVERED' && targetStatus !== 'DELIVERED') {
          return { ok: false, statusCode: 409, error: 'Delivered orders cannot change fulfillment status.' };
        }
        if (expectedUpdatedAt && order.updated_at !== expectedUpdatedAt) {
          return { ok: false, statusCode: 409, error: 'Order was updated concurrently. Please refresh and try again.' };
        }

        const parsedOld = parseNotesMeta(order.notes);
        let alreadyDeducted = Boolean(parsedOld.meta.stockDeducted);
        const relItems = txDb.order_items.filter((oi) => oi.order_id === order.id);
        const items =
          relItems.length > 0
            ? relItems.map((oi) => ({
                productId: oi.product_id,
                variantId: oi.product_variant_id,
                quantity: oi.quantity,
              }))
            : Array.isArray(parsedOld.meta.items)
            ? parsedOld.meta.items
            : [];

        if (deductStock && !alreadyDeducted && items.length > 0) {
          const varDeltas = new Map<string, number>();
          const prodDeltas = new Map<string, number>();
          for (const it of items) {
            const qty = Number(it.quantity) || 0;
            if (qty <= 0) continue;
            if (it.variantId) varDeltas.set(String(it.variantId), (varDeltas.get(String(it.variantId)) || 0) + qty);
            else if (it.productId) prodDeltas.set(String(it.productId), (prodDeltas.get(String(it.productId)) || 0) + qty);
          }

          const touched = new Set<string>();
          for (const [vid, delta] of Array.from(varDeltas.entries()).sort(([a], [b]) => a.localeCompare(b))) {
            const v = txDb.product_variants.find((pv) => pv.id === vid);
            if (!v) continue;
            if (Number(v.stock_quantity || 0) < delta) {
              return { ok: false, statusCode: 400, error: `Insufficient stock for variant ${vid}` };
            }
            v.stock_quantity = Number(v.stock_quantity || 0) - delta;
            v.updated_at = nowIso;
            touched.add(v.product_id);
          }
          for (const pid of touched) {
            const p = txDb.products.find((pr) => pr.id === pid);
            if (!p) continue;
            const total = txDb.product_variants
              .filter((pv) => pv.product_id === pid)
              .reduce((s, pv) => s + Number(pv.stock_quantity || 0), 0);
            p.stock = total;
            p.stock_quantity = total;
            p.updated_at = nowIso;
          }
          for (const [pid, delta] of prodDeltas.entries()) {
            const p = txDb.products.find((pr) => pr.id === pid);
            if (!p) continue;
            const cur = Number(p.stock_quantity ?? p.stock ?? 0);
            if (cur < delta) {
              return { ok: false, statusCode: 400, error: `Insufficient stock for product ${pid}` };
            }
            p.stock = cur - delta;
            p.stock_quantity = cur - delta;
            p.updated_at = nowIso;
          }
          alreadyDeducted = true;
        }

        const parsedIn = parseNotesMeta(params.p_notes);
        const mergedMeta = {
          ...parsedOld.meta,
          ...parsedIn.meta,
          ...(alreadyDeducted ? { stockDeducted: true, stockRestored: false } : {}),
        };
        const resolvedNum = String(order.order_number || parsedIn.orderNumber || parsedOld.orderNumber || order.id.slice(0, 8));
        const nextNotes =
          params.p_notes || targetStatus === 'DELIVERED' || deductStock
            ? `Order #${resolvedNum} | COD_META:${JSON.stringify(mergedMeta)}`
            : order.notes;

        const updated = this.applyOrderUpdateWithTrigger(order, {
          status: newStatus || order.status,
          payment_status: params.p_payment_status || order.payment_status,
          is_paid: typeof params.p_is_paid === 'boolean' ? params.p_is_paid : order.is_paid,
          notes: nextNotes,
          updated_at: nowIso,
        });
        txDb.orders[ordIdx] = updated;

        return { ok: true, statusCode: 200, stockDeducted: alreadyDeducted, order: updated };
      }
    );
  }

  /**
   * Minimal PostgREST query builder facade supporting select/insert/update/delete/filters
   * directly against `this.db` with trigger & unique-index enforcement.
   */
  public createSupabaseClient(): SupabaseClient {
    const engine = this;

    const buildQuery = (table: keyof DbState) => {
      const filters: Array<(row: any) => boolean> = [];
      let op: 'select' | 'insert' | 'update' | 'delete' = 'select';
      let insertRows: any[] = [];
      let updatePatch: Record<string, any> = {};
      let orderCol: string | null = null;
      let orderAsc = true;
      let limitVal: number | null = null;
      let singleMode: 'maybeSingle' | 'single' | null = null;
      let wantReturnRows = false;

      const exec = async (): Promise<{ data: any; error: any }> => {
        try {
          const rows = engine.db[table] as any[];
          const matches = () => rows.filter((r) => filters.every((f) => f(r)));

          if (op === 'insert') {
            const inserted: any[] = [];
            for (const row of insertRows) {
              if (table === 'ledger') {
                engine.insertLedgerRow(rows, row);
                inserted.push(deepClone(row));
              } else {
                if (row.id && rows.some((r) => r.id === row.id)) {
                  const err: any = new Error(`duplicate key value violates unique constraint "${table}_pkey"`);
                  err.code = '23505';
                  throw err;
                }
                const clone = deepClone(row);
                rows.push(clone);
                inserted.push(clone);
              }
            }
            return { data: wantReturnRows ? inserted : null, error: null };
          }

          if (op === 'update') {
            const updated: any[] = [];
            for (let i = 0; i < rows.length; i++) {
              if (filters.every((f) => f(rows[i]))) {
                if (table === 'orders') {
                  rows[i] = engine.applyOrderUpdateWithTrigger(rows[i], updatePatch);
                } else {
                  rows[i] = { ...rows[i], ...deepClone(updatePatch) };
                }
                updated.push(deepClone(rows[i]));
              }
            }
            return { data: wantReturnRows ? updated : null, error: null };
          }

          if (op === 'delete') {
            const deleted: any[] = [];
            for (let i = rows.length - 1; i >= 0; i--) {
              if (filters.every((f) => f(rows[i]))) {
                deleted.push(rows[i]);
                rows.splice(i, 1);
              }
            }
            return { data: wantReturnRows ? deleted : null, error: null };
          }

          // Select
          let result = deepClone(matches());
          if (orderCol) {
            const col = orderCol;
            result.sort((a: any, b: any) => {
              const av = a[col] ?? '';
              const bv = b[col] ?? '';
              return orderAsc ? String(av).localeCompare(String(bv)) : String(bv).localeCompare(String(av));
            });
          }
          if (limitVal !== null) {
            result = result.slice(0, limitVal);
          }
          if (singleMode === 'maybeSingle') {
            return { data: result[0] || null, error: null };
          }
          if (singleMode === 'single') {
            return result[0]
              ? { data: result[0], error: null }
              : { data: null, error: { code: 'PGRST116', message: 'Row not found' } };
          }
          return { data: result, error: null };
        } catch (err: any) {
          return { data: null, error: { code: err?.code || 'P0001', message: err?.message || String(err) } };
        }
      };

      const q: any = {
        select(_cols?: string) {
          if (op !== 'select') wantReturnRows = true;
          return q;
        },
        insert(payload: any | any[]) {
          op = 'insert';
          insertRows = Array.isArray(payload) ? payload : [payload];
          return q;
        },
        update(patch: Record<string, any>) {
          op = 'update';
          updatePatch = patch;
          return q;
        },
        delete() {
          op = 'delete';
          return q;
        },
        eq(col: string, val: any) {
          filters.push((r) => r[col] === val);
          return q;
        },
        neq(col: string, val: any) {
          filters.push((r) => r[col] !== val);
          return q;
        },
        is(col: string, val: any) {
          filters.push((r) => (val === null ? r[col] === null || r[col] === undefined : r[col] === val));
          return q;
        },
        in(col: string, vals: any[]) {
          filters.push((r) => vals.includes(r[col]));
          return q;
        },
        like(col: string, pattern: string) {
          const prefix = pattern.replace(/%$/, '');
          filters.push((r) => String(r[col] || '').startsWith(prefix));
          return q;
        },
        or(expr: string) {
          const parts = expr.split(',').map((s) => s.trim());
          filters.push((r) =>
            parts.some((p) => {
              const mEq = p.match(/^([^.]+)\.eq\.(.+)$/);
              if (mEq) return String(r[mEq[1]] ?? '') === mEq[2];
              return false;
            })
          );
          return q;
        },
        order(col: string, opts?: { ascending?: boolean }) {
          orderCol = col;
          orderAsc = opts?.ascending !== false;
          return q;
        },
        limit(n: number) {
          limitVal = n;
          return q;
        },
        maybeSingle() {
          singleMode = 'maybeSingle';
          return q;
        },
        single() {
          singleMode = 'single';
          return q;
        },
        then(resolve: any, reject: any) {
          return exec().then(resolve, reject);
        },
      };
      return q;
    };

    return {
      from(table: string) {
        return buildQuery(table as keyof DbState);
      },
      rpc(name: string, params: Record<string, any> = {}) {
        return engine.executeRpc(name, params);
      },
    } as unknown as SupabaseClient;
  }
}

async function runTests() {
  const results: string[] = [];

  // ---------------------------------------------------------------------------
  // TEST 1: Distributed Concurrent Cancellations Across Independent Instances
  // ---------------------------------------------------------------------------
  {
    const now = new Date().toISOString();
    const engine = new SimulatedPostgresEngine({
      users: [{ id: 'cust-1', name: 'Asha', phone: '9876543210', role: 'CUSTOMER', wallet_balance: 100 }],
      products: [{ id: 'prod-1', name: 'Basmati Rice', stock: 10, stock_quantity: 10 }],
      product_variants: [{ id: 'var-1', product_id: 'prod-1', unit: 'KG', pack_size: 5, pack_label: '5 KG', base_selling_price: 500, mrp: 550, stock_quantity: 10 }],
      orders: [
        {
          id: 'ord-t1',
          order_number: 'OM-1001',
          customer_id: 'cust-1',
          customer_name: 'Asha',
          customer_phone: '9876543210',
          status: 'ORDER_ACCEPTED',
          payment_method: 'ADVANCE_ONLINE',
          payment_status: 'RECEIVED',
          is_paid: true,
          subtotal: 1000,
          discount_amount: 0,
          final_total: 1000,
          notes: 'Order #OM-1001 | COD_META:{"walletAmountUsed":100,"stockDeducted":true,"stockRestored":false}',
          created_at: now,
          updated_at: now,
        },
      ],
      order_items: [
        {
          id: 'oi-1',
          order_id: 'ord-t1',
          product_id: 'prod-1',
          product_variant_id: 'var-1',
          product_name: 'Basmati Rice',
          variant_name: '5 KG',
          unit: 'KG',
          pack_size: 5,
          quantity: 4,
          unit_price: 250,
          total_price: 1000,
        },
      ],
      ledger: [
        { id: 'wtx_init', customer_id: 'cust-1', type: 'CREDIT', amount: 200, description: 'Initial wallet credit', date: new Date(Date.now() - 60000).toISOString(), balance_after: 200 },
        { id: 'wtx_debit_ord-t1', customer_id: 'cust-1', order_id: 'ord-t1', type: 'DEBIT', amount: 100, description: 'Wallet Applied on Order #OM-1001', date: new Date(Date.now() - 30000).toISOString(), balance_after: 100 },
      ],
    });

    engine.yieldOnRpcStepMs = 15;
    // Two independent clients/serverless instances sharing NO memory
    const clientA = engine.createSupabaseClient();
    const clientB = engine.createSupabaseClient();

    const authShop = {
      adminSession: { role: 'SHOPKEEPER' as const, phone: '9999999999', exp: Date.now() + 60000 },
      customerSession: null,
    };

    const [resA, resB] = await Promise.all([
      processCancelOrderRequest(clientA, { id: 'ord-t1' }, authShop),
      processCancelOrderRequest(clientB, { id: 'ord-t1' }, authShop),
    ]);

    assert.equal(resA.statusCode, 200);
    assert.equal(resB.statusCode, 200);
    assert.equal(resA.payload.success, true);
    assert.equal(resB.payload.success, true);

    const freshWinners = [resA, resB].filter((r) => !r.payload.alreadyCancelled);
    const idempotentWaiters = [resA, resB].filter((r) => r.payload.alreadyCancelled);
    assert.equal(freshWinners.length, 1, 'Exactly one concurrent caller should perform cancellation');
    assert.equal(idempotentWaiters.length, 1, 'Second concurrent caller must wait and receive committed idempotent result');
    assert.equal(freshWinners[0].payload.stockRestored, true);
    assert.equal(freshWinners[0].payload.refund?.creditedNow, 1000);
    assert.equal(idempotentWaiters[0].payload.stockRestored, false);
    assert.equal(idempotentWaiters[0].payload.refund?.creditedNow, 0);
    assert.equal(idempotentWaiters[0].payload.refund?.amount, 1000);

    // Final DB invariants
    assert.equal(engine.db.product_variants[0].stock_quantity, 14, 'Stock must be restored ONCE (10 + 4 = 14)');
    assert.equal(engine.db.products[0].stock_quantity, 14);
    assert.equal(engine.db.users[0].wallet_balance, 1100, 'Wallet balance must be 100 + 1000 = 1100');
    const creditRows = engine.db.ledger.filter((r) => r.order_id === 'ord-t1' && r.type === 'CREDIT');
    assert.equal(creditRows.length, 1, 'Exactly ONE refund CREDIT row in ledger');
    results.push('PASS Test 1: Distributed concurrent cancellations serialize & prevent duplicate stock/refund');
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Concurrent Shared-SKU Stock Restoration + Shopkeeper Acceptance Deduction
  // ---------------------------------------------------------------------------
  {
    const now = new Date().toISOString();
    const engine = new SimulatedPostgresEngine({
      users: [{ id: 'cust-2', name: 'Ravi', phone: '9111111111', role: 'CUSTOMER', wallet_balance: 0 }],
      products: [{ id: 'prod-s', name: 'Sugar', stock: 10, stock_quantity: 10 }],
      product_variants: [{ id: 'var-s', product_id: 'prod-s', unit: 'KG', pack_size: 1, pack_label: '1 KG', base_selling_price: 50, mrp: 60, stock_quantity: 10 }],
      orders: [
        {
          id: 'ord-c1',
          order_number: 'OM-2001',
          customer_id: 'cust-2',
          customer_phone: '9111111111',
          status: 'ORDER_ACCEPTED',
          payment_method: 'COD',
          payment_status: 'PENDING',
          is_paid: false,
          subtotal: 150,
          final_total: 150,
          notes: 'Order #OM-2001 | COD_META:{"stockDeducted":true,"stockRestored":false}',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'ord-acc',
          order_number: 'OM-2002',
          customer_id: 'cust-2',
          customer_phone: '9111111111',
          status: 'ORDER_PENDING',
          payment_method: 'COD',
          payment_status: 'PENDING',
          is_paid: false,
          subtotal: 100,
          final_total: 100,
          notes: 'Order #OM-2002 | COD_META:{"stockDeducted":false,"stockRestored":false}',
          created_at: now,
          updated_at: now,
        },
        {
          id: 'ord-c2',
          order_number: 'OM-2003',
          customer_id: 'cust-2',
          customer_phone: '9111111111',
          status: 'ORDER_ACCEPTED',
          payment_method: 'COD',
          payment_status: 'PENDING',
          is_paid: false,
          subtotal: 200,
          final_total: 200,
          notes: 'Order #OM-2003 | COD_META:{"stockDeducted":true,"stockRestored":false}',
          created_at: now,
          updated_at: now,
        },
      ],
      order_items: [
        { id: 'oi-c1', order_id: 'ord-c1', product_id: 'prod-s', product_variant_id: 'var-s', product_name: 'Sugar', variant_name: '1 KG', unit: 'KG', pack_size: 1, quantity: 3, unit_price: 50, total_price: 150 },
        { id: 'oi-acc', order_id: 'ord-acc', product_id: 'prod-s', product_variant_id: 'var-s', product_name: 'Sugar', variant_name: '1 KG', unit: 'KG', pack_size: 1, quantity: 2, unit_price: 50, total_price: 100 },
        { id: 'oi-c2', order_id: 'ord-c2', product_id: 'prod-s', product_variant_id: 'var-s', product_name: 'Sugar', variant_name: '1 KG', unit: 'KG', pack_size: 1, quantity: 4, unit_price: 50, total_price: 200 },
      ],
    });

    engine.yieldOnRpcStepMs = 10;
    const shopAuth = { adminSession: { role: 'SHOPKEEPER' as const, phone: '9999999999', exp: Date.now() + 60000 }, customerSession: null };

    const [r1, r2, r3] = await Promise.all([
      processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-c1' }, shopAuth),
      processUpdateOrderRequest(engine.createSupabaseClient(), { id: 'ord-acc', status: 'ORDER_ACCEPTED', deductStockOnAccept: true }, shopAuth),
      processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-c2' }, shopAuth),
    ]);

    assert.equal(r1.statusCode, 200);
    assert.equal(r2.statusCode, 200);
    assert.equal(r3.statusCode, 200);
    assert.equal(r2.payload.stockDeducted, true);
    assert.equal(engine.db.product_variants[0].stock_quantity, 15, 'Shared SKU final stock must be 10 + 3 - 2 + 4 = 15 with zero lost updates');
    results.push('PASS Test 2: Shared-SKU concurrent restorations & acceptance deduction preserve exact stock (15)');
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Concurrent Wallet Credit + Debit & Double-Spend Prevention
  // ---------------------------------------------------------------------------
  {
    const now = new Date().toISOString();
    const engine = new SimulatedPostgresEngine({
      users: [{ id: 'cust-w', name: 'Meera', phone: '9222222222', role: 'CUSTOMER', wallet_balance: 500 }],
      products: [{ id: 'prod-w', name: 'Ghee', brand: 'Om', price: 200, stock: 50, stock_quantity: 50, is_discount_excluded: false }],
      product_variants: [{ id: 'var-w', product_id: 'prod-w', unit: 'KG', pack_size: 1, pack_label: '1 KG', base_selling_price: 200, mrp: 220, stock_quantity: 50 }],
      store_settings: [{ id: 'global_settings', advance_discount_percentage: 0, cod_base_charge: 0, free_shipping_min_amount: 0, base_delivery_fee: 0 }],
      orders: [
        {
          id: 'ord-refund',
          order_number: 'OM-3001',
          customer_id: 'cust-w',
          customer_name: 'Meera',
          customer_phone: '9222222222',
          status: 'ORDER_PENDING',
          payment_method: 'ADVANCE_ONLINE',
          payment_status: 'RECEIVED',
          is_paid: true,
          subtotal: 200,
          discount_amount: 0,
          final_total: 200,
          notes: 'Order #OM-3001 | COD_META:{"walletAmountUsed":0,"stockDeducted":false}',
          created_at: now,
          updated_at: now,
        },
      ],
      ledger: [
        { id: 'wtx_seed_w', customer_id: 'cust-w', type: 'CREDIT', amount: 500, description: 'Wallet topup', date: new Date(Date.now() - 60000).toISOString(), balance_after: 500 },
      ],
    });

    engine.yieldOnRpcStepMs = 15;
    const custAuth = { adminSession: null, customerSession: { role: 'CUSTOMER' as const, customerId: 'cust-w', phone: '9222222222', name: 'Meera', exp: Date.now() + 60000 } };
    const shopAuth = { adminSession: { role: 'SHOPKEEPER' as const, phone: '9999999999', exp: Date.now() + 60000 }, customerSession: null };

    // Case 3a: Concurrent refund +200 (cancel_order_atomic by Shopkeeper) and spend -200 (processCreateOrderRequest)
    const [cancelRes, createRes] = await Promise.all([
      processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-refund' }, shopAuth),
      processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: 'ord-new-1',
          orderNumber: 'OM-3002',
          customerId: 'cust-w',
          customerName: 'Meera',
          customerPhone: '9222222222',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Shop 1, Jaipur', pincode: '302001' },
          items: [{ productId: 'prod-w', variantId: 'var-w', quantity: 1 }],
        },
        custAuth
      ),
    ]);

    assert.equal(cancelRes.statusCode, 200);
    assert.equal(createRes.statusCode, 201);
    assert.equal(engine.db.users[0].wallet_balance, 500, 'Wallet 500 + 200 - 200 must equal exact 500');

    // Case 3b: Two concurrent orders each requesting ₹400 from ₹500 balance -> 1 wins (400), 1 gets 409 and deletes orphan order
    const [spend1, spend2] = await Promise.all([
      processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: 'ord-ds-1',
          orderNumber: 'OM-3003',
          customerId: 'cust-w',
          customerName: 'Meera',
          customerPhone: '9222222222',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Shop 1, Jaipur', pincode: '302001' },
          items: [{ productId: 'prod-w', variantId: 'var-w', quantity: 2 }],
        },
        custAuth
      ),
      processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: 'ord-ds-2',
          orderNumber: 'OM-3004',
          customerId: 'cust-w',
          customerName: 'Meera',
          customerPhone: '9222222222',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Shop 1, Jaipur', pincode: '302001' },
          items: [{ productId: 'prod-w', variantId: 'var-w', quantity: 2 }],
        },
        custAuth
      ),
    ]);

    const okSpends = [spend1, spend2].filter((r) => r.statusCode === 201);
    const rejectedSpends = [spend1, spend2].filter((r) => r.statusCode === 409);
    assert.equal(okSpends.length, 1, 'Only ONE ₹400 spend can succeed out of ₹500 balance');
    assert.equal(rejectedSpends.length, 1, 'Second ₹400 spend must fail with 409 Conflict');
    assert.equal(rejectedSpends[0].payload.code, 'INSUFFICIENT_WALLET_BALANCE');
    assert.equal(engine.db.users[0].wallet_balance, 100, 'Remaining wallet balance must be exact ₹100');

    // Verify rejected order row was cleaned up
    const winnerId = okSpends[0].payload.order.id;
    const loserId = winnerId === 'ord-ds-1' ? 'ord-ds-2' : 'ord-ds-1';
    assert.equal(engine.db.orders.some((o) => o.id === loserId), false, 'Rejected double-spend order must be cleaned up');
    results.push('PASS Test 3: Concurrent wallet credit/debit & double-spend prevention work atomically');
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Atomic Rollback on Failure at Every Stage
  // ---------------------------------------------------------------------------
  {
    const faultStages: FaultStage[] = [
      'variant_update',
      'product_update',
      'ledger_insert',
      'user_wallet_update',
      'order_finalize',
    ];
    const now = new Date().toISOString();
    const engine = new SimulatedPostgresEngine({
      users: [{ id: 'cust-f', name: 'Kiran', phone: '9333333333', role: 'CUSTOMER', wallet_balance: 50 }],
      products: [{ id: 'prod-f', name: 'Dal', stock: 8, stock_quantity: 8 }],
      product_variants: [{ id: 'var-f', product_id: 'prod-f', unit: 'KG', pack_size: 2, pack_label: '2 KG', base_selling_price: 200, mrp: 220, stock_quantity: 8 }],
      orders: [
        {
          id: 'ord-f',
          order_number: 'OM-4001',
          customer_id: 'cust-f',
          customer_name: 'Kiran',
          customer_phone: '9333333333',
          status: 'ORDER_ACCEPTED',
          payment_method: 'ADVANCE_ONLINE',
          payment_status: 'RECEIVED',
          is_paid: true,
          subtotal: 400,
          discount_amount: 0,
          final_total: 400,
          notes: 'Order #OM-4001 | COD_META:{"walletAmountUsed":50,"stockDeducted":true,"stockRestored":false}',
          created_at: now,
          updated_at: now,
        },
      ],
      order_items: [
        { id: 'oi-f', order_id: 'ord-f', product_id: 'prod-f', product_variant_id: 'var-f', product_name: 'Dal', variant_name: '2 KG', unit: 'KG', pack_size: 2, quantity: 2, unit_price: 200, total_price: 400 },
      ],
      ledger: [
        { id: 'wtx_f_seed', customer_id: 'cust-f', type: 'CREDIT', amount: 100, description: 'Seed', date: new Date(Date.now() - 50000).toISOString(), balance_after: 100 },
        { id: 'wtx_debit_ord-f', customer_id: 'cust-f', order_id: 'ord-f', type: 'DEBIT', amount: 50, description: 'Wallet Applied', date: new Date(Date.now() - 20000).toISOString(), balance_after: 50 },
      ],
    });

    const auth = { adminSession: { role: 'SHOPKEEPER' as const, phone: '9999999999', exp: Date.now() + 60000 }, customerSession: null };

    for (const stage of faultStages) {
      engine.nextFaultStage = stage;
      const failRes = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-f' }, auth);
      assert.equal(failRes.statusCode, 500, `Fault at ${stage} must return 500`);
      assert.equal(failRes.payload.success, false);
      // Verify 0 partial changes committed
      assert.equal(engine.db.orders[0].status, 'ORDER_ACCEPTED', `After ${stage} rollback, order status unchanged`);
      assert.equal(engine.db.product_variants[0].stock_quantity, 8, `After ${stage} rollback, variant stock unchanged`);
      assert.equal(engine.db.products[0].stock_quantity, 8, `After ${stage} rollback, product stock unchanged`);
      assert.equal(engine.db.users[0].wallet_balance, 50, `After ${stage} rollback, user wallet unchanged`);
      assert.equal(engine.db.ledger.filter((r) => r.order_id === 'ord-f' && r.type === 'CREDIT').length, 0, `After ${stage} rollback, zero ledger refund row`);
    }

    // Retry cleanly after failures -> full recovery!
    const okRes = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-f' }, auth);
    assert.equal(okRes.statusCode, 200);
    assert.equal(okRes.payload.success, true);
    assert.equal(okRes.payload.stockRestored, true);
    assert.equal(engine.db.orders[0].status, 'CANCELLED');
    assert.equal(engine.db.product_variants[0].stock_quantity, 10);
    assert.equal(engine.db.users[0].wallet_balance, 450);
    results.push('PASS Test 4: All 5 injected failure stages roll back 100% atomically and retry recovers cleanly');
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Crash / Retry Idempotency
  // ---------------------------------------------------------------------------
  {
    const now = new Date().toISOString();
    const engine = new SimulatedPostgresEngine({
      users: [{ id: 'cust-i', name: 'Sita', phone: '9444444444', role: 'CUSTOMER', wallet_balance: 0 }],
      orders: [
        {
          id: 'ord-idem',
          order_number: 'OM-5001',
          customer_id: 'cust-i',
          customer_phone: '9444444444',
          status: 'ORDER_PENDING',
          payment_method: 'ADVANCE_ONLINE',
          payment_status: 'RECEIVED',
          is_paid: true,
          subtotal: 300,
          final_total: 300,
          notes: 'Order #OM-5001 | COD_META:{"stockDeducted":false}',
          created_at: now,
          updated_at: now,
        },
      ],
    });
    const auth = { adminSession: { role: 'SHOPKEEPER' as const, phone: '9999999999', exp: Date.now() + 60000 }, customerSession: null };

    const first = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-idem' }, auth);
    const retry = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-idem' }, auth);

    assert.equal(first.statusCode, 200);
    assert.equal(first.payload.alreadyCancelled, false);
    assert.equal(first.payload.refund?.creditedNow, 300);

    assert.equal(retry.statusCode, 200);
    assert.equal(retry.payload.alreadyCancelled, true);
    assert.equal(retry.payload.deduplicated, true);
    assert.equal(retry.payload.refund?.creditedNow, 0);
    assert.equal(retry.payload.refund?.amount, 300);
    assert.equal(retry.payload.refund?.refunded, true);
    assert.equal(retry.payload.refund?.newWalletBalance, 300);
    assert.equal(retry.payload.refund?.ledgerTransactionId, 'wtx_cancel_ord-idem');
    assert.equal(engine.db.users[0].wallet_balance, 300);
    results.push('PASS Test 5: Retry after simulated lost response returns exact committed idempotent state');
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Revival Prevention (Shopkeeper Update & COD Collection vs Cancellation)
  // ---------------------------------------------------------------------------
  {
    const now = new Date().toISOString();
    const engine = new SimulatedPostgresEngine({
      users: [{ id: 'cust-r', name: 'Mohan', phone: '9555555555', role: 'CUSTOMER', wallet_balance: 0, outstanding_balance: 500 }],
      orders: [
        {
          id: 'ord-rev',
          order_number: 'OM-6001',
          customer_id: 'cust-r',
          customer_name: 'Mohan',
          customer_phone: '9555555555',
          status: 'ORDER_PENDING',
          payment_method: 'COD',
          payment_status: 'PENDING',
          is_paid: false,
          subtotal: 500,
          final_total: 500,
          notes: 'Order #OM-6001 | COD_META:{"stockDeducted":false}',
          created_at: now,
          updated_at: now,
        },
      ],
    });

    const shopAuth = { adminSession: { role: 'SHOPKEEPER' as const, phone: '9999999999', exp: Date.now() + 60000 }, customerSession: null };

    // Cancel first (by Shopkeeper)
    const cancelRes = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-rev' }, shopAuth);
    assert.equal(cancelRes.statusCode, 200);

    // Shopkeeper attempts to accept cancelled order -> 409 Conflict
    const acceptRes = await processUpdateOrderRequest(
      engine.createSupabaseClient(),
      { id: 'ord-rev', status: 'ORDER_ACCEPTED', deductStockOnAccept: true },
      shopAuth
    );
    assert.equal(acceptRes.statusCode, 409);
    assert.equal(engine.db.orders[0].status, 'CANCELLED');

    // COD collection attempts to mark cancelled order delivered/paid -> 409 Conflict
    const codRes = await processCodCollectionPost(engine.createSupabaseClient(), {
      orderId: 'ord-rev',
      orderNumber: 'OM-6001',
      customerPhone: '9555555555',
      customerId: 'cust-r',
      collectedAmount: 500,
      markAsDelivered: true,
    });
    assert.equal(codRes.statusCode, 409);
    assert.equal(engine.db.orders[0].status, 'CANCELLED');
    assert.equal(engine.db.ledger.filter((r) => r.order_id === 'ord-rev' && String(r.id).startsWith('cod_tx_')).length, 0);

    // Direct table update revival blocked by DB trigger trg_orders_prevent_cancelled_revival
    const directRes = await engine
      .createSupabaseClient()
      .from('orders')
      .update({ status: 'DELIVERED', is_paid: true })
      .eq('id', 'ord-rev');
    assert.ok(directRes.error, 'Trigger guard must block direct updates reviving CANCELLED orders');
    results.push('PASS Test 6: Shopkeeper updates, COD collections, and direct updates cannot revive CANCELLED orders');
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Shopkeeper-Only Cancellation, Customer 403 Block (Even Within 15m), & No Shopkeeper Time Limit
  // ---------------------------------------------------------------------------
  {
    const now = new Date().toISOString();
    const sixteenMinsAgo = new Date(Date.now() - 16 * 60 * 1000).toISOString();
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const engine = new SimulatedPostgresEngine({
      orders: [
        { id: 'ord-a1', order_number: 'OM-7001', customer_id: 'cust-A', customer_phone: '9666666661', status: 'ORDER_PENDING', payment_method: 'COD', payment_status: 'PENDING', created_at: now, updated_at: now },
        { id: 'ord-a2', order_number: 'OM-7002', customer_id: 'cust-A', customer_phone: '9666666661', status: 'ORDER_PENDING', payment_method: 'COD', payment_status: 'PENDING', created_at: sixteenMinsAgo, updated_at: sixteenMinsAgo },
        { id: 'ord-a3', order_number: 'OM-7003', customer_id: 'cust-A', customer_phone: '9666666661', status: 'DELIVERED', payment_method: 'COD', payment_status: 'RECEIVED', created_at: now, updated_at: now },
        { id: 'ord-a4', order_number: 'OM-7004', customer_id: 'cust-A', customer_phone: '9666666661', status: 'PACKING_IN_PROGRESS', payment_method: 'COD', payment_status: 'PENDING', created_at: twoDaysAgo, updated_at: twoDaysAgo },
      ],
    });

    const unauth = { adminSession: null, customerSession: null };
    const custB = { adminSession: null, customerSession: { role: 'CUSTOMER' as const, customerId: 'cust-B', phone: '9777777777', name: 'Other', exp: Date.now() + 60000 } };
    const custA = { adminSession: null, customerSession: { role: 'CUSTOMER' as const, customerId: 'cust-A', phone: '9666666661', name: 'Owner', exp: Date.now() + 60000 } };
    const shop = { adminSession: { role: 'SHOPKEEPER' as const, phone: '9999999999', exp: Date.now() + 60000 }, customerSession: null };

    const rUnauth = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-a1' }, unauth);
    assert.equal(rUnauth.statusCode, 401);

    // Owner Customer CANNOT cancel even within 15 minutes (via processCancelOrderRequest or processUpdateOrderRequest)
    const rOwnerFreshCancel = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-a1' }, custA);
    assert.equal(rOwnerFreshCancel.statusCode, 403);
    assert.equal(engine.db.orders[0].status, 'ORDER_PENDING');

    const rOwnerPutCancel = await processUpdateOrderRequest(
      engine.createSupabaseClient(),
      { id: 'ord-a1', status: 'CANCELLED' },
      custA
    );
    assert.equal(rOwnerPutCancel.statusCode, 403);
    assert.equal(engine.db.orders[0].status, 'ORDER_PENDING');

    // Other Customer CANNOT cancel -> 403
    const rOther = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-a1' }, custB);
    assert.equal(rOther.statusCode, 403);

    // Owner Customer CANNOT cancel after 15 minutes -> 403
    const rExpiredCust = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-a2' }, custA);
    assert.equal(rExpiredCust.statusCode, 403);

    // Direct RPC call with CUSTOMER actor -> 403
    const rDirectRpcCust = await engine.executeRpc('cancel_order_atomic', {
      p_order_id: 'ord-a1',
      p_actor_role: 'CUSTOMER',
      p_customer_id: 'cust-A',
      p_customer_phone: '9666666661',
    });
    assert.equal(rDirectRpcCust.data?.statusCode, 403);
    assert.equal(rDirectRpcCust.data?.ok, false);

    // Shopkeeper CAN cancel eligible orders at any time (within 15m, after 16m, after 48h)
    const rFreshShop = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-a1' }, shop);
    assert.equal(rFreshShop.statusCode, 200);

    const rExpiredShop = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-a2' }, shop);
    assert.equal(rExpiredShop.statusCode, 200);

    const rOldShop = await processUpdateOrderRequest(
      engine.createSupabaseClient(),
      { id: 'ord-a4', status: 'CANCELLED' },
      shop
    );
    assert.equal(rOldShop.statusCode, 200);

    // Delivered orders still cannot be cancelled even by Shopkeeper
    const rDelivered = await processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-a3' }, shop);
    assert.equal(rDelivered.statusCode, 400);
    results.push('PASS Test 7: 401 unauth, Customer 403 (even <15m), Shopkeeper unlimited window, 400 delivered checks');
  }

  // ---------------------------------------------------------------------------
  // TEST 8: SQL Migration & Source Hygiene Assertions
  // ---------------------------------------------------------------------------
  {
    const rootDir = path.resolve(process.cwd());
    const sql = fs.readFileSync(path.join(rootDir, 'supabase_order_cancellation_atomic_v2.sql'), 'utf8');
    assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.cancel_order_atomic'), 'Missing cancel_order_atomic');
    assert.ok(sql.includes("IF v_actor_role = 'CUSTOMER' THEN"), 'Missing explicit CUSTOMER 403 rejection in cancel_order_atomic');
    assert.ok(sql.includes("IF v_actor_role <> 'SHOPKEEPER' THEN"), 'Missing SHOPKEEPER-only guard in cancel_order_atomic');
    assert.equal(sql.includes('The 15-minute cancellation window for this order has expired.'), false, 'Legacy 15-min cancellation error must be removed from SQL');
    assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.debit_wallet_for_order_atomic'), 'Missing debit_wallet_for_order_atomic');
    assert.ok(sql.includes('CREATE OR REPLACE FUNCTION public.transition_order_status_atomic'), 'Missing transition_order_status_atomic');
    assert.ok(sql.includes('uq_ledger_order_refund_credit'), 'Missing partial unique index uq_ledger_order_refund_credit');
    assert.ok(sql.includes('trg_orders_prevent_cancelled_revival'), 'Missing trigger trg_orders_prevent_cancelled_revival');
    assert.ok(sql.includes('pg_advisory_xact_lock'), 'Missing transaction advisory wallet lock');
    assert.ok(sql.includes('FOR UPDATE'), 'Missing PostgreSQL FOR UPDATE row locks');
    assert.ok(sql.includes('GRANT EXECUTE ON FUNCTION public.cancel_order_atomic') && sql.includes('TO service_role'), 'Missing service_role execute grant');

    const cancelTs = fs.readFileSync(path.join(rootDir, 'api/_orderCancellation.ts'), 'utf8');
    assert.equal(cancelTs.includes('orderCancellationQueues'), false, 'Legacy JS lock map must be removed');
    assert.equal(cancelTs.includes('executeCompensatingRollback'), false, 'Legacy JS snapshot rollback must be removed');
    assert.ok(cancelTs.includes("supabase.rpc('cancel_order_atomic'"), 'api/_orderCancellation.ts must call cancel_order_atomic RPC');
    assert.ok(cancelTs.includes("p_actor_role: 'SHOPKEEPER'"), 'api/_orderCancellation.ts must pass SHOPKEEPER actor role only');

    const creationSql = fs.readFileSync(path.join(rootDir, 'supabase_order_creation_atomic_v2.sql'), 'utf8');
    assert.ok(creationSql.includes('CREATE OR REPLACE FUNCTION public.create_order_with_wallet_atomic'), 'Missing create_order_with_wallet_atomic');
    assert.ok(creationSql.includes('CREATE OR REPLACE FUNCTION public.update_customer_phone_atomic'), 'Missing update_customer_phone_atomic');
    assert.ok(creationSql.includes('CREATE OR REPLACE FUNCTION public._acquire_customer_wallet_locks'), 'Missing _acquire_customer_wallet_locks');
    assert.ok(creationSql.includes('uq_ledger_order_debit'), 'Missing partial unique index uq_ledger_order_debit');
    assert.ok(creationSql.includes('SECURITY DEFINER') && creationSql.includes('SET search_path = public, pg_catalog'), 'Missing hardened SECURITY DEFINER search_path');
    assert.ok(creationSql.includes('GRANT EXECUTE ON FUNCTION public.create_order_with_wallet_atomic') && creationSql.includes('TO service_role'), 'Missing service_role execute grant on create_order_with_wallet_atomic');

    const ordersTs = fs.readFileSync(path.join(rootDir, 'api/orders.ts'), 'utf8');
    assert.ok(ordersTs.includes("supabase.rpc(\n    'create_order_with_wallet_atomic'") || ordersTs.includes("supabase.rpc('create_order_with_wallet_atomic'"), 'api/orders.ts must call create_order_with_wallet_atomic');
    assert.equal(ordersTs.includes("from('orders').insert("), false, 'Legacy split orders.insert must be removed from api/orders.ts');
    assert.equal(ordersTs.includes('debit_wallet_for_order_atomic'), false, 'Legacy split debit_wallet_for_order_atomic call must be removed from api/orders.ts');

    const authTs = fs.readFileSync(path.join(rootDir, 'api/auth/[action].ts'), 'utf8');
    assert.ok(authTs.includes('update_customer_phone_atomic'), 'api/auth/[action].ts must serialize phone updates via update_customer_phone_atomic');

    results.push('PASS Test 8: SQL migrations & TypeScript atomic order creation/cancellation modules verified');
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Atomic Order Creation - Insufficient Balance, Partial Wallet, Zero Wallet & Anti-Spoofing
  // ---------------------------------------------------------------------------
  {
    const engine = new SimulatedPostgresEngine({
      users: [{ id: '11111111-1111-1111-1111-111111111111', name: 'Asha', phone: '9888888881', role: 'CUSTOMER', wallet_balance: 150 }],
      products: [{ id: 'prod-p9', name: 'Atta', brand: 'Om', price: 200, stock: 50, stock_quantity: 50, is_discount_excluded: false }],
      product_variants: [{ id: 'var-p9', product_id: 'prod-p9', unit: 'KG', pack_size: 5, pack_label: '5 KG', base_selling_price: 200, mrp: 220, stock_quantity: 50 }],
      store_settings: [{ id: 'global_settings', advance_discount_percentage: 0, cod_base_charge: 0, free_shipping_min_amount: 0, base_delivery_fee: 0 }],
      ledger: [
        { id: 'wtx_seed_9', customer_id: '11111111-1111-1111-1111-111111111111', type: 'CREDIT', amount: 150, description: 'Wallet topup', date: new Date(Date.now() - 60000).toISOString(), balance_after: 150 },
      ],
    });
    const custAuth = {
      adminSession: null,
      customerSession: { role: 'CUSTOMER' as const, customerId: '11111111-1111-1111-1111-111111111111', phone: '9888888881', name: 'Asha', exp: Date.now() + 60000 },
    };

    // 9a: Zero-wallet COD order -> 201, zero ledger rows inserted, wallet balance untouched (150)
    const zeroWalletRes = await processCreateOrderRequest(
      engine.createSupabaseClient(),
      {
        orderId: 'ord-zw-1',
        orderNumber: 'OM-9001',
        paymentMethod: 'COD',
        useWallet: false,
        walletAmountUsed: 999, // spoof attempt must be ignored
        finalAmount: 1,       // spoof attempt must be ignored
        address: { fullAddress: 'Shop 2, Nashik', pincode: '422001' },
        items: [{ productId: 'prod-p9', variantId: 'var-p9', quantity: 2 }],
      },
      custAuth
    );
    assert.equal(zeroWalletRes.statusCode, 201);
    assert.equal(zeroWalletRes.payload.order.finalAmount, 400);
    assert.equal(zeroWalletRes.payload.order.walletAmountUsed, 0);
    assert.equal(zeroWalletRes.payload.order.totalPayable, 400);
    assert.equal(engine.db.users[0].wallet_balance, 150);
    assert.equal(engine.db.ledger.filter((r) => r.order_id === 'ord-zw-1').length, 0);
    assert.equal(engine.db.order_items.filter((i) => i.order_id === 'ord-zw-1').length, 1);

    // 9b: Partial wallet payment (150 wallet + 250 online on 400 order)
    const partialRes = await processCreateOrderRequest(
      engine.createSupabaseClient(),
      {
        orderId: 'ord-pw-1',
        orderNumber: 'OM-9002',
        paymentMethod: 'ADVANCE_ONLINE',
        useWallet: true,
        walletAmountUsed: 9999, // spoofed value ignored
        paymentStatus: 'REFUNDED', // spoofed value ignored
        address: { fullAddress: 'Shop 2, Nashik', pincode: '422001' },
        items: [{ productId: 'prod-p9', variantId: 'var-p9', quantity: 2 }],
      },
      custAuth
    );
    assert.equal(partialRes.statusCode, 201);
    assert.equal(partialRes.payload.order.walletAmountUsed, 150);
    assert.equal(partialRes.payload.order.totalPayable, 250);
    assert.equal(partialRes.payload.order.remainingWalletBalance, 0);
    assert.equal(partialRes.payload.order.paymentStatus, 'RECEIVED');
    assert.equal(engine.db.users[0].wallet_balance, 0);
    const pwDebits = engine.db.ledger.filter((r) => r.order_id === 'ord-pw-1' && r.type === 'DEBIT');
    assert.equal(pwDebits.length, 1);
    assert.equal(pwDebits[0].amount, 150);

    // 9c: Insufficient wallet balance (balance is now 0, useWallet: true -> 409 and ZERO orphan order/items)
    const insuffRes = await processCreateOrderRequest(
      engine.createSupabaseClient(),
      {
        orderId: 'ord-insuff-1',
        orderNumber: 'OM-9003',
        paymentMethod: 'ADVANCE_ONLINE',
        useWallet: true,
        address: { fullAddress: 'Shop 2, Nashik', pincode: '422001' },
        items: [{ productId: 'prod-p9', variantId: 'var-p9', quantity: 1 }],
      },
      custAuth
    );
    assert.equal(insuffRes.statusCode, 409);
    assert.equal(insuffRes.payload.code, 'INSUFFICIENT_WALLET_BALANCE');
    assert.equal(engine.db.orders.some((o) => o.id === 'ord-insuff-1'), false);
    assert.equal(engine.db.order_items.some((i) => i.order_id === 'ord-insuff-1'), false);
    assert.equal(engine.db.ledger.some((l) => l.order_id === 'ord-insuff-1'), false);

    results.push('PASS Test 9: Zero-wallet, partial-wallet, insufficient-balance & anti-spoofing verified atomically');
  }

  // ---------------------------------------------------------------------------
  // TEST 10: Mid-Transaction DB Fault Rollback & Missing RPC Fail-Closed
  // ---------------------------------------------------------------------------
  {
    const engine = new SimulatedPostgresEngine({
      users: [{ id: '22222222-2222-2222-2222-222222222222', name: 'Neha', phone: '9888888882', role: 'CUSTOMER', wallet_balance: 300 }],
      products: [{ id: 'prod-f10', name: 'Oil', brand: 'Om', price: 250, stock: 20, stock_quantity: 20, is_discount_excluded: false }],
      product_variants: [{ id: 'var-f10', product_id: 'prod-f10', unit: 'LITER', pack_size: 1, pack_label: '1 L', base_selling_price: 250, mrp: 280, stock_quantity: 20 }],
      store_settings: [{ id: 'global_settings', advance_discount_percentage: 0, cod_base_charge: 0, free_shipping_min_amount: 0, base_delivery_fee: 0 }],
      ledger: [
        { id: 'wtx_seed_10', customer_id: '22222222-2222-2222-2222-222222222222', type: 'CREDIT', amount: 300, description: 'Seed', date: new Date(Date.now() - 60000).toISOString(), balance_after: 300 },
      ],
    });
    const custAuth = {
      adminSession: null,
      customerSession: { role: 'CUSTOMER' as const, customerId: '22222222-2222-2222-2222-222222222222', phone: '9888888882', name: 'Neha', exp: Date.now() + 60000 },
    };

    const faultStages: FaultStage[] = [
      'create_order_insert',
      'create_order_items_insert',
      'ledger_insert',
      'user_wallet_update',
      'missing_rpc',
    ];

    for (const stage of faultStages) {
      engine.nextFaultStage = stage;
      const ordId = `ord-fault-${stage}`;
      const res = await processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: ordId,
          orderNumber: 'OM-9100',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Main Rd', pincode: '422001' },
          items: [{ productId: 'prod-f10', variantId: 'var-f10', quantity: 1 }],
        },
        custAuth
      );
      assert.equal(res.statusCode, 500, `Stage ${stage} must return 500`);
      assert.equal(res.payload.success, false);
      assert.equal(engine.db.orders.some((o) => o.id === ordId), false, `Rollback at ${stage} must leave zero order`);
      assert.equal(engine.db.order_items.some((i) => i.order_id === ordId), false, `Rollback at ${stage} must leave zero order_items`);
      assert.equal(engine.db.ledger.some((l) => l.order_id === ordId), false, `Rollback at ${stage} must leave zero ledger entry`);
      assert.equal(engine.db.users[0].wallet_balance, 300, `Rollback at ${stage} must keep wallet_balance=300`);
    }

    results.push('PASS Test 10: Order creation DB fault injection & missing-RPC fail-closed leave zero orphan rows');
  }

  // ---------------------------------------------------------------------------
  // TEST 11: Concurrent Order Creation, Duplicate orderId Retry, Concurrent Cancel & Phone Update Serialization
  // ---------------------------------------------------------------------------
  {
    const engine = new SimulatedPostgresEngine({
      users: [{ id: '33333333-3333-3333-3333-333333333333', name: 'Vikas', phone: '9888888883', role: 'CUSTOMER', wallet_balance: 500 }],
      products: [{ id: 'prod-c11', name: 'Sugar', brand: 'Om', price: 200, stock: 50, stock_quantity: 50, is_discount_excluded: false }],
      product_variants: [{ id: 'var-c11', product_id: 'prod-c11', unit: 'KG', pack_size: 1, pack_label: '1 KG', base_selling_price: 200, mrp: 220, stock_quantity: 50 }],
      store_settings: [{ id: 'global_settings', advance_discount_percentage: 0, cod_base_charge: 0, free_shipping_min_amount: 0, base_delivery_fee: 0 }],
      ledger: [
        { id: 'wtx_seed_11', customer_id: '33333333-3333-3333-3333-333333333333', type: 'CREDIT', amount: 500, description: 'Seed', date: new Date(Date.now() - 60000).toISOString(), balance_after: 500 },
      ],
    });
    engine.yieldOnRpcStepMs = 10;

    const custAuthOldPhone = {
      adminSession: null,
      customerSession: { role: 'CUSTOMER' as const, customerId: '33333333-3333-3333-3333-333333333333', phone: '9888888883', name: 'Vikas', exp: Date.now() + 60000 },
    };

    const shopAuth11 = {
      adminSession: { role: 'SHOPKEEPER' as const, phone: '9999999999', exp: Date.now() + 60000 },
      customerSession: null,
    };

    // 11a: Two concurrent identical duplicate requests (same orderId) + concurrent Shopkeeper cancel on that uncommitted orderId
    const [dupA, dupB, earlyCancel] = await Promise.all([
      processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: 'ord-dup-11',
          orderNumber: 'OM-9201',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Market', pincode: '422001' },
          items: [{ productId: 'prod-c11', variantId: 'var-c11', quantity: 1 }],
        },
        custAuthOldPhone
      ),
      processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: 'ord-dup-11',
          orderNumber: 'OM-9201',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Market', pincode: '422001' },
          items: [{ productId: 'prod-c11', variantId: 'var-c11', quantity: 1 }],
        },
        custAuthOldPhone
      ),
      processCancelOrderRequest(engine.createSupabaseClient(), { id: 'ord-dup-11' }, shopAuth11),
    ]);

    const createdStatuses = [dupA.statusCode, dupB.statusCode].sort();
    assert.deepEqual(createdStatuses, [200, 201], 'One duplicate creates (201) and one deduplicates (200)');
    assert.equal(engine.db.orders.filter((o) => o.id === 'ord-dup-11').length, 1);
    assert.equal(engine.db.ledger.filter((l) => l.order_id === 'ord-dup-11' && l.type === 'DEBIT').length, 1);
    // Cancel either happened before commit (404, balance=300) or serialized cleanly after commit (200, refunded to 500)
    assert.ok([200, 404].includes(earlyCancel.statusCode));
    const expectedAfter11a = earlyCancel.statusCode === 200 ? 500 : 300;
    assert.equal(engine.db.users[0].wallet_balance, expectedAfter11a);

    // 11b: Concurrent phone update (9888888883 -> 9777777773) alongside order creation & Shopkeeper cancellation
    // First ensure ord-dup-11 exists & is active for cancel, reset balance cleanly to 300 if cancelled
    if (earlyCancel.statusCode === 200) {
      await processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: 'ord-active-11b',
          orderNumber: 'OM-9202',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Market', pincode: '422001' },
          items: [{ productId: 'prod-c11', variantId: 'var-c11', quantity: 1 }],
        },
        custAuthOldPhone
      );
    }
    const targetCancelId = earlyCancel.statusCode === 200 ? 'ord-active-11b' : 'ord-dup-11';
    // Customer trying to cancel must fail with 403
    const custAttemptRes = await processCancelOrderRequest(
      engine.createSupabaseClient(),
      { id: targetCancelId },
      custAuthOldPhone
    );
    assert.equal(custAttemptRes.statusCode, 403);

    // Balance is now 300, active ₹200 order exists. Concurrently: update phone to 9777777773 AND Shopkeeper cancels active ₹200 order!
    const [phoneRes, cancelDuringPhoneRes] = await Promise.all([
      engine.executeRpc('update_customer_phone_atomic', {
        p_user_id: '33333333-3333-3333-3333-333333333333',
        p_session_phone: '9888888883',
        p_new_phone: '9777777773',
        p_update_profile: false,
      }),
      processCancelOrderRequest(engine.createSupabaseClient(), { id: targetCancelId }, shopAuth11),
    ]);
    assert.equal(phoneRes.data?.ok, true);
    assert.equal(cancelDuringPhoneRes.statusCode, 200);
    assert.equal(engine.db.users[0].phone, '9777777773');
    assert.equal(engine.db.users[0].wallet_balance, 500, 'Phone update + concurrent cancellation preserve exact wallet balance');

    // Now create two concurrent ₹200 orders using the NEW phone -> both serialize cleanly and leave ₹100
    const custAuthNewPhone = {
      adminSession: null,
      customerSession: { role: 'CUSTOMER' as const, customerId: '33333333-3333-3333-3333-333333333333', phone: '9777777773', name: 'Vikas', exp: Date.now() + 60000 },
    };
    const [conc1, conc2] = await Promise.all([
      processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: 'ord-conc-11c-1',
          orderNumber: 'OM-9203',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Market', pincode: '422001' },
          items: [{ productId: 'prod-c11', variantId: 'var-c11', quantity: 1 }],
        },
        custAuthNewPhone
      ),
      processCreateOrderRequest(
        engine.createSupabaseClient(),
        {
          orderId: 'ord-conc-11c-2',
          orderNumber: 'OM-9204',
          paymentMethod: 'ADVANCE_ONLINE',
          useWallet: true,
          address: { fullAddress: 'Market', pincode: '422001' },
          items: [{ productId: 'prod-c11', variantId: 'var-c11', quantity: 1 }],
        },
        custAuthNewPhone
      ),
    ]);
    assert.equal(conc1.statusCode, 201);
    assert.equal(conc2.statusCode, 201);
    assert.equal(engine.db.users[0].wallet_balance, 100);
    assert.equal(engine.db.orders.filter((o) => o.id.startsWith('ord-conc-11c-')).length, 2);

    results.push('PASS Test 11: Concurrent order creation, duplicate orderId retry, concurrent cancel & phone update serialization verified');
  }

  console.log('\n=== Atomic Order Creation & Cancellation Verification Suite ===');
  for (const r of results) console.log(`  ✓ ${r}`);
  console.log(`\nAll ${results.length} test groups passed.\n`);
}

runTests().catch((err) => {
  console.error('\nTEST SUITE FAILED:', err);
  process.exit(1);
});
