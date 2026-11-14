import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveAuthoritativeCodBaseCharge } from './settings.js';

export function normalizePhone(rawPhone?: string | null): string {
  if (!rawPhone) return '';
  const digits = String(rawPhone).replace(/\D/g, '');
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/**
 * Returns YYYY-MM-DD calendar date in Asia/Kolkata (IST) timezone.
 */
export function getISTCalendarDate(dateInput?: string | Date | null): string | null {
  if (!dateInput) return null;
  const date = typeof dateInput === 'string' ? new Date(dateInput) : dateInput;
  if (!(date instanceof Date) || isNaN(date.getTime())) {
    return null;
  }

  try {
    const parts = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Kolkata',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(date);

    const year = parts.find((p) => p.type === 'year')?.value;
    const month = parts.find((p) => p.type === 'month')?.value;
    const day = parts.find((p) => p.type === 'day')?.value;

    if (year && month && day) {
      return `${year}-${month}-${day}`;
    }
  } catch {
    // Fallback to UTC+05:30 offset
  }

  const istMs = date.getTime() + 5.5 * 60 * 60 * 1000;
  return new Date(istMs).toISOString().slice(0, 10);
}

export function parseCodMetaFromNotes(rawNotes?: string | null): {
  orderNumber: string;
  meta: Record<string, any>;
} {
  const notesStr = rawNotes || '';
  if (notesStr.includes('COD_META:')) {
    const parts = notesStr.split('COD_META:');
    const orderNumber = parts[0].replace(/\|/g, '').replace(/^Order\s*#?/i, '').trim();
    try {
      const parsed = JSON.parse(parts[1].trim());
      if (parsed && typeof parsed === 'object') {
        return { orderNumber, meta: parsed };
      }
    } catch {
      // Ignore malformed JSON
    }
    return { orderNumber, meta: {} };
  }

  return {
    orderNumber: notesStr.replace(/^Order\s*#?/i, '').trim(),
    meta: {},
  };
}

export function buildOrderNotesWithMeta(
  orderNumber: string,
  meta: Record<string, any>
): string {
  return `Order #${orderNumber} | COD_META:${JSON.stringify(meta)}`;
}

export interface CodLateFeeEnforcementResult {
  checked: number;
  updatedCount: number;
  updatedOrderIds: string[];
  appliedFeeAmount: number;
  errors: string[];
}

interface OrderUpdateSnapshot {
  id: string;
  updatedAtUsed: string;
  preSnapshot: {
    final_total: number | null;
    notes: string | null;
    updated_at: string | null;
  };
}

// Per-process guard to prevent parallel overlapping enforcement on the same order
const inFlightLateFeeOrderLocks = new Set<string>();

/**
 * Automatically and idempotently enforces the Shopkeeper-configured COD late fee
 * (from store_settings.cod_base_charge via api/settings.ts, defaulting strictly to ₹0)
 * at most once per order when:
 * 1. Configured codBaseCharge > 0 (if ₹0, immediately exits without touching any order)
 * 2. Payment method is COD
 * 3. Order status is DELIVERED
 * 4. Payment was NOT fully received (is_paid = false, payment_status != RECEIVED/PAID/REFUNDED/FAILED, codCollected < final_total)
 * 5. Valid deliveredAt exists (row.delivered_at || meta.deliveredAt — NEVER falls back to updated_at or created_at)
 * 6. Current IST calendar date is strictly after the delivery IST calendar date (todayIST > deliveryDateIST)
 * 7. Late fee has NOT already been applied to this order
 *
 * Uses strict Optimistic Concurrency Control + compensating rollback if customer balance sync fails.
 */
export async function enforceOverdueCodLateFees(
  supabase: SupabaseClient,
  options?: { phone?: string; now?: Date }
): Promise<CodLateFeeEnforcementResult> {
  const now = options?.now || new Date();
  const todayIST = getISTCalendarDate(now);
  const cleanPhone = normalizePhone(options?.phone);

  const result: CodLateFeeEnforcementResult = {
    checked: 0,
    updatedCount: 0,
    updatedOrderIds: [],
    appliedFeeAmount: 0,
    errors: [],
  };

  if (!todayIST) return result;

  try {
    // 1. Read authoritative COD fee strictly from api/settings.ts (backed by store_settings.cod_base_charge, default ₹0)
    const feeResolution = await resolveAuthoritativeCodBaseCharge(supabase);
    if (feeResolution.error) {
      result.errors.push(
        `Failed to load store_settings.cod_base_charge: ${feeResolution.error}`
      );
      return result;
    }

    const lateFeeAmount = Math.max(
      0,
      Math.round((Number(feeResolution.amount) || 0) * 100) / 100
    );
    result.appliedFeeAmount = lateFeeAmount;

    // When configured fee is ₹0, do not modify any order or set any late-fee flag
    if (lateFeeAmount <= 0) {
      return result;
    }

    // 2. Fetch candidate unpaid DELIVERED COD orders
    let query = supabase
      .from('orders')
      .select('*')
      .eq('payment_method', 'COD')
      .eq('status', 'DELIVERED')
      .eq('is_paid', false);

    if (cleanPhone) {
      query = query.or(`customer_phone.eq.${cleanPhone},customer_phone.eq.+91${cleanPhone}`);
    }

    const { data: candidateOrders, error: fetchErr } = await query;
    if (fetchErr) {
      result.errors.push(fetchErr.message);
      return result;
    }

    if (!candidateOrders || candidateOrders.length === 0) {
      return result;
    }

    result.checked = candidateOrders.length;
    const appliedUpdatesByPhone = new Map<string, OrderUpdateSnapshot[]>();

    for (const row of candidateOrders) {
      if (!row?.id || inFlightLateFeeOrderLocks.has(row.id)) {
        continue;
      }

      const paymentStatusUpper = String(row.payment_status || '').toUpperCase();
      if (
        row.is_paid === true ||
        paymentStatusUpper === 'RECEIVED' ||
        paymentStatusUpper === 'PAID' ||
        paymentStatusUpper === 'REFUNDED' ||
        paymentStatusUpper === 'FAILED'
      ) {
        continue;
      }

      const { orderNumber: parsedOrderNum, meta } = parseCodMetaFromNotes(row.notes);

      // Strict idempotency check: apply AT MOST ONCE per order
      if (
        meta.codLateFeeApplied === true ||
        Number(meta.codLateFeeAmount || 0) > 0 ||
        Boolean(meta.codLateFeeAppliedAt) ||
        row.cod_late_fee_applied === true
      ) {
        continue;
      }

      const currentFinalTotal = Number(row.final_total ?? row.subtotal ?? 0);
      const codCollected = Number(meta.codCollected ?? 0);
      if (codCollected >= currentFinalTotal) {
        continue;
      }

      // Strictly require deliveredAt (column or COD_META); NEVER fall back to updated_at or created_at
      const deliveredAt = row.delivered_at || meta.deliveredAt || null;
      if (!deliveredAt) {
        continue;
      }

      const deliveryDateIST = getISTCalendarDate(deliveredAt);
      if (!deliveryDateIST || todayIST <= deliveryDateIST) {
        // Still on delivery IST calendar day (or invalid deliveredAt) -> do not apply fee
        continue;
      }

      const resolvedOrderNumber = String(
        row.order_number || parsedOrderNum || row.id.replace(/^ord[-_]/i, '').slice(0, 8)
      ).trim();
      const nowISO = new Date().toISOString();
      const nextCodCharge = Math.round(((Number(meta.codCharge) || 0) + lateFeeAmount) * 100) / 100;
      const nextFinalTotal = Math.round((currentFinalTotal + lateFeeAmount) * 100) / 100;

      const updatedMeta = {
        ...meta,
        deliveredAt,
        codCharge: nextCodCharge,
        codLateFeeApplied: true,
        codLateFeeAmount: lateFeeAmount,
        codLateFeeAppliedAt: nowISO,
        totalPayable: nextFinalTotal,
      };

      const nextNotes = buildOrderNotesWithMeta(resolvedOrderNumber, updatedMeta);

      inFlightLateFeeOrderLocks.add(row.id);
      try {
        // Strict OCC update: match id, unpaid COD DELIVERED status, updated_at, notes, and final_total
        let updateQuery = supabase
          .from('orders')
          .update({
            final_total: nextFinalTotal,
            notes: nextNotes,
            updated_at: nowISO,
          })
          .eq('id', row.id)
          .eq('payment_method', 'COD')
          .eq('status', 'DELIVERED')
          .eq('is_paid', false);

        if (row.updated_at !== null && row.updated_at !== undefined) {
          updateQuery = updateQuery.eq('updated_at', row.updated_at);
        } else {
          updateQuery = updateQuery.is('updated_at', null);
        }

        if (row.notes !== null && row.notes !== undefined) {
          updateQuery = updateQuery.eq('notes', row.notes);
        } else {
          updateQuery = updateQuery.is('notes', null);
        }

        if (row.final_total !== null && row.final_total !== undefined) {
          updateQuery = updateQuery.eq('final_total', row.final_total);
        }

        const { data: occRows, error: updateErr } = await updateQuery.select('id');
        if (updateErr) {
          result.errors.push(`Order ${row.id}: ${updateErr.message}`);
          continue;
        }

        if (occRows && occRows.length > 0) {
          result.updatedCount += 1;
          result.updatedOrderIds.push(row.id);
          const orderPhone = normalizePhone(row.customer_phone);
          if (orderPhone) {
            const list = appliedUpdatesByPhone.get(orderPhone) || [];
            list.push({
              id: row.id,
              updatedAtUsed: nowISO,
              preSnapshot: {
                final_total: row.final_total ?? null,
                notes: row.notes ?? null,
                updated_at: row.updated_at ?? null,
              },
            });
            appliedUpdatesByPhone.set(orderPhone, list);
          }
        }
      } finally {
        inFlightLateFeeOrderLocks.delete(row.id);
      }
    }

    // 3. Recalculate authoritative outstanding_balance for each affected customer;
    // rollback order updates if customer balance sync fails so partial state is never kept.
    for (const [phone, orderUpdates] of appliedUpdatesByPhone.entries()) {
      const rollbackPhoneOrders = async (reason: string) => {
        for (const upd of orderUpdates) {
          await supabase
            .from('orders')
            .update({
              final_total: upd.preSnapshot.final_total,
              notes: upd.preSnapshot.notes,
              updated_at: upd.preSnapshot.updated_at,
            })
            .eq('id', upd.id)
            .eq('updated_at', upd.updatedAtUsed);

          const idx = result.updatedOrderIds.indexOf(upd.id);
          if (idx !== -1) {
            result.updatedOrderIds.splice(idx, 1);
            result.updatedCount = Math.max(0, result.updatedCount - 1);
          }
        }
        result.errors.push(reason);
      };

      const { data: custOrders, error: custErr } = await supabase
        .from('orders')
        .select('final_total, subtotal, payment_method, payment_status, is_paid, status, notes')
        .or(`customer_phone.eq.${phone},customer_phone.eq.+91${phone}`)
        .eq('payment_method', 'COD')
        .neq('status', 'CANCELLED');

      if (custErr || !custOrders) {
        await rollbackPhoneOrders(
          `Failed to recalculate outstanding_balance for ${phone}: ${custErr?.message || 'empty order query'}`
        );
        continue;
      }

      let totalOutstanding = 0;
      for (const ord of custOrders) {
        const pStatus = String(ord.payment_status || '').toUpperCase();
        if (ord.is_paid === true || pStatus === 'RECEIVED' || pStatus === 'PAID') continue;

        const { meta } = parseCodMetaFromNotes(ord.notes);
        const bill = Number(ord.final_total ?? ord.subtotal ?? 0);
        const collected = Number(meta.codCollected ?? 0);
        totalOutstanding += Math.max(0, Math.round((bill - collected) * 100) / 100);
      }

      const cleanOutstanding = Math.round(totalOutstanding * 100) / 100;
      const { error: userUpdateErr } = await supabase
        .from('users')
        .update({
          outstanding_balance: cleanOutstanding,
          updated_at: new Date().toISOString(),
        })
        .or(`phone.eq.${phone},phone.eq.+91${phone}`);

      if (userUpdateErr) {
        await rollbackPhoneOrders(
          `Failed to update users.outstanding_balance for ${phone}: ${userUpdateErr.message}`
        );
      }
    }

    return result;
  } catch (err: any) {
    result.errors.push(err?.message || 'Unexpected error enforcing COD late fees');
    return result;
  }
}
