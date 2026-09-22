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
  OrderStatus,
  PaymentMethod,
  PaymentStatus,
  Address,
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
  saveCustomerProfileToSupabase,
  fetchCustomerProfileFromSupabase,
  saveProductToSupabase,
  fetchProductsFromSupabase,
  deleteProductFromSupabase,
} from '../lib/supabase';

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
  products: Product[];
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => Promise<{ success: boolean; error?: string }>;
  updateProduct: (id: string, updates: Partial<Product>) => Promise<{ success: boolean; error?: string }>;
  deleteProduct: (id: string) => void;
  cart: CartItem[];
  addToCart: (product: Product, variant: ProductVariant, quantity?: number) => void;
  updateCartQty: (variantId: string, quantity: number) => void;
  removeFromCart: (variantId: string) => void;
  clearCart: () => void;
  checkoutBreakdown: CheckoutBreakdown;
  orders: Order[];
  createOrder: (data: {
    address: Address;
    paymentMethod: PaymentMethod;
    deliveryDate: string;
  }) => Promise<Order>;
  cancelOrder: (orderId: string) => boolean;
  updateOrderStatus: (orderId: string, newStatus: OrderStatus) => void;
  recordCodCollection: (
    orderId: string,
    collectedAmount: number,
    markAsDelivered?: boolean
  ) => { success: boolean; error?: string };
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
        return parsed;
      } catch {
        return INITIAL_SETTINGS;
      }
    }
    return INITIAL_SETTINGS;
  });

  const [categories] = useState<Category[]>(INITIAL_CATEGORIES);

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
          walletBalance: 100,
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

  const [orders, setOrders] = useState<Order[]>(() => {
    const saved = localStorage.getItem('om_orders');
    return saved ? JSON.parse(saved) : INITIAL_ORDERS;
  });

  const [selectedAddressId, setSelectedAddressId] = useState<string | null>(() => {
    const defaultAddr = currentUser.addresses.find((a) => a.isDefault);
    return defaultAddr ? defaultAddr.id : currentUser.addresses[0]?.id || null;
  });

  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);

  // Sync to localStorage
  useEffect(() => {
    localStorage.setItem('om_settings', JSON.stringify(settings));
  }, [settings]);

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

  // Synchronize orders with Supabase
  const refreshOrders = async () => {
    if (!isSupabaseConfigured) return;
    try {
      if (activeRole === Role.SHOPKEEPER) {
        const adminOrders = await fetchAllOrdersForAdmin();
        if (adminOrders && adminOrders.length > 0) {
          setOrders(adminOrders);
        }
      } else {
        const userOrders = await fetchCustomerOrdersFromSupabase(currentUser.id, currentUser.phone);
        if (userOrders && userOrders.length > 0) {
          setOrders(userOrders);
        }
      }
    } catch (err) {
      console.warn('Error refreshing orders from Supabase:', err);
    }
  };

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

  useEffect(() => {
    if (isSupabaseConfigured) {
      refreshOrders();
    }
  }, [currentUser.id, currentUser.phone, activeRole]);

  useEffect(() => {
    if (isSupabaseConfigured) {
      refreshProducts();
    }
  }, [isSupabaseConfigured]);

  const [isAdminSessionValid, setIsAdminSessionValid] = useState<boolean>(false);

  const checkAdminSession = useCallback(async (): Promise<boolean> => {
    try {
      const res = await fetch('/api/auth/me', { method: 'GET' });
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
      await fetch('/api/auth/logout', { method: 'POST' });
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
      setCurrentUser(matchingUser);
      setSelectedAddressId(matchingUser.addresses[0]?.id || null);
    } else {
      const updatedUser = { ...currentUser, role };
      setCurrentUser(updatedUser);
    }
  };

  const updateSettings = (newSettings: Partial<SystemSetting>) => {
    setSettings((prev) => ({
      ...prev,
      ...newSettings,
      updatedAt: new Date().toISOString(),
    }));
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

  const updateProduct = async (
    id: string,
    updates: Partial<Product>
  ): Promise<{ success: boolean; error?: string }> => {
    const current = products.find((p) => p.id === id);
    if (!current) return { success: false, error: 'Product not found.' };
    const updated = { ...current, ...updates };

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
        setProducts((prev) => prev.map((p) => (p.id === id ? savedProduct : p)));
        return { success: true };
      } else {
        const errData = await resp.json().catch(() => ({}));
        return {
          success: false,
          error: errData.error || `Server error (${resp.status}): Failed to update product.`,
        };
      }
    } catch {
      // Offline fallback
      if (isSupabaseConfigured) {
        const dbResult = await saveProductToSupabase(updated);
        if (!dbResult.success) {
          return { success: false, error: dbResult.error || 'Failed to update product in database.' };
        }
      }
      setProducts((prev) => prev.map((p) => (p.id === id ? updated : p)));
      return { success: true };
    }
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

  // Dynamic Checkout Breakdown calculation using the engine
  const checkoutBreakdown = useMemo(() => {
    const variantItems = cart.map((item) => ({
      variantId: item.variantId,
      quantity: item.quantity,
      baseSellingPrice: item.variant.baseSellingPrice,
      isDiscountExcluded: item.product.isDiscountExcluded,
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
      }
    );
  }, [cart, currentUser.codOrderCount, settings]);

  // Order Management
  const createOrder = async (data: {
    address: Address;
    paymentMethod: PaymentMethod;
    deliveryDate: string;
  }): Promise<Order> => {
    const isAdvance = data.paymentMethod === PaymentMethod.ADVANCE_ONLINE;
    const finalAmount = isAdvance
      ? checkoutBreakdown.advanceFinalTotal
      : checkoutBreakdown.codFinalTotal;
    const discountAmount = isAdvance ? checkoutBreakdown.advanceDiscountAmount : 0;
    const codCharge = isAdvance ? 0 : checkoutBreakdown.codCharge;

    const orderNumber = `OM-${Math.floor(10000 + Math.random() * 90000)}`;

    const newOrder: Order = {
      id: `ord-${Date.now()}`,
      orderNumber,
      userId: currentUser.id,
      userName: currentUser.name,
      userPhone: currentUser.phone,
      addressId: data.address.id,
      address: data.address,
      status: OrderStatus.ORDER_ACCEPTED,
      paymentMethod: data.paymentMethod,
      paymentStatus: isAdvance ? PaymentStatus.RECEIVED : PaymentStatus.PENDING,
      deliveryDate: data.deliveryDate,
      subtotal: checkoutBreakdown.subtotal,
      discountAmount,
      deliveryFee: checkoutBreakdown.deliveryFee,
      codCharge,
      finalAmount,
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
          orderId: `ord-${Date.now()}`,
          variantId: item.variantId,
          variantName: item.variant.packLabel,
          productName: item.product.name,
          brand: item.product.brand,
          unit: item.variant.unit,
          packSize: item.variant.packSize,
          quantity: item.quantity,
          unitPrice,
          price: unitPrice * item.quantity,
        };
      }),
    };

    // Update orders
    setOrders((prev) => [newOrder, ...prev]);

    // Persist to Supabase if configured
    if (isSupabaseConfigured) {
      saveOrderToSupabase(newOrder).catch((err) => {
        console.warn('Background Supabase order save error:', err);
      });
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

    // Deduct stock for inventory integrity
    setProducts((prev) =>
      prev.map((p) => {
        const matchingCartItems = cart.filter((c) => c.productId === p.id);
        if (matchingCartItems.length === 0) return p;
        const updatedVariants = p.variants.map((v) => {
          const cartItem = matchingCartItems.find((c) => c.variantId === v.id);
          if (cartItem) {
            return {
              ...v,
              stockQuantity: Math.max(0, v.stockQuantity - cartItem.quantity),
            };
          }
          return v;
        });
        return { ...p, variants: updatedVariants };
      })
    );

    clearCart();
    return newOrder;
  };

  const cancelOrder = (orderId: string): boolean => {
    const target = orders.find((o) => o.id === orderId);
    if (!target) return false;

    // Check 15-minute cancellation window rule
    if (!canCancelOrder(target.createdAt)) {
      return false;
    }

    // Process cancellation and credit wallet if online payment
    if (target.paymentStatus === PaymentStatus.RECEIVED) {
      setCurrentUser((prev) => ({
        ...prev,
        walletBalance: prev.walletBalance + target.finalAmount,
      }));
    }

    setOrders((prev) =>
      prev.map((o) =>
        o.id === orderId
          ? {
              ...o,
              status: OrderStatus.CANCELLED,
              paymentStatus:
                o.paymentStatus === PaymentStatus.RECEIVED
                  ? PaymentStatus.REFUNDED
                  : o.paymentStatus,
            }
          : o
      )
    );

    return true;
  };

  const updateOrderStatus = (orderId: string, newStatus: OrderStatus) => {
    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === orderId) {
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
          };
        }
        return o;
      })
    );

    if (isSupabaseConfigured) {
      updateOrderStatusInSupabase(orderId, newStatus).catch((err) => {
        console.warn('Background Supabase status update error:', err);
      });
    }
  };

  const recordCodCollection = (
    orderId: string,
    collectedAmount: number,
    markAsDelivered: boolean = false
  ): { success: boolean; error?: string } => {
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

    if (collectedAmount > order.finalAmount) {
      return {
        success: false,
        error: `Collected amount (₹${collectedAmount}) cannot exceed the bill amount (₹${order.finalAmount}).`,
      };
    }

    const cleanAmount = Math.round(collectedAmount * 100) / 100;

    let newPaymentStatus: PaymentStatus;
    if (cleanAmount === order.finalAmount) {
      newPaymentStatus = PaymentStatus.RECEIVED;
    } else if (cleanAmount > 0) {
      newPaymentStatus = PaymentStatus.PARTIALLY_COLLECTED;
    } else {
      newPaymentStatus = PaymentStatus.PENDING;
    }

    setOrders((prev) =>
      prev.map((o) => {
        if (o.id === orderId) {
          return {
            ...o,
            codCollectedAmount: cleanAmount,
            paymentStatus: newPaymentStatus,
            status: markAsDelivered ? OrderStatus.DELIVERED : o.status,
          };
        }
        return o;
      })
    );

    if (isSupabaseConfigured) {
      const isPaid = cleanAmount === order.finalAmount;
      const nextStatus = markAsDelivered ? OrderStatus.DELIVERED : order.status;
      updateOrderStatusInSupabase(orderId, nextStatus, isPaid).catch((err) => {
        console.warn('Background Supabase status update error:', err);
      });
    }

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
    if (options?.isExisting) {
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

      // If customer record is not found, throw error to inform the user
      if (!resolvedUser) {
        throw new Error(
          `No registered customer profile found for +91 ${cleanPhone}. Please switch to New Customer to register.`
        );
      }

      const finalUser: User = {
        ...resolvedUser,
        phone: cleanPhone,
        role: Role.CUSTOMER,
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
          profileCompleted: false, // Navigate to Profile step first to confirm details
        })
      );

      setUsers((prev) => {
        const exists = prev.some((u) => u.phone === cleanPhone || u.id === finalUser.id);
        if (exists) return prev.map((u) => (u.phone === cleanPhone || u.id === finalUser.id ? finalUser : u));
        return [...prev, finalUser];
      });

      if (isSupabaseConfigured) {
        fetchCustomerOrdersFromSupabase(finalUser.id, cleanPhone).then((dbOrders) => {
          if (dbOrders) setOrders(dbOrders);
        });
        refreshProducts();
      }

      setCustomerFlowStep('PROFILE');
      return finalUser;
    }

    // NEW CUSTOMER FLOW:
    // New Customer must continue to start with a clean/empty profile
    const finalUser: User = {
      id: `user-${cleanPhone}`,
      name: name?.trim() || '',
      phone: cleanPhone,
      role: Role.CUSTOMER,
      referralCode: `OM${cleanPhone.length >= 4 ? cleanPhone.slice(-4) : '2026'}`,
      walletBalance: 100, // Welcome ₹100 bonus
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
        products,
        addProduct,
        updateProduct,
        deleteProduct,
        cart,
        addToCart,
        updateCartQty,
        removeFromCart,
        clearCart,
        checkoutBreakdown,
        orders,
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
