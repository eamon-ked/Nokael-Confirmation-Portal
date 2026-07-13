/**
 * Offline verification system for Nokael
 * Allows OTP verification without internet, syncs when connection returns
 */

export interface OfflineJob {
  token: string;
  step: string;
  job_ref: string;
  partner_otp_hash: string; // bcrypt hash — never the raw code
  my_otp: string;
  job_data: any;
  cached_at: number;
}

export interface PendingConfirmation {
  id: string;
  token: string;
  step: string;
  otp: string;
  lat: number | null;
  lng: number | null;
  timestamp: number;
  synced: boolean;
  job_ref?: string; // To match confirmations across different tokens
}

const DB_NAME = 'nokael_offline';
const DB_VERSION = 1;
const JOBS_STORE = 'jobs';
const CONFIRMATIONS_STORE = 'confirmations';

// Initialize IndexedDB
function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Store for cached job data
      if (!db.objectStoreNames.contains(JOBS_STORE)) {
        const jobStore = db.createObjectStore(JOBS_STORE, { keyPath: 'token' });
        jobStore.createIndex('step', 'step', { unique: false });
      }

      // Store for pending confirmations
      if (!db.objectStoreNames.contains(CONFIRMATIONS_STORE)) {
        const confirmStore = db.createObjectStore(CONFIRMATIONS_STORE, { keyPath: 'id' });
        confirmStore.createIndex('synced', 'synced', { unique: false });
        confirmStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// Cache job data for offline use
export async function cacheJobData(
  token: string,
  step: string,
  jobData: any,
  partnerOtpHash: string,
  myOtp: string
): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(JOBS_STORE, 'readwrite');
  const store = tx.objectStore(JOBS_STORE);

  const offlineJob: OfflineJob = {
    token,
    step,
    job_ref: jobData.job_ref,
    partner_otp_hash: partnerOtpHash,
    my_otp: myOtp,
    job_data: jobData,
    cached_at: Date.now(),
  };

  await store.put(offlineJob);
}

// Get cached job data
export async function getCachedJob(token: string): Promise<OfflineJob | null> {
  const db = await openDB();
  const tx = db.transaction(JOBS_STORE, 'readonly');
  const store = tx.objectStore(JOBS_STORE);

  return new Promise((resolve, reject) => {
    const request = store.get(token);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

// Verify OTP offline against the cached bcrypt hash. The real partner code
// is never stored on the device — only a hash of it, computed server-side
// in get_job_by_token — so a compromised device/cache never exposes it.
export async function verifyOtpOffline(
  token: string,
  enteredOtp: string
): Promise<{ valid: boolean; error?: string }> {
  const cachedJob = await getCachedJob(token);

  if (!cachedJob || !cachedJob.partner_otp_hash) {
    return { valid: false, error: 'no_cached_data' };
  }

  // CRITICAL: Block self-verification offline
  if (enteredOtp === cachedJob.my_otp) {
    return { valid: false, error: 'self_verification_blocked' };
  }

  const bcrypt = await import('bcryptjs');
  const matches = bcrypt.compareSync(enteredOtp, cachedJob.partner_otp_hash);

  if (!matches) {
    return { valid: false, error: 'invalid_otp' };
  }

  return { valid: true };
}

// Queue confirmation for later sync
export async function queueConfirmation(
  token: string,
  step: string,
  otp: string,
  lat: number | null,
  lng: number | null,
  job_ref?: string
): Promise<string> {
  const db = await openDB();
  const tx = db.transaction(CONFIRMATIONS_STORE, 'readwrite');
  const store = tx.objectStore(CONFIRMATIONS_STORE);

  const confirmation: PendingConfirmation = {
    id: `${token}_${step}_${Date.now()}`,
    token,
    step,
    otp,
    lat,
    lng,
    timestamp: Date.now(),
    synced: false,
    job_ref,
  };

  await store.put(confirmation);
  return confirmation.id;
}

// Get all pending confirmations
export async function getPendingConfirmations(): Promise<PendingConfirmation[]> {
  const db = await openDB();
  const tx = db.transaction(CONFIRMATIONS_STORE, 'readonly');
  const store = tx.objectStore(CONFIRMATIONS_STORE);
  const index = store.index('synced');

  return new Promise((resolve, reject) => {
    // Ensure the index exists and we are passing a valid key
    try {
      const request = index.getAll(IDBKeyRange.only(0)); // SQLite/IndexedDB sometimes treat booleans as 0/1 or need specific keys
      // Actually, standard approach:
      const req = index.getAll(false as any); 
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    } catch (e) {
      // Fallback for older browsers or weird IndexedDB states
      const request = store.getAll();
      request.onsuccess = () => {
        const all = request.result as PendingConfirmation[];
        resolve(all.filter(c => !c.synced));
      };
      request.onerror = () => reject(request.error);
    }
  });

}

// Mark confirmation as synced
export async function markConfirmationSynced(id: string): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(CONFIRMATIONS_STORE, 'readwrite');
  const store = tx.objectStore(CONFIRMATIONS_STORE);

  const confirmation = await new Promise<PendingConfirmation>((resolve, reject) => {
    const request = store.get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

  if (confirmation) {
    confirmation.synced = true;
    await store.put(confirmation);
  }
}

// Delete synced confirmations older than 7 days
export async function cleanupOldConfirmations(): Promise<void> {
  const db = await openDB();
  const tx = db.transaction(CONFIRMATIONS_STORE, 'readwrite');
  const store = tx.objectStore(CONFIRMATIONS_STORE);
  const index = store.index('timestamp');

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;

  return new Promise((resolve, reject) => {
    const request = index.openCursor();
    request.onsuccess = (event) => {
      const cursor = (event.target as IDBRequest).result;
      if (cursor) {
        const confirmation: PendingConfirmation = cursor.value;
        if (confirmation.synced && confirmation.timestamp < sevenDaysAgo) {
          cursor.delete();
        }
        cursor.continue();
      } else {
        resolve();
      }
    };
    request.onerror = () => reject(request.error);
  });
}

// Check if online
export function isOnline(): boolean {
  return navigator.onLine;
}

// Listen for online/offline events
export function setupConnectivityListeners(
  onOnline: () => void,
  onOffline: () => void
): () => void {
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);

  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
  };
}