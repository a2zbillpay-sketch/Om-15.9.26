-- ==============================================================================
-- Om Distributors - Category Management Migration Schema
-- ==============================================================================
-- Date: 2026-11-02
-- Purpose: Persistent categories table, indexes, RLS security policies, and
--          storage bucket permissions for "product-images/categories/".
--
-- INSTRUCTIONS: Run this script in your Supabase SQL Editor (https://supabase.com/dashboard)
-- if the categories table or storage bucket is not yet provisioned.
-- Safe & Idempotent: Can be run multiple times safely.
-- ==============================================================================

-- 1. Create categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  image_url TEXT,
  display_order INTEGER DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Ensure all required columns exist (idempotent alterations)
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS name TEXT,
  ADD COLUMN IF NOT EXISTS image_url TEXT,
  ADD COLUMN IF NOT EXISTS display_order INTEGER DEFAULT 1,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT now();

-- 2. Link products.category_id safely
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'products' AND column_name = 'category_id'
  ) THEN
    ALTER TABLE public.products ADD COLUMN category_id TEXT REFERENCES public.categories(id) ON DELETE SET NULL;
  END IF;
END $$;

-- 3. Indexes for fast lookup & sorting
CREATE INDEX IF NOT EXISTS idx_categories_display_order ON public.categories(display_order ASC);
CREATE INDEX IF NOT EXISTS idx_products_category_id ON public.products(category_id);

-- 4. Row Level Security (RLS)
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- 4.1 Allow public read for customer storefront navigation
DROP POLICY IF EXISTS "Public Read Categories" ON public.categories;
CREATE POLICY "Public Read Categories" ON public.categories
  FOR SELECT USING (true);

-- 4.2 Allow service_role full control
DROP POLICY IF EXISTS "Service Role Manage Categories" ON public.categories;
CREATE POLICY "Service Role Manage Categories" ON public.categories
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- 4.3 Allow authenticated / anon store operations (when using client anon key)
DROP POLICY IF EXISTS "Allow Client Manage Categories" ON public.categories;
CREATE POLICY "Allow Client Manage Categories" ON public.categories
  FOR ALL TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- 5. Storage Bucket Configuration for "product-images"
-- Ensures bucket exists and is public for category photos
INSERT INTO storage.buckets (id, name, public)
VALUES ('product-images', 'product-images', true)
ON CONFLICT (id) DO UPDATE SET public = true;

-- 5.1 Public Read policy for product-images bucket
DROP POLICY IF EXISTS "Public Read Product Images" ON storage.objects;
CREATE POLICY "Public Read Product Images" ON storage.objects
  FOR SELECT USING (bucket_id = 'product-images');

-- 5.2 Upload & Manage policy for product-images bucket (including categories/ folder)
DROP POLICY IF EXISTS "Allow Upload Product Images" ON storage.objects;
CREATE POLICY "Allow Upload Product Images" ON storage.objects
  FOR ALL TO anon, authenticated, service_role
  USING (bucket_id = 'product-images')
  WITH CHECK (bucket_id = 'product-images');
