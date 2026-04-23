/**
 * Background sync service for pending confirmations
 */

import { supabase } from './supabase';
import {
  getPendingConfirmations,
  markConfirmationSynced,
  cleanupOldConfirmations,
  isOnline,
} from './offline';

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

// Sync all pending confirmations
export async function syncPendingConfirmations(): Promise<SyncResult> {
  if (!isOnline()) {
    return { success: false, synced: 0, failed: 0, errors: [{ id: 'network', error: 'offline' }] };
  }

  const pending = await getPendingConfirmations();
  const result: SyncResult = {
    success: true,
    synced: 0,
    failed: 0,
    errors: [],
  };

  for (const confirmation of pending) {
    try {
      const { data, error } = await supabase.rpc('confirm_job_step', {
        p_token: confirmation.token,
        p_step: confirmation.step,
        p_otp: confirmation.otp,
        p_lat: confirmation.lat,
        p_lng: confirmation.lng,
      });

      if (error) throw error;

      if (data?.error) {
        // RPC returned an error (invalid OTP, already confirmed, etc.)
        result.failed++;
        result.errors.push({ id: confirmation.id, error: data.error });
      } else {
        // Success - mark as synced
        await markConfirmationSynced(confirmation.id);
        result.synced++;
      }
    } catch (err: any) {
      result.failed++;
      result.errors.push({ id: confirmation.id, error: err.message || 'unknown_error' });
    }
  }

  // Cleanup old synced confirmations
  await cleanupOldConfirmations();

  return result;
}

// Auto-sync when connection is restored
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(intervalMs: number = 30000): void {
  if (syncInterval) return;

  syncInterval = setInterval(async () => {
    if (isOnline()) {
      await syncPendingConfirmations();
    }
  }, intervalMs);
}

export function stopAutoSync(): void {
  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = null;
  }
}
