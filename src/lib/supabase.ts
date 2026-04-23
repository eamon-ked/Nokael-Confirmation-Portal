import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('Supabase credentials missing. App will use mock data for preview if not configured.');
}

export const supabase = createClient(
  supabaseUrl || 'https://placeholder.supabase.co',
  supabaseAnonKey || 'placeholder'
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
