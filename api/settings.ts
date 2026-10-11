import type { IncomingMessage, ServerResponse } from 'http';
import fs from 'fs';
import path from 'path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

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
  referralRewardAmount: number;
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
  advancePaymentDiscountPct: 3.0,
  codBaseCharge: 30.0,
  freeShippingMinAmount: 500.0,
  baseDeliveryFee: 40.0,
  referralRewardAmount: 50.0,
  lowStockThreshold: 10,
  updatedAt: new Date().toISOString(),
};

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

function loadSettingsFromFile(): SystemSetting {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const content = fs.readFileSync(SETTINGS_FILE, 'utf8');
      if (content.trim()) {
        const parsed = JSON.parse(content);
        return {
          ...DEFAULT_SETTINGS,
          ...parsed,
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

async function syncWithSupabaseIfConfigured(
  settings: SystemSetting,
  mode: 'READ' | 'WRITE'
): Promise<SystemSetting> {
  const supabase = getSupabaseClient();
  if (!supabase) return settings;

  try {
    if (mode === 'READ') {
      const { data, error } = await supabase
        .from('system_settings')
        .select('*')
        .eq('id', 'global_settings')
        .maybeSingle();

      if (!error && data) {
        const remoteSettings: SystemSetting = {
          ...settings,
          appName: data.app_name || settings.appName,
          logoUrl: data.logo_url || settings.logoUrl,
          advancePaymentDiscountPct:
            data.advance_payment_discount_pct !== undefined
              ? Number(data.advance_payment_discount_pct)
              : settings.advancePaymentDiscountPct,
          codBaseCharge:
            data.cod_base_charge !== undefined
              ? Number(data.cod_base_charge)
              : settings.codBaseCharge,
          freeShippingMinAmount:
            data.free_shipping_min_amount !== undefined
              ? Number(data.free_shipping_min_amount)
              : settings.freeShippingMinAmount,
          baseDeliveryFee:
            data.base_delivery_fee !== undefined
              ? Number(data.base_delivery_fee)
              : settings.baseDeliveryFee,
          referralRewardAmount:
            data.referral_reward_amount !== undefined
              ? Number(data.referral_reward_amount)
              : settings.referralRewardAmount,
          updatedAt: data.updated_at || settings.updatedAt,
        };
        // Persist local copy
        saveSettingsToFile(remoteSettings);
        return remoteSettings;
      }
    } else if (mode === 'WRITE') {
      // Upsert to Supabase system_settings table
      await supabase.from('system_settings').upsert({
        id: 'global_settings',
        app_name: settings.appName,
        logo_url: settings.logoUrl,
        advance_payment_discount_pct: settings.advancePaymentDiscountPct,
        cod_base_charge: settings.codBaseCharge,
        free_shipping_min_amount: settings.freeShippingMinAmount,
        base_delivery_fee: settings.baseDeliveryFee,
        referral_reward_amount: settings.referralRewardAmount,
        updated_at: settings.updatedAt,
      });
    }
  } catch (err) {
    console.warn('Supabase settings sync error (non-fatal):', err);
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
    let current = loadSettingsFromFile();

    // Check if initial file was missing or needs Supabase sync
    if (!fs.existsSync(SETTINGS_FILE)) {
      current = await syncWithSupabaseIfConfigured(current, 'READ');
      saveSettingsToFile(current);
    }

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
    try {
      const body = await parseJsonBody(req);
      const incomingUpdates: Partial<SystemSetting> = body.settings || body;

      const current = loadSettingsFromFile();

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
        ...(incomingUpdates.advancePaymentDiscountPct !== undefined
          ? { advancePaymentDiscountPct: Number(incomingUpdates.advancePaymentDiscountPct) }
          : {}),
        ...(incomingUpdates.codBaseCharge !== undefined
          ? { codBaseCharge: Number(incomingUpdates.codBaseCharge) }
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

      // Persist to central server store
      saveSettingsToFile(mergedSettings);

      // Asynchronously sync to Supabase if configured
      syncWithSupabaseIfConfigured(mergedSettings, 'WRITE').catch((err) => {
        console.warn('Background Supabase write failed:', err);
      });

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
