-- NOKAEL LOGISTICS SYSTEM - DATABASE SCHEMA DOCUMENTATION
-- Target: Supabase / PostgreSQL Database
-- Version: Upgraded Schema (Production Ready)

-- Enable Required Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Custom Enum Types
DO $$ 
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'item_type') THEN
    CREATE TYPE public.item_type AS ENUM ('document', 'parcel', 'spare_part', 'other');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'urgency_level') THEN
    CREATE TYPE public.urgency_level AS ENUM ('immediate', 'today', 'scheduled');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'job_status') THEN
    CREATE TYPE public.job_status AS ENUM ('pending', 'client_pickup', 'driver_pickup', 'driver_delivery', 'completed', 'cancelled');
  END IF;
END $$;

-- 1. Table: public.business_inquiries
CREATE TABLE IF NOT EXISTS public.business_inquiries (
  id uuid NOT NULL DEFAULT uuid_generate_v4(),
  created_at timestamp with time zone DEFAULT now(),
  company_name text NOT NULL,
  contact_person text NOT NULL,
  phone_whatsapp text NOT NULL,
  email text NOT NULL,
  typical_routes text,
  item_types text,
  estimated_monthly_volume text,
  urgent_express_dedicated_needs text,
  invoicing_required boolean DEFAULT false,
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_term text,
  utm_content text,
  gclid text,
  corporate_code text,
  status text DEFAULT 'pending'::text,
  follow_up_notes text,
  CONSTRAINT business_inquiries_pkey PRIMARY KEY (id)
);

-- 2. Table: public.quote_requests
CREATE TABLE IF NOT EXISTS public.quote_requests (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone NOT NULL DEFAULT timezone('utc'::text, now()),
  pickup_location text NOT NULL,
  delivery_location text NOT NULL,
  emirate text NOT NULL,
  item_type text NOT NULL CHECK (item_type = ANY (ARRAY['document'::text, 'parcel'::text, 'spare_part'::text, 'other'::text])),
  urgency text NOT NULL CHECK (urgency = ANY (ARRAY['immediate'::text, 'today'::text, 'scheduled'::text])),
  name text NOT NULL,
  phone text NOT NULL,
  whatsapp_opt_in boolean NOT NULL DEFAULT true,
  status text NOT NULL DEFAULT 'pending'::text CHECK (status = ANY (ARRAY['pending'::text, 'contacted'::text, 'completed'::text])),
  utm_source text,
  utm_medium text,
  utm_campaign text,
  utm_content text,
  utm_term text,
  gclid text,
  customer_type text,
  company_name text,
  repeat_business boolean DEFAULT false,
  tracking_id text,
  corporate_code text,
  CONSTRAINT quote_requests_pkey PRIMARY KEY (id)
);

-- 3. Table: public.drivers
CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  created_at timestamp with time zone DEFAULT now(),
  full_name text NOT NULL,
  phone text NOT NULL,
  whatsapp text NOT NULL,
  email text NOT NULL,
  base_location text NOT NULL,
  vehicle_type text NOT NULL,
  inter_emirate boolean DEFAULT true,
  availability_hours text,
  eid_front_url text,
  eid_back_url text,
  eid_verified boolean DEFAULT false,
  active boolean DEFAULT true,
  onboarding_status text DEFAULT 'pending'::text,
  tier text DEFAULT 'D'::text,
  reliability_score integer DEFAULT 0,
  internal_notes text,
  last_active_at timestamp with time zone DEFAULT now(),
  pin_hash text,
  session_expires_at timestamp with time zone,
  emirates_id text,
  vehicle_make text,
  vehicle_model text,
  vehicle_plate text UNIQUE,
  areas_covered text[], -- Array of strings (areas covered by driver)
  availability text DEFAULT 'on-call'::text CHECK (availability = ANY (ARRAY['full-time'::text, 'part-time'::text, 'on-call'::text])),
  status text DEFAULT 'offline'::text CHECK (status = ANY (ARRAY['offline'::text, 'available'::text, 'on_job'::text])),
  rating numeric DEFAULT 5.0,
  jobs_completed integer DEFAULT 0,
  on_time_rate numeric DEFAULT 100.0,
  CONSTRAINT drivers_pkey PRIMARY KEY (id)
);

-- 4. Table: public.driver_documents
CREATE TABLE IF NOT EXISTS public.driver_documents (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  driver_id uuid,
  document_type text NOT NULL,
  file_url text NOT NULL,
  drive_file_id text,
  verification_status text DEFAULT 'pending'::text,
  expiry_date date,
  uploaded_at timestamp with time zone DEFAULT now(),
  CONSTRAINT driver_documents_pkey PRIMARY KEY (id),
  CONSTRAINT driver_documents_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id)
);

