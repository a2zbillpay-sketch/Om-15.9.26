import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  verifyAdminSession,
  verifyCustomerSession,
  AdminSession,
  CustomerSession,
} from './auth/_verify.js';

const INDIAN_MOBILE_REGEX = /^[6-9]\d{9}$/;
const SAFE_ID_REGEX = /^[A-Za-z0-9_-]{4,100}$/;

function normalizeIndianMobile(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  const digits = String(raw).trim().replace(/\D/g, '');
  let candidate = '';
  if (digits.length === 10) {
    candidate = digits;
  } else if (digits.length === 12 && digits.startsWith('91')) {
    candidate = digits.slice(2);
  } else if (digits.length === 11 && digits.startsWith('0')) {
    candidate = digits.slice(1);
  } else if (digits.length === 13 && digits.startsWith('091')) {
    candidate = digits.slice(3);
  } else if (digits.length === 14 && digits.startsWith('0091')) {
    candidate = digits.slice(4);
  }
  return INDIAN_MOBILE_REGEX.test(candidate) ? candidate : '';
}

function cleanBoundedText(raw: unknown, maxLen: number): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw).trim().slice(0, maxLen);
}

function normalizeIsoTimestamp(raw: unknown, fallbackIso: string): string {
  if (typeof raw !== 'string' || !raw.trim()) return fallbackIso;
  const parsed = new Date(raw.trim());
  if (Number.isNaN(parsed.getTime())) return fallbackIso;
  return parsed.toISOString();
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

class RequestBodyError extends Error {
  statusCode: number;
  constructor(statusCode: number, message: string) {
    super(message);
    this.statusCode = statusCode;
  }
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 256 * 1024) {
        reject(new RequestBodyError(413, 'Request payload too large.'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(body);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
          reject(new RequestBodyError(400, 'Request body must be a JSON object.'));
          return;
        }
        resolve(parsed);
      } catch {
        reject(new RequestBodyError(400, 'Invalid JSON payload.'));
      }
    });
    req.on('error', (err) => reject(new RequestBodyError(400, err?.message || 'Failed to read request body.')));
  });
}

export function verifySameOriginOrRequestedHeader(req: IncomingMessage): boolean {
  const originHeader = req.headers?.origin;
  const rawOrigin = Array.isArray(originHeader) ? originHeader[0] : originHeader;

  const forwardedHostRaw = req.headers?.['x-forwarded-host'];
  const forwardedHost = Array.isArray(forwardedHostRaw) ? forwardedHostRaw[0] : forwardedHostRaw;
  const hostHeaderRaw = req.headers?.host;
  const hostHeader = Array.isArray(hostHeaderRaw) ? hostHeaderRaw[0] : hostHeaderRaw;
  const expectedHost = (forwardedHost ? forwardedHost.split(',')[0] : hostHeader || '')
    .trim()
    .toLowerCase();

  if (typeof rawOrigin === 'string' && rawOrigin.trim()) {
    try {
      const parsedOrigin = new URL(rawOrigin.trim());
      if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
        return false;
      }
      if (expectedHost) {
        return parsedOrigin.host.toLowerCase() === expectedHost;
      }
    } catch {
      return false;
    }
  }

  const xRequestedWith = req.headers?.['x-requested-with'];
  const requestedWithValue = Array.isArray(xRequestedWith) ? xRequestedWith[0] : xRequestedWith;
  return typeof requestedWithValue === 'string' && requestedWithValue.trim().length > 0;
}

export interface ProductRequestAuthContext {
  adminSession: AdminSession | null;
  customerSession: CustomerSession | null;
}

export interface ProductRequestsApiResult {
  statusCode: number;
  payload: any;
}

export async function processGetProductRequests(
  supabase: SupabaseClient | null,
  auth: { adminSession: AdminSession | null }
): Promise<ProductRequestsApiResult> {
  const session = auth?.adminSession;
  if (!session || session.role !== 'SHOPKEEPER') {
    return {
      statusCode: 401,
      payload: {
        success: false,
        error: 'Unauthorized: Shopkeeper session required.',
      },
    };
  }

  if (!supabase) {
    return {
      statusCode: 500,
      payload: {
        success: false,
        error: 'Database service is not configured or unavailable.',
      },
    };
  }

  try {
    const { data, error } = await supabase
      .from('product_requests')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      return {
        statusCode: 500,
        payload: {
          success: false,
          error: error.message || 'Failed to query product requests.',
        },
      };
    }

    return {
      statusCode: 200,
      payload: {
        success: true,
        requests: data || [],
      },
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      payload: {
        success: false,
        error: err?.message || 'Internal server error.',
      },
    };
  }
}

