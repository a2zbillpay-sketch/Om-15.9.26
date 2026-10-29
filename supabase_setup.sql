-- ==============================================================================
-- Om Distributors - Complete Supabase Database Migration & Security Schema
-- ==============================================================================
-- Repo: a2zbillpay-sketch/Om-15.9.26
-- Compatible with: src/types.ts, src/lib/supabase.ts, src/context/AppContext.tsx,
-- and server-side endpoints (/api/orders.ts, /api/product-requests.ts).
--
-- Instructions: Execute this entire script in the Supabase Dashboard SQL Editor (https://supabase.com/dashboard).
-- It is 100% idempotent: Safe for fresh databases as well as existing production databases.
-- ==============================================================================

-- 1. Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ==============================================================================
-- 2. Core Tables Definition & Schema Extensions
-- ==============================================================================

-- 2.1 Users / Customers Table
CREATE TABLE IF NOT EXISTS public.users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  phone TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL DEFAULT 'Valued Customer',
  role TEXT NOT NULL DEFAULT 'CUSTOMER',
  shop_name TEXT,
  address TEXT,
  referral_code TEXT,
  referred_by_id TEXT,
  wallet_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  outstanding_balance NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  cod_order_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS phone TEXT,
  ADD COLUMN IF NOT EXISTS name TEXT DEFAULT 'Valued Customer',
  ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'CUSTOMER',
  ADD COLUMN IF NOT EXISTS shop_name TEXT,
  ADD COLUMN IF NOT EXISTS address TEXT,
  ADD COLUMN IF NOT EXISTS referral_code TEXT,
  ADD COLUMN IF NOT EXISTS referred_by_id TEXT,
  ADD COLUMN IF NOT EXISTS wallet_balance NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS outstanding_balance NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS cod_order_count INTEGER DEFAULT 0,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2.2 Customer Addresses Table
CREATE TABLE IF NOT EXISTS public.addresses (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  user_id TEXT NOT NULL,
  full_address TEXT NOT NULL,
  landmark TEXT,
  pincode TEXT NOT NULL DEFAULT '422001',
  is_default BOOLEAN NOT NULL DEFAULT false,
  google_location JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.addresses
  ADD COLUMN IF NOT EXISTS user_id TEXT,
  ADD COLUMN IF NOT EXISTS full_address TEXT,
  ADD COLUMN IF NOT EXISTS landmark TEXT,
  ADD COLUMN IF NOT EXISTS pincode TEXT DEFAULT '422001',
  ADD COLUMN IF NOT EXISTS is_default BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS google_location JSONB,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2.3 Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  display_order INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 2.4 Products Table
CREATE TABLE IF NOT EXISTS public.products (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  brand TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  category_id TEXT REFERENCES public.categories(id) ON DELETE SET NULL,
  image_url TEXT,
  barcode VARCHAR(64),
  is_discount_excluded BOOLEAN NOT NULL DEFAULT false,
  search_keywords TEXT,
  display_order INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS description TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS category_id TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(64),
  ADD COLUMN IF NOT EXISTS is_discount_excluded BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS search_keywords TEXT,
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2.5 Product Variants Table
CREATE TABLE IF NOT EXISTS public.product_variants (
  id TEXT PRIMARY KEY,
  product_id TEXT NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  unit TEXT NOT NULL,
  pack_size NUMERIC(10, 2) NOT NULL,
  pack_label TEXT NOT NULL,
  mrp NUMERIC(10, 2) NOT NULL,
  base_selling_price NUMERIC(10, 2) NOT NULL,
  purchase_price NUMERIC(10, 2),
  discount NUMERIC(10, 2),
  stock_quantity INTEGER NOT NULL DEFAULT 100,
  max_order_limit INTEGER NOT NULL DEFAULT 20,
  low_stock_threshold INTEGER DEFAULT 10,
  barcode VARCHAR(64),
  image_url TEXT,
  display_order INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_variants
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS pack_size NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS pack_label TEXT,
  ADD COLUMN IF NOT EXISTS mrp NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS base_selling_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS purchase_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS discount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS stock_quantity INTEGER DEFAULT 100,
  ADD COLUMN IF NOT EXISTS max_order_limit INTEGER DEFAULT 20,
  ADD COLUMN IF NOT EXISTS low_stock_threshold INTEGER DEFAULT 10,
  ADD COLUMN IF NOT EXISTS barcode VARCHAR(64),
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2.6 Tiered Wholesale Prices Table
CREATE TABLE IF NOT EXISTS public.tiered_prices (
  id TEXT PRIMARY KEY,
  variant_id TEXT NOT NULL REFERENCES public.product_variants(id) ON DELETE CASCADE,
  min_qty INTEGER NOT NULL,
  max_qty INTEGER NOT NULL,
  unit_price NUMERIC(10, 2) NOT NULL
);

ALTER TABLE public.tiered_prices
  ADD COLUMN IF NOT EXISTS variant_id TEXT,
  ADD COLUMN IF NOT EXISTS min_qty INTEGER,
  ADD COLUMN IF NOT EXISTS max_qty INTEGER,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10, 2);

-- 2.7 Orders Table
-- Loose text references for customer_id ensure historical orders, bills, and accounting
-- are NEVER deleted accidentally if a customer profile changes or is archived.
CREATE TABLE IF NOT EXISTS public.orders (
  id TEXT PRIMARY KEY,
  order_number TEXT,
  customer_id TEXT,
  customer_name TEXT NOT NULL DEFAULT 'Customer',
  customer_phone TEXT NOT NULL DEFAULT '',
  shop_name TEXT,
  "Product Name" TEXT NOT NULL DEFAULT '',
  subtotal NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  discount_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  final_total NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  status TEXT NOT NULL DEFAULT 'ORDER_ACCEPTED',
  payment_method TEXT NOT NULL DEFAULT 'COD',
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  is_paid BOOLEAN NOT NULL DEFAULT false,
  delivery_address TEXT,
  preferred_slot TEXT,
  notes TEXT,
  weight_kg NUMERIC(10, 2),
  razorpay_order_id TEXT,
  razorpay_payment_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_number TEXT,
  ADD COLUMN IF NOT EXISTS customer_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT 'Customer',
  ADD COLUMN IF NOT EXISTS customer_phone TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS shop_name TEXT,
  ADD COLUMN IF NOT EXISTS "Product Name" TEXT DEFAULT '',
  ADD COLUMN IF NOT EXISTS subtotal NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS discount_amount NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS final_total NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ORDER_ACCEPTED',
  ADD COLUMN IF NOT EXISTS payment_method TEXT DEFAULT 'COD',
  ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'PENDING',
  ADD COLUMN IF NOT EXISTS is_paid BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS delivery_address TEXT,
  ADD COLUMN IF NOT EXISTS preferred_slot TEXT,
  ADD COLUMN IF NOT EXISTS notes TEXT,
  ADD COLUMN IF NOT EXISTS weight_kg NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT,
  ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2.8 Order Items Table (Relational Line-Item Mirror)
CREATE TABLE IF NOT EXISTS public.order_items (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id TEXT,
  product_variant_id TEXT,
  product_name TEXT NOT NULL,
  variant_name TEXT,
  brand TEXT,
  unit TEXT,
  pack_size NUMERIC(10, 2) DEFAULT 1,
  quantity INTEGER NOT NULL DEFAULT 1,
  unit_price NUMERIC(10, 2) NOT NULL,
  total_price NUMERIC(10, 2) NOT NULL,
  is_discount_excluded BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS product_variant_id TEXT,
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS variant_name TEXT,
  ADD COLUMN IF NOT EXISTS brand TEXT,
  ADD COLUMN IF NOT EXISTS unit TEXT,
  ADD COLUMN IF NOT EXISTS pack_size NUMERIC(10, 2) DEFAULT 1,
  ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS unit_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS total_price NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS is_discount_excluded BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 2.9 Customer Financial Ledger Table
-- Authoritative persistent source for wallet balance and transactions
CREATE TABLE IF NOT EXISTS public.ledger (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT 'Customer',
  order_id TEXT,
  date TIMESTAMPTZ NOT NULL DEFAULT now(),
  type TEXT NOT NULL CHECK (type IN ('CREDIT', 'DEBIT')),
  amount NUMERIC(10, 2) NOT NULL,
  description TEXT NOT NULL,
  balance_after NUMERIC(10, 2) NOT NULL DEFAULT 0.00
);

ALTER TABLE public.ledger
  ADD COLUMN IF NOT EXISTS customer_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT 'Customer',
  ADD COLUMN IF NOT EXISTS order_id TEXT,
  ADD COLUMN IF NOT EXISTS date TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS type TEXT,
  ADD COLUMN IF NOT EXISTS amount NUMERIC(10, 2),
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS balance_after NUMERIC(10, 2) DEFAULT 0.00;

-- 2.10 Product Requests Table ("आणून द्या" ग्राहक विनंत्या)
-- ID is TEXT for direct compatibility with preq-${timestamp}-${rand} IDs
CREATE TABLE IF NOT EXISTS public.product_requests (
  id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  customer_name TEXT NOT NULL DEFAULT 'Customer',
  customer_phone TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_name TEXT NOT NULL,
  variant_id TEXT,
  variant_name TEXT,
  pack_size TEXT,
  quantity INTEGER NOT NULL DEFAULT 1,
  request_date TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.product_requests
  ADD COLUMN IF NOT EXISTS customer_id TEXT,
  ADD COLUMN IF NOT EXISTS customer_name TEXT DEFAULT 'Customer',
  ADD COLUMN IF NOT EXISTS customer_phone TEXT,
  ADD COLUMN IF NOT EXISTS product_id TEXT,
  ADD COLUMN IF NOT EXISTS product_name TEXT,
  ADD COLUMN IF NOT EXISTS variant_id TEXT,
  ADD COLUMN IF NOT EXISTS variant_name TEXT,
  ADD COLUMN IF NOT EXISTS pack_size TEXT,
  ADD COLUMN IF NOT EXISTS quantity INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS request_date TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now();

-- 2.11 Store Settings Table
CREATE TABLE IF NOT EXISTS public.store_settings (
  id TEXT PRIMARY KEY DEFAULT 'global_settings',
  app_name TEXT NOT NULL DEFAULT 'Om Distributors',
  logo_url TEXT DEFAULT '/logo.jpg',
  primary_color_hex TEXT DEFAULT '#0F2C59',
  secondary_color_hex TEXT DEFAULT '#D4AF37',
  accent_color_hex TEXT DEFAULT '#FF6B00',
  advance_payment_discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
  cod_base_charge NUMERIC(10, 2) NOT NULL DEFAULT 49.00,
  free_shipping_min_amount NUMERIC(10, 2) NOT NULL DEFAULT 249.00,
  base_delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 11.00,
  referral_reward_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  low_stock_threshold NUMERIC(10, 2) NOT NULL DEFAULT 10.00,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS app_name TEXT DEFAULT 'Om Distributors',
  ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '/logo.jpg',
  ADD COLUMN IF NOT EXISTS primary_color_hex TEXT DEFAULT '#0F2C59',
  ADD COLUMN IF NOT EXISTS secondary_color_hex TEXT DEFAULT '#D4AF37',
  ADD COLUMN IF NOT EXISTS accent_color_hex TEXT DEFAULT '#FF6B00',
  ADD COLUMN IF NOT EXISTS advance_payment_discount_pct NUMERIC(5, 2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS cod_base_charge NUMERIC(10, 2) DEFAULT 49.00,
  ADD COLUMN IF NOT EXISTS free_shipping_min_amount NUMERIC(10, 2) DEFAULT 249.00,
  ADD COLUMN IF NOT EXISTS base_delivery_fee NUMERIC(10, 2) DEFAULT 11.00,
  ADD COLUMN IF NOT EXISTS referral_reward_amount NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC(10, 2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2.12 Legacy System Settings Mirror Table (for backward compatibility)
CREATE TABLE IF NOT EXISTS public.system_settings (
  id TEXT PRIMARY KEY DEFAULT 'global_settings',
  app_name TEXT NOT NULL DEFAULT 'Om Distributors',
  logo_url TEXT DEFAULT '/logo.jpg',
  primary_color_hex TEXT DEFAULT '#0F2C59',
  secondary_color_hex TEXT DEFAULT '#D4AF37',
  accent_color_hex TEXT DEFAULT '#FF6B00',
  advance_payment_discount_pct NUMERIC(5, 2) NOT NULL DEFAULT 5.00,
  cod_base_charge NUMERIC(10, 2) NOT NULL DEFAULT 49.00,
  free_shipping_min_amount NUMERIC(10, 2) NOT NULL DEFAULT 249.00,
  base_delivery_fee NUMERIC(10, 2) NOT NULL DEFAULT 11.00,
  referral_reward_amount NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
  low_stock_threshold NUMERIC(10, 2) NOT NULL DEFAULT 10.00,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS app_name TEXT DEFAULT 'Om Distributors',
  ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '/logo.jpg',
  ADD COLUMN IF NOT EXISTS primary_color_hex TEXT DEFAULT '#0F2C59',
  ADD COLUMN IF NOT EXISTS secondary_color_hex TEXT DEFAULT '#D4AF37',
  ADD COLUMN IF NOT EXISTS accent_color_hex TEXT DEFAULT '#FF6B00',
  ADD COLUMN IF NOT EXISTS advance_payment_discount_pct NUMERIC(5, 2) DEFAULT 5.00,
  ADD COLUMN IF NOT EXISTS cod_base_charge NUMERIC(10, 2) DEFAULT 49.00,
  ADD COLUMN IF NOT EXISTS free_shipping_min_amount NUMERIC(10, 2) DEFAULT 249.00,
  ADD COLUMN IF NOT EXISTS base_delivery_fee NUMERIC(10, 2) DEFAULT 11.00,
  ADD COLUMN IF NOT EXISTS referral_reward_amount NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC(10, 2) DEFAULT 10.00,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- ==============================================================================
-- 3. Default Store Settings Seeding (DO NOT OVERWRITE EXISTING SETTINGS)
-- ==============================================================================

INSERT INTO public.store_settings (
  id,
  app_name,
  logo_url,
  primary_color_hex,
  secondary_color_hex,
  accent_color_hex,
  advance_payment_discount_pct,
  cod_base_charge,
  free_shipping_min_amount,
  base_delivery_fee,
  referral_reward_amount,
  low_stock_threshold
) VALUES (
  'global_settings',
  'Om Distributors',
  '/logo.jpg',
  '#0F2C59',
  '#D4AF37',
  '#FF6B00',
  5.00,
  49.00,
  249.00,
  11.00,
  0.00,
  10.00
) ON CONFLICT (id) DO NOTHING;

INSERT INTO public.system_settings (
  id,
  app_name,
  logo_url,
  primary_color_hex,
  secondary_color_hex,
  accent_color_hex,
  advance_payment_discount_pct,
  cod_base_charge,
  free_shipping_min_amount,
  base_delivery_fee,
  referral_reward_amount,
  low_stock_threshold
) VALUES (
  'global_settings',
  'Om Distributors',
  '/logo.jpg',
  '#0F2C59',
  '#D4AF37',
  '#FF6B00',
  5.00,
  49.00,
  249.00,
  11.00,
  0.00,
  10.00
) ON CONFLICT (id) DO NOTHING;

-- ==============================================================================
-- 4. High-Performance Indexes
-- ==============================================================================

CREATE INDEX IF NOT EXISTS idx_users_phone ON public.users(phone);
CREATE INDEX IF NOT EXISTS idx_addresses_user_id ON public.addresses(user_id);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);
CREATE INDEX IF NOT EXISTS idx_products_barcode ON public.products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_product_variants_product_id ON public.product_variants(product_id);
CREATE INDEX IF NOT EXISTS idx_product_variants_barcode ON public.product_variants(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tiered_prices_variant_id ON public.tiered_prices(variant_id);
CREATE INDEX IF NOT EXISTS idx_orders_customer_phone ON public.orders(customer_phone);
CREATE INDEX IF NOT EXISTS idx_orders_customer_id ON public.orders(customer_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON public.orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created_at ON public.orders(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON public.order_items(order_id);
CREATE INDEX IF NOT EXISTS idx_ledger_customer_id ON public.ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_ledger_date ON public.ledger(date DESC);
CREATE INDEX IF NOT EXISTS idx_product_requests_customer_phone ON public.product_requests(customer_phone);
CREATE INDEX IF NOT EXISTS idx_product_requests_created_at ON public.product_requests(created_at DESC);

-- ==============================================================================
-- 5. Row Level Security (RLS) Hardening
-- ==============================================================================

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.addresses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_variants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tiered_prices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_settings ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------------------------
-- 5.1 Public Storefront Catalog: Categories, Products, Variants, Tiers & Settings
-- ------------------------------------------------------------------------------

-- Categories: Public read, writes via service_role
DROP POLICY IF EXISTS "Public Read Categories" ON public.categories;
CREATE POLICY "Public Read Categories" ON public.categories
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service Role Manage Categories" ON public.categories;
CREATE POLICY "Service Role Manage Categories" ON public.categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Products: Public read, writes via service_role
DROP POLICY IF EXISTS "Public Read Products" ON public.products;
CREATE POLICY "Public Read Products" ON public.products
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service Role Manage Products" ON public.products;
CREATE POLICY "Service Role Manage Products" ON public.products
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Product Variants: Public read (frontend queries select explicit columns without purchase_price)
DROP POLICY IF EXISTS "Public Read Product Variants" ON public.product_variants;
CREATE POLICY "Public Read Product Variants" ON public.product_variants
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service Role Manage Product Variants" ON public.product_variants;
CREATE POLICY "Service Role Manage Product Variants" ON public.product_variants
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Tiered Wholesale Prices: Public read
DROP POLICY IF EXISTS "Public Read Tiered Prices" ON public.tiered_prices;
CREATE POLICY "Public Read Tiered Prices" ON public.tiered_prices
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service Role Manage Tiered Prices" ON public.tiered_prices;
CREATE POLICY "Service Role Manage Tiered Prices" ON public.tiered_prices
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- Store Settings & System Settings: Public read for storefront discounts & checkout fees
DROP POLICY IF EXISTS "Public Read Store Settings" ON public.store_settings;
CREATE POLICY "Public Read Store Settings" ON public.store_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service Role Manage Store Settings" ON public.store_settings;
CREATE POLICY "Service Role Manage Store Settings" ON public.store_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Public Read System Settings" ON public.system_settings;
CREATE POLICY "Public Read System Settings" ON public.system_settings
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Service Role Manage System Settings" ON public.system_settings;
CREATE POLICY "Service Role Manage System Settings" ON public.system_settings
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 5.2 Users Table: Eliminate Unauthorized Bulk Access to Customer Profiles
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Users Select Policy" ON public.users;
DROP POLICY IF EXISTS "Users Insert Policy" ON public.users;
DROP POLICY IF EXISTS "Users Update Policy" ON public.users;
DROP POLICY IF EXISTS "Public Read Users" ON public.users;
DROP POLICY IF EXISTS "Allow All Users Select" ON public.users;
DROP POLICY IF EXISTS "Customer Self Registration Insert" ON public.users;
DROP POLICY IF EXISTS "Service Role Full Access Users" ON public.users;

-- Anonymous clients CANNOT SELECT all user rows. Service role handles authenticated fetches.
-- Customers can register their own profile row.
CREATE POLICY "Customer Self Registration Insert" ON public.users
  FOR INSERT WITH CHECK (
    role = 'CUSTOMER' AND
    id != 'admin_credential_store' AND
    length(phone) >= 10
  );

CREATE POLICY "Service Role Full Access Users" ON public.users
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 5.3 Addresses Table: Customer Delivery Addresses
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Read Addresses" ON public.addresses;
DROP POLICY IF EXISTS "Customer Addresses Insert" ON public.addresses;
DROP POLICY IF EXISTS "Service Role Full Access Addresses" ON public.addresses;

CREATE POLICY "Customer Addresses Insert" ON public.addresses
  FOR INSERT WITH CHECK (
    length(user_id) > 0 AND
    length(full_address) > 0
  );

CREATE POLICY "Service Role Full Access Addresses" ON public.addresses
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 5.4 Orders Table: Eliminate Cross-Customer Order Data Leakage
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Read Orders" ON public.orders;
DROP POLICY IF EXISTS "Allow All Orders Select" ON public.orders;
DROP POLICY IF EXISTS "Orders Select Policy" ON public.orders;
DROP POLICY IF EXISTS "Orders Insert Policy" ON public.orders;
DROP POLICY IF EXISTS "Orders Update Policy" ON public.orders;
DROP POLICY IF EXISTS "Customer Order Submission Insert" ON public.orders;
DROP POLICY IF EXISTS "Service Role Full Access Orders" ON public.orders;

-- Anonymous browser SELECT is completely prohibited.
-- Customer orders must ONLY be queried through the verified server API (/api/orders).
-- Insertion is permitted for customer checkout submissions with valid phone.
CREATE POLICY "Customer Order Submission Insert" ON public.orders
  FOR INSERT WITH CHECK (
    length(customer_phone) >= 10 AND
    length(id) > 0
  );

CREATE POLICY "Service Role Full Access Orders" ON public.orders
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 5.5 Order Items Table
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Read Order Items" ON public.order_items;
DROP POLICY IF EXISTS "Allow All Order Items Select" ON public.order_items;
DROP POLICY IF EXISTS "Order Items Insert Policy" ON public.order_items;
DROP POLICY IF EXISTS "Customer Order Items Insert" ON public.order_items;
DROP POLICY IF EXISTS "Service Role Full Access Order Items" ON public.order_items;

CREATE POLICY "Customer Order Items Insert" ON public.order_items
  FOR INSERT WITH CHECK (
    length(order_id) > 0 AND
    quantity > 0
  );

CREATE POLICY "Service Role Full Access Order Items" ON public.order_items
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 5.6 Ledger Table: Customer Wallet & Financial Privacy
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Read Ledger" ON public.ledger;
DROP POLICY IF EXISTS "Allow All Ledger Select" ON public.ledger;
DROP POLICY IF EXISTS "Ledger Select Policy" ON public.ledger;
DROP POLICY IF EXISTS "Ledger Insert Policy" ON public.ledger;
DROP POLICY IF EXISTS "Service Role Full Access Ledger" ON public.ledger;

-- Anonymous browser access to ledger is COMPLETELY BLOCKED (no SELECT/INSERT/UPDATE/DELETE).
-- All wallet balance calculations, credit, debit, and refunds run strictly through service_role.
CREATE POLICY "Service Role Full Access Ledger" ON public.ledger
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ------------------------------------------------------------------------------
-- 5.7 Product Requests Table: Zero Eavesdropping on Customer Requests
-- ------------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public Read Product Requests" ON public.product_requests;
DROP POLICY IF EXISTS "Allow All Product Requests Select" ON public.product_requests;
DROP POLICY IF EXISTS "Product Requests Select Policy" ON public.product_requests;
DROP POLICY IF EXISTS "Product Requests Insert Policy" ON public.product_requests;
DROP POLICY IF EXISTS "Product Requests Update Policy" ON public.product_requests;
DROP POLICY IF EXISTS "Customers Insert Own Product Requests" ON public.product_requests;
DROP POLICY IF EXISTS "Service Role Full Access Product Requests" ON public.product_requests;

-- Customers can ONLY insert new valid requests. Reading, modifying, or deleting is strictly forbidden for anon.
CREATE POLICY "Customers Insert Own Product Requests" ON public.product_requests
  FOR INSERT WITH CHECK (
    length(customer_phone) >= 10 AND
    length(product_name) > 0 AND
    quantity > 0
  );

-- Shopkeepers and Admins access requests strictly through the verified server API (/api/product-requests) using service_role
CREATE POLICY "Service Role Full Access Product Requests" ON public.product_requests
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ==============================================================================
-- 6. Realtime Publication Hardening
-- ==============================================================================

-- Remove sensitive tables from Realtime publication to prevent unauthorized WebSocket interception
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'product_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.product_requests;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'ledger'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.ledger;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'orders'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.orders;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'addresses'
  ) THEN
    ALTER PUBLICATION supabase_realtime DROP TABLE public.addresses;
  END IF;
END $$;

-- Add safe public catalog and settings tables to Realtime publication
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'store_settings'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.store_settings;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'categories'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.categories;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'products'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.products;
  END IF;
END $$;
