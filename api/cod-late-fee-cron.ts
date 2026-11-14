import crypto from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';
import { enforceOverdueCodLateFees } from './_codLateFee.js';

function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (url && key && url !== 'https://your-project.supabase.co' && key !== 'your-service-role-key') {
    try {
      return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    } catch {
      return null;
    }
  }
  return null;
}

function sendJson(res: ServerResponse, statusCode: number, data: any) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
  res.end(JSON.stringify(data));
}

function isValidCronBearerToken(authHeader: string, cronSecret?: string): boolean {
  if (!cronSecret || !cronSecret.trim() || !authHeader) {
    return false;
  }
  const expected = `Bearer ${cronSecret.trim()}`;
  const providedBuf = Buffer.from(authHeader, 'utf8');
  const expectedBuf = Buffer.from(expected, 'utf8');
  if (providedBuf.length !== expectedBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(providedBuf, expectedBuf);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  const method = req.method?.toUpperCase();
  if (method !== 'GET' && method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return sendJson(res, 405, { success: false, error: `Method ${method} Not Allowed` });
  }

  // Strictly authenticate via CRON_SECRET Bearer token (timing-safe) or verified Shopkeeper session;
  // NEVER trust spoofable headers like x-vercel-cron alone.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = String(req.headers['authorization'] || '');
  const isCronSecretValid = isValidCronBearerToken(authHeader, cronSecret);
  const adminSession = verifyAdminSession(req);
  const isAdmin = Boolean(adminSession && adminSession.role === 'SHOPKEEPER');

  if (!isCronSecretValid && !isAdmin) {
    return sendJson(res, 401, {
      success: false,
      error: 'Unauthorized: Valid CRON_SECRET Bearer token or verified Shopkeeper session required.',
    });
  }

  const supabase = getSupabaseClient();
  if (!supabase) {
    return sendJson(res, 500, {
      success: false,
      error: 'SUPABASE_SERVICE_ROLE_KEY is required for COD late fee enforcement.',
    });
  }

  const summary = await enforceOverdueCodLateFees(supabase);
  const statusCode = summary.errors.length > 0 ? 500 : 200;

  return sendJson(res, statusCode, {
    success: summary.errors.length === 0,
    ...summary,
    executedAt: new Date().toISOString(),
  });
}
