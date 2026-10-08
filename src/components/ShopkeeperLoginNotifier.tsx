import React, { useEffect, useState, useRef, useCallback } from 'react';
import { UserCheck, Bell, Volume2, X, CheckCircle2 } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { Role, AdminNotification } from '../types';
import { playNotificationSound } from '../utils/notificationSound';
import {
  isNotificationSupported,
  getNotificationPermission,
  requestNotificationPermission,
  showCustomerLoginNotification,
} from '../utils/browserNotification';

interface ToastData {
  id: string;
  customerName: string;
  loginTime: string;
  phone?: string;
}

export const ShopkeeperLoginNotifier: React.FC = () => {
  const { activeRole, setAdminNotifications } = useApp();
  const [activeToast, setActiveToast] = useState<ToastData | null>(null);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>(() =>
    getNotificationPermission()
  );
  const [hasTestedSound, setHasTestedSound] = useState(false);

  // Set of already alerted event IDs to prevent duplicate notifications
  const alertedIdsRef = useRef<Set<string>>(new Set());
  const lastPollTimestampRef = useRef<number>(Date.now() - 5000);

  const isShopkeeper =
    activeRole === Role.SHOPKEEPER ||
    activeRole === Role.SECONDARY_ADMIN ||
    activeRole === Role.ACCOUNTS;

  // Handler to process a new customer login notification
  const handleCustomerLoginEvent = useCallback(
    (event: {
      id: string;
      customerName: string;
      loginTime: string;
      phone?: string;
      timestamp?: number;
    }) => {
      if (!event.id || alertedIdsRef.current.has(event.id)) {
        return;
      }
      alertedIdsRef.current.add(event.id);

      // 1. Play high-clarity notification chime
      playNotificationSound();

      // 2. Trigger native Browser / PWA Notification
      showCustomerLoginNotification({
        customerName: event.customerName,
        loginTime: event.loginTime,
        phone: event.phone,
      });

      // 3. Display in-app floating banner for Shopkeeper
      setActiveToast({
        id: event.id,
        customerName: event.customerName,
        loginTime: event.loginTime,
        phone: event.phone,
      });

      // 4. Record into persistent adminNotifications
      setAdminNotifications((prev) => {
        if (prev.some((n) => n.id === event.id)) return prev;
        const newNotif: AdminNotification = {
          id: event.id,
          type: 'CUSTOMER_LOGIN',
          title: 'Customer Logged In',
          message: `${event.customerName} logged in at ${event.loginTime}`,
          customerName: event.customerName,
          customerPhone: event.phone,
          loginTime: event.loginTime,
          read: false,
          createdAt: new Date().toISOString(),
        };
        return [newNotif, ...prev];
      });
    },
    [setAdminNotifications]
  );

  // Auto-dismiss floating toast after 8 seconds
  useEffect(() => {
    if (!activeToast) return;
    const timer = setTimeout(() => {
      setActiveToast(null);
    }, 8000);
    return () => clearTimeout(timer);
  }, [activeToast]);

  // Request browser notification permission when in shopkeeper mode
  const handleRequestPermission = async () => {
    const perm = await requestNotificationPermission();
    setNotificationPermission(perm);
    if (perm === 'granted') {
      playNotificationSound();
      showCustomerLoginNotification({
        customerName: 'Om Distributors Alerts',
        loginTime: 'Active now',
      });
    }
  };

  const handleTestSound = () => {
    playNotificationSound();
    setHasTestedSound(true);
    setTimeout(() => setHasTestedSound(false), 2000);
  };

  // Cross-tab and server sync listeners (active whenever Shopkeeper is active)
  useEffect(() => {
    if (!isShopkeeper) return;

    // 1. BroadcastChannel listener (instant across tabs on same device)
    let bc: BroadcastChannel | null = null;
    try {
      bc = new BroadcastChannel('om_customer_login_channel');
      bc.onmessage = (msg) => {
        if (msg.data && msg.data.customerName) {
          handleCustomerLoginEvent(msg.data);
        }
      };
    } catch {}

    // 2. Storage event listener (fallback for other tabs/windows)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'om_last_customer_login' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (parsed && parsed.customerName) {
            handleCustomerLoginEvent(parsed);
          }
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);

    // 3. Polling server endpoint for cross-device customer logins
    const pollInterval = setInterval(async () => {
      try {
        const res = await fetch(`/api/customer-logins?since=${lastPollTimestampRef.current}`);
        if (!res.ok) return;
        const data = await res.json().catch(() => ({}));
        if (data && data.success && Array.isArray(data.logins)) {
          for (const item of data.logins) {
            if (item.timestamp > lastPollTimestampRef.current) {
              lastPollTimestampRef.current = item.timestamp;
            }
            handleCustomerLoginEvent(item);
          }
        }
      } catch {
        // silent fallback
      }
    }, 4000);

    return () => {
      if (bc) bc.close();
      window.removeEventListener('storage', handleStorage);
      clearInterval(pollInterval);
    };
  }, [isShopkeeper, handleCustomerLoginEvent]);

  if (!isShopkeeper) {
    return null;
  }

  return (
    <>
      {/* Permission helper banner if browser notifications are not yet enabled */}
      {isNotificationSupported() && notificationPermission === 'default' && (
        <div className="bg-gradient-to-r from-[#0F2C59] to-[#0a1e3d] text-white px-4 py-2 text-xs flex items-center justify-between border-b border-[#D4AF37]/30 shadow-xs">
          <div className="flex items-center gap-2">
            <Bell size={14} className="text-[#D4AF37] shrink-0 animate-bounce" />
            <span>
              <strong>Customer Login Notifications:</strong> Turn on browser notifications to hear and see alerts when customers log in.
            </span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRequestPermission}
              className="bg-[#D4AF37] hover:bg-[#c49f30] text-[#0F2C59] font-black px-3 py-1 rounded-lg text-[11px] transition shadow-xs cursor-pointer"
            >
              Enable Free Notifications
            </button>
            <button
              onClick={handleTestSound}
              className="bg-white/10 hover:bg-white/20 text-gray-200 px-2.5 py-1 rounded-lg text-[11px] transition flex items-center gap-1 cursor-pointer"
              title="Test notification sound chime"
            >
              <Volume2 size={12} />
              <span>{hasTestedSound ? 'Playing...' : 'Test Sound'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Floating In-App Toast Alert for Shopkeeper */}
      {activeToast && (
        <div className="fixed top-4 right-4 z-50 max-w-sm w-full bg-white rounded-2xl shadow-2xl border-2 border-emerald-500 overflow-hidden animate-slideDown">
          <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white px-4 py-2.5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="p-1 rounded-full bg-white/20 text-white flex items-center justify-center">
                <UserCheck size={16} />
              </span>
              <span className="font-extrabold text-xs tracking-wide uppercase">
                Customer Login Alert
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                onClick={handleTestSound}
                className="p-1 text-white/80 hover:text-white rounded transition"
                title="Replay sound"
              >
                <Volume2 size={14} />
              </button>
              <button
                onClick={() => setActiveToast(null)}
                className="p-1 text-white/80 hover:text-white rounded transition"
                title="Dismiss"
              >
                <X size={15} />
              </button>
            </div>
          </div>
          <div className="p-4 bg-emerald-50/50">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-full bg-emerald-100 border border-emerald-300 flex items-center justify-center text-emerald-800 font-black text-sm shrink-0">
                {activeToast.customerName ? activeToast.customerName.charAt(0).toUpperCase() : 'C'}
              </div>
              <div className="min-w-0 flex-1">
                <h4 className="font-black text-[#0F2C59] text-sm leading-tight truncate">
                  {activeToast.customerName}
                </h4>
                {activeToast.phone && (
                  <p className="text-[11px] text-gray-500 font-medium">
                    +91 {activeToast.phone.replace(/\D/g, '').slice(-10)}
                  </p>
                )}
                <div className="mt-2 flex items-center gap-2 text-xs">
                  <span className="text-gray-500 font-medium">Login Time:</span>
                  <span className="font-bold text-emerald-800 bg-white px-2 py-0.5 rounded-md border border-emerald-200 shadow-2xs">
                    {activeToast.loginTime}
                  </span>
                </div>
              </div>
            </div>
            <div className="mt-3 pt-2.5 border-t border-emerald-200/60 flex items-center justify-between text-[11px]">
              <span className="text-emerald-700 font-medium flex items-center gap-1">
                <CheckCircle2 size={12} className="text-emerald-600" />
                Browser notification &amp; chime sent
              </span>
              <button
                onClick={() => setActiveToast(null)}
                className="text-gray-500 hover:text-gray-800 font-bold"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};
