import { Job } from '@/src/types';
import { formatUAETime } from '@/src/lib/utils';
import { orgBrand, orgTimeZone, orgCocTemplate, orgLogoUrl } from './org';
import { renderCocPdf, normalizeCocTemplate, loadLogo, cocFileName, type DriverContact, type PodFix } from './cocRender';

export type { DriverContact, PodFix } from './cocRender';

/**
 * Client-side Chain of Custody certificate for the /:token/track page.
 * Built only from what get_job_by_token (+ get_job_driver_by_token) already
 * hands this token — no OTPs are ever printed, only the fact that each
 * handover was code-verified and when. Look and wording come from the
 * company's template (organizations.settings.coc, set in the dashboard).
 */
export async function downloadCocPdf(job: Job, driver: DriverContact | null, pod: PodFix[] = []) {
  const template = normalizeCocTemplate(orgCocTemplate());
  const brand = orgBrand();
  const doc = renderCocPdf(job, driver, pod, {
    brand,
    formatTime: (d) => formatUAETime(d),
    timeZoneLabel: orgTimeZone() === 'Asia/Dubai' ? 'UAE' : orgTimeZone(),
    issuedBy: window.location.host,
    template,
    logo: template.show_logo ? await loadLogo(orgLogoUrl()) : null,
  });
  doc.save(cocFileName(brand, job.job_ref));
}
