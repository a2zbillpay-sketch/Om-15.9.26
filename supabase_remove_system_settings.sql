-- ==============================================================================
-- Migration: Remove Legacy public.system_settings Table
-- ==============================================================================
-- Safely drops the deprecated public.system_settings table on existing databases
-- so public.store_settings remains the single canonical settings source.
-- Does NOT modify or drop public.store_settings or any other table.

DROP TABLE IF EXISTS public.system_settings;
