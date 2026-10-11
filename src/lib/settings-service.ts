import { SystemSetting } from '../types';
import { INITIAL_SETTINGS } from '../data/seedData';
import {
  fetchSettingsFromSupabase,
  saveSettingsToSupabase,
  subscribeToSupabaseSettings,
} from './supabase';

const SETTINGS_BROADCAST_CHANNEL = 'om_distributors_settings_sync';
const LOCAL_STORAGE_KEY = 'om_settings';

// Create a BroadcastChannel instance if supported
let broadcastChannel: BroadcastChannel | null = null;
if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
  try {
    broadcastChannel = new BroadcastChannel(SETTINGS_BROADCAST_CHANNEL);
  } catch (err) {
    console.warn('BroadcastChannel not supported or restricted:', err);
  }
}

/**
 * Checks whether settings have non-default customizations that should be preserved.
 */
export function hasCustomSettings(s: SystemSetting): boolean {
  if (!s) return false;
  return (
    (s.logoUrl && s.logoUrl !== '/logo.jpg') ||
    s.codBaseCharge !== INITIAL_SETTINGS.codBaseCharge ||
    s.freeShippingMinAmount !== INITIAL_SETTINGS.freeShippingMinAmount ||
    s.baseDeliveryFee !== INITIAL_SETTINGS.baseDeliveryFee ||
    s.referralRewardAmount !== INITIAL_SETTINGS.referralRewardAmount ||
    s.appName !== INITIAL_SETTINGS.appName ||
    s.advancePaymentDiscountPct !== INITIAL_SETTINGS.advancePaymentDiscountPct
  );
}

/**
 * Loads current settings from localStorage safely without throwing.
 */
export function loadCachedLocalSettings(): SystemSetting {
  if (typeof window === 'undefined') return INITIAL_SETTINGS;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return {
        ...INITIAL_SETTINGS,
        ...parsed,
        lowStockThreshold:
          parsed.lowStockThreshold !== undefined && !isNaN(Number(parsed.lowStockThreshold))
            ? Number(parsed.lowStockThreshold)
            : INITIAL_SETTINGS.lowStockThreshold ?? 10,
      };
    }
  } catch {
    // ignore
  }
  return INITIAL_SETTINGS;
}

/**
 * Saves settings to localStorage safely.
 */
export function saveCachedLocalSettings(settings: SystemSetting): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore
  }
}

/**
 * Fetches settings via the server /api/settings endpoint with strict no-cache.
 */
export async function fetchRemoteSettings(): Promise<SystemSetting | null> {
  try {
    const res = await fetch(`/api/settings?_t=${Date.now()}`, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        Pragma: 'no-cache',
      },
      cache: 'no-store',
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    if (data && data.success && data.settings) {
      const s = data.settings;
      return {
        ...INITIAL_SETTINGS,
        ...s,
        lowStockThreshold:
          s.lowStockThreshold !== undefined && !isNaN(Number(s.lowStockThreshold))
            ? Number(s.lowStockThreshold)
            : INITIAL_SETTINGS.lowStockThreshold ?? 10,
      };
    }
    return null;
  } catch (err) {
    return null;
  }
}

/**
 * Unified fetch that queries Supabase system_settings table first,
 * migrates existing local customizations to Supabase if the database is unseeded,
 * and falls back to /api/settings or local cached state safely without losing data.
 */
export async function fetchUnifiedSettings(
  currentLocal?: SystemSetting
): Promise<SystemSetting> {
  const local = currentLocal || loadCachedLocalSettings();

  // 1. Try Supabase system_settings directly
  try {
    const dbSettings = await fetchSettingsFromSupabase(local);
    if (dbSettings) {
      // If dbSettings has valid timestamp or content, check if we need to migrate local customizations
      if (
        hasCustomSettings(local) &&
        !hasCustomSettings(dbSettings) &&
        local.updatedAt &&
        (!dbSettings.updatedAt || local.updatedAt > dbSettings.updatedAt)
      ) {
        // Migrate existing local customizations up to Supabase
        saveSettingsToSupabase(local).catch((e) =>
          console.warn('Auto-migration to Supabase notice:', e)
        );
        saveCachedLocalSettings(local);
        return local;
      }

      saveCachedLocalSettings(dbSettings);
      return dbSettings;
    } else if (hasCustomSettings(local)) {
      // Supabase table returned null/empty but we have custom settings -> seed Supabase
      saveSettingsToSupabase(local).catch(() => {});
    }
  } catch (err) {
    console.warn('Supabase settings query notice (falling back to server endpoint):', err);
  }

  // 2. Fallback to /api/settings (server persistence)
  const serverSettings = await fetchRemoteSettings();
  if (serverSettings) {
    saveCachedLocalSettings(serverSettings);
    return serverSettings;
  }

  // 3. Fallback safely to current local settings without overriding with defaults
  return local;
}

/**
 * Saves settings to the server endpoint and broadcasts locally.
 */
