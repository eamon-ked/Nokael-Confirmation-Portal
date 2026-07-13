import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

// Whether real Supabase credentials were baked into this build. Every request
// on a build where this is false will fail (wrong host / bad key), and that
// failure looks IDENTICAL to "no internet" to a naive fetch().catch(). Callers
// use this to tell "we're offline" apart from "this build is misconfigured" —
// the fix for the two is completely different (wait for signal vs redeploy).
export const isSupabaseConfigured = Boolean(
  supabaseUrl && supabaseAnonKey && supabaseUrl !== 'YOUR_SUPABASE_URL' && supabaseAnonKey !== 'YOUR_SUPABASE_ANON_KEY'
);

if (!isSupabaseConfigured) {
  console.error(
    '[Supabase] Missing or placeholder credentials at build time. ' +
    'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were not set when this bundle was built. ' +
    'Every request will fail and the app will misreport this as "offline".'
  );
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder',
  {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  }
);



export interface SupabaseErrorInfo {
  error: string;
  operationType: 'create' | 'update' | 'delete' | 'list' | 'get' | 'write' | 'rpc';
  path: string | null;
  authInfo: any;
}

export const handleSupabaseError = (error: any, operationType: SupabaseErrorInfo['operationType'], path: string | null = null) => {
  const errorInfo: SupabaseErrorInfo = {
    error: error.message || 'Unknown Supabase error',
    operationType,
    path,
    authInfo: null,
  };
  throw new Error(JSON.stringify(errorInfo));
};