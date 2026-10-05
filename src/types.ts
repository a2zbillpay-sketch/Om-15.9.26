export enum Role {
  SHOPKEEPER = 'SHOPKEEPER',
  SECONDARY_ADMIN = 'SECONDARY_ADMIN',
  ACCOUNTS = 'ACCOUNTS',
  CUSTOMER = 'CUSTOMER',
}

export enum UnitType {
  G = 'G',
  KG = 'KG',
  ML = 'ML',
  LITER = 'LITER',
  BOX = 'BOX',
  CAN = 'CAN',
  KATTA = 'KATTA',
  NOS = 'NOS',
}

export enum OrderStatus {
  ORDER_PENDING = 'ORDER_PENDING',
  ORDER_ACCEPTED = 'ORDER_ACCEPTED',
  PACKING_IN_PROGRESS = 'PACKING_IN_PROGRESS',
  READY_FOR_DELIVERY = 'READY_FOR_DELIVERY',
  ON_THE_WAY = 'ON_THE_WAY',
  DELIVERED = 'DELIVERED',
  CANCELLED = 'CANCELLED',
}

export enum PaymentMethod {
  COD = 'COD',
  ADVANCE_ONLINE = 'ADVANCE_ONLINE',
}

export enum PaymentStatus {
  PENDING = 'PENDING',
  RECEIVED = 'RECEIVED',
  FAILED = 'FAILED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_COLLECTED = 'PARTIALLY_COLLECTED',
}

export interface Address {
  id: string;
  userId: string;
  fullAddress: string;
  landmark?: string;
  pincode: string;
  isDefault: boolean;
}

export interface User {
  id: string;
  name: string;
  phone: string;
  role: Role;
  referralCode: string;
  referredById?: string | null;
  walletBalance: number;
  outstandingBalance?: number;
  codOrderCount: number;
  addresses: Address[];
  createdAt: string;
}

export interface Category {
  id: string;
  name: string;
  imageUrl: string;
  productCount?: number;
}

export interface TieredPrice {
  id: string;
  variantId: string;
  minQty: number;
  maxQty: number;
  unitPrice: number;
}

export interface ProductVariant {
  id: string;
  productId: string;
  unit: UnitType;
  packSize: number;
  packLabel?: string;
  mrp: number;
  baseSellingPrice: number;
  purchasePrice?: number;
  discount?: number;
  stockQuantity: number;
  maxOrderLimit: number;
  tieredPrices: TieredPrice[];
  imageUrl?: string;
  lowStockThreshold?: number;
}

export interface Product {
  id: string;
  name: string;
  brand?: string;
  description: string;
  categoryId: string;
  imageUrl?: string;
  barcode?: string | null;
  isDiscountExcluded: boolean;
  purchasePrice?: number;
  discount?: number;
  lowStockThreshold?: number;
  variants: ProductVariant[];
  createdAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId?: string;
  variantId: string;
  variantName?: string;
  productName?: string;
  brand?: string;
  unit?: UnitType;
  packSize?: number;
  quantity: number;
  unitPrice: number;
  price: number;
  isDiscountExcluded?: boolean;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId: string;
  userName: string;
  userPhone: string;
  addressId: string;
  address: Address;
  status: OrderStatus;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  deliveryDate: string;
  items: OrderItem[];
  subtotal: number;
  discountAmount: number;
  deliveryFee: number;
  codCharge: number;
  finalAmount: number;
  previousOutstanding?: number;
  totalPayable?: number;
  codCollectedAmount?: number;
  walletAmountUsed?: number;
  stockDeducted?: boolean;
  stockRestored?: boolean;
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
  createdAt: string;
}

export interface CodTransactionAllocation {
  orderId: string;
  orderNumber: string;
  amountAllocated: number;
  orderRemainingUnpaid: number;
}

export interface CodPaymentTransaction {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerPhone: string;
  customerName: string;
  amount: number;
  previousOutstanding: number;
  orderAmount: number;
  totalPayable: number;
  collectedAmount: number;
  remainingOutstanding: number;
  allocations: CodTransactionAllocation[];
  notes?: string;
  createdAt: string;
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

export interface CartItem {
  productId: string;
  product: Product;
  variantId: string;
  variant: ProductVariant;
  quantity: number;
}

export interface WalletTransaction {
  id: string;
  userId: string;
  userPhone: string;
  orderId?: string;
  orderNumber?: string;
  type: 'CREDIT' | 'DEBIT';
  amount: number;
  balanceAfter: number;
  description: string;
  createdAt: string;
}

export interface AdminNotification {
  id: string;
  type: 'ORDER_CANCELLED' | 'GENERAL';
  title: string;
  message: string;
  orderId?: string;
  orderNumber?: string;
  amount?: number;
  read: boolean;
  createdAt: string;
}

export interface ProductRequestCustomer {
  id: string;
  name: string;
  phone: string;
}

export interface ProductRequestProduct {
  id: string;
  name: string;
  brand?: string;
  variantId: string;
  variantName?: string;
  packSize?: string;
  unit?: string;
  price?: number;
}

export interface ProductRequest {
  id: string;
  customer: ProductRequestCustomer;
  customerId: string;
  customerName: string;
  customerPhone: string;
  product: ProductRequestProduct;
  productId: string;
  productName: string;
  variantId: string;
  variantName?: string;
  packSize?: string;
  quantity: number;
  requestDate: string;
  createdAt: string;
}
