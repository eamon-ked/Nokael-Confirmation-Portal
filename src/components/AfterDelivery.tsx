import { useEffect, useState } from 'react';
import { CheckCircle2, Download, Loader2, MessageSquare, Share, Smartphone, Star } from 'lucide-react';
import { orgBrand, orgDispatchNumber, useOrgForToken } from '@/src/lib/org';
import {
  LEAD_SOURCES,
  type LeadSource,
  appUrl,
  getFeedback,
  hasInstallPrompt,
  isIOS,
  isStandalone,
  issueAppToken,
  markReviewClicked,
  promptInstall,
  setAppManifest,
  store,
  submitFeedback,
} from '@/src/lib/clientApp';

/**
 * Shown on the tracking page once a job is completed, for sender and
 * recipient alike: a 3-question survey (stars, where they heard of us,
 * comment) and an "install the app" card that re-books in two taps.
 *
 * `staff` (the dashboard's ?staff=1 preview) renders everything but writes
 * nothing, so dispatch checking the page doesn't create feedback or tokens.
 */
export default function AfterDelivery({ token, staff }: { token: string; staff: boolean }) {
  const org = useOrgForToken(token);
  const reviewUrl = org?.branding.google_review_url?.trim() || '';

  // ---- survey ----
  const doneKey = `nokael_feedback_${token}`;
  const [rating, setRating] = useState(0);
  const [source, setSource] = useState<LeadSource | null>(null);
  const [other, setOther] = useState('');
  const [comment, setComment] = useState('');
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState<number | null>(() => Number(store.get(doneKey)) || null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (staff) return;
    getFeedback(token).then((f) => {
      if (f?.rating) { setSent(f.rating); store.set(doneKey, String(f.rating)); }
    });
  }, [token, staff, doneKey]);

  const send = async () => {
    if (!rating || sending) return;
    if (staff) { setSent(rating); return; }
    setSending(true);
    setError(null);
    try {
      await submitFeedback(token, { rating, leadSource: source, other: source === 'other' ? other : undefined, comment });
      store.set(doneKey, String(rating));
      setSent(rating);
    } catch {
      setError('Could not send that just now. Please try again.');
    } finally {
      setSending(false);
    }
  };

  const openReview = () => {
    if (!staff) markReviewClicked(token);
    window.open(reviewUrl, '_blank', 'noopener,noreferrer');
  };

  // ---- install ----
  const [appToken, setAppToken] = useState<string | null>(null);
  const [canPrompt, setCanPrompt] = useState(hasInstallPrompt);
  const [installed, setInstalled] = useState(false);
  const dismissKey = 'nokael_app_install_dismissed';
  const [dismissed, setDismissed] = useState(() => !!store.get(dismissKey));

  useEffect(() => {
    if (staff) return;
    issueAppToken(token).then((t) => {
      if (!t) return;
      setAppToken(t);
      // Install from this page should open the re-booking app, not this link.
      setAppManifest(t);
    });
  }, [token, staff]);

  useEffect(() => {
    const ready = () => setCanPrompt(true);
    window.addEventListener('nokael_pwa_prompt_ready', ready);
    return () => window.removeEventListener('nokael_pwa_prompt_ready', ready);
  }, []);

  const install = async () => {
    if (canPrompt && (await promptInstall())) { setInstalled(true); return; }
    // iOS (and browsers without the prompt) add the *current* page to the
    // home screen, so send them to the app page and show the steps there.
    if (appToken) window.location.href = `${appUrl(appToken)}?install=1`;
  };

  const showInstall = !isStandalone() && !dismissed && (staff || !!appToken);
  const brand = orgBrand();

  return (
    <>
      <section className="nokael-card space-y-4">
        {sent ? (
          <div className="space-y-3 text-center py-1">
            <CheckCircle2 className="w-8 h-8 text-nokael-success mx-auto" />
            <p className="font-semibold text-nokael-primary">Thank you for the feedback!</p>
            {sent >= 4 && reviewUrl ? (
              <>
                <p className="text-[13px] text-nokael-text-muted">
                  Glad it went well. A quick Google review helps other people find {brand}.
                </p>
                <button onClick={openReview} className="nokael-button gap-2">
                  <Star className="w-5 h-5 fill-current" /> Leave a Google review
                </button>
              </>
            ) : sent <= 3 ? (
              <>
                <p className="text-[13px] text-nokael-text-muted">
                  Sorry it wasn't perfect. Tell dispatch what happened and we'll put it right.
                </p>
                <a
                  href={`https://wa.me/${orgDispatchNumber()}?text=${encodeURIComponent(`Hi ${brand}, I'd like to give some feedback on my delivery.`)}`}
                  target="_blank" rel="noopener noreferrer"
                  className="nokael-button gap-2 no-underline"
                >
                  <MessageSquare className="w-5 h-5" /> Message dispatch
                </a>
              </>
            ) : null}
          </div>
        ) : (
          <>
            <div>
              <p className="font-semibold text-nokael-primary">How did we do?</p>
              <p className="text-[13px] text-nokael-text-muted">Three quick taps. It really helps.</p>
            </div>

            <div className="flex justify-center gap-2" role="radiogroup" aria-label="Rating">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} star${n > 1 ? 's' : ''}`}
                  onClick={() => setRating(n)}
                  className="p-1.5 active:scale-90 transition-transform"
                >
                  <Star className={`w-9 h-9 ${n <= rating ? 'text-amber-400 fill-amber-400' : 'text-slate-300'}`} />
                </button>
              ))}
            </div>

            {rating > 0 && (
              <>
                <div className="space-y-2">
                  <p className="info-label">Where did you hear about {brand}?</p>
                  <div className="flex flex-wrap gap-2">
                    {LEAD_SOURCES.map((s) => (
                      <button
                        key={s.value}
                        onClick={() => setSource(source === s.value ? null : s.value)}
                        className={`px-3 py-1.5 rounded-full border text-[13px] font-medium transition-colors ${
                          source === s.value
                            ? 'bg-nokael-primary border-nokael-primary text-white'
                            : 'bg-white border-nokael-border text-nokael-primary hover:bg-slate-50'
                        }`}
                      >
                        {s.label}
                      </button>
                    ))}
                  </div>
                  {source === 'other' && (
                    <input
                      value={other}
                      onChange={(e) => setOther(e.target.value)}
                      maxLength={120}
                      placeholder="Where?"
                      className="w-full rounded-xl border border-nokael-border px-3 py-2.5 text-sm"
                    />
                  )}
                </div>

                <textarea
                  value={comment}
                  onChange={(e) => setComment(e.target.value)}
                  maxLength={2000}
                  rows={2}
                  placeholder={rating >= 4 ? 'Anything you loved? (optional)' : 'What could we do better? (optional)'}
                  className="w-full rounded-xl border border-nokael-border px-3 py-2.5 text-sm resize-none"
                />

                {error && <p className="text-[13px] text-red-600">{error}</p>}
                <button onClick={send} disabled={sending} className="nokael-button gap-2 disabled:opacity-60">
                  {sending ? <Loader2 className="w-5 h-5 animate-spin" /> : null} Send feedback
                </button>
              </>
            )}
          </>
        )}
      </section>

      {showInstall && (
        <section className="nokael-card space-y-4 bg-nokael-primary text-white border-nokael-primary">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
              <Smartphone className="w-5 h-5" />
            </span>
            <div>
              <p className="font-semibold">{installed ? `${brand} is on your home screen` : `Book your next delivery in two taps`}</p>
              <p className="text-[13px] text-white/70">
                {installed
                  ? 'Open it any time to repeat this delivery or send something new.'
                  : `Add ${brand} to your home screen. Your addresses are saved, so re-booking takes seconds.`}
              </p>
            </div>
          </div>
          {!installed && (
            <div className="flex gap-2">
              <button
                onClick={install}
                className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-white text-nokael-primary font-semibold px-4 py-3 active:scale-[0.98]"
              >
                {isIOS() ? <Share className="w-4 h-4" /> : <Download className="w-4 h-4" />}
                {canPrompt ? 'Install app' : 'Get the app'}
              </button>
              <button
                onClick={() => { store.set(dismissKey, '1'); setDismissed(true); }}
                className="px-4 py-3 rounded-xl text-white/70 text-sm font-medium hover:bg-white/10"
              >
                Not now
              </button>
            </div>
          )}
        </section>
      )}
    </>
  );
}