export async function saveRemoteSettings(
  updates: Partial<SystemSetting>
): Promise<SystemSetting | null> {
  try {
    const res = await fetch(`/api/settings?_t=${Date.now()}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
      cache: 'no-store',
      body: JSON.stringify({ settings: updates }),
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    if (data && data.success && data.settings) {
      return data.settings as SystemSetting;
    }
    return null;
  } catch (err) {
    console.warn('Failed to save settings to server:', err);
    return null;
  }
}

/**
 * Unified save that persists to Supabase system_settings table,
 * /api/settings (server disk), localStorage, and cross-tab BroadcastChannel.
 */
export async function saveUnifiedSettings(
  updatedSettings: SystemSetting
): Promise<{ success: boolean; error?: string }> {
  // Update local cache immediately
  saveCachedLocalSettings(updatedSettings);

  // Broadcast to other open tabs and PWA instances
  broadcastSettingsChange(updatedSettings);

  let supabaseSuccess = false;
  let serverSuccess = false;
  let lastError = '';

  // 1. Direct Supabase write
  try {
    const sbResult = await saveSettingsToSupabase(updatedSettings);
    if (sbResult.success) {
      supabaseSuccess = true;
    } else {
      lastError = sbResult.error || 'Failed to save to Supabase';
    }
  } catch (e: any) {
    lastError = e?.message || 'Error communicating with Supabase';
  }

  // 2. Server API write (which also syncs /data/settings.json and acts as resilient proxy)
  try {
    const srvResult = await saveRemoteSettings(updatedSettings);
    if (srvResult) {
      serverSuccess = true;
    }
  } catch (e: any) {
    if (!lastError) lastError = e?.message || 'Error communicating with server';
  }

  return {
    success: supabaseSuccess || serverSuccess,
    error: supabaseSuccess || serverSuccess ? undefined : lastError,
  };
}

/**
 * Notifies other open contexts (installed PWA, other browser tabs) of a local settings change.
 */
export function broadcastSettingsChange(settings: SystemSetting): void {
  try {
    if (broadcastChannel) {
      broadcastChannel.postMessage({
        type: 'OM_SETTINGS_SYNC',
        settings,
        timestamp: Date.now(),
      });
    }
  } catch {
    // Ignore channel broadcast error
  }
}

/**
 * Subscribes to real-time settings synchronization across:
 * - Installed PWA
 * - Samsung Browser / Mobile Browser
 * - AI Studio preview iframe
 *
 * Utilizes Supabase Postgres Changes, BroadcastChannel, storage events,
 * focus/visibility triggers, and periodic background polling to ensure instant sync.
 */
export function subscribeToSettingsSync(
  onUpdate: (newSettings: SystemSetting) => void,
  currentLocal?: SystemSetting
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let isSubscribed = true;
  let lastKnownUpdatedAt = currentLocal?.updatedAt || '';

  const applyUpdateIfChanged = (incoming: SystemSetting) => {
    if (!isSubscribed || !incoming) return;

    if (incoming.updatedAt && incoming.updatedAt === lastKnownUpdatedAt) {
      return;
    }

    lastKnownUpdatedAt = incoming.updatedAt || '';
    saveCachedLocalSettings(incoming);
    onUpdate(incoming);
  };

  // 1. Supabase Postgres Changes real-time subscription
  const unsubscribeSupabase = subscribeToSupabaseSettings((sbSettings) => {
    applyUpdateIfChanged(sbSettings);
  }, currentLocal);

  // 2. BroadcastChannel listener (instant same-origin cross-context messages)
  const handleBroadcastMessage = (event: MessageEvent) => {
    if (event.data?.type === 'OM_SETTINGS_SYNC' && event.data.settings) {
      applyUpdateIfChanged(event.data.settings);
    }
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handleBroadcastMessage);
  }

  // 3. Storage event listener (fires when another tab modifies localStorage)
  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key === LOCAL_STORAGE_KEY && event.newValue) {
      try {
        const parsed = JSON.parse(event.newValue);
        applyUpdateIfChanged(parsed);
      } catch {
        // Ignore JSON error
      }
    }
  };
  window.addEventListener('storage', handleStorageEvent);

  // 4. Focus / Visibility listener: fetches latest settings immediately
  // when user switches to this window/tab/PWA
  const handleRevalidation = async () => {
    if (!isSubscribed) return;
    const latest = await fetchUnifiedSettings();
    if (latest) {
      applyUpdateIfChanged(latest);
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      handleRevalidation();
    }
  };

  window.addEventListener('focus', handleRevalidation);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // 5. Background polling every 3 seconds to guarantee instant sync
  // even across different browser profiles/sandboxes (PWA vs Samsung Browser vs AI Studio)
  const pollInterval = window.setInterval(() => {
    handleRevalidation();
  }, 3000);

  // Cleanup handler
  return () => {
    isSubscribed = false;
    if (unsubscribeSupabase) {
      unsubscribeSupabase();
    }
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handleBroadcastMessage);
    }
    window.removeEventListener('storage', handleStorageEvent);
    window.removeEventListener('focus', handleRevalidation);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.clearInterval(pollInterval);
  };
}
