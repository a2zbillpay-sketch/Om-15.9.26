import React, { createContext, useContext, useState, useEffect, useMemo } from 'react';
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
import {
  calculateCheckoutTotals,
  canCancelOrder,
  CheckoutBreakdown,
  getActiveUnitPrice,
} from '../lib/engine/checkout-calculator';

interface AppContextType {
  currentUser: User;
  setCurrentUser: (user: User) => void;
  users: User[];
  activeRole: Role;
  setActiveRole: (role: Role) => void;
  settings: SystemSetting;
  updateSettings: (newSettings: Partial<SystemSetting>) => void;
  categories: Category[];
  products: Product[];
  addProduct: (product: Omit<Product, 'id' | 'createdAt'>) => void;
  updateProduct: (id: string, updates: Partial<Product>) => void;
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
  userAddresses: Address[];
  addAddress: (address: Omit<Address, 'id' | 'userId'>) => void;
  selectedAddressId: string | null;
  setSelectedAddressId: (id: string) => void;
  isAuthModalOpen: boolean;
  setIsAuthModalOpen: (open: boolean) => void;
  loginWithPhone: (phone: string, role: Role, name?: string) => User;
  logout: () => void;
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
    return saved ? JSON.parse(saved) : INITIAL_PRODUCTS;
  });

  const [users, setUsers] = useState<User[]>(() => {
    const saved = localStorage.getItem('om_users');
    return saved ? JSON.parse(saved) : INITIAL_USERS;
  });

  const [currentUser, setCurrentUser] = useState<User>(() => {
    const saved = localStorage.getItem('om_current_user');
    return saved ? JSON.parse(saved) : INITIAL_USERS[1]; // Default to Customer Rajesh Gupta
  });

  const [activeRole, setActiveRoleState] = useState<Role>(() => {
    return currentUser.role;
  });

  const [cart, setCart] = useState<CartItem[]>(() => {
    const saved = localStorage.getItem('om_cart');
    return saved ? JSON.parse(saved) : [];
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

  useEffect(() => {
    localStorage.setItem('om_cart', JSON.stringify(cart));
  }, [cart]);

  useEffect(() => {
    localStorage.setItem('om_orders', JSON.stringify(orders));
  }, [orders]);

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

  const addProduct = (newProd: Omit<Product, 'id' | 'createdAt'>) => {
    const id = `prod-${Date.now()}`;
    const product: Product = {
      ...newProd,
      id,
      createdAt: new Date().toISOString(),
    };
    setProducts((prev) => [product, ...prev]);
  };

  const updateProduct = (id: string, updates: Partial<Product>) => {
    setProducts((prev) => prev.map((p) => (p.id === id ? { ...p, ...updates } : p)));
  };

  const deleteProduct = (id: string) => {
    setProducts((prev) => prev.filter((p) => p.id !== id));
  };

  // Cart operations
  const addToCart = (product: Product, variant: ProductVariant, quantity = 1) => {
    setCart((prev) => {
      const existingIndex = prev.findIndex((item) => item.variantId === variant.id);
      if (existingIndex > -1) {
        const existing = prev[existingIndex];
        const newQty = Math.min(
          variant.maxOrderLimit,
          Math.min(variant.stockQuantity, existing.quantity + quantity)
        );
        const updated = [...prev];
        updated[existingIndex] = { ...existing, quantity: newQty };
        return updated;
      }
      return [...prev, { productId: product.id, product, variantId: variant.id, variant, quantity }];
    });
  };

  const updateCartQty = (variantId: string, quantity: number) => {
    if (quantity <= 0) {
      removeFromCart(variantId);
      return;
    }
    setCart((prev) =>
      prev.map((item) => {
        if (item.variantId === variantId) {
          const clamped = Math.min(
            item.variant.maxOrderLimit,
            Math.min(item.variant.stockQuantity, quantity)
          );
          return { ...item, quantity: clamped };
        }
        return item;
      })
    );
  };

  const removeFromCart = (variantId: string) => {
    setCart((prev) => prev.filter((item) => item.variantId !== variantId));
  };

  const clearCart = () => {
    setCart([]);
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
          return {
            ...o,
            status: newStatus,
            paymentStatus:
              isDelivered && o.paymentMethod === PaymentMethod.COD
                ? PaymentStatus.RECEIVED
                : o.paymentStatus,
          };
        }
        return o;
      })
    );
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

  // Auth operations
  const loginWithPhone = (phone: string, role: Role, name?: string): User => {
    const existing = users.find((u) => u.phone === phone);
    if (existing) {
      setCurrentUser(existing);
      setActiveRoleState(existing.role);
      setSelectedAddressId(existing.addresses[0]?.id || null);
      setIsAuthModalOpen(false);
      return existing;
    }

    const newUser: User = {
      id: `user-${Date.now()}`,
      name: name || (role === Role.SHOPKEEPER ? 'Om Prakash Sharma' : 'Valued Customer'),
      phone,
      role,
      referralCode: `OM${Math.floor(1000 + Math.random() * 9000)}`,
      walletBalance: 100, // Welcome ₹100 bonus!
      codOrderCount: 0,
      addresses: [
        {
          id: `addr-${Date.now()}`,
          userId: `user-${Date.now()}`,
          fullAddress: 'Shop #12, Wholesale Market Road',
          landmark: 'Main Chowk',
          pincode: '400705',
          isDefault: true,
        },
      ],
      createdAt: new Date().toISOString(),
    };

    setUsers((prev) => [...prev, newUser]);
    setCurrentUser(newUser);
    setActiveRoleState(role);
    setSelectedAddressId(newUser.addresses[0].id);
    setIsAuthModalOpen(false);
    return newUser;
  };

  const logout = () => {
    // Revert to demo customer or shopkeeper
    const demo = users[1] || users[0];
    setCurrentUser(demo);
    setActiveRoleState(demo.role);
  };

  return (
    <AppContext.Provider
      value={{
        currentUser,
        setCurrentUser,
        users,
        activeRole,
        setActiveRole,
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
        userAddresses,
        addAddress,
        selectedAddressId,
        setSelectedAddressId,
        isAuthModalOpen,
        setIsAuthModalOpen,
        loginWithPhone,
        logout,
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
