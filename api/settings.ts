import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { verifyAdminSession } from './auth/_verify.js';

const DATA_DIR = path.resolve(process.cwd(), 'data');
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface SystemSetting {
  id: string;
  appName: string;
  logoUrl: string;
  primaryColorHex: string;
  secondaryColorHex: string;
  accentColorHex: string;
  advancePaymentDiscountPct: number;
  codBaseCharge: number;
  freeShippingMinAmount: number;
  baseDeliveryFee: number;
  referralRewardAmount?: number;
  lowStockThreshold?: number;
  updatedAt: string;
}

const DEFAULT_SETTINGS: SystemSetting = {
  id: 'global_settings',
  appName: 'Om Distributors',
  logoUrl: '/logo.jpg',
  primaryColorHex: '#0F2C59',
  secondaryColorHex: '#D4AF37',
  accentColorHex: '#FF6B00',
  advancePaymentDiscountPct: 0.0,
  codBaseCharge: 0.0,
  freeShippingMinAmount: 249.0,
  baseDeliveryFee: 11.0,
  referralRewardAmount: 0.0,
  lowStockThreshold: 10,
  updatedAt: new Date().toISOString(),
};

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

export interface ResolvedCodBaseCharge {
  amount: number;
  source: 'store_settings.cod_base_charge' | 'settings_file' | 'default_zero';
  error?: string;
}

/**
 * Resolves the authoritative Shopkeeper-configured COD fee (codBaseCharge) from
 * Supabase store_settings.cod_base_charge, falling back strictly to ₹0 default
 * when no custom row exists (never any hardcoded ₹49/₹50 fallback).
 * Returns an explicit error if the database query itself fails.
 */
export async function resolveAuthoritativeCodBaseCharge(
  supabaseClient?: SupabaseClient | null
): Promise<ResolvedCodBaseCharge> {
  const client = supabaseClient ?? getSupabaseClient();

  if (client) {
    try {
      const { data, error } = await client
        .from('store_settings')
        .select('cod_base_charge')
        .eq('id', 'global_settings')
        .maybeSingle();

      if (error) {
        return {
          amount: 0,
          source: 'default_zero',
          error: error.message,
        };
      }

      if (data) {
        const raw = data.cod_base_charge;
        if (raw !== undefined && raw !== null && !isNaN(Number(raw))) {
          return {
            amount: Math.max(0, Math.round(Number(raw) * 100) / 100),
            source: 'store_settings.cod_base_charge',
          };
        }
        return {
          amount: 0,
          source: 'default_zero',
        };
      }
    } catch (err: any) {
      return {
        amount: 0,
        source: 'default_zero',
        error: err?.message || 'Failed to query store_settings.cod_base_charge',
      };
    }
  }

  if (fs.existsSync(SETTINGS_FILE)) {
    const fileSettings = loadSettingsFromFile();
    const fileVal = Number(fileSettings.codBaseCharge);
    if (!isNaN(fileVal) && fileVal >= 0) {
      return {
        amount: Math.round(fileVal * 100) / 100,
        source: 'settings_file',
      };
    }
  }

  return {
    amount: DEFAULT_SETTINGS.codBaseCharge,
    source: 'default_zero',
  };
}

function loadSettingsFromFile(): SystemSetting {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const content = fs.readFileSync(SETTINGS_FILE, 'utf8');
      if (content.trim()) {
        const parsed = JSON.parse(content);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
          // Single Source of Truth: advancePaymentDiscountPct must come from Supabase store_settings.advance_discount_percentage
          // or fall back strictly to 0.00 when DB is unavailable (never stale local JSON).
          advancePaymentDiscountPct: DEFAULT_SETTINGS.advancePaymentDiscountPct,
          lowStockThreshold:
            parsed.lowStockThreshold !== undefined && !isNaN(Number(parsed.lowStockThreshold))
              ? Number(parsed.lowStockThreshold)
              : DEFAULT_SETTINGS.lowStockThreshold,
        };
      }
    }
  } catch (err) {
    console.error('Failed to read settings.json:', err);
  }
  return { ...DEFAULT_SETTINGS };
}

function saveSettingsToFile(settings: SystemSetting): void {
  try {
    const tempFile = `${SETTINGS_FILE}.tmp.${Date.now()}`;
    fs.writeFileSync(tempFile, JSON.stringify(settings, null, 2), 'utf8');
    fs.renameSync(tempFile, SETTINGS_FILE);
  } catch (err) {
    console.error('Failed to write settings.json:', err);
  }
}

