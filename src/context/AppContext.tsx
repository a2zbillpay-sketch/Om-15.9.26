import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react';
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
  GoogleLocation,
  WalletTransaction,
  AdminNotification,
  ProductRequest,
  RepeatOrderNotice,
  RepeatOrderResult,
} from '../types';
import {
  INITIAL_SETTINGS,
  INITIAL_CATEGORIES,
  INITIAL_PRODUCTS,
  INITIAL_USERS,
  INITIAL_ORDERS,
} from '../data/seedData';
import { formatVariantPack } from '../utils/variantFormatter';
import {
  calculateCheckoutTotals,
  canCancelOrder,
  CheckoutBreakdown,
  getActiveUnitPrice,
} from '../lib/engine/checkout-calculator';
import {
  isSupabaseConfigured,
  getOrCreateCustomerByPhone,
  fetchCustomerOrdersFromSupabase,
  saveOrderToSupabase,
  fetchAllOrdersForAdmin,
  updateOrderStatusInSupabase,
  creditCustomerWalletInSupabase,
  debitCustomerWalletInSupabase,
  saveCustomerProfileToSupabase,
  fetchCustomerProfileFromSupabase,
  saveProductToSupabase,
  fetchProductsFromSupabase,
  deleteProductFromSupabase,
  updateProductStockInSupabase,
  saveEditedOrderToSupabase,
} from '../lib/supabase';
import {
  fetchCategoriesFromDb,
  saveCategoryToDb,
  deleteCategoryFromDb,
} from '../lib/category-service';
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
  isStockDeductedForOrder,
  markStockDeductedForOrder,
  isStockRestoredForOrder,
  markStockRestoredForOrder,
} from '../lib/stock-service';
import {
  fetchRemoteSettings,
  saveRemoteSettings,
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
  referralCode: '',
  walletBalance: 0,
  codOrderCount: 0,
  addresses: [],
  createdAt: '',
};