export async function processCreateProductRequest(
  supabase: SupabaseClient | null,
  body: any,
  auth: ProductRequestAuthContext
): Promise<ProductRequestsApiResult> {
  const isShopkeeper = Boolean(auth?.adminSession && auth.adminSession.role === 'SHOPKEEPER');
  const customerSession =
    !isShopkeeper && auth?.customerSession && auth.customerSession.role === 'CUSTOMER'
      ? auth.customerSession
      : null;

  if (!isShopkeeper && !customerSession) {
    return {
      statusCode: 401,
      payload: {
        success: false,
        error: 'Unauthorized: Verified customer or shopkeeper session is required to submit a product request.',
      },
    };
  }

  if (!supabase) {
    return {
      statusCode: 500,
      payload: {
        success: false,
        error: 'Database service is not configured or unavailable.',
      },
    };
  }

  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return {
      statusCode: 400,
      payload: {
        success: false,
        error: 'Invalid product request payload.',
      },
    };
  }

  const rawBodyPhone =
    body.customerPhone !== undefined && body.customerPhone !== null
      ? String(body.customerPhone).trim()
      : '';
  const cleanBodyPhone = normalizeIndianMobile(rawBodyPhone);

  let cleanPhone = '';
  let resolvedCustomerId = '';

  if (customerSession) {
    if (rawBodyPhone && (!cleanBodyPhone || cleanBodyPhone !== customerSession.phone)) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: You can only submit product requests for your own verified mobile number.',
        },
      };
    }

    cleanPhone = customerSession.phone;
    const rawBodyCustomerId = cleanBoundedText(body.customerId, 128);
    const allowedCustomerIds = new Set([
      customerSession.customerId,
      `usr_${cleanPhone}`,
      `user-${cleanPhone}`,
    ]);

    if (rawBodyCustomerId && !allowedCustomerIds.has(rawBodyCustomerId)) {
      return {
        statusCode: 403,
        payload: {
          success: false,
          error: 'Forbidden: You cannot submit a product request using another customer ID.',
        },
      };
    }

    resolvedCustomerId = customerSession.customerId || `usr_${cleanPhone}`;
  } else {
    if (!cleanBodyPhone) {
      return {
        statusCode: 400,
        payload: {
          success: false,
          error: 'A valid 10-digit Indian mobile number is required.',
        },
      };
    }
    cleanPhone = cleanBodyPhone;
    resolvedCustomerId = cleanBoundedText(body.customerId, 128) || `usr_${cleanPhone}`;
  }

  const productId = cleanBoundedText(body.productId ?? body.product?.id, 128);
  const productName = cleanBoundedText(body.productName ?? body.product?.name, 255);
  const rawQuantity = Number(body.quantity);
  const quantity = Number.isFinite(rawQuantity) ? Math.floor(rawQuantity) : NaN;

  if (!productId) {
    return {
      statusCode: 400,
      payload: {
        success: false,
        error: 'Product ID is required.',
      },
    };
  }

  if (!productName) {
    return {
      statusCode: 400,
      payload: {
        success: false,
        error: 'Product name is required.',
      },
    };
  }

  if (!Number.isFinite(quantity) || quantity < 1 || quantity > 100000 || quantity !== rawQuantity) {
    return {
      statusCode: 400,
      payload: {
        success: false,
        error: 'Requested quantity must be a positive whole number between 1 and 100000.',
      },
    };
  }

  const variantId = cleanBoundedText(body.variantId ?? body.product?.variantId, 128) || null;
  const variantName = cleanBoundedText(body.variantName ?? body.product?.variantName, 120) || null;
  const packSize = cleanBoundedText(body.packSize ?? body.product?.packSize, 80) || null;
  let customerName = cleanBoundedText(body.customerName ?? body.customer?.name, 120) || 'Customer';

  // Enrich canonical customer name/ID from public.users when available
  try {
    const { data: dbCustomer } = await supabase
      .from('users')
      .select('id, name, full_name')
      .eq('phone', cleanPhone)
      .maybeSingle();

    if (dbCustomer) {
      if (dbCustomer.id && !isShopkeeper) {
        resolvedCustomerId = String(dbCustomer.id);
      }
      if (!customerName || customerName === 'Customer') {
        const dbName = cleanBoundedText(dbCustomer.full_name ?? dbCustomer.name, 120);
        if (dbName) {
          customerName = dbName;
        }
      }
    }
  } catch {
    // Non-fatal: continue with verified session identity
  }

  const rawId = cleanBoundedText(body.id, 100);
  const requestId =
    rawId && SAFE_ID_REGEX.test(rawId)
      ? rawId
      : `preq-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

  const nowIso = new Date().toISOString();
  const requestDate = normalizeIsoTimestamp(body.requestDate, nowIso);
  const createdAt = normalizeIsoTimestamp(body.createdAt, requestDate);

  try {
    // Idempotency check if request ID already exists
    const { data: existingRow, error: existingErr } = await supabase
      .from('product_requests')
      .select('*')
      .eq('id', requestId)
      .maybeSingle();

    if (!existingErr && existingRow) {
      const existingPhone =
        normalizeIndianMobile(existingRow.customer_phone) ||
        String(existingRow.customer_phone || '').replace(/\D/g, '').slice(-10);

      if (isShopkeeper || existingPhone === cleanPhone) {
        return {
          statusCode: 200,
          payload: {
            success: true,
            deduplicated: true,
            request: existingRow,
          },
        };
      }

      return {
        statusCode: 409,
        payload: {
          success: false,
          error: 'Product request ID already exists for another customer.',
        },
      };
    }

    const insertPayload = {
      id: requestId,
      customer_id: resolvedCustomerId,
      customer_name: customerName,
      customer_phone: cleanPhone,
      product_id: productId,
      product_name: productName,
      variant_id: variantId,
      variant_name: variantName,
      pack_size: packSize,
      quantity,
      request_date: requestDate,
      created_at: createdAt,
    };

    const { data: insertedRow, error: insertError } = await supabase
      .from('product_requests')
      .insert(insertPayload)
      .select('*')
      .single();

    if (insertError) {
      if (String(insertError.code || '').trim() === '23505') {
        const { data: dupRow } = await supabase
          .from('product_requests')
          .select('*')
          .eq('id', requestId)
          .maybeSingle();
        if (dupRow) {
          const dupPhone =
            normalizeIndianMobile(dupRow.customer_phone) ||
            String(dupRow.customer_phone || '').replace(/\D/g, '').slice(-10);
          if (isShopkeeper || dupPhone === cleanPhone) {
            return {
              statusCode: 200,
              payload: {
                success: true,
                deduplicated: true,
                request: dupRow,
              },
            };
          }
        }
        return {
          statusCode: 409,
          payload: {
            success: false,
            error: 'Product request ID already exists.',
          },
        };
      }

      console.error('[POST /api/product-requests] Insert failed:', {
        code: insertError.code ?? null,
        message: insertError.message ?? null,
      });
      return {
        statusCode: 500,
        payload: {
          success: false,
          error: insertError.message || 'Failed to save product request.',
        },
      };
    }

    return {
      statusCode: 201,
      payload: {
        success: true,
        request: insertedRow || insertPayload,
      },
    };
  } catch (err: any) {
    return {
      statusCode: 500,
      payload: {
        success: false,
        error: err?.message || 'Internal server error while saving product request.',
      },
    };
  }
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

  if (req.method === 'GET') {
    const adminSession = verifyAdminSession(req);
    const supabase = getServerSupabaseClient();
    const result = await processGetProductRequests(supabase, { adminSession });
    res.statusCode = result.statusCode;
    res.end(JSON.stringify(result.payload));
    return;
  }

  if (req.method === 'POST') {
    if (!verifySameOriginOrRequestedHeader(req)) {
      res.statusCode = 403;
      res.end(
        JSON.stringify({
          success: false,
          error: 'Forbidden: Invalid request origin.',
        })
      );
      return;
    }

    let body: any = {};
    try {
      body = await parseJsonBody(req);
    } catch (err: any) {
      res.statusCode = err instanceof RequestBodyError ? err.statusCode : 400;
      res.end(
        JSON.stringify({
          success: false,
          error: err?.message || 'Invalid JSON payload.',
        })
      );
      return;
    }

    const adminSession = verifyAdminSession(req);
    const customerSession = !adminSession ? verifyCustomerSession(req) : null;
    const supabase = getServerSupabaseClient();
    const result = await processCreateProductRequest(supabase, body, {
      adminSession,
      customerSession,
    });
    res.statusCode = result.statusCode;
    res.end(JSON.stringify(result.payload));
    return;
  }

  res.statusCode = 405;
  res.setHeader('Allow', 'GET, POST');
  res.end(
    JSON.stringify({
      success: false,
      error: `Method ${req.method} Not Allowed. Only GET and POST are permitted.`,
    })
  );
}
