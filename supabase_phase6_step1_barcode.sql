-- ==============================================================================
-- Om Distributors - Phase 6: Step 1 Barcode Foundation Migration
-- ==============================================================================
-- Safely adds barcode column to public.products if not present
-- and creates a unique partial index to enforce barcode uniqueness for non-null values.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 
    FROM information_schema.columns 
    WHERE table_schema = 'public' 
      AND table_name = 'products' 
      AND column_name = 'barcode'
  ) THEN
    ALTER TABLE public.products ADD COLUMN barcode VARCHAR(64) NULL;
  END IF;
END $$;

-- Enforce database-level uniqueness across products for non-null barcodes
CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode_unique 
ON public.products(barcode) 
WHERE barcode IS NOT NULL;