// Customer-scoped cart helpers: Isolates every customer's cart by their 10-digit mobile number.
const getCustomerCartKey = (phone?: string): string | null => {
  if (!phone) return null;
  const cleanPhone = phone.replace(/\D/g, '');
  return cleanPhone.length === 10 ? `om_cart_${cleanPhone}` : null;
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
    fullAddress: string;
    landmark: string;
    pincode?: string;
  }) => Promise<void>;
  settings: SystemSetting;
  updateSettings: (newSettings: Partial<SystemSetting>) => void;
  categories: Category[];
  addCategory: (categoryData: {
    name: string;
    imageUrl?: string;
  }) => Promise<{ success: boolean; error?: string; category?: Category }>;
  updateCategory: (
    id: string,
    updates: { name?: string; imageUrl?: string }
  ) => Promise<{ success: boolean; error?: string; category?: Category }>;
  deleteCategory: (id: string) => Promise<{ success: boolean; error?: string }>;
  products: Product[];
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<{ success: boolean; error?: string }>;
  bulkAddProducts: (
    newProds: Omit<Product, 'id' | 'createdAt'>[]
  ) => Promise<{ successCount: number; failedCount: number; errors: string[] }>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<{ success: boolean; error?: string }>;
  deleteProduct: (id: string) => void;
  cart: CartItem[];
  addToCart: (product: Product, variant: ProductVariant, quantity?: number) => void;
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
  getCustomerOutstanding: (phoneOrId?: string) => number;
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
  cancelOrder: (orderId: string, isShopkeeperOverride?: boolean) => boolean;
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => void;
  recordCodCollection: (
    orderId: string,
    collectedAmount: number,
    markAsDelivered?: boolean
  ) => Promise<{ success: boolean; error?: string }> | { success: boolean; error?: string };
  userAddresses: Address[];
  addAddress: (address: Omit<Address, 'id' | 'userId'>) => void;
  selectedAddressId: string | null;
  setSelectedAddressId: (id: string) => void;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  loginWithPhone: (
    phone: string,
    role: Role,
    name?: string,
    options?: { isExisting?: boolean }
  ) => Promise<User>;
  logout: () => void;
  isSupabaseConfigured: boolean;
  refreshOrders: () => Promise<void>;
  refreshProducts: () => Promise<void>;
  isAdminSessionValid: boolean;
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
        return parsed;
      } catch {
        return INITIAL_SETTINGS;
      }
    }
    return INITIAL_SETTINGS;
  });

  const [categories, setCategories] = useState<Category[]>(() => {
    const saved = localStorage.getItem('om_categories');
    if (!saved) return INITIAL_CATEGORIES;
    try {
      const parsed: Category[] = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const existingIds = new Set(parsed.map((c) => c.id));
        const missingInitials = INITIAL_CATEGORIES.filter((c) => !existingIds.has(c.id));
        return [...parsed, ...missingInitials];
      }
      return INITIAL_CATEGORIES;
    } catch {
      return INITIAL_CATEGORIES;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem('om_categories', JSON.stringify(categories));
    } catch (e) {
      console.warn('Failed to persist categories to localStorage', e);
    }
  }, [categories]);

  const [products, setProducts] = useState<Product[]>(() => {
    const saved = localStorage.getItem('om_products');
    if (!saved) return INITIAL_PRODUCTS;
    try {
      const parsed: Product[] = JSON.parse(saved);
      const existingIds = new Set(parsed.map((p) => p.id));
      const missing = INITIAL_PRODUCTS.filter((p) => !existingIds.has(p.id));
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
      return [...normalized, ...missing];
    } catch {
      return INITIAL_PRODUCTS;
    }
  });

  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('om_users');
    return saved ? JSON.parse(saved) : INITIAL_USERS;
  });

  const [customerFlowStep, setCustomerFlowStep] = useState<CustomerFlowStep>(() => {
    const savedSession = localStorage.getItem('om_customer_session');
    if (savedSession) {
      try {
        const session: CustomerSession = JSON.parse(savedSession);
        if (session.role === Role.SHOPKEEPER) return 'SHOP';
        if (session.profileCompleted) return 'SHOP';
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
        if (session.role === Role.SHOPKEEPER) {
          return INITIAL_USERS[0];
        }

        // Rule 5: Never use stale cross-customer data. Fetch strictly for session.phone.
        const phoneKey = `om_profile_${session.phone}`;
        const savedPhoneProfile = localStorage.getItem(phoneKey);
        if (savedPhoneProfile) {
          return JSON.parse(savedPhoneProfile);
        }

        const match = INITIAL_USERS.find((u) => u.phone === session.phone);
        if (match) return match;

        return {
          id: `user-${session.phone}`,
          name: '',
          phone: session.phone,
          role: Role.CUSTOMER,
          referralCode: `OM${session.phone.slice(-4)}`,
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
        return session.role;
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
        if (session.phone) {
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
    const saved = localStorage.getItem('om_orders');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          const missing = INITIAL_ORDERS.filter(
            (io) => !parsed.some((po: any) => po.id === io.id || po.orderNumber === io.orderNumber)
          );
          return missing.length > 0 ? [...parsed, ...missing] : parsed;
        }
      } catch {}
    }
    return INITIAL_ORDERS;
  });

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(() => {
    const defaultAddr = currentUser.addresses.find((a) => a.isDefault);
    return defaultAddr ? defaultAddr.id : currentUser.addresses[0]?.id || null;
  });

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  const [walletTransactions, setWalletTransactions] = useState<WalletTransaction[]>(() => {
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
        const updated = [newRequest, ...prev];
        try {
          localStorage.setItem('om_product_requests', JSON.stringify(updated));
          const cleanPhone = customerPhone.replace(/\D/g, '').slice(-10);
          if (cleanPhone) {
            localStorage.setItem(`om_product_requests_${cleanPhone}`, JSON.stringify(updated));
          }
        } catch {}
        return updated;
      });

      return newRequest;
    },
    [currentUser.id, currentUser.name, currentUser.phone]
  );

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

  // Synchronize settings with centralized server and cross-context channels
  useEffect(() => {
    // 1. Initial fetch from server
    fetchRemoteSettings().then((remote) => {
      if (remote) {
        setSettings((prev) => {
          // If remote is newer or has distinct values, sync it
          if (!prev.updatedAt || !remote.updatedAt || remote.updatedAt >= prev.updatedAt) {
            try {
              localStorage.setItem('om_settings', JSON.stringify(remote));
            } catch {
              // ignore
            }
            return remote;
          }
          return prev;
        });
      }
    });

    // 2. Real-time subscription across installed PWA, Samsung Browser, and AI Studio
    const unsubscribe = subscribeToSettingsSync((synced) => {
      setSettings(synced);
      try {
        localStorage.setItem('om_settings', JSON.stringify(synced));
      } catch {
        // ignore
      }
    });

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

  useEffect(() => {
    localStorage.setItem('om_products', JSON.stringify(products));
  }, [products]);

  useEffect(() => {
    localStorage.setItem('om_users', JSON.stringify(users));
  }, [users]);

  useEffect(() => {
    localStorage.setItem('om_current_user', JSON.stringify(currentUser));
  }, [currentUser]);

  // Sync cart strictly to the active customer's scoped key. Never store to a shared global cart.
  useEffect(() => {
    if (currentUser && currentUser.phone) {
      saveCustomerCart(currentUser.phone, cart);
    }
  }, [cart, currentUser]);

  useEffect(() => {
    localStorage.setItem('om_orders', JSON.stringify(orders));
  }, [orders]);

  // Synchronize orders with Supabase and persistent COD ledger
  const refreshOrders = async () => {
    try {
      let fetchedOrders: Order[] | null = null;
      if (isSupabaseConfigured) {
        if (activeRole === Role.SHOPKEEPER) {
          fetchedOrders = await fetchAllOrdersForAdmin();
        } else {
          fetchedOrders = await fetchCustomerOrdersFromSupabase(currentUser.id, currentUser.phone);
        }
      }

      // Fetch persistent COD transactions and allocations from backend API
      const apiData = await fetchCodCollectionsFromApi(
        activeRole === Role.SHOPKEEPER ? undefined : currentUser.phone
      );

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

      if (apiData && apiData.success && apiData.ordersMap) {
        const merged = baseOrders.map((o) => {
          const persisted = apiData.ordersMap[o.id];
          if (persisted) {
            return {
              ...o,
              codCollectedAmount: persisted.codCollectedAmount ?? o.codCollectedAmount ?? 0,
              previousOutstanding: persisted.previousOutstanding ?? o.previousOutstanding ?? 0,
              totalPayable:
                persisted.totalPayable ??
                o.totalPayable ??
                o.finalAmount,
              paymentStatus: (persisted.paymentStatus as PaymentStatus) || o.paymentStatus,
              status: ((persisted as any).status as OrderStatus) || o.status,
            };
          }
          return o;
        });
        setOrders(merged);
      } else if (fetchedOrders && fetchedOrders.length > 0) {
        setOrders(fetchedOrders);
      }
    } catch (err) {
      console.warn('Error refreshing orders and COD ledger:', err);
    }
  };

  // Synchronize with persistent database on initial mount
  useEffect(() => {
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
                    persisted.totalPayable ??
                    o.totalPayable ??
                    o.finalAmount,
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
  }, []);

  // Synchronize central product catalog with Supabase
  const refreshProducts = async () => {
    if (!isSupabaseConfigured) return;
    try {
      const dbProducts = await fetchProductsFromSupabase();
      // If Supabase is temporarily unavailable (returns null), do not overwrite central catalog
      if (dbProducts !== null) {
        const dbIds = new Set(dbProducts.map((p) => p.id));
        const remainingInitials = INITIAL_PRODUCTS.filter((p) => !dbIds.has(p.id));
        const merged = [...dbProducts, ...remainingInitials];
        setProducts(merged);
      }
    } catch (err) {
      console.warn('Error refreshing products from Supabase:', err);
    }
  };

  // Synchronize categories with Supabase
  const refreshCategories = async () => {
    if (!isSupabaseConfigured) return;
    try {
      const dbCategories = await fetchCategoriesFromDb();
      if (dbCategories !== null && dbCategories.length > 0) {
        const dbIds = new Set(dbCategories.map((c) => c.id));
        const remainingInitials = INITIAL_CATEGORIES.filter((c) => !dbIds.has(c.id));
        setCategories([...dbCategories, ...remainingInitials]);
      }
    } catch (err) {
      console.warn('Error refreshing categories from Supabase:', err);
    }
  };

  useEffect(() => {
    if (isSupabaseConfigured) {
      refreshOrders();
    }
  }, [currentUser.id, currentUser.phone, activeRole]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      refreshProducts();
      refreshCategories();
    }
  }, [isSupabaseConfigured]);

  const [isAdminSessionValid, setIsAdminSessionValid] = useState<boolean>(false);

  const checkAdminSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/me', {
        method: 'GET',
        credentials: 'include',
      });
      if (!res.ok) {
        setIsAdminSessionValid(false);
        return false;
      }
      const data = await res.json().catch(() => ({}));
      const isValid = Boolean(data?.authenticated && data?.role === 'SHOPKEEPER');
      setIsAdminSessionValid(isValid);
      return isValid;
    } catch {
      setIsAdminSessionValid(false);
      return false;
    }
  }, []);

  const logoutAdminSession = useCallback(async () => {
    try {
      await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include',
      });
    } catch {
      // ignore network errors
    } finally {
      setIsAdminSessionValid(false);
      setActiveRoleState(Role.CUSTOMER);
      localStorage.removeItem('om_customer_session');
    }
  }, []);

  const setActiveRole = (role: Role) => {
    setActiveRoleState(role);
    // If switching role, find matching user or switch current user's role
    const matchingUser = users.find((u) => u.role === role);
    if (matchingUser) {
      const userDebt = calculateCustomerOutstanding(orders, matchingUser.phone || matchingUser.id);
      const updatedUser = {
        ...matchingUser,
        walletBalance: userDebt > 0 ? -userDebt : (matchingUser.walletBalance >= 0 ? matchingUser.walletBalance : 0),
        outstandingBalance: userDebt,
      };
      setCurrentUser(updatedUser);
      setSelectedAddressId(matchingUser.addresses[0]?.id || null);
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

    // 4. Persist to centralized server store (which syncs all platforms and Supabase)
    saveRemoteSettings(updated).then((saved) => {
      if (saved) {
        setSettings(saved);
        try {
          localStorage.setItem('om_settings', JSON.stringify(saved));
        } catch {
          // ignore
        }
        broadcastSettingsChange(saved);
      }
    });
  };

  const addProduct = async (
    newProd: Omit<Product, 'id' | 'createdAt'>
  ): Promise<{ success: boolean; error?: string }> => {
    // 1. Validate the product data
    if (!newProd.name || !newProd.name.trim()) {
      return { success: false, error: 'Product name is required.' };
    }
    if (!newProd.variants || newProd.variants.length === 0) {
      return { success: false, error: 'At least one variant is required.' };
    }

    const id = `prod-${Date.now()}`;
    const product: Product = {
      ...newProd,
      brand: newProd.brand ? newProd.brand.trim() : '',
      id,
      createdAt: new Date().toISOString(),
      variants: (newProd.variants || []).map((v, idx) => ({
        ...v,
        id: v.id || `var-${id}-${idx + 1}`,
        productId: id,
      })),
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
        setProducts((prev) => [savedProduct, ...prev]);
        return { success: true };
      } else if (resp.status === 401 && isSupabaseConfigured) {
        return {
          success: false,
          error: 'Shopkeeper authorization required to add products. Please log in as Shopkeeper.',
        };
      } else {
        const errorData = await resp.json().catch(() => ({}));
        if (errorData.error) {
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
    setProducts((prev) => [product, ...prev]);
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
    const current = products.find((p) => p.id === id);
    if (!current) return { success: false, error: 'Product not found.' };
    const updated = { ...current, ...updates };

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
          try {
            localStorage.setItem('om_products', JSON.stringify(next));
          } catch {}
          return next;
        });
        serverSynced = true;
        return { success: true };
      }
    } catch {
      // Offline or network error
    }

    if (!serverSynced) {
      if (isSupabaseConfigured) {
        try {
          await saveProductToSupabase(updated);
        } catch (dbErr) {
          console.warn('Supabase product update error:', dbErr);
        }
      }
      setProducts((prev) => {
        const next = prev.map((p) => (p.id === id ? updated : p));
        try {
          localStorage.setItem('om_products', JSON.stringify(next));
        } catch {}
        return next;
      });
    }
    return { success: true };
  };

  const deleteProduct = async (id: string) => {
    try {
      const resp = await fetch(`/api/products?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (resp.ok) {
        setProducts((prev) => prev.filter((p) => p.id !== id));
        return { success: true };
      }
    } catch {
      // Offline fallback
    }

    if (isSupabaseConfigured) {
      await deleteProductFromSupabase(id);
    }
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  // Category management operations
  const addCategory = async (categoryData: {
    name: string;
    imageUrl?: string;
  }): Promise<{ success: boolean; error?: string; category?: Category }> => {
    const trimmedName = categoryData.name ? categoryData.name.trim() : '';
    if (!trimmedName) {
      return { success: false, error: 'Category name is required and cannot be empty.' };
    }

    // Case-insensitive duplicate check
    const isDuplicate = categories.some(
      (c) => c.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (isDuplicate) {
      return { success: false, error: `A category named "${trimmedName}" already exists.` };
    }

    const newCategory: Category = {
      id: `cat-${Date.now()}`,
      name: trimmedName,
      imageUrl: categoryData.imageUrl ? categoryData.imageUrl.trim() : '',
    };

    if (isSupabaseConfigured) {
      const dbResult = await saveCategoryToDb(newCategory);
      if (!dbResult.success) {
        console.warn('Failed to sync new category to Supabase:', dbResult.error);
      }
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
      return { success: false, error: 'Category not found.' };
    }

    const trimmedName = updates.name !== undefined ? updates.name.trim() : undefined;
    if (trimmedName !== undefined && !trimmedName) {
      return { success: false, error: 'Category name is required and cannot be empty.' };
    }

    // Case-insensitive duplicate check among other categories
    if (trimmedName !== undefined) {
      const isDuplicate = categories.some(
        (c) => c.id !== id && c.name.trim().toLowerCase() === trimmedName.toLowerCase()
      );
      if (isDuplicate) {
        return { success: false, error: `A category named "${trimmedName}" already exists.` };
      }
    }

    const updatedCategory: Category = {
      ...existing,
      name: trimmedName !== undefined ? trimmedName : existing.name,
      imageUrl: updates.imageUrl !== undefined ? updates.imageUrl.trim() : existing.imageUrl,
    };

    if (isSupabaseConfigured) {
      const dbResult = await saveCategoryToDb(updatedCategory);
      if (!dbResult.success) {
        console.warn('Failed to sync category update to Supabase:', dbResult.error);
      }
    }

    setCategories((prev) => prev.map((c) => (c.id === id ? updatedCategory! : c)));
    return { success: true, category: updatedCategory };
  };

  const deleteCategory = async (id: string): Promise<{ success: boolean; error?: string }> => {
    const target = categories.find((c) => c.id === id);
    if (!target) {
      return { success: false, error: 'Category not found.' };
    }

    // Check if products are currently assigned to this category
    const assignedProducts = products.filter((p) => p.categoryId === id);
    if (assignedProducts.length > 0) {
      return {
        success: false,
        error: `Cannot delete "${target.name}". There are currently ${assignedProducts.length} product(s) assigned to this category. Please reassign or delete these products first.`,
      };
    }

    if (isSupabaseConfigured) {
      const dbResult = await deleteCategoryFromDb(id);
      if (!dbResult.success) {
        console.warn('Failed to delete category in Supabase:', dbResult.error);
      }
    }

    setCategories((prev) => prev.filter((c) => c.id !== id));
    return { success: true };
  };

  // Cart operations (scoped to active customer)
  const addToCart = (product: Product, variant: ProductVariant, quantity = 1) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.variantId === variant.id);
      let updated: CartItem[];
      if (existingIndex > -1) {
        const existing = prev[existingIndex];
        const newQty = Math.min(
          variant.maxOrderLimit,
          Math.min(variant.stockQuantity, existing.quantity + quantity)
        );
        updated = [...prev];
        updated[existingIndex] = { ...existing, quantity: newQty };
      } else {
        updated = [...prev, { productId: product.id, product, variantId: variant.id, variant, quantity }];
      }
      if (currentUser?.phone) {
        saveCustomerCart(currentUser.phone, updated);
      }
      return updated;
    });
  };

  const updateCartQty = (variantId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(variantId);
      return;
    }
    setCart((prev) => {
      const updated = prev.map((item) => {
        if (item.variantId === variantId) {
          const clamped = Math.min(
            item.variant.maxOrderLimit,
            Math.min(item.variant.stockQuantity, quantity)
          );
          return { ...item, quantity: clamped };
        }
        return item;
      });
      if (currentUser?.phone) {
        saveCustomerCart(currentUser.phone, updated);
      }
      return updated;
    });
  };

  const removeFromCart = (variantId: string) => {
    setCart((prev) => {
      const updated = prev.filter((item) => item.variantId !== variantId);
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
            variantId: match.variant.id,
            variant: match.variant,
            quantity: Number(item.quantity) || 1,
          };
        }
        const fallbackVariant: ProductVariant = {
          id: item.variantId || `var-${item.id}`,
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
      const unitPrice = getActiveUnitPrice(
        item.variant.baseSellingPrice,
        item.quantity,
        item.variant.tieredPrices || []
      );
      return {
        id: `item-${Date.now()}-${item.variantId}`,
        orderId: currentOrder.id,
        productId: item.productId || item.product.id,
        variantId: item.variantId,
        variantName: item.variant.packLabel,
        productName: item.product.name,
        brand: item.product.brand,
        unit: item.variant.unit,
        packSize: item.variant.packSize,
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

    // COD charge if order was COD
    const isCod = currentOrder.paymentMethod === PaymentMethod.COD;
    const codCharge = isCod
      ? (currentOrder.codCharge !== undefined && currentOrder.codCharge > 0
          ? currentOrder.codCharge
          : (currentUser.codOrderCount < 3 ? 0 : settings.codBaseCharge))
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
          updateProductStockInSupabase(p.id, p.variants).catch(() => {});
          saveProductToSupabase(p).catch((err) => {
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
    currentUser.codOrderCount,
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
        const availableStock = Number(variant.stockQuantity) || 0;

        // Skip product if out of stock
        if (availableStock <= 0) {
          const packLabel = variant.packLabel ? ` (${variant.packLabel})` : '';
          skippedItems.push(`${product.name}${packLabel}`);
          continue;
        }

        // Desired quantity from the past order
        const requestedQty = Math.max(1, Number(item.quantity) || 1);
        const maxLimit =
          variant.maxOrderLimit && variant.maxOrderLimit > 0
            ? variant.maxOrderLimit
            : availableStock;
        const finalQty = Math.min(requestedQty, availableStock, maxLimit);

        itemsForCart.push({
          productId: product.id,
          product,
          variantId: variant.id,
          variant,
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
      const matchId = currentUser.id && o.userId === currentUser.id;
      const matchPhone = currentUser.phone && o.customerPhone === currentUser.phone;
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
    if (currentUser.walletBalance && currentUser.walletBalance < 0) {
      return Math.abs(currentUser.walletBalance);
    }
    return 0;
  }, [orders, currentUser.phone, currentUser.id, currentUser.outstandingBalance, currentUser.walletBalance]);

  const getCustomerOutstanding = useCallback(
    (phoneOrId?: string): number => {
      const target = phoneOrId || currentUser.phone || currentUser.id;
      if (!target) return 0;
      const fromOrders = calculateCustomerOutstanding(orders, target);
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
        if (matchedUser.walletBalance && matchedUser.walletBalance < 0) {
          return Math.abs(matchedUser.walletBalance);
        }
      }
      if (target === currentUser.phone || target === currentUser.id) {
        if (currentUser.outstandingBalance && currentUser.outstandingBalance > 0) {
          return currentUser.outstandingBalance;
        }
        if (currentUser.walletBalance && currentUser.walletBalance < 0) {
          return Math.abs(currentUser.walletBalance);
        }
      }
      return 0;
    },
    [orders, currentUser.phone, currentUser.id, currentUser.outstandingBalance, currentUser.walletBalance, users]
  );

  // Ensure customer COD outstanding debt is tracked as negative walletBalance,
  // showing -₹18 when customer owes ₹18 from previous COD order
  useEffect(() => {
    if (activeRole === Role.CUSTOMER && (currentUser.phone || currentUser.id)) {
      if (customerOutstanding > 0) {
        const targetWallet = -customerOutstanding;
        if (currentUser.walletBalance !== targetWallet || currentUser.outstandingBalance !== customerOutstanding) {
          setCurrentUser((prev) => {
            const updated = {
              ...prev,
              outstandingBalance: customerOutstanding,
              walletBalance: targetWallet,
            };
            try {
              localStorage.setItem('om_current_user', JSON.stringify(updated));
            } catch {}
            return updated;
          });
        }
      } else if (currentUser.walletBalance < 0 && customerOutstanding === 0) {
        setCurrentUser((prev) => {
          const updated = {
            ...prev,
            outstandingBalance: 0,
            walletBalance: 0,
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
      variantId: item.variantId,
      quantity: item.quantity,
      baseSellingPrice: item.variant.baseSellingPrice,
      isDiscountExcluded: item.product.isDiscountExcluded === true || (item.product.isDiscountExcluded as any) === 'true',
      tieredPrices: item.variant.tieredPrices || [],
    }));

    return calculateCheckoutTotals(
      variantItems,
      { codOrderCount: currentUser.codOrderCount },
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
  }, [cart, currentUser.codOrderCount, settings, currentUser.walletBalance, useWalletBalance]);

  // Order Management
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
    const isAdvance = data.paymentMethod === PaymentMethod.ADVANCE_ONLINE;
    const discountedOrderAmount = isAdvance
      ? checkoutBreakdown.advanceFinalTotal
      : checkoutBreakdown.codFinalTotal;
    const discountAmount = isAdvance ? checkoutBreakdown.advanceDiscountAmount : 0;
    const codCharge = isAdvance ? 0 : checkoutBreakdown.codCharge;

    const previousOutstanding = 0; // Never add previous outstanding to the next order

    // Wallet can ONLY be used inside Advance Payment as "Wallet Applied (Advance)"
    // Wallet must be deducted ONLY when:
    // 1. Customer explicitly selects "Advance Payment" (isAdvance === true), AND
    // 2. Customer explicitly chooses to use Wallet in the Advance Payment flow (data.useWallet === true).
    // If customer selects COD or does not select Advance Payment:
    // → Wallet deduction = ₹0
    // → Do not reduce Wallet balance
    // → Do not record Wallet as payment.
    let currentActualWallet = Math.max(0, currentUser.walletBalance || 0);
    try {
      const storedUserStr = localStorage.getItem('om_current_user') || localStorage.getItem('om_dist_current_user');
      if (storedUserStr) {
        const parsed = JSON.parse(storedUserStr);
        if (typeof parsed.walletBalance === 'number' && parsed.walletBalance >= 0) {
          currentActualWallet = parsed.walletBalance;
        }
      }
    } catch {
      // ignore parsing error
    }

    // Explicit check: only apply wallet if advance payment AND customer explicitly chose to use wallet
    const isExplicitlyUsingWallet = isAdvance && Boolean(data.useWallet);
    const walletUsed = isExplicitlyUsingWallet ? Math.min(currentActualWallet, discountedOrderAmount) : 0;

    // When wallet balance is applied during advance payment, deduct it from the discounted order amount in the final bill.
    // Example: Items ₹1250 − 3% discount ₹38 − Wallet ₹184 = Final Bill ₹1028.
    const finalAmount = isAdvance && isExplicitlyUsingWallet
      ? Math.max(0, discountedOrderAmount - walletUsed)
      : discountedOrderAmount;
    const totalPayable = isAdvance
      ? finalAmount
      : Math.max(0, discountedOrderAmount - walletUsed);
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
        const unitPrice = getActiveUnitPrice(
          item.variant.baseSellingPrice,
          item.quantity,
          item.variant.tieredPrices || []
        );
        return {
          id: `item-${Date.now()}-${item.variantId}`,
          orderId,
          productId: item.productId || item.product.id,
          variantId: item.variantId,
          variantName: item.variant.packLabel,
          productName: item.product.name,
          brand: item.product.brand,
          unit: item.variant.unit,
          packSize: item.variant.packSize,
          quantity: item.quantity,
          unitPrice,
          price: unitPrice * item.quantity,
          isDiscountExcluded: item.product.isDiscountExcluded === true || (item.product.isDiscountExcluded as any) === 'true',
        };
      }),
      stockDeducted: false,
      stockRestored: false,
    };

    // Update orders
    setOrders((prev) => [newOrder, ...prev]);

    // Persist to Supabase if configured
    if (isSupabaseConfigured) {
      saveOrderToSupabase(newOrder).catch((err) => {
        console.warn('Background Supabase order save error:', err);
      });
    }

    // Deduct only the amount actually used from the persistent wallet balance
    if (walletUsed > 0) {
      // Prevent duplicate wallet deductions if the payment/order operation is retried
      const isAlreadyDebited = walletTransactions.some(
        (tx) =>
          (tx.orderId === newOrder.id || tx.orderNumber === newOrder.orderNumber) &&
          tx.type === 'DEBIT'
      );

      if (!isAlreadyDebited) {
        const updatedCurrentUser: User = {
          ...currentUser,
          walletBalance: newWalletBalance,
        };

        setCurrentUser(updatedCurrentUser);
        localStorage.setItem('om_current_user', JSON.stringify(updatedCurrentUser));

        const customerPhone = newOrder.userPhone || currentUser.phone;
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
              u.id === newOrder.userId ||
              u.id === currentUser.id ||
              (targetClean && uClean === targetClean)
            ) {
              return {
                ...u,
                walletBalance: newWalletBalance,
              };
            }
            return u;
          });
          localStorage.setItem('om_users', JSON.stringify(updated));
          return updated;
        });

        const newWalletTx: WalletTransaction = {
          id: `wtx-${Date.now()}`,
          userId: newOrder.userId || currentUser.id,
          userPhone: newOrder.userPhone || currentUser.phone,
          orderId: newOrder.id,
          orderNumber: newOrder.orderNumber,
          type: 'DEBIT',
          amount: walletUsed,
          balanceAfter: newWalletBalance,
          description: `Wallet Applied (Advance) for Order #${newOrder.orderNumber}`,
          createdAt: new Date().toISOString(),
        };

        setWalletTransactions((prev) => {
          const updated = [newWalletTx, ...prev];
          localStorage.setItem('om_wallet_transactions', JSON.stringify(updated));
          return updated;
        });

        // Persist debit to Supabase ledger and users table
        if (isSupabaseConfigured) {
          debitCustomerWalletInSupabase({
            userId: newOrder.userId || currentUser.id,
            customerPhone: newOrder.userPhone || currentUser.phone,
            customerName: newOrder.userName || currentUser.name,
            orderId: newOrder.id,
            orderNumber: newOrder.orderNumber,
            amount: walletUsed,
            newWalletBalance,
            description: `Wallet Applied (Advance) for Order #${newOrder.orderNumber}`,
          }).catch((err) => {
            console.warn('Background Supabase wallet debit error:', err);
          });
        }
      }
    }

    // Update user cod count if COD
    if (data.paymentMethod === PaymentMethod.COD) {
      setCurrentUser((prev) => ({
        ...prev,
        codOrderCount: prev.codOrderCount + 1,
      }));
      setUsers((prev) =>
        prev.map((u) =>
          u.id === currentUser.id ? { ...u, codOrderCount: u.codOrderCount + 1 } : u
        )
      );
    }

    // Do NOT deduct stock when order is Pending. Stock deduction occurs strictly upon acceptance.
    clearCart();
    return newOrder;
  };

  const cancelOrder = (orderId: string, isShopkeeperOverride: boolean = false): boolean => {
    const target = orders.find((o) => o.id === orderId || o.orderNumber === orderId);
    if (!target) return false;

    // Check if order is already cancelled (prevent duplicate processing)
    if (target.status === OrderStatus.CANCELLED) {
      return false;
    }

    // Check 15-minute cancellation window rule (bypassed if shopkeeper/admin cancels)
    if (!isShopkeeperOverride && !canCancelOrder(target.createdAt)) {
      return false;
    }

    // Requirement 3: If an order is cancelled while still "Pending", do not change stock.
    const isPending = target.status === OrderStatus.ORDER_PENDING;

    // Restore stock ONLY if stock was deducted upon acceptance and has not yet been restored
    const wasDeducted = !isPending && isStockDeductedForOrder(target.id, target.orderNumber, target);
    const alreadyRestored = isStockRestoredForOrder(target.id, target.orderNumber, target);

    if (wasDeducted && !alreadyRestored) {
      const { updatedProducts, affectedProducts } = restoreStockForOrder(target, products);
      setProducts(updatedProducts);
      markStockRestoredForOrder(target.id, target.orderNumber);

      if (isSupabaseConfigured && affectedProducts.length > 0) {
        affectedProducts.forEach((p) => {
          updateProductStockInSupabase(p.id, p.variants).catch(() => {});
          saveProductToSupabase(p).catch((err) => {
            console.warn('Background Supabase product stock restore error:', err);
          });
        });
      }
    }

    const isAdvancePaid =
      target.paymentMethod === PaymentMethod.ADVANCE_ONLINE ||
      target.paymentStatus === PaymentStatus.RECEIVED;

    // Track both components of advance payment to refund the full order amount:
    // 1. wallet amount used in the cancelled order (strictly actual wallet usage only)
    let walletAmountUsed = Math.max(0, target.walletAmountUsed || 0);
    if (walletAmountUsed === 0) {
      // Check walletTransactions for a DEBIT tx for this order
      const debitTx = walletTransactions.find(
        (tx) =>
          (tx.orderId === target.id || tx.orderNumber === target.orderNumber) &&
          tx.type === 'DEBIT'
      );
      if (debitTx && debitTx.amount > 0) {
        walletAmountUsed = debitTx.amount;
      }
    }

    // 2. online advance payment amount paid by customer (strictly actual online payment only, never adding wallet amount)
    const isFinalAmountNetOfWallet =
      walletAmountUsed > 0 &&
      target.subtotal !== undefined &&
      Math.abs(target.finalAmount - (target.subtotal - (target.discountAmount || 0) + (target.deliveryFee || 0) - walletAmountUsed)) < 2;

    const onlineAdvancePayment =
      target.previousOnlinePaid !== undefined && target.previousOnlinePaid > 0
        ? (isAdvancePaid ? (isFinalAmountNetOfWallet ? target.finalAmount : Math.max(0, target.finalAmount - walletAmountUsed)) : target.previousOnlinePaid)
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

    // Total refund is based on actual payment sources: wallet amount used + actual online advance payment
    const advancePaidAmount = walletAmountUsed + (isAdvancePaid ? onlineAdvancePayment : 0);

    // Prevent duplicate refunds for the same order
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

    // Credit refundable amount to customer's Store Wallet
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
          (target.userId && u.id === target.userId) ||
          (cleanCustomerPhone && u.phone && u.phone.replace(/\D/g, '').slice(-10) === cleanCustomerPhone)
      );

      let customerBaseWallet = 0;
      if (isCurrentCustomer) {
        customerBaseWallet = currentUser.walletBalance >= 0 ? currentUser.walletBalance : 0;
      } else if (customerInUsers) {
        customerBaseWallet = customerInUsers.walletBalance >= 0 ? customerInUsers.walletBalance : 0;
      } else if (cleanCustomerPhone) {
        try {
          const cached = localStorage.getItem(`om_profile_${cleanCustomerPhone}`);
          if (cached) {
            const parsed = JSON.parse(cached);
            customerBaseWallet = parsed.walletBalance >= 0 ? parsed.walletBalance : 0;
          }
        } catch {}
      }

      const newCustomerWalletBalance = customerBaseWallet + amountToCredit;

      // Update customer in users list
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
            referralCode: `OM${cleanCustomerPhone.slice(-4)}`,
            walletBalance: newCustomerWalletBalance,
            codOrderCount: 0,
            createdAt: new Date().toISOString(),
          });
        }
        localStorage.setItem('om_users', JSON.stringify(updated));
        return updated;
      });

      // Update currentUser only if current user is the customer
      if (isCurrentCustomer) {
        const updatedCurrentUser: User = {
          ...currentUser,
          walletBalance: newCustomerWalletBalance,
          outstandingBalance: 0,
        };
        setCurrentUser(updatedCurrentUser);
        localStorage.setItem('om_current_user', JSON.stringify(updatedCurrentUser));
      }

      // Update cached customer profile
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

      // Record wallet credit ledger transaction
      const refundDescription =
        walletAmountUsed > 0 && onlineAdvancePayment > 0
          ? `Refund for Cancelled Order #${target.orderNumber} (₹${walletAmountUsed} wallet + ₹${onlineAdvancePayment} online advance)`
          : walletAmountUsed > 0
          ? `Refund for Cancelled Order #${target.orderNumber} (₹${walletAmountUsed} wallet used)`
          : `Refund for Cancelled Order #${target.orderNumber} (₹${onlineAdvancePayment} online advance)`;

      const newWalletTx: WalletTransaction = {
        id: `wtx-${Date.now()}`,
        userId: target.userId || (customerInUsers ? customerInUsers.id : (isCurrentCustomer ? currentUser.id : `user-${cleanCustomerPhone}`)),
        userPhone: customerPhone || (customerInUsers ? customerInUsers.phone : (isCurrentCustomer ? currentUser.phone : cleanCustomerPhone)),
        orderId: target.id,
        orderNumber: target.orderNumber,
        type: 'CREDIT',
        amount: amountToCredit,
        balanceAfter: newCustomerWalletBalance,
        description: refundDescription,
        createdAt: new Date().toISOString(),
      };

      setWalletTransactions((prev) => {
        const updated = [newWalletTx, ...prev];
        localStorage.setItem('om_wallet_transactions', JSON.stringify(updated));
        return updated;
      });

      if (isSupabaseConfigured) {
        creditCustomerWalletInSupabase({
          userId: target.userId || (customerInUsers ? customerInUsers.id : (isCurrentCustomer ? currentUser.id : `user-${cleanCustomerPhone}`)),
          customerPhone: customerPhone || (customerInUsers ? customerInUsers.phone : (isCurrentCustomer ? currentUser.phone : cleanCustomerPhone)),
          customerName: target.userName || (customerInUsers ? customerInUsers.name : 'Customer'),
          orderId: target.id,
          orderNumber: target.orderNumber,
          amount: amountToCredit,
          newWalletBalance: newCustomerWalletBalance,
          description: refundDescription,
        }).catch((err) => {
          console.warn('Background Supabase wallet credit error:', err);
        });
      }

      walletCreditSucceeded = true;
    }

    // Update Payment Status to REFUNDED only after the wallet credit succeeds
    const updatedPaymentStatus =
      advancePaidAmount > 0
        ? (walletCreditSucceeded ? PaymentStatus.REFUNDED : target.paymentStatus)
        : target.paymentStatus;

    setOrders((prev) => {
      const updated = prev.map((o) =>
        o.id === target.id || o.orderNumber === target.orderNumber
          ? {
              ...o,
              status: OrderStatus.CANCELLED,
              paymentStatus: updatedPaymentStatus,
              stockDeducted: false,
              stockRestored: wasDeducted ? true : false,
            }
          : o
      );
      localStorage.setItem('om_orders', JSON.stringify(updated));
      return updated;
    });

    if (isSupabaseConfigured) {
      updateOrderStatusInSupabase(
        target.id,
        OrderStatus.CANCELLED,
        false,
        {
          stockDeducted: false,
          stockRestored: wasDeducted ? true : false,
          orderNumber: target.orderNumber,
          walletAmountUsed: target.walletAmountUsed || walletAmountUsed || 0,
          items: target.items,
          codCollected: target.codCollectedAmount || 0,
          prevOutstanding: target.previousOutstanding || 0,
          totalPayable: target.totalPayable !== undefined ? target.totalPayable : target.finalAmount,
        }
      ).catch((err) => {
        console.warn('Background Supabase cancel order error:', err);
      });
    }

    // Notify the shopkeeper/admin that the order was cancelled
    const newAdminNotification: AdminNotification = {
      id: `notif-${Date.now()}`,
      type: 'ORDER_CANCELLED',
      title: `Order #${target.orderNumber} Cancelled`,
      message: isShopkeeperOverride
        ? `Order #${target.orderNumber} cancelled by shopkeeper${
            updatedPaymentStatus === PaymentStatus.REFUNDED
              ? ` (₹${advancePaidAmount} advance refunded to customer store wallet)`
              : ''
          }.`
        : `Customer ${target.userName || target.userPhone || 'Customer'} cancelled order #${target.orderNumber}${
            updatedPaymentStatus === PaymentStatus.REFUNDED
              ? ` (₹${advancePaidAmount} advance refunded to store wallet)`
              : ''
          }.`,
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

    return true;
  };

  const updateOrderStatus = (orderId: string, newStatus: OrderStatus) => {
    const target = orders.find((o) => o.id === orderId || o.orderNumber === orderId);
    if (!target) return;

    if (newStatus === OrderStatus.CANCELLED) {
      cancelOrder(orderId, true);
      return;
    }

    // Check if order is moving to an accepted or subsequent active fulfillment status
    const isAcceptedOrProgressing =
      newStatus === OrderStatus.ORDER_ACCEPTED ||
      newStatus === OrderStatus.PACKING_IN_PROGRESS ||
      newStatus === OrderStatus.READY_FOR_DELIVERY ||
      newStatus === OrderStatus.ON_THE_WAY ||
      newStatus === OrderStatus.DELIVERED;

    const alreadyDeducted = isStockDeductedForOrder(target.id, target.orderNumber, target);
    let nextStockDeducted = target.stockDeducted ?? false;

    if (isAcceptedOrProgressing && !alreadyDeducted) {
      const { updatedProducts, affectedProducts } = deductStockForOrder(target, products);
      setProducts(updatedProducts);
      markStockDeductedForOrder(target.id, target.orderNumber);
      nextStockDeducted = true;

      if (isSupabaseConfigured && affectedProducts.length > 0) {
        affectedProducts.forEach((p) => {
          updateProductStockInSupabase(p.id, p.variants).catch(() => {});
          saveProductToSupabase(p).catch((err) => {
            console.warn('Background Supabase product stock deduction error:', err);
          });
        });
      }
    }

    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === orderId || o.orderNumber === orderId) {
          const isDelivered = newStatus === OrderStatus.DELIVERED;
          let updatedPaymentStatus = o.paymentStatus;
          let updatedCodCollected = o.codCollectedAmount;

          if (isDelivered && o.paymentMethod === PaymentMethod.COD) {
            if (updatedCodCollected !== undefined) {
              updatedPaymentStatus =
                updatedCodCollected === o.finalAmount
                  ? PaymentStatus.RECEIVED
                  : updatedCodCollected > 0
                  ? PaymentStatus.PARTIALLY_COLLECTED
                  : PaymentStatus.PENDING;
            } else {
              // Default full COD collection if delivered without prior custom record
              updatedCodCollected = o.finalAmount;
              updatedPaymentStatus = PaymentStatus.RECEIVED;
            }
          }

          return {
            ...o,
            status: newStatus,
            paymentStatus: updatedPaymentStatus,
            codCollectedAmount: updatedCodCollected,
            stockDeducted: isAcceptedOrProgressing ? true : o.stockDeducted,
            stockRestored: false,
          };
        }
        return o;
      })
    );

    if (isSupabaseConfigured) {
      updateOrderStatusInSupabase(orderId, newStatus, undefined, {
        stockDeducted: nextStockDeducted,
        stockRestored: false,
        orderNumber: target.orderNumber,
        walletAmountUsed: target.walletAmountUsed,
        items: target.items,
        codCollected: target.codCollectedAmount || 0,
        prevOutstanding: target.previousOutstanding || 0,
        totalPayable: target.totalPayable !== undefined ? target.totalPayable : target.finalAmount,
      }).catch((err) => {
        console.warn('Background Supabase status update error:', err);
      });
    }
  };

  const recordCodCollection = async (
    orderId: string,
    collectedAmount: number,
    markAsDelivered: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    const order = orders.find((o) => o.id === orderId);
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

    const customerPriorDebt = getCustomerOutstanding(order.userPhone || order.userId);
    const maxCollectible = (Number(order.finalAmount) || 0) + customerPriorDebt;
    if (collectedAmount > maxCollectible) {
      return {
        success: false,
        error: `Collected amount (₹${collectedAmount}) cannot exceed the collectible total (₹${maxCollectible}).`,
      };
    }

    const cleanAmount = Math.round(collectedAmount * 100) / 100;

    // Allocate cash across previous unpaid/partially paid orders (FIFO) and current order
    const targetCustomer = order.userPhone || order.userId;
    const allocationResult = allocateCodCollection(
      orders,
      targetCustomer,
      orderId,
      cleanAmount,
      markAsDelivered
    );

    // Update React state with all affected orders
    setOrders(allocationResult.updatedOrders);

    // Update customer in users list and currentUser if matching
    const newDebt = allocationResult.remainingOutstanding;
    setUsers((prev) =>
      prev.map((u) => {
        if (isSameCustomer({ userPhone: u.phone, userId: u.id }, targetCustomer)) {
          return {
            ...u,
            walletBalance: newDebt > 0 ? -newDebt : (u.walletBalance < 0 ? 0 : u.walletBalance),
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
          walletBalance: newDebt > 0 ? -newDebt : (prev.walletBalance < 0 ? 0 : prev.walletBalance),
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
      previousOutstanding: order.previousOutstanding || 0,
      orderAmount: order.finalAmount,
      totalPayable: order.totalPayable ?? order.finalAmount,
      markAsDelivered,
      allCustomerOrders: allocationResult.updatedOrders.filter(
        (o) => isSameCustomer(o, order.userPhone || order.userId)
      ),
    }).catch((err) => {
      console.warn('Persistent COD API save notice:', err);
    });

    return { success: true };
  };

  // Address management
  const userAddresses = currentUser.addresses || [];

  const addAddress = (addressData: Omit<Address, 'id' | 'userId'>) => {
    const newAddress: Address = {
      ...addressData,
      id: `addr-${Date.now()}`,
      userId: currentUser.id,
      isDefault: userAddresses.length === 0,
    };
    const updatedAddresses = [...userAddresses, newAddress];
    const updatedUser = { ...currentUser, addresses: updatedAddresses };
    setCurrentUser(updatedUser);
    setSelectedAddressId(newAddress.id);
    setUsers((prev) => prev.map((u) => (u.id === currentUser.id ? updatedUser : u)));
  };

  // Customer profile save (Rule 1, 2, 6, 7, 8)
  const saveCustomerProfile = async (data: {
    name: string;
    fullAddress: string;
    landmark: string;
    pincode?: string;
  }): Promise<void> => {
    // Sourced strictly from authenticated customer record (Rule 1 & 2)
    const cleanPhone = currentUser.phone.replace(/\D/g, '');
    const targetUserId = currentUser.id || `user-${cleanPhone}`;
    const targetAddrId = currentUser.addresses[0]?.id || `addr-${targetUserId}-1`;

    const updatedAddress: Address = {
      id: targetAddrId,
      userId: targetUserId,
      fullAddress: data.fullAddress.trim(),
      landmark: data.landmark.trim(),
      pincode: data.pincode?.trim() || '',
      isDefault: true,
    };

    const updatedUser: User = {
      ...currentUser,
      id: targetUserId,
      name: data.name.trim(),
      phone: cleanPhone, // Guaranteed not replaced (Rule 2)
      role: Role.CUSTOMER,
      addresses: [updatedAddress],
    };

    // 1. Update state
    setCurrentUser(updatedUser);
    setSelectedAddressId(updatedAddress.id);
    setUsers((prev) => {
      const exists = prev.some((u) => u.phone === cleanPhone || u.id === targetUserId);
      if (exists) {
        return prev.map((u) => (u.phone === cleanPhone || u.id === targetUserId ? updatedUser : u));
      }
      return [...prev, updatedUser];
    });

    // 2. Rule 5 & 8: Save to customer-isolated localStorage key
    localStorage.setItem(`om_profile_${cleanPhone}`, JSON.stringify(updatedUser));
    localStorage.setItem(
      'om_customer_session',
      JSON.stringify({
        phone: cleanPhone,
        role: Role.CUSTOMER,
        profileCompleted: true,
      })
    );

    // 3. Rule 6: Save profile changes to Supabase
    if (isSupabaseConfigured) {
      try {
        await saveCustomerProfileToSupabase(
          targetUserId,
          cleanPhone,
          data.name.trim(),
          data.fullAddress.trim(),
          data.landmark.trim(),
          data.pincode?.trim() || ''
        );
      } catch (err) {
        console.error('Supabase profile save error:', err);
      }
    }

    // 4. Rule 7: After profile completion, navigate correctly to Products/Shop page
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
    options?: { isExisting?: boolean }
  ): Promise<User> => {
    const cleanPhone = phone.replace(/\D/g, '');

    if (role === Role.SHOPKEEPER) {
      const shopkeeper = users.find((u) => u.role === Role.SHOPKEEPER) || INITIAL_USERS[0];
      setCurrentUser(shopkeeper);
      setActiveRoleState(Role.SHOPKEEPER);
      setCustomerFlowStep('SHOP');
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
    const hasLocalProfile = Boolean(
      localStorage.getItem(`om_profile_${cleanPhone}`) ||
      users.some((u) => {
        const uClean = u.phone ? u.phone.replace(/\D/g, '').slice(-10) : '';
        return uClean === cleanPhone.slice(-10);
      })
    );

    const treatAsExisting = options?.isExisting === true || (options?.isExisting === undefined && hasLocalProfile);

    if (treatAsExisting) {
      // Existing Customer login: must await database profile lookup before advancing
      let resolvedUser: User | null = null;

      if (isSupabaseConfigured) {
        resolvedUser = await fetchCustomerProfileFromSupabase(cleanPhone);
      }

      // Check local cache if offline or not returned by Supabase
      if (!resolvedUser) {
        const phoneKey = `om_profile_${cleanPhone}`;
        const localProfile = localStorage.getItem(phoneKey);
        if (localProfile) {
          try {
            resolvedUser = JSON.parse(localProfile);
          } catch {
            resolvedUser = null;
          }
        }
      }

      // If customer record is not found, fallback to checking local users
      if (!resolvedUser) {
        const matchingUser = users.find((u) => {
          const uClean = u.phone ? u.phone.replace(/\D/g, '').slice(-10) : '';
          return uClean === cleanPhone.slice(-10);
        });
        if (matchingUser) {
          resolvedUser = matchingUser;
        } else if (options?.isExisting === true) {
          throw new Error(
            `No registered customer profile found for +91 ${cleanPhone}. Please switch to New Customer to register.`
          );
        }
      }

      // Ensure persistent wallet balance (e.g. from cancellation refunds and order wallet payments) is accurately preserved
      let resolvedWalletBalance = resolvedUser ? (resolvedUser.walletBalance || 0) : 0;
      try {
        const savedTx = localStorage.getItem('om_wallet_transactions');
        if (savedTx) {
          const txList: WalletTransaction[] = JSON.parse(savedTx);
          const userTx = txList.filter(
            (t) =>
              (t.userPhone && t.userPhone.replace(/\D/g, '').slice(-10) === cleanPhone.slice(-10)) ||
              (resolvedUser && t.userId === resolvedUser.id)
          );
          if (userTx.length > 0 && typeof userTx[0].balanceAfter === 'number' && userTx[0].balanceAfter >= 0) {
            resolvedWalletBalance = userTx[0].balanceAfter;
          }
        }
      } catch {}

      if (resolvedWalletBalance <= 0) {
        try {
          const localProfileStr = localStorage.getItem(`om_profile_${cleanPhone}`);
          if (localProfileStr) {
            const parsed = JSON.parse(localProfileStr);
            if (typeof parsed.walletBalance === 'number' && parsed.walletBalance > 0) {
              resolvedWalletBalance = parsed.walletBalance;
            }
          }
        } catch {}
      }

      const userDebt = Number(
        resolvedUser?.outstandingBalance ?? calculateCustomerOutstanding(orders, cleanPhone)
      );

      const finalUser: User = {
        ...(resolvedUser || {}),
        id: resolvedUser?.id || `user-${cleanPhone}`,
        name: resolvedUser?.name || name?.trim() || '',
        phone: cleanPhone,
        role: Role.CUSTOMER,
        referralCode: resolvedUser?.referralCode || `OM${cleanPhone.slice(-4)}`,
        walletBalance: userDebt > 0 ? -userDebt : (resolvedWalletBalance >= 0 ? resolvedWalletBalance : 0),
        outstandingBalance: userDebt,
        codOrderCount: resolvedUser?.codOrderCount || 0,
        addresses: resolvedUser?.addresses || [],
        createdAt: resolvedUser?.createdAt || new Date().toISOString(),
      };

      setCurrentUser(finalUser);
      setActiveRoleState(Role.CUSTOMER);
      setSelectedAddressId(finalUser.addresses[0]?.id || null);
      setIsAuthModalOpen(false);

      const customerSavedCart = loadCustomerCart(cleanPhone);
      setCart(customerSavedCart);

      localStorage.setItem(`om_profile_${cleanPhone}`, JSON.stringify(finalUser));
      localStorage.setItem(
        'om_customer_session',
        JSON.stringify({
          phone: cleanPhone,
          role: Role.CUSTOMER,
          profileCompleted: Boolean(finalUser.name && finalUser.addresses.length > 0),
        })
      );

      setUsers((prev) => {
        const exists = prev.some((u) => u.phone === cleanPhone || u.id === finalUser.id);
        if (exists) return prev.map((u) => (u.phone === cleanPhone || u.id === finalUser.id ? finalUser : u));
        return [...prev, finalUser];
      });

      if (isSupabaseConfigured) {
        fetchCustomerOrdersFromSupabase(finalUser.id, cleanPhone).then((dbOrders) => {
          if (dbOrders && dbOrders.length > 0) {
            setOrders((prev) => {
              const existingIds = new Set(prev.map((o) => o.id));
              const existingOrderNums = new Set(prev.map((o) => o.orderNumber));
              const newOrders = dbOrders.filter((o) => !existingIds.has(o.id) && !existingOrderNums.has(o.orderNumber));
              return [...prev, ...newOrders];
            });
          }
        });
        refreshProducts();
      }

      setCustomerFlowStep(finalUser.name && finalUser.addresses.length > 0 ? 'SHOP' : 'PROFILE');
      notifyShopkeeperCustomerLogin(finalUser);
      return finalUser;
    }

    // NEW CUSTOMER FLOW:
    // Every new customer must start with Wallet Balance = ₹0
    let initialNewWalletBalance = 0;
    try {
      const localProfileStr = localStorage.getItem(`om_profile_${cleanPhone}`);
      if (localProfileStr) {
        const parsed = JSON.parse(localProfileStr);
        if (typeof parsed.walletBalance === 'number') {
          initialNewWalletBalance = parsed.walletBalance;
        }
      }
    } catch {}

    const finalUser: User = {
      id: `user-${cleanPhone}`,
      name: name?.trim() || '',
      phone: cleanPhone,
      role: Role.CUSTOMER,
      referralCode: `OM${cleanPhone.length >= 4 ? cleanPhone.slice(-4) : '2026'}`,
      walletBalance: initialNewWalletBalance,
      codOrderCount: 0,
      addresses: [], // Strictly blank for new customers!
      createdAt: new Date().toISOString(),
    };

    setCurrentUser(finalUser);
    setActiveRoleState(Role.CUSTOMER);
    setSelectedAddressId(null);
    setIsAuthModalOpen(false);

    const customerSavedCart = loadCustomerCart(cleanPhone);
    setCart(customerSavedCart);

    localStorage.setItem(
      'om_customer_session',
      JSON.stringify({
        phone: cleanPhone,
        role: Role.CUSTOMER,
        profileCompleted: false,
      })
    );

    setCustomerFlowStep('PROFILE');
    notifyShopkeeperCustomerLogin(finalUser);
    return finalUser;
  };

  const logout = () => {
    localStorage.removeItem('om_customer_session');
    setCurrentUser(BLANK_CUSTOMER);
    setCart([]);
    setActiveRoleState(Role.CUSTOMER);
    setSelectedAddressId(null);
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
        addCategory,
        updateCategory,
        deleteCategory,
        products,
        addProduct,
        bulkAddProducts,
        updateProduct,
        deleteProduct,
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
        addAddress,
        selectedAddressId,
        setSelectedAddressId,
        isAuthModalOpen,
        setIsAuthModalOpen,
        loginWithPhone,
        logout,
        isSupabaseConfigured,
        refreshOrders,
        refreshProducts,
        isAdminSessionValid,
        checkAdminSession,
        logoutAdminSession,
        walletTransactions,
        adminNotifications,
        markNotificationAsRead,
        markAllNotificationsAsRead,
        productRequests,
        requestProduct,
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
