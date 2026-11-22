import React, { createContext, useContext, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  User,
  Role,
  Product,
  ProductVariant,
  Category,
  SystemSetting,
  CartItem,
  Order,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Address,
  AddressLabel,
  GoogleLocation,
  WalletTransaction,
  AdminNotification,
  ProductRequest,
  RepeatOrderNotice,
  RepeatOrderResult,
  formatFullAddress,
  normalizeAddressLabel,
} from '../types';
import {
  INITIAL_SETTINGS,
  INITIAL_PRODUCTS,
  INITIAL_USERS,
} from '../data/seedData';
import { formatVariantPack } from '../utils/variantFormatter';
import {
  calculateCheckoutTotals,
  CheckoutBreakdown,
  getActiveUnitPrice,
} from '../lib/engine/checkout-calculator';
import {
  isSupabaseConfigured,
  fetchCustomerOrdersFromSupabase,
  saveOrderToSupabase,
  fetchAllOrdersForAdmin,
  updateOrderStatusInSupabase,
  cancelOrderInSupabase,
  fetchCustomerWalletSummaryFromSupabase,
  saveCustomerProfileToSupabase,
  loginCustomerServerSession,
  logoutCustomerServerSession,
  checkCustomerServerSession,
  fetchAddressesFromSupabase,
  createAddressInSupabase,
  updateAddressInSupabase,
  deleteAddressInSupabase,
  setDefaultAddressInSupabase,
  fetchCustomerProfileFromSupabase,
  saveProductToSupabase,
  fetchProductsFromSupabase,
  deleteProductFromSupabase,
  updateProductStockInSupabase,
  saveEditedOrderToSupabase,
  saveProductRequestToSupabase,
  fetchProductRequestsFromSupabase,
  subscribeToProductRequests,
  fetchCategoriesFromSupabase,
  saveCategoryToSupabase,
  deleteCategoryFromSupabase,
  reorderCategoriesInSupabase,
  DUPLICATE_CUSTOMER_MESSAGE,
  INDIAN_MOBILE_REGEX,
  INVALID_INDIAN_MOBILE_MESSAGE,
  normalizeIndianMobile,
  getIndianMobileVariants,
} from '../lib/supabase';

import { reorderProductsInDb } from '../lib/product-service';
import {
  calculateCustomerOutstanding,
  allocateCodCollection,
  recordCodCollectionViaApi,
  fetchCodCollectionsFromApi,
  isSameCustomer,
} from '../lib/cod-storage';
import {
  deductStockForOrder,
  restoreStockForOrder,
  adjustStockForEditedOrder,
  findProductAndVariant,
  validateOrderStockAvailability,
  isStockDeductedForOrder,
  markStockDeductedForOrder,
  isStockRestoredForOrder,
  markStockRestoredForOrder,
} from '../lib/stock-service';
import {
  fetchUnifiedSettings,
  saveUnifiedSettings,
  broadcastSettingsChange,
  subscribeToSettingsSync,
} from '../lib/settings-service';

export type CustomerFlowStep = 'AUTH' | 'PROFILE' | 'SHOP';

export interface CustomerSession {
  phone: string;
  role: Role;
  profileCompleted: boolean;
}

const BLANK_CUSTOMER: User = {
  id: '',
  name: '',
  phone: '',
  role: Role.CUSTOMER,
  walletBalance: 0,
  codOrderCount: 0,
  addresses: [],
  createdAt: '',
};

// Customer-scoped cart helpers: Isolates every customer's cart by their normalized 10-digit mobile number.
const getCustomerCartKey = (phone?: string): string | null => {
  if (!phone) return null;
  const cleanPhone = normalizeIndianMobile(phone);
  return cleanPhone && INDIAN_MOBILE_REGEX.test(cleanPhone) ? `om_cart_${cleanPhone}` : null;
};

const loadCustomerCart = (phone?: string): CartItem[] => {
  const key = getCustomerCartKey(phone);
  if (!key) return [];
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : [];
  } catch {
    return [];
  }
};

const saveCustomerCart = (phone: string | undefined, cartItems: CartItem[]): void => {
  const key = getCustomerCartKey(phone);
  if (!key) return;
  try {
    if (cartItems.length === 0) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(cartItems));
    }
  } catch {
    // ignore storage quota errors
  }
};

export interface CancelOrderResult {
  success: boolean;
  alreadyCancelled?: boolean;
  refunded?: boolean;
  refundAmount?: number;
  walletUsed?: number;
  onlinePaid?: number;
  codPaid?: number;
  stockRestored?: boolean;
  offlineOnly?: boolean;
  order?: Order;
  error?: string;
}

