-- ==============================================================================
-- Om Distributors - Store Settings Schema Extension & Secure RLS Patch
-- ==============================================================================
-- Execute this SQL in your Supabase Dashboard SQL Editor (https://app.supabase.com)
-- This safely adds the missing columns to the existing public.store_settings table,
-- sets the requested initial values (COD ₹50, Free Delivery above ₹249, Delivery Fee ₹11, Referral Credit ₹0),
-- and secures write permissions while allowing public read access for storefront calculations.

-- 1. Safely add missing columns if they do not already exist
ALTER TABLE public.store_settings
  ADD COLUMN IF NOT EXISTS logo_url TEXT DEFAULT '/logo.jpg',
  ADD COLUMN IF NOT EXISTS cod_base_charge NUMERIC(10, 2) DEFAULT 50.00,
  ADD COLUMN IF NOT EXISTS free_shipping_min_amount NUMERIC(10, 2) DEFAULT 249.00,
  ADD COLUMN IF NOT EXISTS base_delivery_fee NUMERIC(10, 2) DEFAULT 11.00,
  ADD COLUMN IF NOT EXISTS referral_reward_amount NUMERIC(10, 2) DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS low_stock_threshold NUMERIC(10, 2) DEFAULT 10.00;

-- 2. Update existing 'global_settings' row with the requested current values, preserving app_name & existing logo
UPDATE public.store_settings
SET
  cod_base_charge = 50.00,
  free_shipping_min_amount = 249.00,
  base_delivery_fee = 11.00,
  referral_reward_amount = 0.00,
  logo_url = COALESCE(logo_url, '/logo.jpg'),
  updated_at = now()
WHERE id = 'global_settings';

-- 3. Enable Row Level Security (RLS) on store_settings
ALTER TABLE public.store_settings ENABLE ROW LEVEL SECURITY;

-- 4. Apply clean, secure RLS Policies:
-- Permissive Read for storefront calculations across all clients (customers, browsers, PWA)
DROP POLICY IF EXISTS "Public Read Store Settings" ON public.store_settings;
CREATE POLICY "Public Read Store Settings" ON public.store_settings
  FOR SELECT USING (true);

-- Secure write access: Prohibit arbitrary unauthenticated public modifications.
-- Allows authenticated shopkeepers / admins or service role to update store settings.
DROP POLICY IF EXISTS "Authenticated Admins Update Store Settings" ON public.store_settings;
CREATE POLICY "Authenticated Admins Update Store Settings" ON public.store_settings
  FOR UPDATE USING (
    auth.role() = 'authenticated' OR auth.role() = 'service_role'
  )
  WITH CHECK (
    auth.role() = 'authenticated' OR auth.role() = 'service_role'
  );

DROP POLICY IF EXISTS "Authenticated Admins Insert Store Settings" ON public.store_settings;
CREATE POLICY "Authenticated Admins Insert Store Settings" ON public.store_settings
  FOR INSERT WITH CHECK (
    auth.role() = 'authenticated' OR auth.role() = 'service_role'
  );

-- 5. Enable Supabase Realtime publication on store_settings for instant cross-device updates
ALTER PUBLICATION supabase_realtime ADD TABLE public.store_settings;
