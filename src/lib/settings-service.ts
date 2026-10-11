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
 * Fetches settings from the centralized server endpoint with strict no-cache.
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
    // Offline or network unreachable - fallback gracefully
    return null;
  }
}

/**
 * Saves settings to the centralized server endpoint and broadcasts locally.
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
 * Utilizes BroadcastChannel, cross-window storage events, focus/visibility triggers,
 * and periodic background polling to ensure instant sync.
 */
export function subscribeToSettingsSync(
  onUpdate: (newSettings: SystemSetting) => void
): () => void {
  if (typeof window === 'undefined') {
    return () => {};
  }

  let isSubscribed = true;
  let lastKnownUpdatedAt = '';

  const applyUpdateIfChanged = (incoming: SystemSetting) => {
    if (!isSubscribed || !incoming) return;

    // Compare timestamps or properties
    if (incoming.updatedAt && incoming.updatedAt === lastKnownUpdatedAt) {
      return;
    }

    lastKnownUpdatedAt = incoming.updatedAt || '';
    onUpdate(incoming);
  };

  // 1. BroadcastChannel listener (instant same-origin cross-context messages)
  const handleBroadcastMessage = (event: MessageEvent) => {
    if (event.data?.type === 'OM_SETTINGS_SYNC' && event.data.settings) {
      applyUpdateIfChanged(event.data.settings);
    }
  };

  if (broadcastChannel) {
    broadcastChannel.addEventListener('message', handleBroadcastMessage);
  }

  // 2. Storage event listener (fires when another tab modifies localStorage)
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

  // 3. Focus / Visibility listener: fetches latest server settings immediately
  // when user switches to this window/tab/PWA
  const handleRevalidation = async () => {
    if (!isSubscribed) return;
    const remote = await fetchRemoteSettings();
    if (remote) {
      applyUpdateIfChanged(remote);
    }
  };

  const handleVisibilityChange = () => {
    if (document.visibilityState === 'visible') {
      handleRevalidation();
    }
  };

  window.addEventListener('focus', handleRevalidation);
  document.addEventListener('visibilitychange', handleVisibilityChange);

  // 4. Background polling every 3 seconds to guarantee instant sync
  // even across different browser profiles/sandboxes (PWA vs Samsung Browser vs AI Studio)
  const pollInterval = window.setInterval(() => {
    handleRevalidation();
  }, 3000);

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
