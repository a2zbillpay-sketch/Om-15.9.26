/**
 * Browser & PWA System Notifications for Shopkeeper.
 * Uses native Web Notifications API and ServiceWorker showNotification.
 * 100% free, no external push services, SMS, OTP, or third-party accounts required.
 */

export function isNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getNotificationPermission(): NotificationPermission {
  if (!isNotificationSupported()) return 'denied';
  return Notification.permission;
}

export async function requestNotificationPermission(): Promise<NotificationPermission> {
  if (!isNotificationSupported()) return 'denied';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export interface CustomerLoginNotificationData {
  customerName: string;
  loginTime: string;
  phone?: string;
}

/**
 * Display a native browser / PWA notification for a customer login.
 */
export async function showCustomerLoginNotification(
  data: CustomerLoginNotificationData
): Promise<boolean> {
  if (!isNotificationSupported() || Notification.permission !== 'granted') {
    return false;
  }

  const title = 'Customer Logged In';
  const body = `${data.customerName} logged in at ${data.loginTime}`;
  const icon = '/pwa-192x192.png';
  const tag = `customer-login-${Date.now()}`;

  // 1. Try Service Worker registration (ideal for PWA / background display)
  try {
    if ('serviceWorker' in navigator) {
      const registration = await navigator.serviceWorker.ready.catch(() => null);
      if (registration && 'showNotification' in registration) {
        await registration.showNotification(title, {
          body,
          icon,
          badge: icon,
          tag,
          vibrate: [200, 100, 200],
          data: {
            url: window.location.href,
            customerName: data.customerName,
            loginTime: data.loginTime,
          },
        });
        return true;
      }
    }
  } catch (err) {
    console.warn('Service worker notification notice:', err);
  }

  // 2. Fallback to standard Window Notification
  try {
    const notif = new Notification(title, {
      body,
      icon,
      tag,
    });
    notif.onclick = () => {
      window.focus();
      notif.close();
    };
    return true;
  } catch (err) {
    console.warn('Window notification notice:', err);
    return false;
  }
}