export async function syncWithSupabaseIfConfigured(
  settings: SystemSetting,
  mode: 'READ' | 'WRITE',
  supabaseClient?: SupabaseClient | null
): Promise<SystemSetting> {
  const supabase = supabaseClient !== undefined ? supabaseClient : getSupabaseClient();
  if (!supabase) {
    return mode === 'READ'
      ? { ...settings, advancePaymentDiscountPct: DEFAULT_SETTINGS.advancePaymentDiscountPct }
      : settings;
  }

  try {
    if (mode === 'READ') {
      const { data, error } = await supabase
        .from('store_settings')
        .select('*')
        .eq('id', 'global_settings')
        .maybeSingle();

      if (!error && data) {
        const rawDiscount = data.advance_discount_percentage;
        const resolvedDiscount =
          rawDiscount !== undefined && rawDiscount !== null && !isNaN(Number(rawDiscount))
            ? Math.max(0, Math.round(Number(rawDiscount) * 100) / 100)
            : DEFAULT_SETTINGS.advancePaymentDiscountPct;

        const remoteSettings: SystemSetting = {
          ...settings,
          appName: data.app_name || data['app name'] || settings.appName,
          logoUrl: data.logo_url || data['logo url'] || settings.logoUrl || '/logo.jpg',
          advancePaymentDiscountPct: resolvedDiscount,
          codBaseCharge:
            data.cod_base_charge !== undefined
              ? Number(data.cod_base_charge)
              : (settings.codBaseCharge ?? 0.0),
          freeShippingMinAmount:
            data.free_shipping_min_amount !== undefined
              ? Number(data.free_shipping_min_amount)
              : (settings.freeShippingMinAmount ?? 249.0),
          baseDeliveryFee:
            data.base_delivery_fee !== undefined
              ? Number(data.base_delivery_fee)
              : (settings.baseDeliveryFee ?? 11.0),
          referralRewardAmount: 0.0,
          lowStockThreshold:
            data.low_stock_threshold !== undefined && !isNaN(Number(data.low_stock_threshold))
              ? Number(data.low_stock_threshold)
              : settings.lowStockThreshold ?? 10,
          updatedAt: data.updated_at || settings.updatedAt,
        };
        // Persist local copy
        saveSettingsToFile(remoteSettings);
        return remoteSettings;
      }

      return { ...settings, advancePaymentDiscountPct: DEFAULT_SETTINGS.advancePaymentDiscountPct };
    } else if (mode === 'WRITE') {
      const timestamp = settings.updatedAt || new Date().toISOString();
      const sanitizedDiscount =
        settings.advancePaymentDiscountPct !== undefined &&
        settings.advancePaymentDiscountPct !== null &&
        !isNaN(Number(settings.advancePaymentDiscountPct))
          ? Math.max(0, Math.round(Number(settings.advancePaymentDiscountPct) * 100) / 100)
          : DEFAULT_SETTINGS.advancePaymentDiscountPct;

      // Try full upsert with extended columns
      const fullPayload = {
        id: 'global_settings',
        app_name: settings.appName,
        advance_discount_percentage: sanitizedDiscount,
        logo_url: settings.logoUrl,
        cod_base_charge: settings.codBaseCharge,
        free_shipping_min_amount: settings.freeShippingMinAmount,
        base_delivery_fee: settings.baseDeliveryFee,
        updated_at: timestamp,
      };

      const { error: fullError } = await supabase
        .from('store_settings')
        .upsert(fullPayload, { onConflict: 'id' });

      // If missing column error (42703 or PGRST204), fallback to base columns
      if (
        fullError &&
        (fullError.code === '42703' ||
          fullError.code === 'PGRST204' ||
          String(fullError.message).includes('schema cache') ||
          String(fullError.message).includes('does not exist') ||
          String(fullError.message).includes('column'))
      ) {
        await supabase.from('store_settings').upsert({
          id: 'global_settings',
          app_name: settings.appName,
          advance_discount_percentage: sanitizedDiscount,
          updated_at: timestamp,
        }, { onConflict: 'id' });
      }
    }
  } catch (err) {
    console.warn('Supabase settings sync error (non-fatal):', err);
    if (mode === 'READ') {
      return { ...settings, advancePaymentDiscountPct: DEFAULT_SETTINGS.advancePaymentDiscountPct };
    }
  }

  return settings;
}

