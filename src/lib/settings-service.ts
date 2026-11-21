import { SystemSetting } from '../types';
import { INITIAL_SETTINGS } from '../data/seedData';

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
    s.appName !== INITIAL_SETTINGS.appName
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
        advancePaymentDiscountPct: 0.0,
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
      credentials: 'include',
      cache: 'no-store',
    });

    if (!res.ok) {
      return null;
    }

    const data = await res.json();
    if (data && data.success && data.settings) {
      const s = data.settings;
      const rawDiscount = s.advancePaymentDiscountPct;
      const resolvedDiscount =
        rawDiscount !== undefined && rawDiscount !== null && !isNaN(Number(rawDiscount))
          ? Math.max(0, Math.round(Number(rawDiscount) * 100) / 100)
          : 0.0;

      return {
        ...INITIAL_SETTINGS,
        ...s,
        advancePaymentDiscountPct: resolvedDiscount,
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
 * Unified fetch that queries the server /api/settings endpoint (backed by Service Role)
 * and falls back safely to local cached state without triggering direct anon Supabase queries.
 */
export async function fetchUnifiedSettings(
  currentLocal?: SystemSetting
): Promise<SystemSetting> {
  const local = currentLocal || loadCachedLocalSettings();

  const serverSettings = await fetchRemoteSettings();
  if (serverSettings) {
    saveCachedLocalSettings(serverSettings);
    return serverSettings;
  }

  return {
    ...local,
    advancePaymentDiscountPct: 0.0,
  };
}

/**
 * Saves settings to the server /api/settings endpoint with Shopkeeper session credentials.
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
      credentials: 'include',
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
 * Unified save that persists via /api/settings (which syncs Supabase store_settings & /data/settings.json),
 * localStorage, and cross-tab BroadcastChannel.
 */
export async function saveUnifiedSettings(
  updatedSettings: SystemSetting
): Promise<{ success: boolean; error?: string }> {
  // Update local cache immediately
  saveCachedLocalSettings(updatedSettings);

  // Broadcast to other open tabs and PWA instances
  broadcastSettingsChange(updatedSettings);

  try {
    const srvResult = await saveRemoteSettings(updatedSettings);
    if (srvResult) {
      saveCachedLocalSettings(srvResult);
      return { success: true };
    }
    return { success: false, error: 'Failed to save settings via server API.' };
  } catch (e: any) {
    return {
      success: false,
      error: e?.message || 'Error communicating with settings server API.',
    };
  }
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

  // 1. Cross-context synchronization via BroadcastChannel, storage events, focus/visibility, and polling
  // (Direct browser anon Realtime subscriptions on store_settings are omitted to prevent 401/RLS failures)

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

  // 5. Periodic background polling every 10 minutes (600,000 ms) to keep settings synced
  // while preventing excessive Supabase and server egress bandwidth consumption
  const pollInterval = window.setInterval(() => {
    handleRevalidation();
  }, 600000);

  // Cleanup handler
  return () => {
    isSubscribed = false;
    if (broadcastChannel) {
      broadcastChannel.removeEventListener('message', handleBroadcastMessage);
    }
    window.removeEventListener('storage', handleStorageEvent);
    window.removeEventListener('focus', handleRevalidation);
    document.removeEventListener('visibilitychange', handleVisibilityChange);
    window.clearInterval(pollInterval);
  };
}
