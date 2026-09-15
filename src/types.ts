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
  stockQuantity: number;
  maxOrderLimit: number;
  tieredPrices: TieredPrice[];
}

export interface Product {
  id: string;
  name: string;
  brand: string;
  description: string;
  categoryId: string;
  imageUrl?: string;
  isDiscountExcluded: boolean;
  variants: ProductVariant[];
  createdAt: string;
}

export interface OrderItem {
  id: string;
  orderId: string;
  variantId: string;
  variantName?: string;
  productName?: string;
  brand?: string;
  unit?: UnitType;
  packSize?: number;
  quantity: number;
  unitPrice: number;
  price: number;
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
  razorpayOrderId?: string;
  razorpayPaymentId?: string;
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
  updatedAt: string;
}

export interface CartItem {
  productId: string;
  product: Product;
  variantId: string;
  variant: ProductVariant;
  quantity: number;
}