function parseJsonBody(req: IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = '';
    // Allow up to 15MB for direct Base64 logo uploads
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 15 * 1024 * 1024) {
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

function setNoCacheHeaders(res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  setNoCacheHeaders(res);

  if (req.method === 'GET') {
    const localFallback = loadSettingsFromFile();
    const current = await syncWithSupabaseIfConfigured(localFallback, 'READ');

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        settings: current,
        timestamp: Date.now(),
      })
    );
    return;
  }

  if (req.method === 'POST' || req.method === 'PUT') {
    const adminSession = verifyAdminSession(req);
    if (!adminSession || adminSession.role !== 'SHOPKEEPER') {
      res.statusCode = 401;
      res.end(
        JSON.stringify({
          success: false,
          error: 'Unauthorized: Shopkeeper credentials required to modify store settings.',
        })
      );
      return;
    }

    try {
      const body = await parseJsonBody(req);
      const incomingUpdates: Partial<SystemSetting> = body.settings || body;

      const baseSettings = loadSettingsFromFile();
      const current = await syncWithSupabaseIfConfigured(baseSettings, 'READ');

      const mergedSettings: SystemSetting = {
        ...current,
        ...(incomingUpdates.appName !== undefined ? { appName: String(incomingUpdates.appName) } : {}),
        ...(incomingUpdates.logoUrl !== undefined ? { logoUrl: String(incomingUpdates.logoUrl) } : {}),
        ...(incomingUpdates.primaryColorHex !== undefined
          ? { primaryColorHex: String(incomingUpdates.primaryColorHex) }
          : {}),
        ...(incomingUpdates.secondaryColorHex !== undefined
          ? { secondaryColorHex: String(incomingUpdates.secondaryColorHex) }
          : {}),
        ...(incomingUpdates.accentColorHex !== undefined
          ? { accentColorHex: String(incomingUpdates.accentColorHex) }
          : {}),
        ...(incomingUpdates.advancePaymentDiscountPct !== undefined &&
          incomingUpdates.advancePaymentDiscountPct !== null &&
          !isNaN(Number(incomingUpdates.advancePaymentDiscountPct))
          ? {
              advancePaymentDiscountPct: Math.max(
                0,
                Math.round(Number(incomingUpdates.advancePaymentDiscountPct) * 100) / 100
              ),
            }
          : {}),
        ...(incomingUpdates.codBaseCharge !== undefined
          ? {
              codBaseCharge: Math.max(
                0,
                Math.round((Number(incomingUpdates.codBaseCharge) || 0) * 100) / 100
              ),
            }
          : {}),
        ...(incomingUpdates.freeShippingMinAmount !== undefined
          ? { freeShippingMinAmount: Number(incomingUpdates.freeShippingMinAmount) }
          : {}),
        ...(incomingUpdates.baseDeliveryFee !== undefined
          ? { baseDeliveryFee: Number(incomingUpdates.baseDeliveryFee) }
          : {}),
        ...(incomingUpdates.referralRewardAmount !== undefined
          ? { referralRewardAmount: Number(incomingUpdates.referralRewardAmount) }
          : {}),
        ...(incomingUpdates.lowStockThreshold !== undefined
          ? { lowStockThreshold: Math.max(1, Number(incomingUpdates.lowStockThreshold)) }
          : {}),
        updatedAt: incomingUpdates.updatedAt || new Date().toISOString(),
      };

      // Authoritatively sync to Supabase store_settings (advance_discount_percentage, cod_base_charge, etc.)
      await syncWithSupabaseIfConfigured(mergedSettings, 'WRITE');

      // Persist local cache copy
      saveSettingsToFile(mergedSettings);

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          settings: mergedSettings,
          timestamp: Date.now(),
        })
      );
      return;
    } catch (err: any) {
      console.error('Error updating settings:', err);
      res.statusCode = 400;
      res.end(
        JSON.stringify({
          success: false,
          error: err?.message || 'Failed to parse request body',
        })
      );
      return;
    }
  }

  res.statusCode = 405;
  res.end(JSON.stringify({ error: 'Method not allowed' }));
}
