import { supabase } from './supabase';
import type { Job } from '@/src/types';
import type { OrgProfile } from './org';
import type { DriverContact, PodFix } from './cocRender';

// ==========================================
// Permanent certificate link — /:token/certificate
// ==========================================
// Tracking links close 24h after delivery; the certificate doesn't.
// get_certificate (supabase-share-links-migration.sql) answers for any client
// link token of a completed job, with only what the PDF prints.

export interface CertificateData {
  org: OrgProfile | null;
  job: Job;
  driver: DriverContact | null;
  pod: PodFix[];
}

export const certificatePath = (token: string) => `/${token}/certificate`;

export async function getCertificate(token: string): Promise<CertificateData | null> {
  const { data, error } = await supabase.rpc('get_certificate', { p_token: token });
  if (error) throw error;
  return (data as CertificateData | null) ?? null;
}