-- 5. Table: public.jobs
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_ref text UNIQUE,
  source text DEFAULT 'manual'::text,
  quote_id uuid,
  sender_name text NOT NULL,
  sender_phone text NOT NULL,
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  driver_id uuid,
  pickup_emirate text NOT NULL,
  pickup_location text NOT NULL,
  delivery_emirate text NOT NULL,
  delivery_location text NOT NULL,
  item_type public.item_type NOT NULL DEFAULT 'parcel'::public.item_type,
  urgency public.urgency_level NOT NULL DEFAULT 'immediate'::public.urgency_level,
  price_aed numeric,
  operator_notes text,
  otp_sender character(6),
  otp_driver_pickup character(6),
  otp_driver_delivery character(6),
  otp_recipient character(6),
  otp_attempts integer DEFAULT 0,
  status public.job_status NOT NULL DEFAULT 'pending'::public.job_status,
  token_client_pickup uuid NOT NULL DEFAULT gen_random_uuid(),
  token_driver_pickup uuid NOT NULL DEFAULT gen_random_uuid(),
  token_driver_delivery uuid NOT NULL DEFAULT gen_random_uuid(),
  token_client_delivery uuid NOT NULL DEFAULT gen_random_uuid(),
  client_pickup_at timestamp with time zone,
  driver_pickup_at timestamp with time zone,
  driver_delivery_at timestamp with time zone,
  client_delivery_at timestamp with time zone,
  pickup_lat double precision,
  pickup_lng double precision,
  delivery_lat double precision,
  delivery_lng double precision,
  sender_notified boolean DEFAULT false,
  recipient_notified boolean DEFAULT false,
  driver_notified boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  driver_lat double precision,
  driver_lng double precision,
  driver_arrived_pickup_at timestamp with time zone,
  sender_ready_at timestamp with time zone,
  driver_arrived_delivery_at timestamp with time zone,
  client_name text,
  client_whatsapp text,
  company_name text,
  service_tier text CHECK (service_tier = ANY (ARRAY['express'::text, 'priority'::text, 'standard'::text])),
  special_instructions text,
  scheduled_pickup_at timestamp with time zone,
  cancelled_at timestamp with time zone,
  cancellation_reason text,
  driver_updated_at timestamp with time zone,
  tracking_token text DEFAULT encode(gen_random_bytes(16), 'hex'::text) UNIQUE,
  CONSTRAINT jobs_pkey PRIMARY KEY (id),
  CONSTRAINT jobs_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id),
  CONSTRAINT jobs_quote_id_fkey FOREIGN KEY (quote_id) REFERENCES public.quote_requests(id)
);

-- 6. Table: public.job_ratings
CREATE TABLE IF NOT EXISTS public.job_ratings (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL UNIQUE,
  driver_id uuid NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  feedback_text text,
  rated_by text NOT NULL CHECK (rated_by = ANY (ARRAY['client'::text, 'operator'::text])),
  rated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT job_ratings_pkey PRIMARY KEY (id),
  CONSTRAINT job_ratings_job_id_fkey FOREIGN KEY (job_id) REFERENCES public.jobs(id),
  CONSTRAINT job_ratings_driver_id_fkey FOREIGN KEY (driver_id) REFERENCES public.drivers(id)
);

-- Enable Row Level Security (RLS) on all tables
ALTER TABLE public.business_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.quote_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.driver_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_ratings ENABLE ROW LEVEL SECURITY;

-- Ensure roles permissions for real-time and client interactions
GRANT USAGE ON SCHEMA public TO anon;
GRANT USAGE ON SCHEMA public TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;
GRANT ALL ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO authenticated;
GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO authenticated;

-- Ensure Enum usage is granted to public roles
GRANT USAGE ON TYPE public.job_status TO anon, authenticated;
GRANT USAGE ON TYPE public.item_type TO anon, authenticated;
GRANT USAGE ON TYPE public.urgency_level TO anon, authenticated;

-- Clean up and configure Row Level Security policies for Jobs
DO $$
DECLARE
    pol record;
BEGIN
    FOR pol IN (SELECT policyname FROM pg_policies WHERE tablename = 'jobs' AND schemaname = 'public') LOOP
        EXECUTE 'DROP POLICY IF EXISTS ' || quote_ident(pol.policyname) || ' ON jobs';
    END LOOP;
END $$;

-- Policy: Allow clients / drivers / recipients to fetch/read jobs
CREATE POLICY "Allow public select of jobs" 
ON public.jobs 
FOR SELECT 
TO anon, authenticated 
USING (true);

-- Policy: Allow clients & drivers to update relevant fields of jobs
CREATE POLICY "Allow public update of active jobs" 
ON public.jobs 
FOR UPDATE 
TO anon, authenticated
USING (status != 'completed')
WITH CHECK (status != 'completed');

-- Policy: Allow drivers list querying for telemetry verification
DROP POLICY IF EXISTS "Allow public select of drivers" ON public.drivers;
CREATE POLICY "Allow public select of drivers"
ON public.drivers
FOR SELECT
TO anon, authenticated
USING (true);
