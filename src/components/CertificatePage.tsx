import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { AlertCircle, ArrowRight, CheckCircle2, Download, Loader2, MessageSquare } from 'lucide-react';
import { orgBrand, orgDispatchNumber, orgLogoUrl, setOrg } from '@/src/lib/org';
import { formatUAETime } from '@/src/lib/utils';
import { downloadCocPdf } from '@/src/lib/cocPdf';
import { getCertificate, type CertificateData } from '@/src/lib/certificate';

/**
 * /:token/certificate — the delivered job's Chain of Custody certificate.
 * Dispatch sends this link after delivery; unlike the tracking page it never
 * closes. The PDF is drawn here from get_certificate (no codes, no phone).
 */

const wa = (p: string, text: string) => `https://wa.me/${p.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
const short = (s?: string | null) => (s || '').split(',')[0].trim();

export default function CertificatePage() {
  const { token } = useParams<{ token: string }>();
  const [data, setData] = useState<CertificateData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    getCertificate(token)
      .then((d) => {
        if (!d) { setError('This certificate isn’t available. It appears once the delivery is complete.'); return; }
        setOrg(d.org);
        setData(d);
        document.title = `${orgBrand()} certificate ${d.job.job_ref ?? ''}`.trim();
      })
      .catch(() => setError('We couldn’t load the certificate. Check your connection and try again.'));
  }, [token]);

  if (error) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center p-4">
        <div className="nokael-card max-w-md w-full text-center space-y-4 py-10">
          <AlertCircle className="w-10 h-10 text-amber-500 mx-auto" />
          <p className="text-nokael-text-main">{error}</p>
          <a href={wa(orgDispatchNumber(), `Hi ${orgBrand()}, I need my delivery certificate.`)} target="_blank" rel="noopener noreferrer" className="nokael-button gap-2 no-underline">
            <MessageSquare className="w-5 h-5" /> WhatsApp dispatch
          </a>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="min-h-[100dvh] flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-nokael-primary" />
      </div>
    );
  }

  const { job } = data;
  const brand = orgBrand();
  const deliveredAt = job.client_delivery_at || job.driver_delivery_at;
  const download = async () => {
    setBusy(true);
    try { await downloadCocPdf(job, data.driver, data.pod || []); } finally { setBusy(false); }
  };

  return (
    <div className="min-h-[100dvh] pb-[max(2rem,env(safe-area-inset-bottom))]">
      <header className="border-b border-nokael-border bg-white">
        <div className="max-w-xl mx-auto px-4 h-14 flex items-center gap-2">
          <img src={orgLogoUrl() || '/nokael-logo.jpg'} alt="" className="w-7 h-7 rounded-lg object-cover" />
          <span className="font-extrabold tracking-tight text-nokael-primary">{brand.toUpperCase()}</span>
        </div>
      </header>

      <main className="max-w-xl mx-auto px-4 pt-6 space-y-4">
        <section className="nokael-card space-y-5">
          <div className="flex items-start gap-3">
            <span className="w-11 h-11 rounded-xl bg-nokael-success/10 flex items-center justify-center shrink-0">
              <CheckCircle2 className="w-6 h-6 text-nokael-success" />
            </span>
            <div className="min-w-0">
              <p className="info-label">Chain of Custody certificate</p>
              <h1 className="text-xl font-bold text-nokael-primary">Job {job.job_ref}</h1>
              {deliveredAt && <p className="text-[13px] text-nokael-text-muted">Delivered {formatUAETime(deliveredAt)}</p>}
            </div>
          </div>

          <div className="rounded-xl border border-nokael-border px-4 py-3 flex items-center gap-3 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block text-[11px] uppercase tracking-wide text-nokael-text-muted">From</span>
              <span className="block font-semibold text-nokael-primary truncate">{short(job.pickup_location)}</span>
            </span>
            <ArrowRight className="w-4 h-4 text-nokael-text-muted shrink-0" />
            <span className="min-w-0 flex-1 text-right">
              <span className="block text-[11px] uppercase tracking-wide text-nokael-text-muted">To</span>
              <span className="block font-semibold text-nokael-primary truncate">{short(job.delivery_location)}</span>
            </span>
          </div>

          <p className="text-[13px] text-nokael-text-muted">Every handover, time-stamped and verified. Keep this link: it stays available.</p>

          <button onClick={download} disabled={busy} className="nokael-button gap-2 !bg-nokael-success disabled:opacity-60">
            {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5" />} Download certificate (PDF)
          </button>
        </section>
      </main>
    </div>
  );
}
