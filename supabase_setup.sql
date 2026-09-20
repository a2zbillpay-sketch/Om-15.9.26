-- ==============================================================================
-- Om Distributors - Centralized Supabase Database Schema & RLS Policies
-- ==============================================================================
-- Run this script in your Supabase SQL Editor (https://app.supabase.com)
-- This creates all required tables and RLS security rules for cross-browser synchronization.

-- 1. Users / Customers Table
CREATE TABLE IF NOT EXISTS public.users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT 'Valued Customer',
  role TEXT NOT NULL DEFAULT 'CUSTOMER',
  referral_code TEXT,
  wallet_balance NUMERIC(10, 2) NOT NULL DEFAULT 100.00,
  cod_order_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 2. Customer Addresses Table
CREATE TABLE IF NOT EXISTS public.addresses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  full_address TEXT NOT NULL,
  landmark TEXT,
  pincode TEXT NOT NULL DEFAULT '422001',
  is_default BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 4. Products Table
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL,
  description TEXT NOT NULL,
  category_id TEXT REFERENCES public.categories(id),
  image_url TEXT,
  is_discount_excluded BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 5. Product Variants Table
CREATE TABLE IF NOT EXISTS public.product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit TEXT NOT NULL,
  pack_size NUMERIC(10, 2) NOT NULL,
  pack_label TEXT NOT NULL,
  mrp NUMERIC(10, 2) NOT NULL,
  base_selling_price NUMERIC(10, 2) NOT NULL,
  stock_quantity INTEGER NOT NULL DEFAULT 100,
  max_order_limit INTEGER NOT NULL DEFAULT 20,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 6. Tiered Wholesale Prices Table
CREATE TABLE IF NOT EXISTS public.tiered_prices (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  min_qty INTEGER NOT NULL,
  max_qty INTEGER NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL
);

-- 7. Orders Table
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  order_number TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES public.users(id),
  user_name TEXT NOT NULL,
  user_phone TEXT NOT NULL,
  address_id TEXT,
  shipping_address JSONB,
  status TEXT NOT NULL DEFAULT 'ORDER_ACCEPTED',
  payment_method TEXT NOT NULL DEFAULT 'COD',
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  delivery_date DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  cod_charge NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  final_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 8. Order Items Table
CREATE TABLE IF NOT EXISTS public.order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_variant_id TEXT,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  brand TEXT,
  unit TEXT,
  pack_size NUMERIC(10, 2) DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL
);

-- 9. System Settings Table
CREATE TABLE IF NOT EXISTS public.system_settings (
  id TEXT PRIMARY KEY DEFAULT 'global_settings',
  app_name TEXT NOT NULL DEFAULT 'Om Distributors',
  logo_url TEXT DEFAULT '/logo.jpg',
  advance_payment_discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 3.00,
  cod_base_charge NUMERIC(10, 2) NOT NULL DEFAULT 30.00,
  free_shipping_min_amount NUMERIC(10, 2) NOT NULL DEFAULT 500.00,
  base_delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 40.00,
  referral_reward_amount NUMERIC(10, 2) NOT NULL DEFAULT 50.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone);
CREATE INDEX IF NOT EXISTS idx_orders_user_id ON public.orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_user_phone ON public.orders(user_phone);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);

-- ==============================================================================
-- ROW LEVEL SECURITY (RLS) POLICIES
-- ==============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiered_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- Categories & Products: Public Read
CREATE POLICY "Public Read Categories" ON public.categories FOR SELECT USING (true);
CREATE POLICY "Public Read Products" ON public.products FOR SELECT USING (true);
CREATE POLICY "Public Read Variants" ON public.product_variants FOR SELECT USING (true);
CREATE POLICY "Public Read Tiered Prices" ON public.tiered_prices FOR SELECT USING (true);
CREATE POLICY "Public Read Settings" ON public.system_settings FOR SELECT USING (true);

-- Users: Read/Write by Phone / Public Key for PWA client (System & Admin credential rows protected)
DROP POLICY IF EXISTS "Users Select Policy" ON public.users;
CREATE POLICY "Users Select Policy" ON public.users 
FOR SELECT USING (
  role != 'SYSTEM' AND id != 'admin_credential_store'
);

DROP POLICY IF EXISTS "Users Insert Policy" ON public.users;
CREATE POLICY "Users Insert Policy" ON public.users 
FOR INSERT WITH CHECK (
  role != 'SYSTEM' AND id != 'admin_credential_store'
);

DROP POLICY IF EXISTS "Users Update Policy" ON public.users;
CREATE POLICY "Users Update Policy" ON public.users 
FOR UPDATE USING (
  role != 'SYSTEM' AND id != 'admin_credential_store'
) WITH CHECK (
  role != 'SYSTEM' AND id != 'admin_credential_store'
);

-- Addresses Policy
CREATE POLICY "Addresses Select Policy" ON public.addresses FOR SELECT USING (true);
CREATE POLICY "Addresses Insert Policy" ON public.addresses FOR INSERT WITH CHECK (true);

-- Orders & Order Items: Allow customer insertion and retrieval
CREATE POLICY "Orders Select Policy" ON public.orders FOR SELECT USING (true);
CREATE POLICY "Orders Insert Policy" ON public.orders FOR INSERT WITH CHECK (true);
CREATE POLICY "Orders Update Policy" ON public.orders FOR UPDATE USING (true);

CREATE POLICY "Order Items Select Policy" ON public.order_items FOR SELECT USING (true);
CREATE POLICY "Order Items Insert Policy" ON public.order_items FOR INSERT WITH CHECK (true);