interface AppContextType {
  currentUser: User;
  setCurrentUser: (user: User) => void;
  users: User[];
  activeRole: Role;
  setActiveRole: (role: Role) => void;
  customerFlowStep: CustomerFlowStep;
  setCustomerFlowStep: (step: CustomerFlowStep) => void;
  saveCustomerProfile: (data: {
    name: string;
    addressLine1: string;
    addressLine2?: string;
    landmark: string;
    city: string;
    state: string;
    pincode: string;
    label?: string;
    addressLabel?: AddressLabel | string;
    fullAddress?: string;
  }) => Promise<void>;
  settings: SystemSetting;
  updateSettings: (newSettings: Partial<SystemSetting>) => void;
  categories: Category[];
  refreshCategories: () => Promise<void>;
  addCategory: (categoryData: {
    name: string;
    imageUrl?: string;
  }) => Promise<{ success: boolean; error?: string; category?: Category }>;
  updateCategory: (
    id: string,
    updates: { name?: string; imageUrl?: string }
  ) => Promise<{ success: boolean; error?: string; category?: Category }>;
  deleteCategory: (id: string) => Promise<{ success: boolean; error?: string }>;
  reorderCategories: (newCategories: Category[]) => Promise<{ success: boolean; error?: string }>;
  products: Product[];
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<{ success: boolean; error?: string }>;
  bulkAddProducts: (
    newProds: Omit<Product, 'id' | 'createdAt'>[]
  ) => Promise<{ successCount: number; failedCount: number; errors: string[] }>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<{ success: boolean; error?: string }>;
  deleteProduct: (id: string) => Promise<{ success: boolean; error?: string }>;
  reorderProducts: (newProducts: Product[]) => Promise<{ success: boolean; error?: string }>;
  reorderVariants: (productId: string, newVariants: ProductVariant[]) => Promise<{ success: boolean; error?: string }>;
  cart: CartItem[];
  addToCart: (product: Product, variant?: ProductVariant | null, quantity?: number) => void;
  updateCartQty: (variantId: string, quantity: number) => void;
  removeFromCart: (variantId: string) => void;
  clearCart: () => void;
  editingOrder: Order | null;
  startEditingOrder: (order: Order) => void;
  cancelEditingOrder: () => void;
  saveEditedOrder: () => Promise<{
    success: boolean;
    error?: string;
    updatedOrder?: Order;
    remainingAmountToPay?: number;
    previousOnlinePaid?: number;
    walletAmountUsed?: number;
    requiresPayment?: boolean;
  }>;
  confirmEditedOrderPayment: (orderId: string, paymentMethodApp?: string) => Promise<{
    success: boolean;
    updatedOrder?: Order;
    error?: string;
  }>;
  repeatLastOrder: () => RepeatOrderResult;
  repeatOrder: (order: Order) => RepeatOrderResult;
  repeatOrderNotice: RepeatOrderNotice | null;
  setRepeatOrderNotice: (notice: RepeatOrderNotice | null) => void;
  checkoutBreakdown: CheckoutBreakdown;
  useWalletBalance: boolean;
  setUseWalletBalance: (use: boolean) => void;
  orders: Order[];
  customerOutstanding: number;
  getCustomerOutstanding: (phoneOrId?: string, excludeOrderId?: string) => number;
  createOrder: (data: {
    address: Address;
    paymentMethod: PaymentMethod;
    deliveryDate: string;
    useWallet?: boolean;
    orderId?: string;
    orderNumber?: string;
    selectedPaymentApp?: string;
    isWalletPayment?: boolean;
    googleLocation?: GoogleLocation;
  }) => Promise<Order>;
  cancelOrder: (orderId: string, isShopkeeperOverride?: boolean) => Promise<CancelOrderResult>;
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => Promise<{ success: boolean; error?: string }>;
  recordCodCollection: (
    orderId: string,
    collectedAmount: number,
    markAsDelivered?: boolean
  ) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string };
  userAddresses: Address[];
  addressesLoading: boolean;
  addressesError: string | null;
  refreshAddresses: () => Promise<Address[]>;
  addAddress: (
    address: Omit<Address, 'id' | 'userId'>
  ) => Promise<{ success: boolean; error?: string; address?: Address }>;
  updateAddress: (
    addressId: string,
    updates: Partial<Address>
  ) => Promise<{ success: boolean; error?: string; address?: Address }>;
  deleteAddress: (addressId: string) => Promise<{ success: boolean; error?: string }>;
  setDefaultAddress: (addressId: string) => Promise<{ success: boolean; error?: string }>;
  selectedAddressId: string | null;
  setSelectedAddressId: (id: string) => void;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  loginWithPhone: (
    phone: string,
    role: Role,
    name?: string,
    options?: { isExisting?: boolean; isNewRegistration?: boolean }
  ) => Promise<User>;
  logout: () => void;
  isSupabaseConfigured: boolean;
  refreshOrders: () => Promise<Order[] | null>;
  refreshCustomerWallet: () => Promise<number | null>;
  refreshProducts: () => Promise<void>;
  isAdminSessionValid: boolean;
  isVerifyingAdminSession: boolean;
  shopkeeperLoginRedirect: boolean;
  clearShopkeeperLoginRedirect: () => void;
  checkAdminSession: () => Promise<boolean>;
  logoutAdminSession: () => Promise<void>;
  walletTransactions: WalletTransaction[];
  adminNotifications: AdminNotification[];
  markNotificationAsRead: (id: string) => void;
  markAllNotificationsAsRead: () => void;
  productRequests: ProductRequest[];
  requestProduct: (data: {
    product: Product;
    variant: ProductVariant;
    quantity: number;
    customerOverride?: { name?: string; phone?: string; id?: string };
  }) => ProductRequest;
  refreshProductRequests: () => Promise<void>;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  // Load state from localStorage or seed
  const [settings, setSettings] = useState<SystemSetting>(() => {
    const saved = localStorage.getItem('om_settings');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (!parsed.logoUrl || parsed.logoUrl.trim() === '' || parsed.logoUrl === '/icons/icon-192x192.png') {
          parsed.logoUrl = '/logo.jpg';
        }
        if (parsed.lowStockThreshold === undefined || parsed.lowStockThreshold === null || isNaN(Number(parsed.lowStockThreshold))) {
          parsed.lowStockThreshold = INITIAL_SETTINGS.lowStockThreshold ?? 10;
        }
        parsed.advancePaymentDiscountPct = 0.0;
        return parsed;
      } catch {
        return INITIAL_SETTINGS;
      }
    }
    return INITIAL_SETTINGS;
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    try {
      const saved = localStorage.getItem('om_categories');
      if (saved) {
        const parsed: Category[] = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Explicitly purge any legacy 15 default/sample categories (cat-1 to cat-15)
          const DEFAULT_CAT_IDS = new Set([
            'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7',
            'cat-8', 'cat-9', 'cat-10', 'cat-11', 'cat-12', 'cat-13', 'cat-14', 'cat-15',
          ]);
          const userDefinedCategories = parsed.filter(
            (c) => c && c.id && !DEFAULT_CAT_IDS.has(c.id) && !/^cat-(?:[1-9]|1[0-5])$/i.test(c.id)
          );
          if (userDefinedCategories.length > 0) {
            return userDefinedCategories;
          }
        }
      }
      localStorage.removeItem('om_categories');
    } catch {}
    return [];
  });

  // Pull persisted categories from Supabase on application mount
  useEffect(() => {
    fetchCategoriesFromSupabase()
      .then((cats) => {
        if (Array.isArray(cats)) {
          const DEFAULT_CAT_IDS = new Set([
            'cat-1', 'cat-2', 'cat-3', 'cat-4', 'cat-5', 'cat-6', 'cat-7',
            'cat-8', 'cat-9', 'cat-10', 'cat-11', 'cat-12', 'cat-13', 'cat-14', 'cat-15',
          ]);
          const userCats = cats.filter(
            (c) => c && c.id && !DEFAULT_CAT_IDS.has(c.id) && !/^cat-(?:[1-9]|1[0-5])$/i.test(c.id)
          );
          setCategories(userCats);
          if (userCats.length === 0) {
            try {
              localStorage.removeItem('om_categories');
            } catch {}
          }
        }
      })
      .catch((err) => {
        console.warn('Initial categories fetch notice:', err);
      });
  }, []);

  useEffect(() => {
    try {
      if (categories && categories.length > 0) {
        localStorage.setItem('om_categories', JSON.stringify(categories));
      } else {
        localStorage.removeItem('om_categories');
      }
    } catch {}
  }, [categories]);

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('om_products');
    if (!saved) return INITIAL_PRODUCTS;
    try {
      const parsed: Product[] = JSON.parse(saved);
      if (!Array.isArray(parsed)) return INITIAL_PRODUCTS;
      const normalized = parsed.map((p) => {
        let name = p.name;
        let brand = p.brand;
        if (p.id === 'prod-6' && (p.name.includes('(Price Capped)') || p.name.includes('Vacuum'))) {
          name = 'Tata Salt';
        }
        if (p.id === 'prod-3' && p.name.includes('Shudh Chakki')) {
          name = 'Aashirvaad Atta';
          brand = 'Aashirvaad';
        }
        const updatedVariants = (p.variants || []).map((v) => ({
          ...v,
          packLabel: formatVariantPack(v),
        }));
        return { ...p, name, brand, variants: updatedVariants };
      });
      return normalized;
    } catch {
      return INITIAL_PRODUCTS;
    }
  });

  const [users, setUsers] = useState<User[]>(() => {
    // Safely remove legacy cached entry for phone 9820123456 / user-customer-1
    try {
      localStorage.removeItem('om_profile_9820123456');
      localStorage.removeItem('om_profile_+919820123456');
      const savedCur = localStorage.getItem('om_current_user');
      if (savedCur) {
        const parsedCur = JSON.parse(savedCur);
        if (parsedCur.phone === '9820123456' || parsedCur.id === 'user-customer-1') {
          localStorage.removeItem('om_current_user');
        }
      }
      const savedSession = localStorage.getItem('om_customer_session');
      if (savedSession) {
        const parsedSession = JSON.parse(savedSession);
        if (parsedSession.phone === '9820123456') {
          localStorage.removeItem('om_customer_session');
        }
      }

      // Safely purge invalid shopkeeper profile cached under customer profile keys
      const cachedShopProfile = localStorage.getItem('om_profile_9876543210');
      if (cachedShopProfile) {
        try {
          const parsed = JSON.parse(cachedShopProfile);
          if (parsed.role !== Role.CUSTOMER || parsed.id === 'user-shopkeeper' || parsed.name?.includes('Proprietor')) {
            localStorage.removeItem('om_profile_9876543210');
          }
        } catch {
          localStorage.removeItem('om_profile_9876543210');
        }
      }
      if (savedSession) {
        try {
          const parsedSession = JSON.parse(savedSession);
          if (parsedSession.role === Role.CUSTOMER && parsedSession.phone === '9876543210') {
            const profile = localStorage.getItem('om_profile_9876543210');
            if (!profile) {
              localStorage.removeItem('om_customer_session');
            }
          }
        } catch {}
      }
    } catch {}

    const saved = localStorage.getItem('om_users');
    const rawUsers: User[] = saved ? JSON.parse(saved) : INITIAL_USERS;
    return rawUsers.filter(
      (u) => u.phone !== '9820123456' && u.id !== 'user-customer-1'
    );
  });

  const isAdminRoleValue = (role: unknown): boolean =>
    role === Role.SHOPKEEPER || role === Role.SECONDARY_ADMIN || role === Role.ACCOUNTS;

  const [isVerifyingAdminSession, setIsVerifyingAdminSession] = useState<boolean>(() => {
    const savedSession = localStorage.getItem('om_customer_session');
    if (!savedSession) return false;
    try {
      const session: CustomerSession = JSON.parse(savedSession);
      return isAdminRoleValue(session?.role);
    } catch {
      return false;
    }
  });

  const [isAdminSessionValid, setIsAdminSessionValid] = useState<boolean>(false);
  const isAdminSessionValidRef = useRef<boolean>(false);

  const [shopkeeperLoginRedirect, setShopkeeperLoginRedirect] = useState<boolean>(false);
  const clearShopkeeperLoginRedirect = useCallback(() => {
    setShopkeeperLoginRedirect(false);
  }, []);

  const [customerFlowStep, setCustomerFlowStep] = useState<CustomerFlowStep>(() => {
    const savedSession = localStorage.getItem('om_customer_session');
    if (savedSession) {
      try {
        const session: CustomerSession = JSON.parse(savedSession);
        if (isAdminRoleValue(session.role)) return 'AUTH';
        const cleanSessionPhone = normalizeIndianMobile(session.phone);
        if (!cleanSessionPhone) return 'AUTH';
        if (session.profileCompleted) {
          if (session.role === Role.CUSTOMER && cleanSessionPhone === '9876543210') {
            const cached = localStorage.getItem('om_profile_9876543210');
            if (!cached) return 'AUTH';
            try {
              const parsed = JSON.parse(cached);
              if (parsed.role !== Role.CUSTOMER || parsed.id === 'user-shopkeeper') return 'AUTH';
            } catch {
              return 'AUTH';
            }
          }
          return 'SHOP';
        }
        return 'PROFILE';
      } catch {
        return 'AUTH';
      }
    }
    return 'AUTH';
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    const savedSession = localStorage.getItem('om_customer_session');
    if (savedSession) {
      try {
        const session: CustomerSession = JSON.parse(savedSession);
        if (isAdminRoleValue(session.role)) {
          return BLANK_CUSTOMER;
        }

        const cleanSessionPhone = normalizeIndianMobile(session.phone);
        if (!cleanSessionPhone) {
          return BLANK_CUSTOMER;
        }

        // Rule: Sourced strictly for session.phone, accepting ONLY Role.CUSTOMER. Never use SHOPKEEPER or ADMIN.
        // When Supabase is configured, never treat localStorage addresses as authoritative; wait for DB fetch.
        const phoneKey = `om_profile_${cleanSessionPhone}`;
        const savedPhoneProfile = localStorage.getItem(phoneKey);
        if (savedPhoneProfile) {
          try {
            const parsed = JSON.parse(savedPhoneProfile);
            if (parsed && parsed.role === Role.CUSTOMER && parsed.id !== 'user-shopkeeper') {
              return isSupabaseConfigured
                ? { ...parsed, phone: cleanSessionPhone, addresses: [] }
                : { ...parsed, phone: cleanSessionPhone };
            }
          } catch {}
        }

        if (!isSupabaseConfigured) {
          const match = INITIAL_USERS.find(
            (u) => u.role === Role.CUSTOMER && normalizeIndianMobile(u.phone) === cleanSessionPhone
          );
          if (match) return match;
        }

        return {
          id: `user-${cleanSessionPhone}`,
          name: '',
          phone: cleanSessionPhone,
          role: Role.CUSTOMER,
          walletBalance: 0,
          codOrderCount: 0,
          addresses: [],
          createdAt: new Date().toISOString(),
        };
      } catch {
        // Fallback to blank
      }
    }
    return BLANK_CUSTOMER;
  });

  const [activeRole, setActiveRoleState] = useState<Role>(() => {
    const savedSession = localStorage.getItem('om_customer_session');
    if (savedSession) {
      try {
        const session = JSON.parse(savedSession);
        if (isAdminRoleValue(session?.role)) {
          return Role.CUSTOMER;
        }
        return session.role || Role.CUSTOMER;
      } catch {
        return Role.CUSTOMER;
      }
    }
    return Role.CUSTOMER;
  });

  const [cart, setCart] = useState<CartItem[]>(() => {
    // Isolate cart to active customer session phone
    const savedSession = localStorage.getItem('om_customer_session');
    if (savedSession) {
      try {
        const session: CustomerSession = JSON.parse(savedSession);
        if (session.phone && !isAdminRoleValue(session.role)) {
          return loadCustomerCart(session.phone);
        }
      } catch {
        // Fallback to empty
      }
    }
    return [];
  });

  const [editingOrder, setEditingOrder] = useState<Order | null>(null);
  const [savedPreEditCart, setSavedPreEditCart] = useState<CartItem[] | null>(null);

  const [orders, setOrders] = useState<Order[]>(() => {
    if (isSupabaseConfigured) {
      return [];
    }
    const saved = localStorage.getItem('om_orders');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          return parsed.map((o: any) => ({
            ...o,
            totalPayable:
              o.paymentMethod === PaymentMethod.COD
                ? o.finalAmount
                : (o.totalPayable ?? o.finalAmount),
          }));
        }
      } catch {}
    }
    return [];
  });

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(() => {
    const defaultAddr = currentUser.addresses.find((a) => a.isDefault);
    return defaultAddr ? defaultAddr.id : currentUser.addresses[0]?.id || null;
  });

  const [addressesLoading, setAddressesLoading] = useState<boolean>(false);
  const [addressesError, setAddressesError] = useState<string | null>(null);

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>(() => {
    if (isSupabaseConfigured) {
      return [];
    }
    const saved = localStorage.getItem('om_wallet_transactions');
    return saved ? JSON.parse(saved) : [];
  });

  const [adminNotifications, setAdminNotifications] = useState<AdminNotification[]>(() => {
    const saved = localStorage.getItem('om_admin_notifications');
    return saved ? JSON.parse(saved) : [];
  });

  const [productRequests, setProductRequests] = useState<ProductRequest[]>(() => {
    try {
      const saved = localStorage.getItem('om_product_requests');
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  const refreshProductRequests = useCallback(async () => {
    try {
      const remote = await fetchProductRequestsFromSupabase();
      if (remote && Array.isArray(remote)) {
        setProductRequests((prev) => {
          const map = new Map<string, ProductRequest>();
          remote.forEach((r) => map.set(r.id, r));
          prev.forEach((r) => {
            if (!map.has(r.id)) {
              map.set(r.id, r);
            }
          });
          const merged = Array.from(map.values()).sort(
            (a, b) => new Date(b.requestDate || b.createdAt).getTime() - new Date(a.requestDate || a.createdAt).getTime()
          );
          try {
            localStorage.setItem('om_product_requests', JSON.stringify(merged));
          } catch {}
          return merged;
        });
      }
    } catch (err) {
      console.warn('Error refreshing product requests:', err);
    }
  }, []);

  const requestProduct = useCallback(
    (data: {
      product: Product;
      variant: ProductVariant;
      quantity: number;
      customerOverride?: { name?: string; phone?: string; id?: string };
    }): ProductRequest => {
      const now = new Date();
      const customerId = data.customerOverride?.id || currentUser.id || `cust-${now.getTime()}`;
      const customerName = data.customerOverride?.name || currentUser.name || 'Customer';
      const customerPhone = data.customerOverride?.phone || currentUser.phone || '';

      const newRequest: ProductRequest = {
        id: `preq-${now.getTime()}-${Math.floor(Math.random() * 1000)}`,
        customer: {
          id: customerId,
          name: customerName,
          phone: customerPhone,
        },
        customerId,
        customerName,
        customerPhone,
        product: {
          id: data.product.id,
          name: data.product.name,
          brand: data.product.brand,
          variantId: data.variant.id,
          variantName: data.variant.packLabel || formatVariantPack(data.variant),
          packSize: formatVariantPack(data.variant),
          unit: data.variant.unit,
          price: data.variant.baseSellingPrice,
        },
        productId: data.product.id,
        productName: data.product.name,
        variantId: data.variant.id,
        variantName: data.variant.packLabel || formatVariantPack(data.variant),
        packSize: formatVariantPack(data.variant),
        quantity: Math.max(1, data.quantity || 1),
        requestDate: now.toISOString(),
        createdAt: now.toISOString(),
      };

      setProductRequests((prev) => {
        const updated = [newRequest, ...prev.filter((r) => r.id !== newRequest.id)];
        try {
          localStorage.setItem('om_product_requests', JSON.stringify(updated));
          const cleanPhone = customerPhone.replace(/\D/g, '').slice(-10);
          if (cleanPhone) {
            localStorage.setItem(`om_product_requests_${cleanPhone}`, JSON.stringify(updated));
          }
        } catch {}
        return updated;
      });

      // Persist to Supabase product_requests table
      saveProductRequestToSupabase(newRequest).catch((err) => {
        console.warn('Notice saving product request to Supabase:', err);
      });

      // Real-time broadcast to all browser tabs and windows
      try {
        if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
          const bc = new BroadcastChannel('om_product_request_channel');
          bc.postMessage({ type: 'NEW_REQUEST', request: newRequest });
          setTimeout(() => {
            try {
              bc.close();
            } catch {}
          }, 1000);
          window.dispatchEvent(new CustomEvent('om_product_requests_updated', { detail: newRequest }));
        }
      } catch {}

      return newRequest;
    },
    [currentUser.id, currentUser.name, currentUser.phone]
  );

  // Synchronize product requests across tabs, windows, and remote Supabase
  useEffect(() => {
    const unsubscribeSupabase = subscribeToProductRequests((incoming) => {
      setProductRequests((prev) => {
        if (prev.some((r) => r.id === incoming.id)) return prev;
        const updated = [incoming, ...prev];
        try {
          localStorage.setItem('om_product_requests', JSON.stringify(updated));
        } catch {}
        return updated;
      });
    });

    let bc: BroadcastChannel | null = null;
    try {
      if (typeof window !== 'undefined' && 'BroadcastChannel' in window) {
        bc = new BroadcastChannel('om_product_request_channel');
        bc.onmessage = (event) => {
          if (event.data?.type === 'NEW_REQUEST' && event.data.request) {
            const incoming: ProductRequest = event.data.request;
            setProductRequests((prev) => {
              if (prev.some((r) => r.id === incoming.id)) return prev;
              const updated = [incoming, ...prev];
              try {
                localStorage.setItem('om_product_requests', JSON.stringify(updated));
              } catch {}
              return updated;
            });
          }
        };
      }
    } catch {}

    const handleCustomUpdate = (e: Event) => {
      const detail = (e as CustomEvent)?.detail;
      if (detail && detail.id) {
        setProductRequests((prev) => {
          if (prev.some((r) => r.id === detail.id)) return prev;
          const updated = [detail, ...prev];
          try {
            localStorage.setItem('om_product_requests', JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
    };
    window.addEventListener('om_product_requests_updated', handleCustomUpdate);

    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'om_product_requests' && e.newValue) {
        try {
          const parsed = JSON.parse(e.newValue);
          if (Array.isArray(parsed)) {
            setProductRequests(parsed);
          }
        } catch {}
      }
    };
    window.addEventListener('storage', handleStorage);

    return () => {
      unsubscribeSupabase();
      try {
        bc?.close();
      } catch {}
      window.removeEventListener('om_product_requests_updated', handleCustomUpdate);
      window.removeEventListener('storage', handleStorage);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem('om_wallet_transactions', JSON.stringify(walletTransactions));
  }, [walletTransactions]);

  useEffect(() => {
    localStorage.setItem('om_admin_notifications', JSON.stringify(adminNotifications));
  }, [adminNotifications]);

  const markNotificationAsRead = (id: string) => {
    setAdminNotifications((prev) =>
      prev.map((n) => (n.id === id ? { ...n, read: true } : n))
    );
  };

  const markAllNotificationsAsRead = () => {
    setAdminNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
  };

  // Sync settings across platforms and persist locally
  useEffect(() => {
    try {
      localStorage.setItem('om_settings', JSON.stringify(settings));
    } catch {
      // ignore
    }
  }, [settings]);

  // Synchronize settings with Supabase store_settings table, server, and cross-context channels
  useEffect(() => {
    // 1. Initial fetch from Supabase (store_settings is authoritative for discount & settings)
    fetchUnifiedSettings(settings).then((unified) => {
      if (unified) {
        try {
          localStorage.setItem('om_settings', JSON.stringify(unified));
        } catch {
          // ignore
        }
        setSettings(unified);
      }
    });

    // 2. Real-time subscription across Supabase postgres_changes, BroadcastChannel, and window triggers
    const unsubscribe = subscribeToSettingsSync((synced) => {
      setSettings(synced);
      try {
        localStorage.setItem('om_settings', JSON.stringify(synced));
      } catch {
        // ignore
      }
    }, settings);

    return () => {
      unsubscribe();
    };
  }, []);

  // Sync favicon/apple-touch-icon dynamically when logo changes
  useEffect(() => {
    if (typeof document !== 'undefined' && settings.logoUrl) {
      try {
        const iconLinks = document.querySelectorAll<HTMLLinkElement>(
          "link[rel='icon'], link[rel='shortcut icon']"
        );
        iconLinks.forEach((link) => {
          link.href = settings.logoUrl;
        });
      } catch {
        // ignore
      }
    }
  }, [settings.logoUrl]);

  const productsRef = useRef<Product[]>(products);
  const ordersRef = useRef<Order[]>(orders);
  const hasSyncedProductsRef = useRef<boolean>(!isSupabaseConfigured);

  useEffect(() => {
    productsRef.current = products;
    localStorage.setItem('om_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    try {
      const sanitizedUsers = isSupabaseConfigured
        ? users.map((u) => (u.role === Role.CUSTOMER ? { ...u, addresses: [] } : u))
        : users;
      localStorage.setItem('om_users', JSON.stringify(sanitizedUsers));
    } catch {}
  }, [users]);

  useEffect(() => {
    try {
      const sanitizedCurrent =
        isSupabaseConfigured && currentUser.role === Role.CUSTOMER
          ? { ...currentUser, addresses: [] }
          : currentUser;
      localStorage.setItem('om_current_user', JSON.stringify(sanitizedCurrent));
    } catch {}
  }, [currentUser]);

  // Sync cart strictly to the active customer's scoped key. Never store to a shared global cart.
  useEffect(() => {
    if (currentUser && currentUser.phone) {
      saveCustomerCart(currentUser.phone, cart);
    }
  }, [cart, currentUser]);

  useEffect(() => {
    ordersRef.current = orders;
    localStorage.setItem('om_orders', JSON.stringify(orders));
  }, [orders]);

  // Synchronize orders with Supabase and persistent COD ledger
  const refreshOrders = async (): Promise<Order[] | null> => {
    try {
      let fetchedOrders: Order[] | null = null;
      const isAdminView =
        activeRole === Role.SHOPKEEPER ||
        activeRole === Role.SECONDARY_ADMIN ||
        activeRole === Role.ACCOUNTS;

      const cleanCustomerPhone = (currentUser.phone || '').replace(/\D/g, '').slice(-10);
      if (!isAdminView && cleanCustomerPhone.length !== 10) {
        return isSupabaseConfigured ? null : [];
      }

      if (isSupabaseConfigured) {
        if (isAdminView) {
          fetchedOrders = await fetchAllOrdersForAdmin();
        } else {
          fetchedOrders = await fetchCustomerOrdersFromSupabase(currentUser.id, cleanCustomerPhone);
        }

        // Fail closed when authoritative DB/API fetch fails: never fall back to stale cached orders
        if (fetchedOrders === null) {
          return null;
        }
      }

      // When Supabase successfully returns [], set orders to []
      if (fetchedOrders !== null && fetchedOrders.length === 0) {
        setOrders([]);
        return [];
      }

      // Fetch persistent COD transactions and allocations from backend API strictly in verified SHOPKEEPER Admin View
      const canFetchCodCollections =
        isAdminView &&
        activeRole === Role.SHOPKEEPER &&
        (isAdminSessionValid || isAdminSessionValidRef.current) &&
        !isVerifyingAdminSession;
      const apiData = canFetchCodCollections ? await fetchCodCollectionsFromApi() : null;

      // Preserve rich item definitions and stock status from current orders
      const resolvedFetched = fetchedOrders
        ? fetchedOrders.map((fo) => {
            const local = orders.find((lo) => lo.id === fo.id || lo.orderNumber === fo.orderNumber);
            if (!local) return fo;
            const localHasRichItems = local.items?.some((it) => it.variantId || it.productId);
            const fetchedHasRichItems = fo.items?.some((it) => it.variantId || it.productId);
            return {
              ...fo,
              items: !fetchedHasRichItems && localHasRichItems ? local.items : fo.items,
              stockDeducted: fo.stockDeducted ?? local.stockDeducted ?? false,
              stockRestored: fo.stockRestored ?? local.stockRestored ?? false,
            };
          })
        : null;

      const baseOrders = resolvedFetched && resolvedFetched.length > 0 ? resolvedFetched : orders;
      let finalOrders = baseOrders;

      if (apiData && apiData.success && apiData.ordersMap) {
        finalOrders = baseOrders.map((o) => {
          const persisted = apiData.ordersMap[o.id];
          if (persisted) {
            return {
              ...o,
              codCollectedAmount: persisted.codCollectedAmount ?? o.codCollectedAmount ?? 0,
              previousOutstanding: persisted.previousOutstanding ?? o.previousOutstanding ?? 0,
              totalPayable:
                o.paymentMethod === PaymentMethod.COD
                  ? o.finalAmount
                  : (persisted.totalPayable ?? o.totalPayable ?? o.finalAmount),
              paymentStatus: (persisted.paymentStatus as PaymentStatus) || o.paymentStatus,
              status: ((persisted as any).status as OrderStatus) || o.status,
            };
          }
          return o;
        });
        setOrders(finalOrders);
      } else if (resolvedFetched && resolvedFetched.length > 0) {
        finalOrders = resolvedFetched;
        setOrders(resolvedFetched);
      } else if (fetchedOrders && fetchedOrders.length > 0) {
        finalOrders = fetchedOrders;
        setOrders(fetchedOrders);
      }

      if (isAdminView) {
        refreshProductRequests().catch(() => {});
      }
      return finalOrders;
    } catch (err) {
      console.warn('Error refreshing orders and COD ledger:', err);
      return null;
    }
  };

  // Synchronize with persistent local COD ledger only in offline mode with a verified SHOPKEEPER session
  useEffect(() => {
    if (
      isSupabaseConfigured !== false ||
      activeRole !== Role.SHOPKEEPER ||
      isAdminSessionValid !== true ||
      isVerifyingAdminSession !== false
    ) {
      return;
    }
    fetchCodCollectionsFromApi()
      .then((apiData) => {
        if (apiData && apiData.success && apiData.ordersMap) {
          setOrders((prev) =>
            prev.map((o) => {
              const persisted = apiData.ordersMap[o.id];
              if (persisted) {
                return {
                  ...o,
                  codCollectedAmount: persisted.codCollectedAmount ?? o.codCollectedAmount ?? 0,
                  previousOutstanding: persisted.previousOutstanding ?? o.previousOutstanding ?? 0,
                  totalPayable:
                    o.paymentMethod === PaymentMethod.COD
                      ? o.finalAmount
                      : (persisted.totalPayable ?? o.totalPayable ?? o.finalAmount),
                  paymentStatus: (persisted.paymentStatus as PaymentStatus) || o.paymentStatus,
                  status: ((persisted as any).status as OrderStatus) || o.status,
                };
              }
              return o;
            })
          );
        }
      })
      .catch((err) => {
        console.warn('Initial COD ledger sync notice:', err);
      });
  }, [isSupabaseConfigured, activeRole, isAdminSessionValid, isVerifyingAdminSession]);

  // Synchronize central product catalog with Supabase
  const refreshProducts = async () => {
    if (!isSupabaseConfigured) {
      hasSyncedProductsRef.current = true;
      return;
    }
    try {
      const dbProducts = await fetchProductsFromSupabase();
      // If Supabase is temporarily unavailable (returns null), do not overwrite central catalog
      if (dbProducts !== null) {
        hasSyncedProductsRef.current = true;
        productsRef.current = dbProducts;
        try {
          localStorage.setItem('om_products', JSON.stringify(dbProducts));
        } catch {}
        setProducts(dbProducts);
      }
    } catch (err) {
      console.warn('Error refreshing products from Supabase:', err);
    }
  };

  // Synchronize customer wallet and persistent ledger from Supabase on demand
  const refreshCustomerWallet = useCallback(async (): Promise<number | null> => {
    if (!isSupabaseConfigured) {
      return Math.max(0, currentUser.walletBalance || 0);
    }
    if (!currentUser || !currentUser.phone) return null;
    try {
      const cleanPhone = currentUser.phone.replace(/\D/g, '').slice(-10);
      if (cleanPhone.length !== 10) return null;

      const summary = await fetchCustomerWalletSummaryFromSupabase(currentUser.id, cleanPhone);
      if (!summary) return null;

      const authoritativeBalance = Math.max(0, summary.balance);
      setWalletTransactions(summary.transactions);
      try {
        localStorage.setItem('om_wallet_transactions', JSON.stringify(summary.transactions));
      } catch {}

      setCurrentUser((prev) => {
        const prevClean = prev.phone ? prev.phone.replace(/\D/g, '').slice(-10) : '';
        if (prevClean !== cleanPhone) return prev;
        if (prev.walletBalance === authoritativeBalance) return prev;
        const updated = {
          ...prev,
          walletBalance: authoritativeBalance,
        };
        try {
          localStorage.setItem('om_current_user', JSON.stringify({ ...updated, addresses: [] }));
          localStorage.setItem(`om_profile_${cleanPhone}`, JSON.stringify({ ...updated, addresses: [] }));
        } catch {}
        return updated;
      });

      setUsers((prev) =>
        prev.map((u) => {
          const uClean = u.phone ? u.phone.replace(/\D/g, '').slice(-10) : '';
          if (uClean === cleanPhone && u.walletBalance !== authoritativeBalance) {
            return { ...u, walletBalance: authoritativeBalance };
          }
          return u;
        })
      );

      return authoritativeBalance;
    } catch (err) {
      console.warn('Error refreshing customer wallet:', err);
      return null;
    }
  }, [currentUser.id, currentUser.phone, currentUser.walletBalance]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      refreshProducts();
    }
  }, [isSupabaseConfigured]);

  // Admin-only background refreshes (never trigger unnecessary customer orders/requests fetches on refresh)
  useEffect(() => {
    if (isSupabaseConfigured && activeRole !== Role.CUSTOMER && isAdminSessionValid && !isVerifyingAdminSession) {
      refreshOrders();
      refreshProductRequests();
    }
  }, [activeRole, isAdminSessionValid, isVerifyingAdminSession]);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const handleVisibilityChange = () => {
      if (!document.hidden && isSupabaseConfigured) {
        if (activeRole !== Role.CUSTOMER && isAdminSessionValid) {
          refreshOrders().catch(() => {});
        }
        refreshProducts().catch(() => {});
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [activeRole, isAdminSessionValid]);

  const checkAdminSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        isAdminSessionValidRef.current = false;
        setIsAdminSessionValid(false);
        return false;
      }
      const data = await res.json().catch(() => ({}));
      const isValid = Boolean(data?.authenticated === true && data?.role === 'SHOPKEEPER');
      isAdminSessionValidRef.current = isValid;
      setIsAdminSessionValid(isValid);
      return isValid;
    } catch {
      isAdminSessionValidRef.current = false;
      setIsAdminSessionValid(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (!isVerifyingAdminSession) return;
    let cancelled = false;

    const verifyStoredShopkeeperSession = async () => {
      const isValid = await checkAdminSession();
      if (cancelled) return;

      if (isValid) {
        const shopkeeper = users.find((u) => u.role === Role.SHOPKEEPER) || INITIAL_USERS[0];
        setCurrentUser(shopkeeper);
        setActiveRoleState(Role.SHOPKEEPER);
        setCustomerFlowStep('SHOP');
        setShopkeeperLoginRedirect(false);
      } else {
        isAdminSessionValidRef.current = false;
        setIsAdminSessionValid(false);
        setActiveRoleState(Role.CUSTOMER);
        setCurrentUser(BLANK_CUSTOMER);
        setCustomerFlowStep('AUTH');
        setShopkeeperLoginRedirect(true);
        try {
          const saved = localStorage.getItem('om_customer_session');
          if (saved) {
            const parsed = JSON.parse(saved);
            if (isAdminRoleValue(parsed?.role)) {
              localStorage.removeItem('om_customer_session');
            }
          }
        } catch {
          localStorage.removeItem('om_customer_session');
        }
      }
      setIsVerifyingAdminSession(false);
    };

    verifyStoredShopkeeperSession();

    return () => {
      cancelled = true;
    };
  }, [isVerifyingAdminSession, checkAdminSession]);

  const logoutAdminSession = useCallback(async () => {
    isAdminSessionValidRef.current = false;
    setIsAdminSessionValid(false);
    setActiveRoleState(Role.CUSTOMER);
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore network errors
    } finally {
      isAdminSessionValidRef.current = false;
      setIsAdminSessionValid(false);
      setActiveRoleState(Role.CUSTOMER);
      localStorage.removeItem('om_customer_session');
    }
  }, []);

  const setActiveRole = (role: Role) => {
    if (isAdminRoleValue(role) && !isAdminSessionValidRef.current) {
      setIsAdminSessionValid(false);
      setShopkeeperLoginRedirect(true);
      return;
    }
    if (role === Role.CUSTOMER) {
      isAdminSessionValidRef.current = false;
      setIsAdminSessionValid(false);
    }
    setActiveRoleState(role);
    // If switching role, find matching user or switch current user's role
    const matchingUser = users.find((u) => u.role === role);
    if (matchingUser) {
      const userDebt = calculateCustomerOutstanding(orders, matchingUser.phone || matchingUser.id);
      const updatedUser = {
        ...matchingUser,
        walletBalance: matchingUser.walletBalance >= 0 ? matchingUser.walletBalance : 0,
        outstandingBalance: userDebt,
      };
      setCurrentUser(updatedUser);
      const defaultAddr = matchingUser.addresses.find((a) => a.isDefault) || matchingUser.addresses[0];
      setSelectedAddressId(defaultAddr?.id || null);
    } else {
      const updatedUser = { ...currentUser, role };
      setCurrentUser(updatedUser);
    }
  };

  const updateSettings = (newSettings: Partial<SystemSetting>) => {
    const nowIso = new Date().toISOString();
    const updated: SystemSetting = {
      ...settings,
      ...newSettings,
      updatedAt: nowIso,
    };

    // 1. Optimistic immediate state update
    setSettings(updated);

    // 2. Persist to localStorage for offline PWA fallback
    try {
      localStorage.setItem('om_settings', JSON.stringify(updated));
    } catch {
      // ignore
    }

    // 3. Broadcast across tabs and windows
    broadcastSettingsChange(updated);

    // 4. Persist to Supabase store_settings table and server persistence
    saveUnifiedSettings(updated).catch((err) => {
      console.warn('Background settings save error:', err);
    });
  };

  const addProduct = async (
    newProd: Omit<Product, 'id' | 'createdAt'>
  ): Promise<{ success: boolean; error?: string }> => {
    // 1. Validate the product data
    if (!newProd.name || !newProd.name.trim()) {
      return { success: false, error: 'Product name is required.' };
    }

    const id = `prod-${Date.now()}`;
    const product: Product = {
      ...newProd,
      brand: newProd.brand ? newProd.brand.trim() : '',
      id,
      createdAt: new Date().toISOString(),
      variants: Array.isArray(newProd.variants)
        ? newProd.variants.map((v, idx) => ({
            ...v,
            id: v.id || `var-${id}-${idx + 1}`,
            productId: id,
          }))
        : [],
    };

    // 2. Save product through Server Boundary /api/products
    try {
      const resp = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(product),
      });

      if (resp.ok) {
        const data = await resp.json();
        const savedProduct = data.product || product;
        setProducts((prev) => {
          const next = [savedProduct, ...prev];
          productsRef.current = next;
          try {
            localStorage.setItem('om_products', JSON.stringify(next));
          } catch {}
          return next;
        });
        return { success: true };
      } else if (resp.status === 401 && isSupabaseConfigured) {
        return {
          success: false,
          error: 'Shopkeeper authorization required to add products. Please log in as Shopkeeper.',
        };
      } else {
        const errorData = await resp.json().catch(() => ({}));
        if (errorData.error && (resp.status === 400 || resp.status === 401 || isSupabaseConfigured)) {
          return { success: false, error: errorData.error };
        }
      }
    } catch {
      // Offline or network error fallback
    }

    // Direct Supabase fallback if offline/client-direct
    if (isSupabaseConfigured) {
      const saveResult = await saveProductToSupabase(product);
      if (!saveResult.success) {
        // Do NOT update React state or localStorage on failure
        return {
          success: false,
          error: saveResult.error || 'Failed to save product to central database.',
        };
      }
    }

    // 3. Update React product state (which subsequently updates localStorage cache)
    setProducts((prev) => {
      const next = [product, ...prev];
      productsRef.current = next;
      try {
        localStorage.setItem('om_products', JSON.stringify(next));
      } catch {}
      return next;
    });
    return { success: true };
  };

  const bulkAddProducts = async (
    newProds: Omit<Product, 'id' | 'createdAt'>[]
  ): Promise<{ successCount: number; failedCount: number; errors: string[] }> => {
    let successCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (let i = 0; i < newProds.length; i++) {
      const p = newProds[i];
      try {
        const result = await addProduct(p);
        if (result.success) {
          successCount++;
        } else {
          failedCount++;
          errors.push(`Row ${i + 1} (${p.name}): ${result.error || 'Failed to save product.'}`);
        }
      } catch (err: any) {
        failedCount++;
        errors.push(`Row ${i + 1} (${p.name}): ${err?.message || 'Error saving product.'}`);
      }
    }

    return { successCount, failedCount, errors };
  };

  const updateProduct = async (
    id: string,
    updates: Partial<Product>
  ): Promise<{ success: boolean; error?: string }> => {
    const currentList = productsRef.current.length > 0 ? productsRef.current : products;
    const current = currentList.find((p) => p.id === id);
    if (!current) return { success: false, error: 'Product not found.' };
    const updated = { ...current, ...updates };
    if (Array.isArray(updated.variants) && updated.variants.length > 0) {
      const totalStock = updated.variants.reduce((sum, v) => sum + (Number(v.stockQuantity) || 0), 0);
      updated.stock = totalStock;
      updated.stockQuantity = totalStock;
    }

    let serverSynced = false;
    try {
      const resp = await fetch('/api/products', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updated),
      });

      if (resp.ok) {
        const data = await resp.json();
        const savedProduct = data.product || updated;
        setProducts((prev) => {
          const next = prev.map((p) => (p.id === id ? savedProduct : p));
          productsRef.current = next;
          try {
            localStorage.setItem('om_products', JSON.stringify(next));
          } catch {}
          return next;
        });
        serverSynced = true;
        return { success: true };
      }

      const errData = await resp.json().catch(() => null);
      return {
        success: false,
        error: errData?.error || `Failed to save product stock (HTTP ${resp.status}).`,
      };
    } catch {
      // Offline or network error: attempt Supabase direct fallback or local persistence
    }

    if (!serverSynced) {
      if (isSupabaseConfigured) {
        try {
          const dbRes = await saveProductToSupabase(updated);
          if (!dbRes.success) {
            return { success: false, error: dbRes.error || 'Failed to sync product to database.' };
          }
        } catch (dbErr: any) {
          console.warn('Supabase product update error:', dbErr);
          return { success: false, error: dbErr?.message || 'Database sync error.' };
        }
      }
      setProducts((prev) => {
        const next = prev.map((p) => (p.id === id ? updated : p));
        productsRef.current = next;
        try {
          localStorage.setItem('om_products', JSON.stringify(next));
        } catch {}
        return next;
      });
    }
    return { success: true };
  };

  const deleteProduct = async (id: string): Promise<{ success: boolean; error?: string }> => {
    try {
      const resp = await fetch(`/api/products?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (resp.ok) {
        setProducts((prev) => {
          const next = prev.filter((p) => p.id !== id);
          productsRef.current = next;
          try {
            localStorage.setItem('om_products', JSON.stringify(next));
          } catch {}
          return next;
        });
        return { success: true };
      }
      const errData = await resp.json().catch(() => ({}));
      if (resp.status === 401 || resp.status === 400 || isSupabaseConfigured) {
        return {
          success: false,
          error: errData?.error || `Failed to delete product (HTTP ${resp.status}).`,
        };
      }
    } catch {
      // Offline/network fallback
    }

    if (isSupabaseConfigured) {
      const dbDeleted = await deleteProductFromSupabase(id);
      if (!dbDeleted) {
        return {
          success: false,
          error: 'Failed to delete product from central database.',
        };
      }
    }

    setProducts((prev) => {
      const next = prev.filter((p) => p.id !== id);
      productsRef.current = next;
      try {
        localStorage.setItem('om_products', JSON.stringify(next));
      } catch {}
      return next;
    });
    return { success: true };
  };

  // Category operations: Supabase persistent handlers
  const refreshCategories = async (): Promise<void> => {
    try {
      const fetched = await fetchCategoriesFromSupabase();
      if (Array.isArray(fetched)) {
        setCategories(fetched);
      }
    } catch (e) {
      console.warn('Refresh categories error:', e);
    }
  };

  const addCategory = async (categoryData: {
    name: string;
    imageUrl?: string;
  }): Promise<{ success: boolean; error?: string; category?: Category }> => {
    const trimmed = categoryData.name.trim();
    if (!trimmed) {
      return { success: false, error: 'Category name is required' };
    }
    const newCategory: Category = {
      id: `cat_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name: trimmed,
      imageUrl: categoryData.imageUrl ? categoryData.imageUrl.trim() : '',
      displayOrder: categories.length + 1,
    };

    if (isSupabaseConfigured) {
      const res = await saveCategoryToSupabase(newCategory);
      if (res.success && res.category) {
        setCategories((prev) => [...prev, res.category!]);
        return res;
      }
      return res;
    }
    setCategories((prev) => [...prev, newCategory]);
    return { success: true, category: newCategory };
  };

  const updateCategory = async (
    id: string,
    updates: { name?: string; imageUrl?: string }
  ): Promise<{ success: boolean; error?: string; category?: Category }> => {
    const existing = categories.find((c) => c.id === id);
    if (!existing) {
      return { success: false, error: 'Category not found' };
    }
    const updated: Category = {
      ...existing,
      name: updates.name !== undefined ? updates.name.trim() : existing.name,
      imageUrl: updates.imageUrl !== undefined ? updates.imageUrl.trim() : existing.imageUrl,
    };

    if (isSupabaseConfigured) {
      const res = await saveCategoryToSupabase(updated);
      if (res.success && res.category) {
        setCategories((prev) => prev.map((c) => (c.id === id ? res.category! : c)));
        return res;
      }
      return res;
    }
    setCategories((prev) => prev.map((c) => (c.id === id ? updated : c)));
    return { success: true, category: updated };
  };

  const deleteCategory = async (id: string): Promise<{ success: boolean; error?: string }> => {
    if (isSupabaseConfigured) {
      const res = await deleteCategoryFromSupabase(id);
      if (!res.success) {
        return res;
      }
    }
    setCategories((prev) => prev.filter((c) => c.id !== id));
    // Clear category reference on local products if any
    setProducts((prev) =>
      prev.map((p) => (p.categoryId === id ? { ...p, categoryId: '' } : p))
    );
    return { success: true };
  };

  const reorderCategories = async (
    newCategories: Category[]
  ): Promise<{ success: boolean; error?: string }> => {
    const updatedList = newCategories.map((c, idx) => ({
      ...c,
      displayOrder: idx + 1,
    }));
    setCategories(updatedList);
    if (isSupabaseConfigured) {
      return await reorderCategoriesInSupabase(updatedList);
    }
    return { success: true };
  };

  const reorderProducts = async (
    newProducts: Product[]
  ): Promise<{ success: boolean; error?: string }> => {
    // 1. Optimistically update local state & localStorage
    setProducts(newProducts);
    try {
      localStorage.setItem('om_products', JSON.stringify(newProducts));
    } catch {}

    // 2. Persist to server and Supabase
    const res = await reorderProductsInDb(newProducts);
    if (!res.success) {
      console.warn('Reorder products sync note:', res.error);
    }
    return res;
  };

  const reorderVariants = async (
    productId: string,
    newVariants: ProductVariant[]
  ): Promise<{ success: boolean; error?: string }> => {
    const targetProduct = products.find((p) => p.id === productId);
    if (!targetProduct) {
      return { success: false, error: 'Product not found.' };
    }

    const updatedProduct: Product = {
      ...targetProduct,
      variants: newVariants,
    };

    return updateProduct(productId, updatedProduct);
  };

  // Keep persisted cart items synchronized with live catalog prices, stock, and order limits after refresh
  useEffect(() => {
    if (editingOrder || !Array.isArray(products)) return;
    if (products.length === 0 && !hasSyncedProductsRef.current) return;

    setCart((prev) => {
      if (!prev || prev.length === 0) return prev;
      let changed = false;
      const nextCart: CartItem[] = [];

      for (const item of prev) {
        const liveProduct = products.find((p) => p.id === item.productId);
        if (!liveProduct) {
          if (hasSyncedProductsRef.current) {
            changed = true;
            continue;
          }
          nextCart.push(item);
          continue;
        }

        const hasVariants = Array.isArray(liveProduct.variants) && liveProduct.variants.length > 0;
        let liveVariant: ProductVariant | null = null;
        if (item.variantId) {
          liveVariant = liveProduct.variants?.find((v) => v.id === item.variantId) || null;
          if (!liveVariant) {
            changed = true;
            continue;
          }
        } else if (hasVariants) {
          changed = true;
          continue;
        }

        const rawStock = liveVariant
          ? liveVariant.stockQuantity
          : Number(liveProduct.stockQuantity ?? liveProduct.stock ?? 0);
        const stock = Number.isFinite(Number(rawStock)) ? Math.max(0, Math.floor(Number(rawStock))) : 0;
        if (stock <= 0) {
          changed = true;
          continue;
        }

        const rawMaxLimit = liveVariant ? liveVariant.maxOrderLimit : liveProduct.maxOrderLimit;
        const hasMaxLimit =
          rawMaxLimit !== undefined &&
          rawMaxLimit !== null &&
          Number.isFinite(Number(rawMaxLimit)) &&
          Number(rawMaxLimit) > 0;
        const effectiveCap = hasMaxLimit ? Math.min(Number(rawMaxLimit), stock) : stock;
        const clampedQty = Math.min(effectiveCap, Math.max(1, Math.floor(Number(item.quantity) || 1)));

        if (
          item.product !== liveProduct ||
          item.variant !== liveVariant ||
          item.quantity !== clampedQty
        ) {
          changed = true;
        }

        nextCart.push({
          ...item,
          product: liveProduct,
          variant: liveVariant,
          quantity: clampedQty,
        });
      }

      return changed ? nextCart : prev;
    });
  }, [products, editingOrder]);

  // Cart operations (scoped to active customer)
  const addToCart = (product: Product, variant?: ProductVariant | null, quantity = 1) => {
    const cleanRequestedQty = Math.floor(Number(quantity));
    if (!Number.isFinite(cleanRequestedQty) || cleanRequestedQty <= 0) {
      return;
    }

    const liveProduct = products.find((p) => p.id === product.id) || product;
    const liveVariant = variant
      ? liveProduct.variants?.find((v) => v.id === variant.id) || variant
      : null;

    setCart((prev) => {
      const existingIndex = prev.findIndex((item) =>
        liveVariant
          ? item.variantId === liveVariant.id
          : !item.variantId && item.productId === liveProduct.id
      );
      const rawMaxLimit = liveVariant ? liveVariant.maxOrderLimit : liveProduct.maxOrderLimit;
      const hasMaxLimit =
        rawMaxLimit !== undefined &&
        rawMaxLimit !== null &&
        Number.isFinite(Number(rawMaxLimit)) &&
        Number(rawMaxLimit) > 0;
      const rawStock = liveVariant
        ? liveVariant.stockQuantity
        : Number(liveProduct.stockQuantity ?? liveProduct.stock ?? 0);
      const stock = Number.isFinite(Number(rawStock)) ? Math.max(0, Math.floor(Number(rawStock))) : 0;

      if (stock <= 0) {
        if (existingIndex > -1) {
          const updated = prev.filter((_, idx) => idx !== existingIndex);
          if (currentUser?.phone) {
            saveCustomerCart(currentUser.phone, updated);
          }
          return updated;
        }
        return prev;
      }

      const effectiveCap = hasMaxLimit ? Math.min(Number(rawMaxLimit), stock) : stock;
      if (effectiveCap <= 0) {
        return prev;
      }

      let updated: CartItem[];
      if (existingIndex > -1) {
        const existing = prev[existingIndex];
        const newQty = Math.min(effectiveCap, existing.quantity + cleanRequestedQty);
        updated = [...prev];
        updated[existingIndex] = {
          ...existing,
          product: liveProduct,
          variant: liveVariant,
          quantity: newQty,
        };
      } else {
        const initialQty = Math.min(effectiveCap, cleanRequestedQty);
        if (initialQty <= 0) {
          return prev;
        }
        updated = [
          ...prev,
          {
            productId: liveProduct.id,
            product: liveProduct,
            variantId: liveVariant?.id || null,
            variant: liveVariant || null,
            quantity: initialQty,
          },
        ];
      }
      if (currentUser?.phone) {
        saveCustomerCart(currentUser.phone, updated);
      }
      return updated;
    });
  };

  const updateCartQty = (itemKey: string, quantity: number) => {
    const cleanQty = Math.floor(Number(quantity));
    if (!Number.isFinite(cleanQty) || cleanQty <= 0) {
      removeFromCart(itemKey);
      return;
    }
    setCart((prev) => {
      const updated = prev
        .map((item) => {
          const isMatch = item.variantId === itemKey || (!item.variantId && item.productId === itemKey);
          if (isMatch) {
            const liveProduct = (!editingOrder && products.find((p) => p.id === item.productId)) || item.product;
            const liveVariant =
              item.variantId && !editingOrder
                ? liveProduct.variants?.find((v) => v.id === item.variantId) || item.variant
                : item.variant;
            const rawMaxLimit = liveVariant ? liveVariant.maxOrderLimit : liveProduct.maxOrderLimit;
            const hasMaxLimit =
              rawMaxLimit !== undefined &&
              rawMaxLimit !== null &&
              Number.isFinite(Number(rawMaxLimit)) &&
              Number(rawMaxLimit) > 0;
            const rawStock = liveVariant
              ? liveVariant.stockQuantity
              : Number(liveProduct.stockQuantity ?? liveProduct.stock ?? 0);
            const stock = Number.isFinite(Number(rawStock)) ? Math.max(0, Math.floor(Number(rawStock))) : 0;
            const effectiveCap = editingOrder
              ? (hasMaxLimit ? Math.floor(Number(rawMaxLimit)) : 999)
              : hasMaxLimit
              ? Math.min(Number(rawMaxLimit), stock)
              : stock;
            const clamped = Math.min(effectiveCap, cleanQty);
            return {
              ...item,
              product: liveProduct,
              variant: liveVariant,
              quantity: clamped,
            };
          }
          return item;
        })
        .filter((item) => item.quantity > 0);
      if (currentUser?.phone) {
        saveCustomerCart(currentUser.phone, updated);
      }
      return updated;
    });
  };

  const removeFromCart = (itemKey: string) => {
    setCart((prev) => {
      const updated = prev.filter((item) => !(item.variantId === itemKey || (!item.variantId && item.productId === itemKey)));
      if (currentUser?.phone) {
        saveCustomerCart(currentUser.phone, updated);
      }
      return updated;
    });
  };

  const clearCart = () => {
    setCart([]);
    if (currentUser?.phone) {
      saveCustomerCart(currentUser.phone, []);
    }
  };

  const startEditingOrder = useCallback(
    (order: Order) => {
      // Save current cart snapshot so it can be restored if user cancels edit
      setSavedPreEditCart([...cart]);
      setEditingOrder(order);

      // Convert order items to CartItem[]
      const itemsForCart: CartItem[] = (order.items || []).map((item) => {
        const match = findProductAndVariant(item, products);
        if (match) {
          return {
            productId: match.product.id,
            product: match.product,
            variantId: match.variant?.id || null,
            variant: match.variant || null,
            quantity: Number(item.quantity) || 1,
          };
        }
        if (!item.variantId) {
          const fallbackProduct: Product = {
            id: item.productId || `prod-${item.id}`,
            name: item.productName || 'Grocery Item',
            brand: item.brand || '',
            description: '',
            categoryId: 'ALL',
            price: item.unitPrice || item.price,
            baseSellingPrice: item.unitPrice || item.price,
            mrp: item.unitPrice || item.price,
            stock: 999,
            stockQuantity: 999,
            unit: (item.unit as any) || 'PACK',
            packSize: item.packSize || 1,
            packLabel: item.variantName || 'Standard',
            isDiscountExcluded: Boolean(item.isDiscountExcluded),
            variants: [],
            createdAt: new Date().toISOString(),
          };
          return {
            productId: fallbackProduct.id,
            product: fallbackProduct,
            variantId: null,
            variant: null,
            quantity: Number(item.quantity) || 1,
          };
        }
        const fallbackVariant: ProductVariant = {
          id: item.variantId,
          productId: item.productId || `prod-${item.id}`,
          unit: (item.unit as any) || 'PACK',
          packSize: item.packSize || 1,
          packLabel: item.variantName || 'Standard',
          mrp: item.unitPrice || item.price,
          baseSellingPrice: item.unitPrice || item.price,
          stockQuantity: 999,
          maxOrderLimit: 999,
          tieredPrices: [],
        };
        const fallbackProduct: Product = {
          id: item.productId || `prod-${item.id}`,
          name: item.productName || 'Grocery Item',
          brand: item.brand || '',
          description: '',
          categoryId: 'ALL',
          isDiscountExcluded: Boolean(item.isDiscountExcluded),
          variants: [fallbackVariant],
          createdAt: new Date().toISOString(),
        };
        return {
          productId: fallbackProduct.id,
          product: fallbackProduct,
          variantId: fallbackVariant.id,
          variant: fallbackVariant,
          quantity: Number(item.quantity) || 1,
        };
      });

      setCart(itemsForCart);
    },
    [cart, products]
  );

  const cancelEditingOrder = useCallback(() => {
    if (savedPreEditCart !== null) {
      setCart(savedPreEditCart);
      setSavedPreEditCart(null);
    }
    setEditingOrder(null);
  }, [savedPreEditCart]);

  const saveEditedOrder = useCallback(async (): Promise<{
    success: boolean;
    error?: string;
    updatedOrder?: Order;
    remainingAmountToPay?: number;
    previousOnlinePaid?: number;
    walletAmountUsed?: number;
    requiresPayment?: boolean;
  }> => {
    if (!editingOrder) {
      return { success: false, error: 'No order is currently being edited.' };
    }
    if (!cart || cart.length === 0) {
      return { success: false, error: 'Order must contain at least 1 item.' };
    }

    const currentOrder = orders.find((o) => o.id === editingOrder.id) || editingOrder;

    // 1. Build updated OrderItem[] from cart
    const updatedOrderItems: OrderItem[] = cart.map((item) => {
      const baseSellingPrice = item.variant
        ? item.variant.baseSellingPrice
        : Number(item.product.baseSellingPrice ?? item.product.price ?? 0);
      const tieredPrices = item.variant?.tieredPrices || item.product.tieredPrices || [];
      const unitPrice = getActiveUnitPrice(
        baseSellingPrice,
        item.quantity,
        tieredPrices
      );
      const variantName = item.variant
        ? item.variant.packLabel
        : (item.product.packLabel || (item.product.unit ? String(item.product.unit) : 'Standard'));
      const unit = item.variant ? item.variant.unit : (item.product.unit || 'PIECE');
      const packSize = item.variant ? item.variant.packSize : (item.product.packSize || 1);

      return {
        id: `item-${Date.now()}-${item.variantId || item.productId}`,
        orderId: currentOrder.id,
        productId: item.productId || item.product.id,
        variantId: item.variantId || null,
        variantName,
        productName: item.product.name,
        brand: item.product.brand,
        unit,
        packSize,
        quantity: item.quantity,
        unitPrice,
        price: unitPrice * item.quantity,
        isDiscountExcluded:
          item.product.isDiscountExcluded === true ||
          (item.product.isDiscountExcluded as any) === 'true',
      };
    });

    // 2. Recalculate edited order total:
    // Items subtotal (combined subtotal of all items in the new bill, including newly added items)
    const subtotal = updatedOrderItems.reduce((acc, it) => acc + it.price, 0);

    // Delivery fee
    const deliveryFee = subtotal >= settings.freeShippingMinAmount ? 0 : settings.baseDeliveryFee;

    // COD charge if order was COD (no count-based free-order rule)
    const isCod = currentOrder.paymentMethod === PaymentMethod.COD;
    const codCharge = isCod
      ? (currentOrder.codCharge !== undefined && currentOrder.codCharge > 0
          ? currentOrder.codCharge
          : Math.max(0, Number(settings.codBaseCharge) || 0))
      : 0;

    // Recalculate discount on the combined subtotal of all items in the new bill, including newly added items.
    // Do not carry forward the old bill's discount.
    const isAdvance =
      currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE ||
      (currentOrder.discountAmount !== undefined && currentOrder.discountAmount > 0);

    const configuredPct = Number(settings.advancePaymentDiscountPct);
    const discountPct =
      !isNaN(configuredPct) && configuredPct > 0
        ? configuredPct
        : currentOrder.discountAmount && currentOrder.subtotal
        ? (currentOrder.discountAmount / currentOrder.subtotal) * 100
        : 0;

    const discountAmount = isAdvance
      ? Math.round((subtotal * Math.max(0, discountPct)) / 100)
      : 0;

    // Recalculated new order total (BEFORE subtracting amount already paid)
    const finalAmount = Math.max(0, subtotal + deliveryFee + codCharge - discountAmount);

    // Subtract only the wallet amount actually selected/used
    const originalWalletUsed = Math.max(0, currentOrder.walletAmountUsed || 0);
    const walletUsed = Math.min(finalAmount, originalWalletUsed);
    const totalAfterWallet = Math.max(0, finalAmount - walletUsed);

    // And calculate the remaining amount to pay
    const wasPreviouslyPaid =
      currentOrder.paymentStatus === PaymentStatus.RECEIVED ||
      (currentOrder.paymentStatus as any) === 'PAID' ||
      (currentOrder as any).is_paid === true;

    // If previously paid online, compute actual online payment paid earlier (e.g. ₹204)
    // Previously paid UPI/online advance must never appear as "Wallet Applied (Advance)".
    // Show it as "Previous Online Advance Paid". Wallet Applied must reflect only actual wallet usage.
    const previousOnlinePaid =
      currentOrder.previousOnlinePaid !== undefined && currentOrder.previousOnlinePaid > 0
        ? currentOrder.previousOnlinePaid
        : (wasPreviouslyPaid || currentOrder.paymentMethod === PaymentMethod.ADVANCE_ONLINE)
        ? Math.max(
            0,
            currentOrder.finalAmount -
              originalWalletUsed -
              (wasPreviouslyPaid ? 0 : (currentOrder.totalPayable || 0))
          )
        : 0;

    // Balance to Pay Now:
    // Calculate remaining payment correctly (Total Bill Amount − Previous Online Advance Paid)
    // (Taking into account actual wallet applied if any):
    const remainingAmountToPay = isCod
      ? 0
      : Math.max(0, totalAfterWallet - previousOnlinePaid);

    // If remaining amount > ₹0, keep payment status UNPAID/PENDING and redirect customer to payment page
    // NEVER mark it PAID unless the newly required online balance is actually paid successfully!
    const requiresPayment = !isCod && remainingAmountToPay > 0;
    const paymentStatus = requiresPayment
      ? PaymentStatus.PENDING
      : wasPreviouslyPaid
      ? PaymentStatus.RECEIVED
      : currentOrder.paymentStatus || PaymentStatus.PENDING;

    // 3. Adjust stock ONLY by the difference between old and new quantities
    const stockResult = adjustStockForEditedOrder(currentOrder, updatedOrderItems, products);
    if (stockResult.affectedProducts.length > 0) {
      setProducts(stockResult.updatedProducts);
      try {
        localStorage.setItem('om_products', JSON.stringify(stockResult.updatedProducts));
      } catch {}

      if (isSupabaseConfigured) {
        stockResult.affectedProducts.forEach((p) => {
          updateProductStockInSupabase(p.id, p.variants, p).catch((err) => {
            console.warn('Background Supabase product stock adjust error:', err);
          });
        });
      }
    }

    // 4. Build updated Order object - keeping same id, orderNumber, status, paymentMethod, etc.
    const updatedOrder: Order = {
      ...currentOrder,
      items: updatedOrderItems,
      subtotal,
      discountAmount,
      deliveryFee,
      codCharge,
      finalAmount,
      totalPayable: requiresPayment ? remainingAmountToPay : (isCod ? (finalAmount - walletUsed) : 0),
      walletAmountUsed: walletUsed,
      previousOnlinePaid,
      paymentStatus,
    };

    // 5. Update React state and localStorage
    setOrders((prev) => {
      const updated = prev.map((o) => (o.id === updatedOrder.id ? updatedOrder : o));
      try {
        localStorage.setItem('om_orders', JSON.stringify(updated));
      } catch {}
      return updated;
    });

    // 6. Update database
    if (isSupabaseConfigured) {
      saveEditedOrderToSupabase(updatedOrder).catch((err) => {
        console.warn('Background Supabase edited order save error:', err);
      });
    }

    // 7. Clear cart & exit editing mode cleanly
    setCart([]);
    setSavedPreEditCart(null);
    setEditingOrder(null);

    return {
      success: true,
      updatedOrder,
      remainingAmountToPay,
      previousOnlinePaid,
      walletAmountUsed: walletUsed,
      requiresPayment,
    };
  }, [
    editingOrder,
    cart,
    orders,
    settings,
    products,
    isSupabaseConfigured,
  ]);

  const confirmEditedOrderPayment = useCallback(
    async (
      orderId: string,
      paymentMethodApp?: string
    ): Promise<{
      success: boolean;
      updatedOrder?: Order;
      error?: string;
    }> => {
      const target = orders.find((o) => o.id === orderId);
      if (!target) {
        return { success: false, error: 'Order not found.' };
      }

      const totalOnlinePaid = Math.max(0, target.finalAmount - (target.walletAmountUsed || 0));
      const updatedOrder: Order = {
        ...target,
        paymentStatus: PaymentStatus.RECEIVED,
        totalPayable: 0,
        previousOnlinePaid: totalOnlinePaid,
        razorpayPaymentId: `pay_${Date.now()}_${paymentMethodApp || 'upi'}`,
      };

      setOrders((prev) => {
        const next = prev.map((o) => (o.id === orderId ? updatedOrder : o));
        try {
          localStorage.setItem('om_orders', JSON.stringify(next));
        } catch {}
        return next;
      });

      if (isSupabaseConfigured) {
        updateOrderStatusInSupabase(
          orderId,
          target.status,
          true,
          {
            orderNumber: target.orderNumber,
            totalPayable: target.totalPayable,
            walletAmountUsed: target.walletAmountUsed,
            items: target.items,
          }
        ).catch((err) => {
          console.warn('Background Supabase payment update error:', err);
        });
        saveEditedOrderToSupabase(updatedOrder).catch(() => {});
      }

      return { success: true, updatedOrder };
    },
    [orders, isSupabaseConfigured]
  );

  // Repeat Order notice & action state
  const [repeatOrderNotice, setRepeatOrderNotice] = useState<RepeatOrderNotice | null>(null);

  /**
   * Repeat Order implementation:
   * 1. Loads items and quantities from the specified past order.
   * 2. Recalculates dynamically with current prices, bulk slabs, and discounts.
   * 3. Skips any product/variant that is out of stock (stock <= 0) and surfaces clear notice.
   * 4. Ensures editingOrder is strictly null, so checkout creates a new order without modifying the previous order.
   */
  const repeatOrder = useCallback(
    (order: Order): RepeatOrderResult => {
      // Never modify previous order: clear any editing state
      setEditingOrder(null);
      setSavedPreEditCart(null);

      if (!order.items || order.items.length === 0) {
        const res: RepeatOrderResult = {
          success: false,
          orderNumber: order.orderNumber,
          loadedCount: 0,
          skippedItems: [],
          message: `Order #${order.orderNumber} contains no items to repeat.`,
        };
        setRepeatOrderNotice({
          type: 'error',
          message: res.message,
          orderNumber: order.orderNumber,
        });
        return res;
      }

      const itemsForCart: CartItem[] = [];
      const skippedItems: string[] = [];

      for (const item of order.items) {
        const match = findProductAndVariant(item, products);
        if (!match) {
          skippedItems.push(item.productName || item.variantName || 'Item no longer in catalog');
          continue;
        }

        const { product, variant } = match;
        const availableStock = variant
          ? Number(variant.stockQuantity) || 0
          : Number(product.stockQuantity ?? product.stock ?? 0);

        // Skip product if out of stock
        if (availableStock <= 0) {
          const packLabel = variant?.packLabel ? ` (${variant.packLabel})` : '';
          skippedItems.push(`${product.name}${packLabel}`);
          continue;
        }

        // Desired quantity from the past order
        const requestedQty = Math.max(1, Number(item.quantity) || 1);
        const maxLimit = variant
          ? (variant.maxOrderLimit && variant.maxOrderLimit > 0 ? variant.maxOrderLimit : availableStock)
          : (product.maxOrderLimit && product.maxOrderLimit > 0 ? product.maxOrderLimit : availableStock);
        const finalQty = Math.min(requestedQty, availableStock, maxLimit);

        itemsForCart.push({
          productId: product.id,
          product,
          variantId: variant?.id || null,
          variant: variant || null,
          quantity: Math.max(1, finalQty),
        });
      }

      if (itemsForCart.length === 0) {
        const res: RepeatOrderResult = {
          success: false,
          orderNumber: order.orderNumber,
          loadedCount: 0,
          skippedItems,
          message:
            skippedItems.length > 0
              ? `Could not repeat order #${order.orderNumber}: all items are currently out of stock.`
              : `All items from order #${order.orderNumber} are no longer available.`,
        };
        setRepeatOrderNotice({
          type: 'error',
          message: res.message,
          skippedItems,
          orderNumber: order.orderNumber,
        });
        return res;
      }

      // Load products into active cart
      setCart(itemsForCart);
      if (currentUser?.phone) {
        saveCustomerCart(currentUser.phone, itemsForCart);
      }

      const hasSkipped = skippedItems.length > 0;
      const successMessage = hasSkipped
        ? `Added ${itemsForCart.length} available ${itemsForCart.length === 1 ? 'item' : 'items'} from Order #${order.orderNumber} to cart. ${skippedItems.length} out-of-stock ${skippedItems.length === 1 ? 'item was' : 'items were'} skipped.`
        : `Loaded all ${itemsForCart.length} ${itemsForCart.length === 1 ? 'item' : 'items'} from Order #${order.orderNumber} into cart at current prices & discounts!`;

      const res: RepeatOrderResult = {
        success: true,
        orderNumber: order.orderNumber,
        loadedCount: itemsForCart.length,
        skippedItems,
        message: successMessage,
      };

      setRepeatOrderNotice({
        type: hasSkipped ? 'warning' : 'success',
        message: successMessage,
        skippedItems,
        orderNumber: order.orderNumber,
      });

      return res;
    },
    [products, currentUser?.phone]
  );

  const repeatLastOrder = useCallback((): RepeatOrderResult => {
    // Find customer's past orders
    const customerOrders = orders.filter((o) => {
      const cleanCurrentPhone = currentUser.phone ? currentUser.phone.replace(/\D/g, '').slice(-10) : '';
      const orderPhone = (o.userPhone || o.customerPhone || '').replace(/\D/g, '').slice(-10);
      const matchId = currentUser.id && o.userId === currentUser.id;
      const matchPhone = Boolean(cleanCurrentPhone && orderPhone && cleanCurrentPhone === orderPhone);
      return matchId || matchPhone;
    });

    if (customerOrders.length === 0) {
      const res: RepeatOrderResult = {
        success: false,
        loadedCount: 0,
        skippedItems: [],
        message: 'No previous orders found to repeat. Explore our catalog to place your first order!',
      };
      setRepeatOrderNotice({
        type: 'error',
        message: res.message,
      });
      return res;
    }

    // Pick most recent order by createdAt
    const mostRecentOrder = [...customerOrders].sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    )[0];

    return repeatOrder(mostRecentOrder);
  }, [orders, currentUser.id, currentUser.phone, repeatOrder]);

  // Customer outstanding balance calculation (Source of truth: persistent orders & DB)
  const customerOutstanding = useMemo(() => {
    const phoneOrId = currentUser.phone || currentUser.id;
    if (!phoneOrId) return 0;
    const fromOrders = calculateCustomerOutstanding(orders, phoneOrId);
    const hasCustomerOrders = orders.some(
      (o) => o.paymentMethod === PaymentMethod.COD && isSameCustomer(o, phoneOrId)
    );
    if (hasCustomerOrders) {
      return fromOrders;
    }
    if (currentUser.outstandingBalance && currentUser.outstandingBalance > 0) {
      return currentUser.outstandingBalance;
    }
    return 0;
  }, [orders, currentUser.phone, currentUser.id, currentUser.outstandingBalance]);

  const getCustomerOutstanding = useCallback(
    (phoneOrId?: string, excludeOrderId?: string): number => {
      const target = phoneOrId || currentUser.phone || currentUser.id;
      if (!target) return 0;
      const fromOrders = calculateCustomerOutstanding(orders, target, excludeOrderId);
      const hasCustomerOrders = orders.some(
        (o) => o.paymentMethod === PaymentMethod.COD && isSameCustomer(o, target)
      );
      if (hasCustomerOrders) {
        return fromOrders;
      }
      const matchedUser = users.find((u) => isSameCustomer({ userPhone: u.phone, userId: u.id }, target));
      if (matchedUser) {
        if (matchedUser.outstandingBalance && matchedUser.outstandingBalance > 0) {
          return matchedUser.outstandingBalance;
        }
      }
      if (target === currentUser.phone || target === currentUser.id) {
        if (currentUser.outstandingBalance && currentUser.outstandingBalance > 0) {
          return currentUser.outstandingBalance;
        }
      }
      return 0;
    },
    [orders, currentUser.phone, currentUser.id, currentUser.outstandingBalance, users]
  );

  // Keep customer COD outstanding debt tracked in outstandingBalance, completely separate from walletBalance
  useEffect(() => {
    if (activeRole === Role.CUSTOMER && (currentUser.phone || currentUser.id)) {
      const needsOutstandingSync = currentUser.outstandingBalance !== customerOutstanding;
      const hasLegacyNegativeWallet = currentUser.walletBalance < 0;

      if (needsOutstandingSync || hasLegacyNegativeWallet) {
        setCurrentUser((prev) => {
          const updated = {
            ...prev,
            outstandingBalance: customerOutstanding,
            walletBalance: prev.walletBalance < 0 ? 0 : prev.walletBalance,
          };
          try {
            localStorage.setItem('om_current_user', JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }
    }
  }, [activeRole, customerOutstanding, currentUser.phone, currentUser.id, currentUser.outstandingBalance, currentUser.walletBalance]);

  const [useWalletBalance, setUseWalletBalance] = useState<boolean>(true);

  // Dynamic Checkout Breakdown calculation using the engine
  const checkoutBreakdown = useMemo(() => {
    const variantItems = cart.map((item) => ({
      variantId: item.variantId || null,
      productId: item.productId,
      quantity: item.quantity,
      baseSellingPrice: item.variant
        ? item.variant.baseSellingPrice
        : Number(item.product.baseSellingPrice ?? item.product.price ?? 0),
      isDiscountExcluded: item.product.isDiscountExcluded === true || (item.product.isDiscountExcluded as any) === 'true',
      tieredPrices: item.variant?.tieredPrices || item.product.tieredPrices || [],
    }));

    return calculateCheckoutTotals(
      variantItems,
      {},
      {
        advancePaymentDiscountPct: settings.advancePaymentDiscountPct,
        codBaseCharge: settings.codBaseCharge,
        freeShippingMinAmount: settings.freeShippingMinAmount,
        baseDeliveryFee: settings.baseDeliveryFee,
      },
      0, // Never add previous outstanding to the next order
      currentUser.walletBalance > 0 ? currentUser.walletBalance : 0,
      useWalletBalance
    );
  }, [cart, settings, currentUser.walletBalance, useWalletBalance]);

  // Order Management
  const activeOrderSubmissionRef = useRef<Promise<Order> | null>(null);

  const createOrder = async (data: {
    address: Address;
    paymentMethod: PaymentMethod;
    deliveryDate: string;
    useWallet?: boolean;
    orderId?: string;
    orderNumber?: string;
    selectedPaymentApp?: string;
    isWalletPayment?: boolean;
    googleLocation?: GoogleLocation;
  }): Promise<Order> => {
    if (data.orderId) {
      const alreadyCreated = orders.find((o) => o.id === data.orderId);
      if (alreadyCreated) {
        return alreadyCreated;
      }
    }

    if (activeOrderSubmissionRef.current) {
      return activeOrderSubmissionRef.current;
    }

    if (!cart || cart.length === 0) {
      throw new Error('Your cart is empty. Please add products before placing an order.');
    }

    const submissionPromise = (async (): Promise<Order> => {
      const isAdvance = data.paymentMethod === PaymentMethod.ADVANCE_ONLINE;
    const discountedOrderAmount = isAdvance
      ? checkoutBreakdown.advanceFinalTotal
      : checkoutBreakdown.codFinalTotal;
    const discountAmount = isAdvance ? checkoutBreakdown.advanceDiscountAmount : 0;
    const codCharge = isAdvance ? 0 : checkoutBreakdown.codCharge;

    // Calculate customer's previously unpaid, eligible outstanding balance
    // Rules:
    // 1. Must belong to this customer (by normalized phone or userId)
    // 2. Exclude the current order being created/edited
    // 3. Do not count cancelled orders (status === CANCELLED)
    // 4. Do not count unpaid pending or in-progress orders (status === ORDER_PENDING or not delivered with no collection)
    // 5. Do not count fully paid orders (paymentStatus === RECEIVED or bill <= collected)
    // 6. Prevent double-counting: only sum each eligible order's individual unpaid portion: Math.max(0, finalAmount - codCollectedAmount)
    let eligiblePreviousOutstanding = 0;
    const customerIdentifier = currentUser.phone || currentUser.id;
    let liveOrdersForOutstanding: Order[] = isSupabaseConfigured && !isAdvance ? [] : orders;
    let freshDbOutstandingFallback = !isSupabaseConfigured
      ? Math.max(0, Number(currentUser.outstandingBalance || 0))
      : 0;

    if (!isAdvance && isSupabaseConfigured && activeRole === Role.CUSTOMER) {
      const cleanCustPhone = (currentUser.phone || '').replace(/\D/g, '').slice(-10);
      if (cleanCustPhone.length !== 10) {
        throw new Error('Unable to verify customer mobile number for COD order. Please log in again.');
      }

      const fetchedLiveOrders = await refreshOrders();
      if (fetchedLiveOrders === null) {
        throw new Error('Unable to verify customer order history from database. Please try again.');
      }
      liveOrdersForOutstanding = fetchedLiveOrders;
      const hasLiveCustomerOrders = liveOrdersForOutstanding.some((o) =>
        isSameCustomer(o, customerIdentifier)
      );
      if (!hasLiveCustomerOrders) {
        const freshProfile = await fetchCustomerProfileFromSupabase(currentUser.phone, {
          includeLedger: false,
        });
        if (
          !freshProfile ||
          (freshProfile.outstandingBalance !== undefined &&
            !Number.isFinite(Number(freshProfile.outstandingBalance)))
        ) {
          throw new Error(
            'Unable to verify customer COD outstanding balance from database. Please try again.'
          );
        }
        freshDbOutstandingFallback = Math.max(0, Number(freshProfile.outstandingBalance || 0));
      }
    }

    if (customerIdentifier && Array.isArray(liveOrdersForOutstanding)) {
      const eligibleOrders = liveOrdersForOutstanding.filter((o) => {
        if (data.orderId && o.id === data.orderId) return false;
        if (!isSameCustomer(o, customerIdentifier)) return false;
        if (o.status === OrderStatus.CANCELLED) return false;
        if (o.paymentMethod !== PaymentMethod.COD) return false;
        if (o.paymentStatus === PaymentStatus.RECEIVED) return false;

        // Do not count unpaid pending or in-progress orders
        const isUnpaidPending =
          o.status === OrderStatus.ORDER_PENDING ||
          (o.status !== OrderStatus.DELIVERED && (!o.codCollectedAmount || o.codCollectedAmount <= 0));

        if (isUnpaidPending) return false;

        return true;
      });

      if (eligibleOrders.length > 0) {
        for (const o of eligibleOrders) {
          const bill = Number(o.finalAmount) || 0;
          const collected = Number(o.codCollectedAmount) || 0;
          const unpaid = Math.max(0, bill - collected);
          eligiblePreviousOutstanding += unpaid;
        }
        eligiblePreviousOutstanding = Math.round(eligiblePreviousOutstanding * 100) / 100;
      } else {
        const hasAnyCustomerOrders = liveOrdersForOutstanding.some((o) =>
          isSameCustomer(o, customerIdentifier)
        );
        if (!hasAnyCustomerOrders && freshDbOutstandingFallback > 0) {
          eligiblePreviousOutstanding = Math.round(freshDbOutstandingFallback * 100) / 100;
        }
      }
    }

    // Previous outstanding balance is included for COD orders
    const previousOutstanding = isAdvance ? 0 : eligiblePreviousOutstanding;

    // Wallet can ONLY be used inside Advance Payment as "Wallet Applied (Advance)"
    // Always verify live wallet balance from Database for transactions (never read stale cache).
    let currentActualWallet = Math.max(0, currentUser.walletBalance || 0);
    if (isSupabaseConfigured && isAdvance && Boolean(data.useWallet)) {
      const liveWallet = await refreshCustomerWallet();
      if (liveWallet === null) {
        throw new Error('Unable to verify live wallet balance from database. Please try again.');
      }
      currentActualWallet = Math.max(0, liveWallet);
    }

    // Explicit check: only apply wallet if advance payment AND customer explicitly chose to use wallet
    const isExplicitlyUsingWallet = isAdvance && Boolean(data.useWallet);
    const walletUsed = isExplicitlyUsingWallet ? Math.min(currentActualWallet, discountedOrderAmount) : 0;

    // Keep finalAmount as the bill amount (before wallet) and totalPayable as remaining online/COD payable,
    // matching server calculation and OrderTrackingModal financial breakdown.
    const finalAmount = discountedOrderAmount;
    const totalPayable =
      isAdvance && isExplicitlyUsingWallet
        ? Math.max(0, Math.round((discountedOrderAmount - walletUsed) * 100) / 100)
        : discountedOrderAmount;
    const newWalletBalance = isExplicitlyUsingWallet
      ? Math.max(0, currentActualWallet - walletUsed)
      : currentActualWallet;

    const orderNumber = data.orderNumber || `OM-${Math.floor(10000 + Math.random() * 90000)}`;
    const orderId = data.orderId || `ord-${Date.now()}`;

    // Payment status: if remaining payable is 0, full amount covered by wallet, received immediately.
    // If Advance Online, received immediately via UPI gateway.
    // If COD and totalPayable > 0, pending collection at doorstep.
    const paymentStatus =
      totalPayable === 0
        ? PaymentStatus.RECEIVED
        : isAdvance
        ? PaymentStatus.RECEIVED
        : PaymentStatus.PENDING;

    const resolvedGoogleLocation = data.googleLocation || data.address.googleLocation;

    const newOrder: Order = {
      id: orderId,
      orderNumber,
      userId: currentUser.id,
      userName: currentUser.name,
      userPhone: currentUser.phone,
      addressId: data.address.id,
      address: {
        ...data.address,
        googleLocation: resolvedGoogleLocation || data.address.googleLocation,
      },
      googleLocation: resolvedGoogleLocation,
      status: OrderStatus.ORDER_PENDING,
      paymentMethod: data.paymentMethod,
      paymentStatus,
      deliveryDate: data.deliveryDate,
      subtotal: checkoutBreakdown.subtotal,
      discountAmount,
      deliveryFee: checkoutBreakdown.deliveryFee,
      codCharge,
      finalAmount, // Original bill / final amount of this new order is preserved unchanged!
      previousOutstanding,
      totalPayable, // Remaining payable calculated correctly
      walletAmountUsed: walletUsed,
      codCollectedAmount: 0,
      razorpayOrderId: isAdvance ? `rzp_ord_${Date.now()}` : undefined,
      razorpayPaymentId: isAdvance ? `pay_${Date.now()}` : undefined,
      createdAt: new Date().toISOString(),
      items: cart.map((item) => {
        const baseSellingPrice = item.variant
          ? item.variant.baseSellingPrice
          : Number(item.product.baseSellingPrice ?? item.product.price ?? 0);
        const tieredPrices = item.variant?.tieredPrices || item.product.tieredPrices || [];
        const unitPrice = getActiveUnitPrice(
          baseSellingPrice,
          item.quantity,
          tieredPrices
        );
        const variantName = item.variant
          ? item.variant.packLabel
          : (item.product.packLabel || (item.product.unit ? String(item.product.unit) : 'Standard'));
        const unit = item.variant ? item.variant.unit : (item.product.unit || 'PIECE');
        const packSize = item.variant ? item.variant.packSize : (item.product.packSize || 1);

        return {
          id: `item-${Date.now()}-${item.variantId || item.productId}`,
          orderId,
          productId: item.productId || item.product.id,
          variantId: item.variantId || null,
          variantName,
          productName: item.product.name,
          brand: item.product.brand,
          unit,
          packSize,
          quantity: item.quantity,
          unitPrice,
          price: Math.round(unitPrice * item.quantity * 100) / 100,
          isDiscountExcluded: item.product.isDiscountExcluded === true || (item.product.isDiscountExcluded as any) === 'true',
        };
      }),
      stockDeducted: false,
      stockRestored: false,
    };

    // 1. Authoritative Server-First Order Placement: Await server response
    const saveResult = await saveOrderToSupabase(newOrder);

    if (!saveResult.success) {
      const errorMsg = saveResult.error || 'Failed to place order on server. Please try again.';
      console.error('Order creation rejected by server:', errorMsg);
      // Cart remains untouched! Local state is NOT updated!
      throw new Error(errorMsg);
    }

    // 2. Synchronize with server-authoritative order details
    const serverOrder = saveResult.order;
    const confirmedOrder: Order = {
      ...newOrder,
      id: serverOrder?.id || newOrder.id,
      orderNumber: serverOrder?.orderNumber || newOrder.orderNumber,
      status: (serverOrder?.status as OrderStatus) || newOrder.status,
      paymentStatus: (serverOrder?.paymentStatus as PaymentStatus) || newOrder.paymentStatus,
      createdAt: serverOrder?.createdAt || newOrder.createdAt,
      previousOutstanding:
        typeof serverOrder?.previousOutstanding === 'number'
          ? serverOrder.previousOutstanding
          : newOrder.previousOutstanding,
      subtotal: typeof serverOrder?.subtotal === 'number' ? serverOrder.subtotal : newOrder.subtotal,
      discountAmount: typeof serverOrder?.discountAmount === 'number' ? serverOrder.discountAmount : newOrder.discountAmount,
      deliveryFee: typeof serverOrder?.deliveryFee === 'number' ? serverOrder.deliveryFee : newOrder.deliveryFee,
      codCharge: typeof serverOrder?.codCharge === 'number' ? serverOrder.codCharge : newOrder.codCharge,
      finalAmount: typeof serverOrder?.finalAmount === 'number' ? serverOrder.finalAmount : newOrder.finalAmount,
      walletAmountUsed: typeof serverOrder?.walletAmountUsed === 'number' ? serverOrder.walletAmountUsed : newOrder.walletAmountUsed,
      totalPayable: typeof serverOrder?.totalPayable === 'number' ? serverOrder.totalPayable : newOrder.totalPayable,
      paymentMethod: (serverOrder?.paymentMethod as PaymentMethod) || newOrder.paymentMethod,
      items: Array.isArray(serverOrder?.items) && serverOrder.items.length > 0
        ? serverOrder.items.map((it: any) => ({
            id: it.id || `item-${Date.now()}-${it.variantId || it.productId}`,
            orderId: serverOrder?.id || newOrder.id,
            productId: it.productId,
            variantId: it.variantId || null,
            variantName: it.variantName || 'Standard',
            productName: it.productName,
            brand: it.brand,
            unit: it.unit || 'PIECE',
            packSize: it.packSize || 1,
            quantity: it.quantity,
            unitPrice: it.unitPrice,
            price: it.price,
            isDiscountExcluded: Boolean(it.isDiscountExcluded),
          }))
        : newOrder.items,
    };

    const orderAlreadyExistsLocally = orders.some((o) => o.id === confirmedOrder.id);

    // 3. Update orders state ONLY after successful server confirmation
    setOrders((prev) => {
      const next = [confirmedOrder, ...prev.filter((o) => o.id !== confirmedOrder.id)];
      try {
        localStorage.setItem('om_orders', JSON.stringify(next));
      } catch {}
      return next;
    });

    // 4. Update wallet locally if wallet was used in the confirmed order (prevent duplicate debit on retries)
    const actualWalletUsed = confirmedOrder.walletAmountUsed || 0;
    if (actualWalletUsed > 0) {
      const alreadyDebitedLocally = walletTransactions.some(
        (tx) => tx.orderId === confirmedOrder.id && tx.type === 'DEBIT'
      );

      const updatedWalletBalance =
        typeof serverOrder?.remainingWalletBalance === 'number'
          ? Math.max(0, Math.round(serverOrder.remainingWalletBalance * 100) / 100)
          : alreadyDebitedLocally || orderAlreadyExistsLocally || saveResult.deduplicated
          ? currentActualWallet
          : Math.max(0, Math.round((currentActualWallet - actualWalletUsed) * 100) / 100);

      const updatedCurrentUser: User = {
        ...currentUser,
        walletBalance: updatedWalletBalance,
      };

      setCurrentUser(updatedCurrentUser);
      localStorage.setItem('om_current_user', JSON.stringify(updatedCurrentUser));

      const customerPhone = confirmedOrder.userPhone || currentUser.phone;
      if (customerPhone) {
        const cleanPhone = customerPhone.replace(/\D/g, '').slice(-10);
        localStorage.setItem(`om_profile_${cleanPhone}`, JSON.stringify(updatedCurrentUser));
        const rawDigits = customerPhone.replace(/\D/g, '');
        if (rawDigits && rawDigits !== cleanPhone) {
          localStorage.setItem(`om_profile_${rawDigits}`, JSON.stringify(updatedCurrentUser));
        }
      }

      setUsers((prev) => {
        const updated = prev.map((u) => {
          const uClean = u.phone ? u.phone.replace(/\D/g, '').slice(-10) : '';
          const targetClean = customerPhone ? customerPhone.replace(/\D/g, '').slice(-10) : '';
          if (
            u.id === confirmedOrder.userId ||
            u.id === currentUser.id ||
            (targetClean && uClean === targetClean)
          ) {
            return {
              ...u,
              walletBalance: updatedWalletBalance,
            };
          }
          return u;
        });
        localStorage.setItem('om_users', JSON.stringify(updated));
        return updated;
      });

      if (!alreadyDebitedLocally) {
        const newWalletTx: WalletTransaction = {
          id: `wtx-${Date.now()}`,
          userId: confirmedOrder.userId || currentUser.id,
          userPhone: confirmedOrder.userPhone || currentUser.phone,
          orderId: confirmedOrder.id,
          orderNumber: confirmedOrder.orderNumber,
          type: 'DEBIT',
          amount: actualWalletUsed,
          balanceAfter: updatedWalletBalance,
          description: `Wallet Applied (Advance) for Order #${confirmedOrder.orderNumber}`,
          createdAt: new Date().toISOString(),
        };

        setWalletTransactions((prev) => {
          if (prev.some((tx) => tx.orderId === confirmedOrder.id && tx.type === 'DEBIT')) {
            return prev;
          }
          const updated = [newWalletTx, ...prev];
          localStorage.setItem('om_wallet_transactions', JSON.stringify(updated));
          return updated;
        });
      }

      // Synchronize latest server-side wallet balance
      refreshCustomerWallet();
    }

    // 5. Clear cart ONLY after verified order confirmation
    clearCart();
    return confirmedOrder;
    })();

    activeOrderSubmissionRef.current = submissionPromise;
    try {
      return await submissionPromise;
    } finally {
      activeOrderSubmissionRef.current = null;
    }
  };

  const cancelOrder = async (
    orderId: string,
    isShopkeeperOverride: boolean = false
  ): Promise<CancelOrderResult> => {
    if (
      !isShopkeeperOverride ||
      activeRole !== Role.SHOPKEEPER ||
      (isSupabaseConfigured && !isAdminSessionValid && !isAdminSessionValidRef.current)
    ) {
      return {
        success: false,
        error: 'Customers cannot cancel orders. Only the shopkeeper can cancel an order.',
      };
    }

    const liveOrders = ordersRef.current.length > 0 ? ordersRef.current : orders;
    const target = liveOrders.find((o) => o.id === orderId || o.orderNumber === orderId);

    if (target?.status === OrderStatus.DELIVERED) {
      return { success: false, error: 'Delivered orders cannot be cancelled.' };
    }

    // Authoritative Server-First Cancellation when Supabase is configured:
    // Never mutate products, orders, wallet, or localStorage before server confirms success.
    if (isSupabaseConfigured) {
      const targetId = target?.id || orderId;
      const apiRes = await cancelOrderInSupabase(targetId);
      if (!apiRes.success) {
        return {
          success: false,
          error: apiRes.error || 'Failed to cancel order on server. Please try again.',
        };
      }

      const serverOrder = apiRes.order;
      const resolvedOrder: Order | undefined = serverOrder
        ? {
            ...(target || ({} as Order)),
            ...serverOrder,
            items:
              serverOrder.items && serverOrder.items.length > 0
                ? serverOrder.items
                : target?.items || [],
          }
        : target
        ? {
            ...target,
            status: OrderStatus.CANCELLED,
            paymentStatus: apiRes.refund?.refunded ? PaymentStatus.REFUNDED : target.paymentStatus,
            stockDeducted: false,
            stockRestored: Boolean(apiRes.stockRestored),
          }
        : undefined;

      if (resolvedOrder) {
        setOrders((prev) => {
          const exists = prev.some(
            (o) => o.id === resolvedOrder.id || o.orderNumber === resolvedOrder.orderNumber
          );
          const updated = exists
            ? prev.map((o) =>
                o.id === resolvedOrder.id || o.orderNumber === resolvedOrder.orderNumber
                  ? resolvedOrder
                  : o
              )
            : [resolvedOrder, ...prev];
          ordersRef.current = updated;
          try {
            localStorage.setItem('om_orders', JSON.stringify(updated));
          } catch {}
          return updated;
        });

        if (resolvedOrder.stockRestored) {
          markStockRestoredForOrder(resolvedOrder.id, resolvedOrder.orderNumber);
        }
      }

      const refundInfo = apiRes.refund;
      if (refundInfo && refundInfo.refunded && typeof refundInfo.newWalletBalance === 'number') {
        const targetPhoneClean = (resolvedOrder?.userPhone || '')
          .replace(/\D/g, '')
          .slice(-10);
        const currentPhoneClean = (currentUser.phone || '').replace(/\D/g, '').slice(-10);
        const matchesCurrentCustomer =
          !isShopkeeperOverride &&
          currentUser.role === Role.CUSTOMER &&
          ((resolvedOrder?.userId && currentUser.id === resolvedOrder.userId) ||
            (targetPhoneClean && currentPhoneClean === targetPhoneClean));

        if (matchesCurrentCustomer) {
          setCurrentUser((prev) => {
            const updatedCurrentUser: User = {
              ...prev,
              walletBalance: refundInfo.newWalletBalance,
            };
            try {
              localStorage.setItem(
                'om_current_user',
                JSON.stringify({ ...updatedCurrentUser, addresses: [] })
              );
              if (currentPhoneClean) {
                localStorage.setItem(
                  `om_profile_${currentPhoneClean}`,
                  JSON.stringify({ ...updatedCurrentUser, addresses: [] })
                );
              }
            } catch {}
            return updatedCurrentUser;
          });
        }

        if (targetPhoneClean || resolvedOrder?.userId) {
          setUsers((prev) =>
            prev.map((u) => {
              const uClean = u.phone ? u.phone.replace(/\D/g, '').slice(-10) : '';
              if (
                (resolvedOrder?.userId && u.id === resolvedOrder.userId) ||
                (targetPhoneClean && uClean === targetPhoneClean)
              ) {
                return { ...u, walletBalance: refundInfo.newWalletBalance };
              }
              return u;
            })
          );
        }

        if (
          refundInfo.creditedNow > 0 &&
          refundInfo.ledgerTransactionId &&
          resolvedOrder
        ) {
          setWalletTransactions((prev) => {
            if (
              prev.some(
                (tx) =>
                  tx.id === refundInfo.ledgerTransactionId ||
                  (tx.type === 'CREDIT' && tx.orderId === resolvedOrder.id)
              )
            ) {
              return prev;
            }
            const nextTx: WalletTransaction = {
              id: refundInfo.ledgerTransactionId!,
              userId: resolvedOrder.userId || currentUser.id,
              userPhone: resolvedOrder.userPhone || currentUser.phone,
              orderId: resolvedOrder.id,
              orderNumber: resolvedOrder.orderNumber,
              type: 'CREDIT',
              amount: refundInfo.creditedNow,
              balanceAfter: refundInfo.newWalletBalance,
              description:
                refundInfo.description ||
                `Refund for Cancelled Order #${resolvedOrder.orderNumber}`,
              createdAt: new Date().toISOString(),
            };
            const updated = [nextTx, ...prev];
            try {
              localStorage.setItem('om_wallet_transactions', JSON.stringify(updated));
            } catch {}
            return updated;
          });
        }
      }

      // Refresh authoritative server state across orders, catalog stock, and customer wallet
      const refreshTasks: Promise<any>[] = [refreshOrders(), refreshProducts()];
      if (!isShopkeeperOverride && currentUser.role === Role.CUSTOMER) {
        refreshTasks.push(refreshCustomerWallet());
      }
      await Promise.allSettled(refreshTasks);

      if (!apiRes.alreadyCancelled && resolvedOrder) {
        const refundAmt = refundInfo?.amount || 0;
        const newAdminNotification: AdminNotification = {
          id: `notif-${Date.now()}`,
          type: 'ORDER_CANCELLED',
          title: `Order #${resolvedOrder.orderNumber} Cancelled`,
          message: isShopkeeperOverride
            ? `Order #${resolvedOrder.orderNumber} cancelled by shopkeeper${
                refundInfo?.refunded && refundAmt > 0
                  ? ` (₹${refundAmt} advance refunded to customer store wallet)`
                  : ''
              }.`
            : `Customer ${
                resolvedOrder.userName || resolvedOrder.userPhone || 'Customer'
              } cancelled order #${resolvedOrder.orderNumber}${
                refundInfo?.refunded && refundAmt > 0
                  ? ` (₹${refundAmt} advance refunded to store wallet)`
                  : ''
              }.`,
          orderId: resolvedOrder.id,
          orderNumber: resolvedOrder.orderNumber,
          amount: refundAmt,
          read: false,
          createdAt: new Date().toISOString(),
        };

        setAdminNotifications((prev) => {
          const updated = [newAdminNotification, ...prev];
          try {
            localStorage.setItem('om_admin_notifications', JSON.stringify(updated));
          } catch {}
          return updated;
        });
      }

      return {
        success: true,
        alreadyCancelled: Boolean(apiRes.alreadyCancelled),
        refunded: Boolean(refundInfo?.refunded),
        refundAmount: refundInfo?.amount || 0,
        walletUsed: refundInfo?.walletUsed || 0,
        onlinePaid: refundInfo?.onlinePaid || 0,
        codPaid: refundInfo?.codPaid || 0,
        stockRestored: Boolean(apiRes.stockRestored),
        order: resolvedOrder,
      };
    }

    // Offline-only fallback mode (!isSupabaseConfigured): localStorage state only
    if (!target) {
      return { success: false, error: 'Order not found.' };
    }

    if (target.status === OrderStatus.CANCELLED || target.status === OrderStatus.DELIVERED) {
      return { success: false, error: 'Order cannot be cancelled in its current state.' };
    }

    const wasDeducted = isStockDeductedForOrder(target.id, target.orderNumber, target);
    const alreadyRestored = isStockRestoredForOrder(target.id, target.orderNumber, target);
    let didRestoreStock = false;

    if (wasDeducted && !alreadyRestored) {
      const currentCatalog = productsRef.current.length > 0 ? productsRef.current : products;
      const { updatedProducts, affectedProducts } = restoreStockForOrder(target, currentCatalog);
      if (affectedProducts.length > 0) {
        productsRef.current = updatedProducts;
        setProducts(updatedProducts);
        markStockRestoredForOrder(target.id, target.orderNumber);
        didRestoreStock = true;
      }
    }

    const isAdvancePaid =
      target.paymentMethod === PaymentMethod.ADVANCE_ONLINE ||
      target.paymentStatus === PaymentStatus.RECEIVED;

    let walletAmountUsed = Math.max(0, target.walletAmountUsed || 0);
    if (walletAmountUsed === 0) {
      const debitTx = walletTransactions.find(
        (tx) =>
          (tx.orderId === target.id || tx.orderNumber === target.orderNumber) &&
          tx.type === 'DEBIT'
      );
      if (debitTx && debitTx.amount > 0) {
        walletAmountUsed = debitTx.amount;
      }
    }

    const isFinalAmountNetOfWallet =
      walletAmountUsed > 0 &&
      target.subtotal !== undefined &&
      Math.abs(
        target.finalAmount -
          (target.subtotal - (target.discountAmount || 0) + (target.deliveryFee || 0) - walletAmountUsed)
      ) < 2;

    const onlineAdvancePayment =
      target.previousOnlinePaid !== undefined && target.previousOnlinePaid > 0
        ? isAdvancePaid
          ? isFinalAmountNetOfWallet
            ? target.finalAmount
            : Math.max(0, target.finalAmount - walletAmountUsed)
          : target.previousOnlinePaid
        : isAdvancePaid
        ? Math.max(
            0,
            isFinalAmountNetOfWallet
              ? target.finalAmount
              : target.paymentStatus === PaymentStatus.RECEIVED
              ? target.finalAmount - walletAmountUsed
              : target.totalPayable !== undefined && target.totalPayable < target.finalAmount
              ? Math.max(0, target.finalAmount - walletAmountUsed - target.totalPayable)
              : target.finalAmount - walletAmountUsed
          )
        : 0;

    const advancePaidAmount = walletAmountUsed + (isAdvancePaid ? onlineAdvancePayment : 0);

    const existingRefundTx = walletTransactions.find(
      (tx) =>
        (tx.orderId === target.id || tx.orderNumber === target.orderNumber) &&
        tx.type === 'CREDIT'
    );
    const alreadyRefundedAmount = existingRefundTx ? existingRefundTx.amount : 0;
    const isAlreadyRefunded =
      target.paymentStatus === PaymentStatus.REFUNDED ||
      (advancePaidAmount > 0 && alreadyRefundedAmount >= advancePaidAmount);
    const amountToCredit = isAlreadyRefunded ? 0 : Math.max(0, advancePaidAmount - alreadyRefundedAmount);

    let walletCreditSucceeded = isAlreadyRefunded;

    if (advancePaidAmount > 0 && amountToCredit > 0) {
      const customerPhone = target.userPhone || '';
      const cleanCustomerPhone = customerPhone ? customerPhone.replace(/\D/g, '').slice(-10) : '';
      const isCurrentCustomer =
        (target.userId && currentUser.id === target.userId) ||
        (cleanCustomerPhone &&
          currentUser.phone &&
          currentUser.phone.replace(/\D/g, '').slice(-10) === cleanCustomerPhone);

      const customerInUsers = users.find(
        (u) =>
          u.role === Role.CUSTOMER &&
          ((target.userId && u.id === target.userId) ||
            (cleanCustomerPhone && u.phone && u.phone.replace(/\D/g, '').slice(-10) === cleanCustomerPhone))
      );

      let customerBaseWallet = 0;
      const userPhoneClean = cleanCustomerPhone;
      const relevantTxs = walletTransactions.filter(
        (t) =>
          (userPhoneClean && t.userPhone && t.userPhone.replace(/\D/g, '').slice(-10) === userPhoneClean) ||
          (target.userId && t.userId === target.userId) ||
          (customerInUsers && t.userId === customerInUsers.id) ||
          (isCurrentCustomer && t.userId === currentUser.id)
      );

      if (relevantTxs.length > 0) {
        const sorted = [...relevantTxs].sort(
          (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
        );
        let running = 0;
        for (const t of sorted) {
          if (t.type === 'CREDIT') running += Number(t.amount) || 0;
          else if (t.type === 'DEBIT') running = Math.max(0, running - (Number(t.amount) || 0));
        }
        customerBaseWallet = running;
      } else if (isCurrentCustomer) {
        customerBaseWallet = Math.max(0, currentUser.walletBalance || 0);
      } else if (customerInUsers) {
        customerBaseWallet = Math.max(0, customerInUsers.walletBalance || 0);
      }

      const newCustomerWalletBalance = customerBaseWallet + amountToCredit;

      setUsers((prev) => {
        let matched = false;
        const updated = prev.map((u) => {
          const uClean = u.phone ? u.phone.replace(/\D/g, '').slice(-10) : '';
          if (
            (target.userId && u.id === target.userId) ||
            (cleanCustomerPhone && uClean === cleanCustomerPhone)
          ) {
            matched = true;
            return {
              ...u,
              walletBalance: newCustomerWalletBalance,
              outstandingBalance: 0,
            };
          }
          return u;
        });
        if (!matched && (target.userId || cleanCustomerPhone)) {
          updated.push({
            id: target.userId || `user-${cleanCustomerPhone}`,
            name: target.userName || 'Customer',
            phone: customerPhone || cleanCustomerPhone,
            role: Role.CUSTOMER,
            walletBalance: newCustomerWalletBalance,
            codOrderCount: 0,
            createdAt: new Date().toISOString(),
          });
        }
        localStorage.setItem('om_users', JSON.stringify(updated));
        return updated;
      });

      if (isCurrentCustomer) {
        const updatedCurrentUser: User = {
          ...currentUser,
          walletBalance: newCustomerWalletBalance,
          outstandingBalance: 0,
        };
        setCurrentUser(updatedCurrentUser);
        localStorage.setItem('om_current_user', JSON.stringify(updatedCurrentUser));
      }

      if (cleanCustomerPhone) {
        try {
          const rawDigits = customerPhone.replace(/\D/g, '');
          let existingProfileData: Partial<User> = customerInUsers || {};
          const cached = localStorage.getItem(`om_profile_${cleanCustomerPhone}`);
          if (cached) {
            try {
              existingProfileData = { ...JSON.parse(cached), ...existingProfileData };
            } catch {}
          }
          const updatedCustomerProfile: User = {
            ...(existingProfileData as User),
            id: target.userId || existingProfileData.id || `user-${cleanCustomerPhone}`,
            name: target.userName || existingProfileData.name || 'Customer',
            phone: customerPhone || existingProfileData.phone || cleanCustomerPhone,
            role: Role.CUSTOMER,
            walletBalance: newCustomerWalletBalance,
            outstandingBalance: 0,
          };
          localStorage.setItem(`om_profile_${cleanCustomerPhone}`, JSON.stringify(updatedCustomerProfile));
          if (rawDigits && rawDigits !== cleanCustomerPhone) {
            localStorage.setItem(`om_profile_${rawDigits}`, JSON.stringify(updatedCustomerProfile));
          }
        } catch {}
      }

      const refundDescription =
        walletAmountUsed > 0 && onlineAdvancePayment > 0
          ? `Refund for Cancelled Order #${target.orderNumber} (₹${walletAmountUsed} wallet + ₹${onlineAdvancePayment} online advance)`
          : walletAmountUsed > 0
          ? `Refund for Cancelled Order #${target.orderNumber} (₹${walletAmountUsed} wallet used)`
          : `Refund for Cancelled Order #${target.orderNumber} (₹${onlineAdvancePayment} online advance)`;

      const resolvedCustId =
        target.userId ||
        (customerInUsers ? customerInUsers.id : isCurrentCustomer ? currentUser.id : `user-${cleanCustomerPhone}`);
      const resolvedCustPhone =
        customerPhone ||
        (customerInUsers ? customerInUsers.phone : isCurrentCustomer ? currentUser.phone : cleanCustomerPhone);

      const newWalletTx: WalletTransaction = {
        id: `wtx-${Date.now()}`,
        userId: resolvedCustId,
        userPhone: resolvedCustPhone,
        orderId: target.id,
        orderNumber: target.orderNumber,
        type: 'CREDIT',
        amount: amountToCredit,
        balanceAfter: newCustomerWalletBalance,
        description: refundDescription,
        createdAt: new Date().toISOString(),
      };

      setWalletTransactions((prev) => {
        const alreadyExists = prev.some(
          (t) => t.type === 'CREDIT' && (t.orderId === target.id || t.orderNumber === target.orderNumber)
        );
        if (alreadyExists) return prev;
        const updated = [newWalletTx, ...prev];
        localStorage.setItem('om_wallet_transactions', JSON.stringify(updated));
        return updated;
      });

      walletCreditSucceeded = true;
    }

    const updatedPaymentStatus =
      advancePaidAmount > 0
        ? walletCreditSucceeded
          ? PaymentStatus.REFUNDED
          : target.paymentStatus
        : target.paymentStatus;

    const cancelledLocalOrder: Order = {
      ...target,
      status: OrderStatus.CANCELLED,
      paymentStatus: updatedPaymentStatus,
      stockDeducted: false,
      stockRestored: wasDeducted ? true : false,
    };

    setOrders((prev) => {
      const updated = prev.map((o) =>
        o.id === target.id || o.orderNumber === target.orderNumber ? cancelledLocalOrder : o
      );
      ordersRef.current = updated;
      localStorage.setItem('om_orders', JSON.stringify(updated));
      return updated;
    });

    const newAdminNotification: AdminNotification = {
      id: `notif-${Date.now()}`,
      type: 'ORDER_CANCELLED',
      title: `Order #${target.orderNumber} Cancelled`,
      message: isShopkeeperOverride
        ? `Order #${target.orderNumber} cancelled offline by shopkeeper${
            updatedPaymentStatus === PaymentStatus.REFUNDED
              ? ` (₹${advancePaidAmount} local wallet refund)`
              : ''
          }.`
        : `Customer ${target.userName || target.userPhone || 'Customer'} cancelled order #${target.orderNumber} offline.`,
      orderId: target.id,
      orderNumber: target.orderNumber,
      amount: advancePaidAmount,
      read: false,
      createdAt: new Date().toISOString(),
    };

    setAdminNotifications((prev) => {
      const updated = [newAdminNotification, ...prev];
      localStorage.setItem('om_admin_notifications', JSON.stringify(updated));
      return updated;
    });

    return {
      success: true,
      refunded: updatedPaymentStatus === PaymentStatus.REFUNDED && advancePaidAmount > 0,
      refundAmount: advancePaidAmount,
      walletUsed: walletAmountUsed,
      onlinePaid: isAdvancePaid ? onlineAdvancePayment : 0,
      stockRestored: didRestoreStock,
      offlineOnly: true,
      order: cancelledLocalOrder,
    };
  };

  const updateOrderStatus = async (
    orderId: string,
    newStatus: OrderStatus
  ): Promise<{ success: boolean; error?: string }> => {
    const liveOrders = ordersRef.current.length > 0 ? ordersRef.current : orders;
    const target = liveOrders.find((o) => o.id === orderId || o.orderNumber === orderId);
    if (!target) return { success: false, error: 'Order not found.' };

    if (newStatus === OrderStatus.CANCELLED) {
      const res = await cancelOrder(orderId, true);
      return res.success
        ? { success: true }
        : { success: false, error: res.error || 'Order cannot be cancelled in its current state.' };
    }

    // Prevent invalid status changes on already cancelled or delivered orders
    if (target.status === OrderStatus.CANCELLED || target.status === OrderStatus.DELIVERED) {
      return { success: false, error: 'Completed or cancelled orders cannot change fulfillment status.' };
    }

    // Check if order is moving to an accepted or subsequent active fulfillment status
    const isAcceptedOrProgressing =
      newStatus === OrderStatus.ORDER_ACCEPTED ||
      newStatus === OrderStatus.PACKING_IN_PROGRESS ||
      newStatus === OrderStatus.READY_FOR_DELIVERY ||
      newStatus === OrderStatus.ON_THE_WAY ||
      newStatus === OrderStatus.DELIVERED;

    // Prevent reverting an already-accepted/deducted order back to ORDER_PENDING
    const alreadyDeducted = isStockDeductedForOrder(target.id, target.orderNumber, target);
    if (alreadyDeducted && newStatus === OrderStatus.ORDER_PENDING) {
      return {
        success: false,
        error: 'Accepted order cannot be reverted back to Order Pending.',
      };
    }

    let nextStockDeducted = Boolean(alreadyDeducted || target.stockDeducted);
    const shouldDeductStockOnAccept = isAcceptedOrProgressing && !alreadyDeducted;

    if (shouldDeductStockOnAccept) {
      const currentCatalog = productsRef.current.length > 0 ? productsRef.current : products;
      const stockCheck = validateOrderStockAvailability(target, currentCatalog);
      if (!stockCheck.available) {
        return {
          success: false,
          error: stockCheck.errorMessage || 'Insufficient stock available to accept this order.',
        };
      }
    }

    const isDelivered = newStatus === OrderStatus.DELIVERED;
    const deliveryTimestamp = isDelivered
      ? target.deliveredAt || new Date().toISOString()
      : target.deliveredAt;

    let nextPaymentStatus = target.paymentStatus;
    let nextCodCollected = target.codCollectedAmount;

    if (isDelivered && target.paymentMethod === PaymentMethod.COD) {
      if (nextCodCollected !== undefined) {
        nextPaymentStatus =
          nextCodCollected === target.finalAmount
            ? PaymentStatus.RECEIVED
            : nextCodCollected > 0
            ? PaymentStatus.PARTIALLY_COLLECTED
            : PaymentStatus.PENDING;
      } else {
        // Default full COD collection if delivered without prior custom record
        nextCodCollected = target.finalAmount;
        nextPaymentStatus = PaymentStatus.RECEIVED;
      }
    }

    const nextIsPaid = nextPaymentStatus === PaymentStatus.RECEIVED ? true : undefined;

    if (isSupabaseConfigured) {
      const res = await updateOrderStatusInSupabase(target.id, newStatus, nextIsPaid, {
        stockDeducted: nextStockDeducted || shouldDeductStockOnAccept,
        stockRestored: false,
        deductStockOnAccept: shouldDeductStockOnAccept,
        expectedUpdatedAt: target.updatedAt,
        orderNumber: target.orderNumber,
        walletAmountUsed: target.walletAmountUsed,
        items: target.items,
        codCollected: nextCodCollected || 0,
        codCharge: target.codCharge || 0,
        deliveredAt: deliveryTimestamp,
        codLateFeeApplied: target.codLateFeeApplied,
        codLateFeeAmount: target.codLateFeeAmount,
        codLateFeeAppliedAt: target.codLateFeeAppliedAt,
        prevOutstanding: target.previousOutstanding || 0,
        totalPayable: target.totalPayable !== undefined ? target.totalPayable : target.finalAmount,
        paymentStatus: nextPaymentStatus,
      });

      if (!res.success) {
        await Promise.allSettled([refreshOrders(), refreshProducts()]);
        return {
          success: false,
          error: res.error || 'Failed to update order status on server.',
        };
      }

      if (res.stockDeducted || shouldDeductStockOnAccept) {
        markStockDeductedForOrder(target.id, target.orderNumber);
        nextStockDeducted = true;
      }

      const committedOrder: Order = res.order
        ? {
            ...target,
            ...res.order,
            items:
              res.order.items && res.order.items.length > 0 ? res.order.items : target.items,
          }
        : {
            ...target,
            status: newStatus,
            deliveredAt: isDelivered ? target.deliveredAt || deliveryTimestamp : target.deliveredAt,
            paymentStatus: nextPaymentStatus,
            codCollectedAmount: nextCodCollected,
            stockDeducted: nextStockDeducted,
            stockRestored: false,
          };

      setOrders((prev) => {
        const nextOrders = prev.map((o) =>
          o.id === target.id || o.orderNumber === target.orderNumber ? committedOrder : o
        );
        ordersRef.current = nextOrders;
        return nextOrders;
      });

      await Promise.allSettled([refreshOrders(), refreshProducts()]);
      return { success: true };
    }

    // Offline-only fallback mode (!isSupabaseConfigured): localStorage state only
    if (shouldDeductStockOnAccept) {
      const currentCatalog = productsRef.current.length > 0 ? productsRef.current : products;
      const { updatedProducts, affectedProducts } = deductStockForOrder(target, currentCatalog);
      if (affectedProducts.length > 0) {
        productsRef.current = updatedProducts;
        setProducts(updatedProducts);
        markStockDeductedForOrder(target.id, target.orderNumber);
        nextStockDeducted = true;
      }
    }

    setOrders((prev) => {
      const nextOrders = prev.map((o) => {
        if (o.id === orderId || o.orderNumber === orderId) {
          return {
            ...o,
            status: newStatus,
            deliveredAt: isDelivered ? o.deliveredAt || deliveryTimestamp : o.deliveredAt,
            paymentStatus: nextPaymentStatus,
            codCollectedAmount: nextCodCollected,
            stockDeducted: nextStockDeducted || Boolean(o.stockDeducted),
            stockRestored: false,
          };
        }
        return o;
      });
      ordersRef.current = nextOrders;
      return nextOrders;
    });

    return { success: true };
  };

  const recordCodCollection = async (
    orderId: string,
    collectedAmount: number,
    markAsDelivered: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    const liveOrders = ordersRef.current.length > 0 ? ordersRef.current : orders;
    const order = liveOrders.find((o) => o.id === orderId);
    if (!order) {
      return { success: false, error: 'Order not found.' };
    }
    if (order.paymentMethod !== PaymentMethod.COD) {
      return { success: false, error: 'Collection can only be recorded for Cash on Delivery (COD) orders.' };
    }

    if (typeof collectedAmount !== 'number' || isNaN(collectedAmount) || !isFinite(collectedAmount)) {
      return { success: false, error: 'Please enter a valid numeric monetary amount.' };
    }

    if (collectedAmount < 0) {
      return { success: false, error: 'Collected amount cannot be negative.' };
    }

    const previouslyCollected = Math.max(0, Number(order.codCollectedAmount) || 0);
    const remainingOrderBalance = Math.max(0, Math.round(((Number(order.finalAmount) || 0) - previouslyCollected) * 100) / 100);
    const customerPriorDebt = getCustomerOutstanding(order.userPhone || order.userId, orderId);
    const maxCollectible = Math.round((remainingOrderBalance + customerPriorDebt) * 100) / 100;
    if (collectedAmount > maxCollectible) {
      return {
        success: false,
        error: `Collected amount (₹${collectedAmount}) cannot exceed the collectible total (₹${maxCollectible}).`,
      };
    }

    const cleanAmount = Math.round(collectedAmount * 100) / 100;

    // Ensure stock is available and deducted if marking directly as delivered from pending state
    let justDeductedStock = isStockDeductedForOrder(order.id, order.orderNumber, order);
    if (markAsDelivered && !justDeductedStock) {
      const currentCatalog = productsRef.current.length > 0 ? productsRef.current : products;
      const stockCheck = validateOrderStockAvailability(order, currentCatalog);
      if (!stockCheck.available) {
        return {
          success: false,
          error: stockCheck.errorMessage || 'Insufficient stock available to deliver this order.',
        };
      }

      const { updatedProducts, affectedProducts } = deductStockForOrder(order, currentCatalog);
      if (affectedProducts.length > 0) {
        productsRef.current = updatedProducts;
        setProducts(updatedProducts);
        markStockDeductedForOrder(order.id, order.orderNumber);
        justDeductedStock = true;
        if (isSupabaseConfigured) {
          affectedProducts.forEach((p) => {
            updateProductStockInSupabase(p.id, p.variants, p).catch((err) => {
              console.warn('Background Supabase product stock deduction error on COD delivery:', err);
            });
          });
        }
      }
    }

    // Allocate cash across previous unpaid/partially paid orders (FIFO) and current order
    const targetCustomer = order.userPhone || order.userId;
    const allocationResult = allocateCodCollection(
      liveOrders,
      targetCustomer,
      orderId,
      cleanAmount,
      markAsDelivered
    );

    const finalUpdatedOrders =
      markAsDelivered && justDeductedStock
        ? allocationResult.updatedOrders.map((o) =>
            o.id === orderId ? { ...o, stockDeducted: true, stockRestored: false } : o
          )
        : allocationResult.updatedOrders;

    // Update React state with all affected orders
    ordersRef.current = finalUpdatedOrders;
    setOrders(finalUpdatedOrders);

    // Update customer in users list and currentUser if matching
    const newDebt = allocationResult.remainingOutstanding;
    setUsers((prev) =>
      prev.map((u) => {
        if (isSameCustomer({ userPhone: u.phone, userId: u.id }, targetCustomer)) {
          return {
            ...u,
            walletBalance: u.walletBalance < 0 ? 0 : u.walletBalance,
            outstandingBalance: newDebt,
          };
        }
        return u;
      })
    );

    if (isSameCustomer({ userPhone: currentUser.phone, userId: currentUser.id }, targetCustomer)) {
      setCurrentUser((prev) => {
        const updated = {
          ...prev,
          walletBalance: prev.walletBalance < 0 ? 0 : prev.walletBalance,
          outstandingBalance: newDebt,
        };
        try {
          localStorage.setItem('om_current_user', JSON.stringify(updated));
          const cleanP = updated.phone?.replace(/\D/g, '').slice(-10);
          if (cleanP) {
            localStorage.setItem(`om_profile_${cleanP}`, JSON.stringify(updated));
          }
        } catch {}
        return updated;
      });
    }

    // Persist permanently to backend database API and Supabase
    recordCodCollectionViaApi({
      orderId,
      orderNumber: order.orderNumber,
      customerPhone: order.userPhone,
      customerId: order.userId,
      customerName: order.userName,
      collectedAmount: cleanAmount,
      previousOutstanding: customerPriorDebt > 0 ? customerPriorDebt : (order.previousOutstanding || 0),
      orderAmount: order.finalAmount,
      totalPayable: order.finalAmount,
      markAsDelivered,
      stockDeducted: markAsDelivered && justDeductedStock ? true : undefined,
      allCustomerOrders: orders.filter(
        (o) => isSameCustomer(o, order.userPhone || order.userId)
      ),
    }).catch((err) => {
      console.warn('Persistent COD API save notice:', err);
    });

    return { success: true };
  };

  // Address management (single source of truth: Supabase public.addresses via /api/addresses)
  const userAddresses = currentUser.addresses || [];

  const applyAuthoritativeAddresses = useCallback((dbAddresses: Address[], targetPhone?: string) => {
    setCurrentUser((prev) => {
      const prevClean = prev.phone ? prev.phone.replace(/\D/g, '').slice(-10) : '';
      const cleanTarget = targetPhone ? targetPhone.replace(/\D/g, '').slice(-10) : prevClean;
      if (targetPhone && prevClean && prevClean !== cleanTarget) return prev;
      return { ...prev, addresses: dbAddresses };
    });

    setSelectedAddressId((prevSelected) => {
      if (prevSelected && dbAddresses.some((a) => a.id === prevSelected)) {
        return prevSelected;
      }
      const def = dbAddresses.find((a) => a.isDefault) || dbAddresses[0];
      return def ? def.id : null;
    });
  }, []);

  const hasHydratedCustomerOnMountRef = useRef<boolean>(false);

  const resetStaleCustomerClientSession = useCallback(() => {
    try {
      const saved = localStorage.getItem('om_customer_session');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (!isAdminRoleValue(parsed?.role)) {
          localStorage.removeItem('om_customer_session');
        }
      }
      localStorage.removeItem('om_current_user');
    } catch {
      localStorage.removeItem('om_customer_session');
    }
    setCurrentUser(BLANK_CUSTOMER);
    setCart([]);
    setOrders([]);
    setWalletTransactions([]);
    setSelectedAddressId(null);
    setAddressesError(null);
    setCustomerFlowStep('AUTH');
  }, []);

  const ensureCustomerSessionCookie = useCallback(
    async (phoneOverride?: string, _nameOverride?: string, customerIdOverride?: string): Promise<boolean> => {
      if (!isSupabaseConfigured) return true;
      const cleanPhone = normalizeIndianMobile(phoneOverride || currentUser.phone);
      if (cleanPhone.length !== 10) return false;

      const check = await checkCustomerServerSession();
      if (
        check.authenticated &&
        check.phone === cleanPhone &&
        (!customerIdOverride || check.customerId === customerIdOverride)
      ) {
        return true;
      }

      // Never auto-create a session via customer-login when cookie verification fails.
      resetStaleCustomerClientSession();
      return false;
    },
    [currentUser.phone, resetStaleCustomerClientSession]
  );

  const refreshAddresses = useCallback(async (): Promise<Address[]> => {
    if (!isSupabaseConfigured) {
      return currentUser.addresses || [];
    }

    const cleanPhone = (currentUser.phone || '').replace(/\D/g, '').slice(-10);
    if (activeRole !== Role.CUSTOMER || cleanPhone.length !== 10) {
      return [];
    }

    setAddressesLoading(true);
    setAddressesError(null);

    try {
      const hasSession = await ensureCustomerSessionCookie(cleanPhone);
      if (!hasSession) {
        const msg = 'Unable to verify customer session for loading addresses.';
        setAddressesError(msg);
        return [];
      }

      const result = await fetchAddressesFromSupabase();
      if (!result.success) {
        setAddressesError(result.error || 'Failed to load addresses from database.');
        return [];
      }

      applyAuthoritativeAddresses(result.addresses, cleanPhone);
      return result.addresses;
    } catch (err: any) {
      setAddressesError(err?.message || 'Database error while loading addresses.');
      return [];
    } finally {
      setAddressesLoading(false);
    }
  }, [activeRole, applyAuthoritativeAddresses, currentUser.addresses, currentUser.phone, ensureCustomerSessionCookie]);

  // Single unified customer session restore on mount:
  // 1. Checks /api/auth/customer-me first (never calls customer-login automatically).
  // 2. If invalid, resets safely to AUTH state.
  // 3. If valid, fetches profile + delivery addresses ONCE in parallel.
  useEffect(() => {
    if (
      !isSupabaseConfigured ||
      activeRole !== Role.CUSTOMER ||
      isVerifyingAdminSession ||
      shopkeeperLoginRedirect ||
      hasHydratedCustomerOnMountRef.current
    ) {
      return;
    }

    let cancelled = false;

    const hydrateCustomerSessionOnMount = async () => {
      try {
        const serverSession = await checkCustomerServerSession();
        if (cancelled) return;
        hasHydratedCustomerOnMountRef.current = true;

        if (!serverSession.authenticated || !serverSession.phone) {
          resetStaleCustomerClientSession();
          return;
        }

        const cleanPhone = normalizeIndianMobile(serverSession.phone);
        if (!cleanPhone) {
          resetStaleCustomerClientSession();
          return;
        }

        setAddressesLoading(true);
        setAddressesError(null);

        const [dbProfile, addrRes] = await Promise.all([
          fetchCustomerProfileFromSupabase(cleanPhone, { includeLedger: false }),
          fetchAddressesFromSupabase(),
        ]);
        if (cancelled) return;
        setAddressesLoading(false);

        if (!addrRes.success) {
          setAddressesError(addrRes.error || 'Failed to load delivery addresses.');
        }

        const dbAddresses = addrRes.success ? addrRes.addresses : [];
        const resolvedName = dbProfile?.name?.trim() || '';
        const shouldEnterShop = Boolean(resolvedName || dbAddresses.length > 0);
        const restoredUser: User = {
          id: dbProfile?.id || serverSession.customerId || `user-${cleanPhone}`,
          name: resolvedName,
          phone: cleanPhone,
          role: Role.CUSTOMER,
          walletBalance: Math.max(0, Number(dbProfile?.walletBalance || 0)),
          outstandingBalance: Number(dbProfile?.outstandingBalance || 0),
          codOrderCount: Number(dbProfile?.codOrderCount || 0),
          addresses: dbAddresses,
          createdAt: dbProfile?.createdAt || new Date().toISOString(),
          isDatabaseVerified: Boolean(dbProfile?.id || serverSession.customerId),
        };

        setCurrentUser(restoredUser);
        setActiveRoleState(Role.CUSTOMER);
        const defaultAddr = dbAddresses.find((a) => a.isDefault) || dbAddresses[0];
        setSelectedAddressId(defaultAddr?.id || null);
        setCart(loadCustomerCart(cleanPhone));
        setCustomerFlowStep(shouldEnterShop ? 'SHOP' : 'PROFILE');

        try {
          localStorage.setItem(
            `om_profile_${cleanPhone}`,
            JSON.stringify({ ...restoredUser, addresses: [] })
          );
          localStorage.setItem(
            'om_customer_session',
            JSON.stringify({
              phone: cleanPhone,
              role: Role.CUSTOMER,
              profileCompleted: shouldEnterShop,
            })
          );
        } catch {}
      } catch {
        setAddressesLoading(false);
        // On check failure, do not auto-create session; stay safely in AUTH if unverified
      }
    };

    hydrateCustomerSessionOnMount();
    return () => {
      cancelled = true;
    };
  }, [isSupabaseConfigured, activeRole, isVerifyingAdminSession, shopkeeperLoginRedirect, resetStaleCustomerClientSession]);

  const persistLocalOfflineAddresses = (updatedUser: User) => {
    if (isSupabaseConfigured) return;
    const cleanPhone = updatedUser.phone ? updatedUser.phone.replace(/\D/g, '').slice(-10) : '';
    try {
      localStorage.setItem('om_current_user', JSON.stringify(updatedUser));
      if (cleanPhone) {
        localStorage.setItem(`om_profile_${cleanPhone}`, JSON.stringify(updatedUser));
      }
      setUsers((prev) => {
        const exists = prev.some(
          (u) => u.id === updatedUser.id || (cleanPhone && u.phone?.replace(/\D/g, '').slice(-10) === cleanPhone)
        );
        const next = exists
          ? prev.map((u) =>
              u.id === updatedUser.id || (cleanPhone && u.phone?.replace(/\D/g, '').slice(-10) === cleanPhone)
                ? updatedUser
                : u
            )
          : [...prev, updatedUser];
        localStorage.setItem('om_users', JSON.stringify(next));
        return next;
      });
    } catch {}
  };

  const addAddress = async (
    addressData: Omit<Address, 'id' | 'userId'>
  ): Promise<{ success: boolean; error?: string; address?: Address }> => {
    const cleanLine1 = (addressData.addressLine1 ?? addressData.fullAddress ?? '').trim();
    const cleanLine2 = (addressData.addressLine2 ?? '').trim();
    const cleanLandmark = (addressData.landmark ?? '').trim();
    const cleanCity = (addressData.city ?? '').trim();
    const cleanState = (addressData.state ?? '').trim();
    const cleanPincode = (addressData.pincode ?? '').trim();
    const cleanRecipientName = (addressData.recipientName ?? currentUser.name ?? '').trim();
    const cleanRecipientPhone = normalizeIndianMobile(addressData.recipientPhone ?? currentUser.phone ?? '');
    const resolvedLabel = normalizeAddressLabel(addressData.addressLabel ?? addressData.label);

    if (!cleanRecipientName) {
      return { success: false, error: 'Recipient name is required.' };
    }
    if (!cleanRecipientPhone || !INDIAN_MOBILE_REGEX.test(cleanRecipientPhone)) {
      return { success: false, error: INVALID_INDIAN_MOBILE_MESSAGE };
    }
    if (!cleanLine1) {
      return { success: false, error: 'Address line 1 is required.' };
    }
    if (!cleanCity) {
      return { success: false, error: 'City is required.' };
    }
    if (!cleanState) {
      return { success: false, error: 'State is required.' };
    }
    if (!cleanPincode || !/^\d{6}$/.test(cleanPincode)) {
      return { success: false, error: 'Please enter a valid 6-digit pincode.' };
    }

    const derivedFullAddress = formatFullAddress({
      addressLine1: cleanLine1,
      addressLine2: cleanLine2,
      landmark: cleanLandmark,
      city: cleanCity,
      state: cleanState,
      pincode: cleanPincode,
    });

    if (!isSupabaseConfigured) {
      const shouldBeDefault = Boolean(addressData.isDefault) || userAddresses.length === 0;
      const newAddress: Address = {
        ...addressData,
        label: resolvedLabel,
        addressLabel: resolvedLabel,
        recipientName: cleanRecipientName,
        recipientPhone: cleanRecipientPhone,
        addressLine1: cleanLine1,
        addressLine2: cleanLine2,
        fullAddress: derivedFullAddress,
        landmark: cleanLandmark,
        city: cleanCity,
        state: cleanState,
        pincode: cleanPincode,
        id: `addr-${Date.now()}`,
        userId: currentUser.id,
        isDefault: shouldBeDefault,
      };
      const updatedAddresses = [
        ...userAddresses.map((a) => (shouldBeDefault ? { ...a, isDefault: false } : a)),
        newAddress,
      ];
      const updatedUser: User = { ...currentUser, addresses: updatedAddresses };
      setCurrentUser(updatedUser);
      setSelectedAddressId(newAddress.id);
      persistLocalOfflineAddresses(updatedUser);
      return { success: true, address: newAddress };
    }

    setAddressesError(null);
    const hasSession = await ensureCustomerSessionCookie();
    if (!hasSession) {
      const msg = 'Unable to verify customer session. Please log in again.';
      setAddressesError(msg);
      return { success: false, error: msg };
    }

    const res = await createAddressInSupabase({
      label: resolvedLabel,
      addressLabel: resolvedLabel,
      recipientName: cleanRecipientName,
      recipientPhone: cleanRecipientPhone,
      addressLine1: cleanLine1,
      addressLine2: cleanLine2,
      fullAddress: derivedFullAddress,
      landmark: cleanLandmark,
      city: cleanCity,
      state: cleanState,
      pincode: cleanPincode,
      isDefault: Boolean(addressData.isDefault) || userAddresses.length === 0,
    });

    if (!res.success) {
      const msg = res.error || 'Failed to save address to database.';
      setAddressesError(msg);
      return { success: false, error: msg };
    }

    const refreshed = await refreshAddresses();
    const effectiveList = refreshed.length > 0 ? refreshed : res.addresses;
    if (res.address?.id) {
      setSelectedAddressId(res.address.id);
    } else if (effectiveList.length > 0) {
      const def = effectiveList.find((a) => a.isDefault) || effectiveList[0];
      setSelectedAddressId(def.id);
    }
    return { success: true, address: res.address };
  };

  const updateAddress = async (
    addressId: string,
    updates: Partial<Address>
  ): Promise<{ success: boolean; error?: string; address?: Address }> => {
    if (!addressId) {
      return { success: false, error: 'Address ID is required.' };
    }

    if (!isSupabaseConfigured) {
      const shouldBeDefault = updates.isDefault === true;
      let updatedAddresses = userAddresses.map((a) => {
        if (a.id === addressId) {
          const merged: Address = {
            ...a,
            ...updates,
            ...(updates.addressLabel !== undefined || updates.label !== undefined
              ? {
                  label: normalizeAddressLabel(updates.addressLabel ?? updates.label),
                  addressLabel: normalizeAddressLabel(updates.addressLabel ?? updates.label),
                }
              : {}),
            isDefault: updates.isDefault !== undefined ? updates.isDefault : a.isDefault,
          };
          merged.fullAddress = formatFullAddress(merged) || merged.fullAddress;
          return merged;
        }
        return shouldBeDefault ? { ...a, isDefault: false } : a;
      });
      if (updatedAddresses.length > 0 && !updatedAddresses.some((a) => a.isDefault)) {
        const replacement = updatedAddresses.find((a) => a.id !== addressId) || updatedAddresses[0];
        updatedAddresses = updatedAddresses.map((a) =>
          a.id === replacement.id ? { ...a, isDefault: true } : a
        );
      }
      const updatedUser: User = { ...currentUser, addresses: updatedAddresses };
      setCurrentUser(updatedUser);
      if (updates.isDefault === true) {
        setSelectedAddressId(addressId);
      }
      persistLocalOfflineAddresses(updatedUser);
      return { success: true, address: updatedAddresses.find((a) => a.id === addressId) };
    }

    setAddressesError(null);
    const hasSession = await ensureCustomerSessionCookie();
    if (!hasSession) {
      const msg = 'Unable to verify customer session. Please log in again.';
      setAddressesError(msg);
      return { success: false, error: msg };
    }

    const res = await updateAddressInSupabase(addressId, updates);
    if (!res.success) {
      const msg = res.error || 'Failed to update address in database.';
      setAddressesError(msg);
      return { success: false, error: msg };
    }

    await refreshAddresses();
    if (updates.isDefault === true) {
      setSelectedAddressId(addressId);
    }
    return { success: true, address: res.address };
  };

  const deleteAddress = async (addressId: string): Promise<{ success: boolean; error?: string }> => {
    if (!addressId) {
      return { success: false, error: 'Address ID is required.' };
    }

    if (!isSupabaseConfigured) {
      const target = userAddresses.find((a) => a.id === addressId);
      const remaining = userAddresses.filter((a) => a.id !== addressId);
      if (target?.isDefault && remaining.length > 0 && !remaining.some((a) => a.isDefault)) {
        remaining[0] = { ...remaining[0], isDefault: true };
      }
      const updatedUser: User = { ...currentUser, addresses: remaining };
      setCurrentUser(updatedUser);
      if (selectedAddressId === addressId) {
        const nextDef = remaining.find((a) => a.isDefault) || remaining[0];
        setSelectedAddressId(nextDef?.id || null);
      }
      persistLocalOfflineAddresses(updatedUser);
      return { success: true };
    }

    setAddressesError(null);
    const hasSession = await ensureCustomerSessionCookie();
    if (!hasSession) {
      const msg = 'Unable to verify customer session. Please log in again.';
      setAddressesError(msg);
      return { success: false, error: msg };
    }

    const res = await deleteAddressInSupabase(addressId);
    if (!res.success) {
      const msg = res.error || 'Failed to delete address from database.';
      setAddressesError(msg);
      return { success: false, error: msg };
    }

    const refreshed = await refreshAddresses();
    if (selectedAddressId === addressId) {
      const nextDef = refreshed.find((a) => a.isDefault) || refreshed[0];
      setSelectedAddressId(nextDef?.id || null);
    }
    return { success: true };
  };

  const setDefaultAddress = async (addressId: string): Promise<{ success: boolean; error?: string }> => {
    if (!userAddresses.some((a) => a.id === addressId)) {
      return { success: false, error: 'Selected address not found.' };
    }

    if (!isSupabaseConfigured) {
      const updatedAddresses = userAddresses.map((a) => ({
        ...a,
        isDefault: a.id === addressId,
      }));
      const updatedUser: User = { ...currentUser, addresses: updatedAddresses };
      setCurrentUser(updatedUser);
      setSelectedAddressId(addressId);
      persistLocalOfflineAddresses(updatedUser);
      return { success: true };
    }

    setAddressesError(null);
    const hasSession = await ensureCustomerSessionCookie();
    if (!hasSession) {
      const msg = 'Unable to verify customer session. Please log in again.';
      setAddressesError(msg);
      return { success: false, error: msg };
    }

    const res = await setDefaultAddressInSupabase(addressId);
    if (!res.success) {
      const msg = res.error || 'Failed to set default address in database.';
      setAddressesError(msg);
      return { success: false, error: msg };
    }

    await refreshAddresses();
    setSelectedAddressId(addressId);
    return { success: true };
  };

  // Customer profile save (Rule 1, 2, 6, 7, 8 — preserves additional delivery addresses & labels in public.addresses)
  const saveCustomerProfile = async (data: {
    name: string;
    addressLine1: string;
    addressLine2?: string;
    landmark: string;
    city: string;
    state: string;
    pincode: string;
    label?: string;
    addressLabel?: AddressLabel | string;
    fullAddress?: string;
  }): Promise<void> => {
    // Sourced strictly from authenticated customer record (Rule 1 & 2)
    const cleanPhone = currentUser.phone.replace(/\D/g, '').slice(-10) || currentUser.phone.replace(/\D/g, '');
    const targetUserId = currentUser.id || `user-${cleanPhone}`;
    const existingDefault = currentUser.addresses.find((a) => a.isDefault) || currentUser.addresses[0];
    const preservedLabel = normalizeAddressLabel(
      data.addressLabel ?? data.label ?? existingDefault?.addressLabel ?? existingDefault?.label
    );
    const cleanLine1 = (data.addressLine1 ?? data.fullAddress ?? '').trim();
    const cleanLine2 = (data.addressLine2 ?? '').trim();
    const cleanLandmark = (data.landmark ?? '').trim();
    const cleanCity = (data.city ?? existingDefault?.city ?? '').trim();
    const cleanState = (data.state ?? existingDefault?.state ?? '').trim();
    const cleanPincode = (data.pincode ?? existingDefault?.pincode ?? '').trim();

    if (!cleanLine1) {
      throw new Error('Please enter your delivery address (Address Line 1).');
    }
    if (!cleanCity) {
      throw new Error('Please enter your city.');
    }
    if (!cleanState) {
      throw new Error('Please enter your state.');
    }
    if (!cleanPincode || !/^\d{6}$/.test(cleanPincode)) {
      throw new Error('Please enter a valid 6-digit pincode.');
    }

    const derivedFullAddress = formatFullAddress({
      addressLine1: cleanLine1,
      addressLine2: cleanLine2,
      landmark: cleanLandmark,
      city: cleanCity,
      state: cleanState,
      pincode: cleanPincode,
    });

    let resolvedUserId = targetUserId;
    let authoritativeAddresses: Address[] = currentUser.addresses || [];

    if (isSupabaseConfigured) {
      const hasSession = await ensureCustomerSessionCookie(cleanPhone);
      if (!hasSession) {
        throw new Error('Unable to establish customer database session. Please try again.');
      }

      const savedProfileUser = await saveCustomerProfileToSupabase(
        targetUserId,
        cleanPhone,
        data.name.trim(),
        derivedFullAddress,
        cleanLandmark,
        cleanPincode
      );
      if (savedProfileUser?.id) {
        resolvedUserId = savedProfileUser.id;
      }

      const currentDbRes = await fetchAddressesFromSupabase();
      const currentDbList = currentDbRes.success ? currentDbRes.addresses : [];
      const dbDefault = currentDbList.find((a) => a.isDefault) || currentDbList[0] || null;

      if (dbDefault) {
        const updRes = await updateAddressInSupabase(dbDefault.id, {
          addressLabel: preservedLabel,
          label: preservedLabel,
          recipientName: data.name.trim(),
          recipientPhone: cleanPhone,
          addressLine1: cleanLine1,
          addressLine2: cleanLine2,
          landmark: cleanLandmark,
          city: cleanCity,
          state: cleanState,
          pincode: cleanPincode,
          isDefault: true,
        });
        if (!updRes.success) {
          throw new Error(updRes.error || 'Failed to update default address in database.');
        }
      } else {
        const crtRes = await createAddressInSupabase({
          addressLabel: preservedLabel,
          label: preservedLabel,
          recipientName: data.name.trim(),
          recipientPhone: cleanPhone,
          addressLine1: cleanLine1,
          addressLine2: cleanLine2,
          fullAddress: derivedFullAddress,
          landmark: cleanLandmark,
          city: cleanCity,
          state: cleanState,
          pincode: cleanPincode,
          isDefault: true,
        });
        if (!crtRes.success) {
          throw new Error(crtRes.error || 'Failed to save delivery address to database.');
        }
      }

      const refreshedRes = await fetchAddressesFromSupabase();
      if (!refreshedRes.success) {
        throw new Error(refreshedRes.error || 'Failed to refresh delivery addresses from database.');
      }
      authoritativeAddresses = refreshedRes.addresses;
    } else {
      const targetAddrId = existingDefault?.id || `addr-${targetUserId}-1`;
      const updatedDefaultAddress: Address = {
        id: targetAddrId,
        userId: targetUserId,
        label: preservedLabel,
        addressLabel: preservedLabel,
        recipientName: data.name.trim(),
        recipientPhone: cleanPhone,
        addressLine1: cleanLine1,
        addressLine2: cleanLine2,
        fullAddress: derivedFullAddress,
        landmark: cleanLandmark,
        city: cleanCity,
        state: cleanState,
        pincode: cleanPincode,
        isDefault: true,
      };
      const otherAddresses = (currentUser.addresses || [])
        .filter((a) => a.id !== targetAddrId)
        .map((a) => ({ ...a, isDefault: false }));
      authoritativeAddresses = [updatedDefaultAddress, ...otherAddresses];
    }

    const defaultAfterSave = authoritativeAddresses.find((a) => a.isDefault) || authoritativeAddresses[0];

    const updatedUser: User = {
      ...currentUser,
      id: resolvedUserId,
      name: data.name.trim(),
      phone: cleanPhone,
      role: Role.CUSTOMER,
      addresses: authoritativeAddresses,
      isDatabaseVerified: isSupabaseConfigured,
    };

    // 1. Update state
    setCurrentUser(updatedUser);
    setSelectedAddressId(defaultAfterSave?.id || null);
    setUsers((prev) => {
      const userForCache = isSupabaseConfigured ? { ...updatedUser, addresses: [] } : updatedUser;
      const exists = prev.some((u) => u.phone?.replace(/\D/g, '').slice(-10) === cleanPhone || u.id === resolvedUserId);
      const next = exists
        ? prev.map((u) => (u.phone?.replace(/\D/g, '').slice(-10) === cleanPhone || u.id === resolvedUserId ? userForCache : u))
        : [...prev, userForCache];
      try {
        localStorage.setItem('om_users', JSON.stringify(next));
      } catch {}
      return next;
    });

    // 2. Save customer session & non-address profile metadata locally (addresses live in Supabase when configured)
    const cachedProfile = isSupabaseConfigured ? { ...updatedUser, addresses: [] } : updatedUser;
    localStorage.setItem('om_current_user', JSON.stringify(cachedProfile));
    localStorage.setItem(`om_profile_${cleanPhone}`, JSON.stringify(cachedProfile));
    localStorage.setItem(
      'om_customer_session',
      JSON.stringify({
        phone: cleanPhone,
        role: Role.CUSTOMER,
        profileCompleted: true,
      })
    );

    // 3. Navigate to Shop
    setCustomerFlowStep('SHOP');
  };

  // Helper: Notify Shopkeeper via browser/PWA channels and chime when a customer logs in
  const notifyShopkeeperCustomerLogin = (customer: User) => {
    try {
      const cleanPhone = customer.phone ? customer.phone.replace(/\D/g, '') : '';
      const customerDisplayName =
        customer.name?.trim() || `Customer (+91 ${cleanPhone.slice(-10) || 'Unknown'})`;
      const loginTimeStr = new Date().toLocaleTimeString('en-IN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: true,
      });
      const timestamp = Date.now();
      const eventId = `cust-login-${timestamp}-${Math.random().toString(36).slice(2, 7)}`;

      const payload = {
        id: eventId,
        customerName: customerDisplayName,
        phone: cleanPhone,
        loginTime: loginTimeStr,
        timestamp,
      };

      // 1. Record into persistent AdminNotifications list for Shopkeeper
      const newAdminNotification: AdminNotification = {
        id: eventId,
        type: 'CUSTOMER_LOGIN',
        title: 'Customer Logged In',
        message: `${customerDisplayName} logged in at ${loginTimeStr}`,
        customerName: customerDisplayName,
        customerPhone: cleanPhone,
        loginTime: loginTimeStr,
        read: false,
        createdAt: new Date().toISOString(),
      };
      setAdminNotifications((prev) => [newAdminNotification, ...prev]);

      // 2. Broadcast to other open tabs / windows on this device via BroadcastChannel
      try {
        const bc = new BroadcastChannel('om_customer_login_channel');
        bc.postMessage(payload);
        bc.close();
      } catch {}

      // 3. Update localStorage to trigger cross-tab storage event
      try {
        localStorage.setItem('om_last_customer_login', JSON.stringify(payload));
      } catch {}

      // 4. Send to backend server for cross-device notification sync
      fetch('/api/customer-logins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }).catch(() => {});
    } catch (err) {
      console.warn('Customer login notification dispatch notice:', err);
    }
  };

  // Auth operations (Standardized Customer Flow Step 1)
  const loginWithPhone = async (
    phone: string,
    role: Role,
    name?: string,
    options?: { isExisting?: boolean; isNewRegistration?: boolean }
  ): Promise<User> => {
    const cleanPhone = phone.replace(/\D/g, '');

    if (role === Role.SHOPKEEPER) {
      const verified = await checkAdminSession();
      if (!verified) {
        isAdminSessionValidRef.current = false;
        setIsAdminSessionValid(false);
        setActiveRoleState(Role.CUSTOMER);
        setShopkeeperLoginRedirect(true);
        throw new Error('Shopkeeper session verification failed. Please log in again.');
      }
      const shopkeeper = users.find((u) => u.role === Role.SHOPKEEPER) || INITIAL_USERS[0];
      setCurrentUser(shopkeeper);
      setActiveRoleState(Role.SHOPKEEPER);
      setCustomerFlowStep('SHOP');
      setShopkeeperLoginRedirect(false);
      localStorage.setItem(
        'om_customer_session',
        JSON.stringify({
          phone: cleanPhone,
          role: Role.SHOPKEEPER,
          profileCompleted: true,
        })
      );
      setIsAuthModalOpen(false);
      return shopkeeper;
    }

    // CUSTOMER FLOW:
    const cleanPhone10 = normalizeIndianMobile(phone);
    if (!cleanPhone10 || !INDIAN_MOBILE_REGEX.test(cleanPhone10)) {
      throw new Error(INVALID_INDIAN_MOBILE_MESSAGE);
    }

    const isNewRegistration = options?.isNewRegistration === true || options?.isExisting === false;
    const isExistingRequested = options?.isExisting === true && !isNewRegistration;

    if (isSupabaseConfigured) {
      // Establish signed HttpOnly server session cookie + lookup/register authoritative customer record in DB
      const serverAuth = await loginCustomerServerSession(cleanPhone10, {
        name: name?.trim(),
        isExisting: isExistingRequested ? true : isNewRegistration ? false : undefined,
        isNewRegistration,
        mode: isNewRegistration ? 'NEW' : isExistingRequested ? 'EXISTING' : undefined,
      });

      if (!serverAuth.authenticated) {
        if (serverAuth.code === 'DUPLICATE_CUSTOMER' || serverAuth.status === 409) {
          const dupErr: any = new Error(serverAuth.error || DUPLICATE_CUSTOMER_MESSAGE);
          dupErr.code = 'DUPLICATE_CUSTOMER';
          dupErr.redirectToLogin = true;
          dupErr.normalizedPhone = cleanPhone10;
          throw dupErr;
        }
        if (isExistingRequested || serverAuth.status === 404) {
          throw new Error(
            serverAuth.error ||
              `No registered customer profile found for +91 ${cleanPhone10}. Please switch to New Customer to register.`
          );
        }
        throw new Error(serverAuth.error || 'Unable to authenticate customer session with server.');
      }

      setAddressesLoading(true);
      setAddressesError(null);
      const addrRes = await fetchAddressesFromSupabase();
      setAddressesLoading(false);
      if (!addrRes.success) {
        setAddressesError(addrRes.error || 'Failed to load delivery addresses.');
      }

      const dbAddresses = addrRes.success ? addrRes.addresses : [];
      const dbUserProfile = serverAuth.user
        ? null
        : await fetchCustomerProfileFromSupabase(cleanPhone10, { includeLedger: false });

      const resolvedName =
        serverAuth.user?.name?.trim() || dbUserProfile?.name?.trim() || name?.trim() || '';
      const resolvedId =
        serverAuth.customerId || dbUserProfile?.id || `user-${cleanPhone10}`;
      const resolvedWallet = Math.max(
        0,
        Number(dbUserProfile?.walletBalance ?? serverAuth.user?.walletBalance ?? 0)
      );
      const resolvedOutstanding = Number(
        dbUserProfile?.outstandingBalance ??
          serverAuth.user?.outstandingBalance ??
          0
      );

      const hasExistingProfileData = Boolean(resolvedName || dbAddresses.length > 0);
      const shouldEnterShop = isExistingRequested || hasExistingProfileData;

      const finalUser: User = {
        id: resolvedId,
        name: resolvedName,
        phone: cleanPhone10,
        role: Role.CUSTOMER,
        walletBalance: resolvedWallet,
        outstandingBalance: resolvedOutstanding,
        codOrderCount: Number(dbUserProfile?.codOrderCount ?? serverAuth.user?.codOrderCount ?? 0),
        addresses: dbAddresses,
        createdAt: dbUserProfile?.createdAt || serverAuth.user?.createdAt || new Date().toISOString(),
        isDatabaseVerified: true,
      };

      hasHydratedCustomerOnMountRef.current = true;
      setCurrentUser(finalUser);
      setActiveRoleState(Role.CUSTOMER);
      const defaultAddr = dbAddresses.find((a) => a.isDefault) || dbAddresses[0];
      setSelectedAddressId(defaultAddr?.id || null);
      setIsAuthModalOpen(false);

      const customerSavedCart = loadCustomerCart(cleanPhone10);
      setCart(customerSavedCart);

      const cachedProfile = { ...finalUser, addresses: [] };
      localStorage.setItem(`om_profile_${cleanPhone10}`, JSON.stringify(cachedProfile));
      localStorage.setItem(
        'om_customer_session',
        JSON.stringify({
          phone: cleanPhone10,
          role: Role.CUSTOMER,
          profileCompleted: shouldEnterShop,
        })
      );

      setUsers((prev) => {
        const exists = prev.some(
          (u) => normalizeIndianMobile(u.phone) === cleanPhone10 || u.id === finalUser.id
        );
        if (exists) {
          return prev.map((u) =>
            normalizeIndianMobile(u.phone) === cleanPhone10 || u.id === finalUser.id
              ? cachedProfile
              : u
          );
        }
        return [...prev, cachedProfile];
      });

      refreshProducts();

      setCustomerFlowStep(shouldEnterShop ? 'SHOP' : 'PROFILE');
      notifyShopkeeperCustomerLogin(finalUser);
      return finalUser;
    }

    const findCachedLocalProfile = (): User | null => {
      try {
        const variants = getIndianMobileVariants(cleanPhone10);
        for (const keySuffix of [cleanPhone10, ...variants]) {
          const cached = localStorage.getItem(`om_profile_${keySuffix}`);
          if (!cached) continue;
          const parsed = JSON.parse(cached);
          if (parsed && parsed.role === Role.CUSTOMER && parsed.id !== 'user-shopkeeper') {
            return parsed;
          }
        }
        return null;
      } catch {
        return null;
      }
    };

    const cachedLocalUser = findCachedLocalProfile();
    const matchingLocalUser = users.find((u) => {
      const uClean = normalizeIndianMobile(u.phone);
      return u.role === Role.CUSTOMER && uClean === cleanPhone10;
    });

    const hasLocalProfile = Boolean(cachedLocalUser || matchingLocalUser);

    if (isNewRegistration && hasLocalProfile) {
      const dupErr: any = new Error(DUPLICATE_CUSTOMER_MESSAGE);
      dupErr.code = 'DUPLICATE_CUSTOMER';
      dupErr.redirectToLogin = true;
      dupErr.normalizedPhone = cleanPhone10;
      throw dupErr;
    }

    const treatAsExisting =
      isExistingRequested || (!isNewRegistration && options?.isExisting === undefined && hasLocalProfile);

    if (treatAsExisting) {
      let resolvedUser: User | null = cachedLocalUser || matchingLocalUser || null;

      if (!resolvedUser && isExistingRequested) {
        throw new Error(
          `No registered customer profile found for +91 ${cleanPhone10}. Please switch to New Customer to register.`
        );
      }

      let resolvedWalletBalance = resolvedUser ? (resolvedUser.walletBalance ?? 0) : 0;
      if (!resolvedUser) {
        try {
          const savedTx = localStorage.getItem('om_wallet_transactions');
          if (savedTx) {
            const txList: WalletTransaction[] = JSON.parse(savedTx);
            const userTx = txList.filter(
              (t) => normalizeIndianMobile(t.userPhone) === cleanPhone10
            );
            if (userTx.length > 0 && typeof userTx[0].balanceAfter === 'number' && userTx[0].balanceAfter >= 0) {
              resolvedWalletBalance = userTx[0].balanceAfter;
            }
          }
        } catch {}
      }

      const userDebt = Number(
        resolvedUser?.outstandingBalance ?? calculateCustomerOutstanding(orders, cleanPhone10)
      );

      const finalUser: User = {
        ...(resolvedUser || {}),
        id: resolvedUser?.id || `user-${cleanPhone10}`,
        name: resolvedUser?.name || name?.trim() || '',
        phone: cleanPhone10,
        role: Role.CUSTOMER,
        walletBalance: resolvedWalletBalance >= 0 ? resolvedWalletBalance : 0,
        outstandingBalance: userDebt,
        codOrderCount: resolvedUser?.codOrderCount || 0,
        addresses: resolvedUser?.addresses || [],
        createdAt: resolvedUser?.createdAt || new Date().toISOString(),
        isDatabaseVerified: false,
      };

      setCurrentUser(finalUser);
      setActiveRoleState(Role.CUSTOMER);
      const defaultAddr = finalUser.addresses.find((a) => a.isDefault) || finalUser.addresses[0];
      setSelectedAddressId(defaultAddr?.id || null);
      setIsAuthModalOpen(false);

      const customerSavedCart = loadCustomerCart(cleanPhone10);
      setCart(customerSavedCart);

      localStorage.setItem(`om_profile_${cleanPhone10}`, JSON.stringify(finalUser));
      localStorage.setItem(
        'om_customer_session',
        JSON.stringify({
          phone: cleanPhone10,
          role: Role.CUSTOMER,
          profileCompleted: true,
        })
      );

      setUsers((prev) => {
        const exists = prev.some(
          (u) => normalizeIndianMobile(u.phone) === cleanPhone10 || u.id === finalUser.id
        );
        if (exists) {
          return prev.map((u) =>
            normalizeIndianMobile(u.phone) === cleanPhone10 || u.id === finalUser.id ? finalUser : u
          );
        }
        return [...prev, finalUser];
      });

      setCustomerFlowStep('SHOP');
      notifyShopkeeperCustomerLogin(finalUser);
      return finalUser;
    }

    // NEW CUSTOMER FLOW (offline/dev fallback):
    const finalUser: User = {
      id: `user-${cleanPhone10}`,
      name: name?.trim() || '',
      phone: cleanPhone10,
      role: Role.CUSTOMER,
      walletBalance: 0,
      codOrderCount: 0,
      addresses: [],
      createdAt: new Date().toISOString(),
      isDatabaseVerified: false,
    };

    setCurrentUser(finalUser);
    setActiveRoleState(Role.CUSTOMER);
    setSelectedAddressId(null);
    setIsAuthModalOpen(false);

    const customerSavedCart = loadCustomerCart(cleanPhone10);
    setCart(customerSavedCart);

    localStorage.setItem(`om_profile_${cleanPhone10}`, JSON.stringify(finalUser));
    localStorage.setItem(
      'om_customer_session',
      JSON.stringify({
        phone: cleanPhone10,
        role: Role.CUSTOMER,
        profileCompleted: false,
      })
    );
    setUsers((prev) => {
      const exists = prev.some(
        (u) => normalizeIndianMobile(u.phone) === cleanPhone10 || u.id === finalUser.id
      );
      if (exists) return prev;
      return [...prev, finalUser];
    });

    setCustomerFlowStep('PROFILE');
    notifyShopkeeperCustomerLogin(finalUser);
    return finalUser;
  };

  const logout = () => {
    hasHydratedCustomerOnMountRef.current = false;
    localStorage.removeItem('om_customer_session');
    localStorage.removeItem('om_current_user');
    logoutCustomerServerSession();
    setCurrentUser(BLANK_CUSTOMER);
    setCart([]);
    setOrders([]);
    setWalletTransactions([]);
    setActiveRoleState(Role.CUSTOMER);
    setSelectedAddressId(null);
    setAddressesError(null);
    setAddressesLoading(false);
    setCustomerFlowStep('AUTH');
    setIsAuthModalOpen(false);
    refreshProducts();
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        users,
        activeRole,
        setActiveRole,
        customerFlowStep,
        setCustomerFlowStep,
        saveCustomerProfile,
        settings,
        updateSettings,
        categories,
        refreshCategories,
        addCategory,
        updateCategory,
        deleteCategory,
        reorderCategories,
        products,
        addProduct,
        bulkAddProducts,
        updateProduct,
        deleteProduct,
        reorderProducts,
        reorderVariants,
        cart,
        addToCart,
        updateCartQty,
        removeFromCart,
        clearCart,
        editingOrder,
        startEditingOrder,
        cancelEditingOrder,
        saveEditedOrder,
        confirmEditedOrderPayment,
        repeatLastOrder,
        repeatOrder,
        repeatOrderNotice,
        setRepeatOrderNotice,
        checkoutBreakdown,
        useWalletBalance,
        setUseWalletBalance,
        orders,
        customerOutstanding,
        getCustomerOutstanding,
        createOrder,
        cancelOrder,
        updateOrderStatus,
        recordCodCollection,
        userAddresses,
        addressesLoading,
        addressesError,
        refreshAddresses,
        addAddress,
        updateAddress,
        deleteAddress,
        setDefaultAddress,
        selectedAddressId,
        setSelectedAddressId,
        isAuthModalOpen,
        setIsAuthModalOpen,
        loginWithPhone,
        logout,
        isSupabaseConfigured,
        refreshOrders,
        refreshCustomerWallet,
        refreshProducts,
        isAdminSessionValid,
        isVerifyingAdminSession,
        shopkeeperLoginRedirect,
        clearShopkeeperLoginRedirect,
        checkAdminSession,
        logoutAdminSession,
        walletTransactions,
        adminNotifications,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        productRequests,
        requestProduct,
        refreshProductRequests,
      }}
    >
      {children}
    </AppContext.Provider>
  );
};

export const useApp = () => {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
};
