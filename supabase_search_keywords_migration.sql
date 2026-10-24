-- Om Distributors: Products Search Keywords Migration SQL
-- Add search_keywords column to public.products table if it does not exist already
ALTER TABLE public.products
ADD COLUMN IF NOT EXISTS search_keywords TEXT NULL;

COMMENT ON COLUMN public.products.search_keywords IS 'Comma-separated search keywords and synonyms for customer search';
