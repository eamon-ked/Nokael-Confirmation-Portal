-- 1. ADD MISSING COLUMNS FOR READINESS STATUS & TRACKING
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS driver_arrived_pickup_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sender_ready_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS driver_arrived_delivery_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS driver_lat FLOAT8,
ADD COLUMN IF NOT EXISTS driver_lng FLOAT8;

-- 2. ENABLE RLS (Security)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- 3. ENSURE PERMISSIONS FOR THE ANON ROLE
-- Supabase uses the 'anon' role for unauthenticated requests.
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;

-- Extra safety for common types
DO $$ 
BEGIN
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN GRANT USAGE ON TYPE job_status TO anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_type') THEN GRANT USAGE ON TYPE item_type TO anon; END IF;
  IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'urgency_level') THEN GRANT USAGE ON TYPE urgency_level TO anon; END IF;
END $$;

-- 4. CLEAN UP AND ADD RLS POLICIES
-- We drop EVERY known policy to ensure our new one is the only one acting.
-- If you have custom policies you want to keep, rename them or merge them.
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN (SELECT policyname FROM pg_policies WHERE tablename = 'jobs' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol.policyname) || ' ON jobs';
    END LOOP;
END $$;

-- Policy for Public Updates (Readiness & Location Tracking)
CREATE POLICY "Allow public update of active jobs" 
ON jobs 
FOR UPDATE 
TO anon, authenticated
USING (status != 'completed')
WITH CHECK (status != 'completed');

-- Policy for Public Selection
CREATE POLICY "Allow public select of jobs" 
ON jobs 
FOR SELECT 
TO anon, authenticated 
USING (true);

-- Ensure anon can read drivers 
DROP POLICY IF EXISTS "Allow public select of drivers" ON drivers;
CREATE POLICY "Allow public select of drivers"
ON drivers
FOR SELECT
TO anon, authenticated
USING (true);


