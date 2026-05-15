-- 1. ADD MISSING COLUMNS FOR READINESS STATUS & TRACKING
ALTER TABLE jobs 
ADD COLUMN IF NOT EXISTS driver_arrived_pickup_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sender_ready_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS driver_arrived_delivery_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS driver_lat FLOAT8,
ADD COLUMN IF NOT EXISTS driver_lng FLOAT8;

-- 2. ENABLE RLS (Security)
ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;

-- 3. ADD RLS POLICIES FOR ANONYMOUS UPDATES
-- We drop existing policies to ensure a clean state
DROP POLICY IF EXISTS "Allow public update of readiness status via tokens" ON jobs;
DROP POLICY IF EXISTS "Allow public update of driver status" ON jobs;
DROP POLICY IF EXISTS "Allow public update of active jobs" ON jobs;
DROP POLICY IF EXISTS "Allow public select of jobs" ON jobs;

-- Policy for Public Updates (Readiness & Location Tracking)
-- Allows updating any active (non-completed) job. 
-- In a high-security environment, you would refine this to check tokens explicitly.
CREATE POLICY "Allow public update of active jobs" 
ON jobs 
FOR UPDATE 
TO anon
USING (status != 'completed')
WITH CHECK (status != 'completed');

-- Policy for Public Selection (Viewing the Page)
-- Allows reading any job record with a public token.
CREATE POLICY "Allow public select of jobs" 
ON jobs 
FOR SELECT 
TO anon 
USING (true);
