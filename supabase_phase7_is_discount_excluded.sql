-- ==============================================================================
-- Om Distributors - Phase 7: Add is_discount_excluded to public.products
-- ==============================================================================
-- Execute this script in your Supabase SQL Editor (https://app.supabase.com)
-- This adds the persistent is_discount_excluded column to public.products table.

ALTER TABLE public.products 
ADD COLUMN IF NOT EXISTS is_discount_excluded BOOLEAN NOT NULL DEFAULT FALSE;
