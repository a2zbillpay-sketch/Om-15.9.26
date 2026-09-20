-- ==============================================================================
-- Om Distributors - Admin Credential RLS Security Hardening Patch
-- ==============================================================================
-- Execute this SQL script in the Supabase Dashboard SQL Editor (https://app.supabase.com)
-- This replaces the permissive USING (true) policies on public.users with strict
-- policies that prohibit anonymous/public clients from reading, inserting, or
-- updating SYSTEM and admin_credential_store rows, while keeping all Customer
-- and Shopkeeper operations fully functional.

-- 1. Replace SELECT policy: Prohibit anonymous reads of SYSTEM / admin_credential_store
DROP POLICY IF EXISTS "Users Select Policy" ON public.users;
CREATE POLICY "Users Select Policy" ON public.users 
FOR SELECT USING (
  role != 'SYSTEM' AND id != 'admin_credential_store'
);

-- 2. Replace INSERT policy: Prohibit anonymous insertion of SYSTEM / admin_credential_store
DROP POLICY IF EXISTS "Users Insert Policy" ON public.users;
CREATE POLICY "Users Insert Policy" ON public.users 
FOR INSERT WITH CHECK (
  role != 'SYSTEM' AND id != 'admin_credential_store'
);

-- 3. Replace UPDATE policy: Prohibit anonymous modification of SYSTEM / admin_credential_store
DROP POLICY IF EXISTS "Users Update Policy" ON public.users;
CREATE POLICY "Users Update Policy" ON public.users 
FOR UPDATE USING (
  role != 'SYSTEM' AND id != 'admin_credential_store'
) WITH CHECK (
  role != 'SYSTEM' AND id != 'admin_credential_store'
);

-- (Note: No DELETE policy is created for anonymous users, keeping deletion forbidden)
