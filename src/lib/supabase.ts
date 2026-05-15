import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL?.trim();
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

if (!supabaseUrl || !supabaseAnonKey || supabaseUrl === 'YOUR_SUPABASE_URL') {
  console.warn('Supabase credentials missing or using placeholders. App may fail to fetch/update data.');
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
