/**
 * Background sync service for pending confirmations
 */

import { supabase } from './supabase';
import {
  getPendingConfirmations,
  markConfirmationSynced,
  cleanupOldConfirmations,
  isOnline,
  checkServerReachable,
} from './offline';

export interface SyncResult {
  success: boolean;
  synced: number;
  failed: number;
  errors: Array<{ id: string; error: string }>;
}

// Sync all pending confirmations. `skipOnlineCheck` lets callers that have
// already verified real reachability (via checkServerReachable) bypass the
// navigator.onLine gate below, which is known to under-report connectivity
// in WebView/Capacitor and would otherwise block a sync we know can succeed.
export async function syncPendingConfirmations(skipOnlineCheck: boolean = false): Promise<SyncResult> {
  if (!skipOnlineCheck && !isOnline()) {
    console.log('[Sync] Skipping - offline');
    return { success: false, synced: 0, failed: 0, errors: [{ id: 'network', error: 'offline' }] };
  }

  const pending = await getPendingConfirmations();
  
  if (pending.length === 0) {
    console.log('[Sync] No pending confirmations');
    return { success: true, synced: 0, failed: 0, errors: [] };
  }

  console.log(`[Sync] Syncing ${pending.length} pending confirmation(s)`);
  
  const result: SyncResult = {
    success: true,
    synced: 0,
    failed: 0,
    errors: [],
  };

  for (const confirmation of pending) {
    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10 second timeout

      const { data, error } = await supabase.rpc('confirm_job_step', {
        p_token: confirmation.token,
        p_step: confirmation.step,
        p_otp: confirmation.otp,
        p_lat: confirmation.lat,
        p_lng: confirmation.lng,
      });

      clearTimeout(timeoutId);

      if (error) {
        console.error('[Sync] RPC error:', error);
        throw error;
      }

      if (data?.error) {
        // RPC returned an error (invalid OTP, already confirmed, etc.)
        console.warn('[Sync] Server error:', data.error);
        
        // If already confirmed, mark as synced anyway (idempotent)
        if (data.error === 'already_confirmed') {
          await markConfirmationSynced(confirmation.id);
          result.synced++;
        } else {
          result.failed++;
          result.errors.push({ id: confirmation.id, error: data.error });
        }
      } else {
        // Success - mark as synced
        console.log('[Sync] Successfully synced:', confirmation.id);
        await markConfirmationSynced(confirmation.id);
        result.synced++;
      }
    } catch (err: any) {
      console.error('[Sync] Network error:', err);
      result.failed++;
      result.errors.push({ 
        id: confirmation.id, 
        error: err.message || 'network_error' 
      });
    }
  }

  // Cleanup old synced confirmations
  await cleanupOldConfirmations();

  console.log('[Sync] Complete:', result);
  return result;
}

// Auto-sync when connection is restored
let syncInterval: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(intervalMs: number = 30000): void {
  if (syncInterval) return;

  console.log('[Sync] Starting auto-sync service');

  syncInterval = setInterval(async () => {
    // Don't gate this on navigator.onLine alone — it's known to under-report
    // connectivity in WebView/Capacitor, and if it's ever wrong, pending
    // confirmations from steps 3/4 would stay queued locally forever with
    // no other retry path. Actively verify instead.
    const pending = await getPendingConfirmations();
    if (pending.length === 0) return;

    const reachable = isOnline() || (await checkServerReachable());
    if (reachable) {
      try {
        await syncPendingConfirmations(true);
      } catch (err) {
        console.error('[Sync] Auto-sync error:', err);
      }
    }
  }, intervalMs);
}

export function stopAutoSync(): void {
  if (syncInterval) {
    console.log('[Sync] Stopping auto-sync service');
    clearInterval(syncInterval);
    syncInterval = null;
  }
}