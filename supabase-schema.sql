-- 1. ADD MISSING COLUMNS FOR READINESS STATUS & TRACKING
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS driver_arrived_pickup_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sender_ready_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS driver_arrived_delivery_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS driver_lat FLOAT8,
ADD COLUMN IF NOT EXISTS driver_lng FLOAT8;

-- 2. ENABLE RLS (Security)
-- Run this if not already enabled
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- 3. ADD RLS POLICIES FOR ANONYMOUS UPDATES
-- By default, Supabase blocks updates via the anon key unless a policy exists.

-- Policy for Public Updates (Readiness & Location)
-- We allow updates to active jobs. In production, tighten this to match tokens.
DROP POLICY IF EXISTS "Allow public update of readiness status via tokens" ON jobs;
DROP POLICY IF EXISTS "Allow public update of driver status" ON jobs;
DROP POLICY IF EXISTS "Allow public update of active jobs" ON jobs;

CREATE POLICY "Allow public update of active jobs" 
ON jobs 
FOR UPDATE 
TO anon
USING (status != 'completed')
WITH CHECK (status != 'completed');

-- Policy for Public Selection (Viewing the Page)
DROP POLICY IF EXISTS "Allow public select of jobs" ON jobs;
CREATE POLICY "Allow public select of jobs" 
ON jobs 
FOR SELECT 
TO anon 
USING (true);
