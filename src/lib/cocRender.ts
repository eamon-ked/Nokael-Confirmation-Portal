import { jsPDF } from 'jspdf';

// ==========================================
// Chain of Custody certificate — renderer
// ==========================================
// The one place the certificate is drawn. This file is a verbatim copy of
// nokael-concierge-V2/src/lib/cocRender.ts (the original) — edit there,
// then copy it here. It imports nothing app-specific: each app passes
// its own brand, clock and the company's template (organizations.settings.coc,
// edited in Dashboard → Settings → COC certificate).

export interface CocTemplate {
  /** Line under the company name in the header band. */
  title: string;
  /** Legal name, licence / TRN, address — printed under the header. Blank = none. */
  company_details: string;
  header_color: string;
  accent_color: string;
  /** Print branding.logo_url in the header instead of the company name. */
  show_logo: boolean;
  show_vehicle: boolean;
  show_gps: boolean;
  show_transit_time: boolean;
  /** Small print at the foot of the page. One line per line. */
  footer_note: string;
}

export const DEFAULT_COC_TEMPLATE: CocTemplate = {
  title: 'CHAIN OF CUSTODY CERTIFICATE',
  company_details: '',
  header_color: '#0f172a',
  accent_color: '#0369A1',
  show_logo: false,
  show_vehicle: true,
  show_gps: true,
  show_transit_time: true,
  footer_note:
    'Each handover was confirmed with a single-use code held by the party receiving custody.\n' +
    "GPS is the driver's phone position when the handover was confirmed.",
};

const HEX = /^#[0-9a-f]{6}$/i;

/** Saved template (any shape, possibly partial or old) → a complete, safe one. */
export function normalizeCocTemplate(raw: unknown): CocTemplate {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const d = DEFAULT_COC_TEMPLATE;
  const str = (k: keyof CocTemplate, max: number) =>
    typeof r[k] === 'string' ? (r[k] as string).slice(0, max) : (d[k] as string);
  const bool = (k: keyof CocTemplate) => (typeof r[k] === 'boolean' ? (r[k] as boolean) : (d[k] as boolean));
  const color = (k: keyof CocTemplate) => (typeof r[k] === 'string' && HEX.test(r[k] as string) ? (r[k] as string) : (d[k] as string));
  return {
    title: str('title', 60).trim() || d.title,
    company_details: str('company_details', 300),
    header_color: color('header_color'),
    accent_color: color('accent_color'),
    show_logo: bool('show_logo'),
    show_vehicle: bool('show_vehicle'),
    show_gps: bool('show_gps'),
    show_transit_time: bool('show_transit_time'),
    footer_note: str('footer_note', 400),
  };
}

/** The job fields the certificate prints. */
export interface CocJobData {
  job_ref?: string | null;
  status: string;
  sender_name: string;
  company_name?: string | null;
  recipient_name: string;
  pickup_location: string;
  pickup_emirate: string;
  delivery_location: string;
  delivery_emirate: string;
  pickup_lat?: number | null;
  pickup_lng?: number | null;
  delivery_lat?: number | null;
  delivery_lng?: number | null;
  item_type: string;
  urgency: string;
  created_at?: string | null;
  sender_ready_at?: string | null;
  driver_arrived_pickup_at?: string | null;
  driver_pickup_at?: string | null;
  client_pickup_at?: string | null;
  driver_arrived_delivery_at?: string | null;
  driver_delivery_at?: string | null;
  client_delivery_at?: string | null;
  /** Multi-stop / round trip: every stop in order. One-way jobs leave it out. */
  job_kind?: string | null;
  stops?: CocStop[] | null;
  /** Waiting at each point (job_waits); only finished waits are printed. */
  waits?: CocWait[] | null;
}

/** Driver waiting at a pickup / drop-off / stop, as the certificate prints it. */
export interface CocWait {
  leg: 'pickup' | 'dropoff' | 'stop';
  seq: number;
  stop_id?: string | null;
  ended_at?: string | null;
  wait_min?: number | null;
  free_min: number;
  /** Charge (the client link sends the final amount; the dashboard row also has adjusted_charge_aed). */
  charge_aed?: number | null;
  adjusted_charge_aed?: number | null;
  currency?: string | null;
  waived?: boolean | null;
}

/** Final charge after any dispatch adjustment, and whether it was waived. */
const finalCharge = (w: CocWait) => Number(w.adjusted_charge_aed ?? w.charge_aed ?? 0);
const isWaived = (w: CocWait) => w.waived ?? (w.adjusted_charge_aed === 0 && Number(w.charge_aed ?? 0) > 0);

const cocMoney = (n: number, currency?: string | null) =>
  `${(currency || 'AED').toUpperCase()} ${Number.isInteger(n) ? n : n.toFixed(2)}`;

/** "Driver waited 22 min (15 free) · AED 25"; '' when nothing to say. */
const waitNote = (w: CocWait | undefined): string => {
  if (!w || !w.ended_at || w.wait_min == null) return '';
  const charge = finalCharge(w);
  return `Driver waited ${w.wait_min} min (${w.free_min} free)${isWaived(w) ? ' · waiting waived' : charge > 0 ? ` · waiting charge ${cocMoney(charge, w.currency)}` : ''}`;
};

/** A stop of a multi-stop or round-trip job, as the certificate prints it. */
export interface CocStop {
  id?: string;
  seq: number;
  kind: 'pickup' | 'drop';
  address: string;
  emirate?: string | null;
  contact_name?: string | null;
  company?: string | null;
  item_note?: string | null;
  lat?: number | null;
  lng?: number | null;
  arrived_at?: string | null;
  handed_at?: string | null;
  method?: 'otp' | 'ops_override' | null;
  /** Dispatch ended the job before this stop. */
  skipped_at?: string | null;
}

export interface DriverContact {
  full_name: string | null;
  phone: string | null;
  vehicle_type: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
}

/** One confirmed custody step with the driver's GPS fix. */
export interface PodFix {
  step: 'client_pickup' | 'driver_pickup' | 'driver_delivery' | 'client_delivery' | 'stop_handover';
  method: 'otp' | 'ops_override';
  /** stop_handover rows: which stop. */
  stop_id?: string | null;
  driver_lat: number | null;
  driver_lng: number | null;
  accuracy_m: number | null;
  fix_age_s: number | null;
  confirmed_at: string;
}

export interface CocContext {
  brand: string;
  /** Formats a timestamp in the company's time zone. */
  formatTime: (d: string | Date) => string;
  /** Shown after "Issued", e.g. "UAE" or "Africa/Kampala". */
  timeZoneLabel: string;
  /** Last footer segment, e.g. "issued by Nokael dispatch" or the portal host. */
  issuedBy: string;
  template: CocTemplate;
  /** Logo already loaded as a data URL (see loadLogo). */
  logo?: { dataUrl: string; width: number; height: number } | null;
  /** "Send with us" line above the footer (see cocPromo); omitted when null. */
  promo?: CocPromo | null;
}

export interface CocPromo {
  text: string;
  /** Where the line links to in the PDF. */
  url: string | null;
}

/** +971 50 971 0446 for UAE mobiles, else +<digits>. */
const displayPhone = (digits: string) =>
  /^9715\d{8}$/.test(digits)
    ? `+971 ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`
    : `+${digits}`;

/**
 * The promo line every certificate carries, so whoever receives one knows how
 * to send something the same way. `site` is a bare domain ("nokael.com");
 * `whatsapp` is the dispatch number's digits. null when neither is known.
 */
export function cocPromo(brand: string, site: string | null | undefined, whatsapp: string | null | undefined): CocPromo | null {
  const wa = (whatsapp ?? '').replace(/\D/g, '');
  const parts = [site || null, wa.length >= 7 ? `WhatsApp ${displayPhone(wa)}` : null].filter(Boolean);
  if (!parts.length) return null;
  return {
    text: `Need something delivered with proof? Send with ${brand}  ·  ${parts.join('  ·  ')}`,
    url: site ? `https://${site}` : `https://wa.me/${wa}`,
  };
}

const metersBetween = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const rad = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(rad(bLat - aLat) / 2) ** 2 +
    Math.cos(rad(aLat)) * Math.cos(rad(bLat)) * Math.sin(rad(bLng - aLng) / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.sqrt(h));
};

/** The fix for a handover: the driver's own confirmation first, else the client's. */
const fixFor = (pod: PodFix[], steps: PodFix['step'][]) =>
  steps.map((s) => pod.find((p) => p.step === s)).find(Boolean) ?? null;

/**
 * Fetches a logo for the header. Returns null when it can't be read (no URL,
 * blocked by CORS, not an image) — the header then shows the company name.
 */
const logoCache = new Map<string, Promise<CocContext['logo']>>();

export function loadLogo(url: string | null | undefined): Promise<CocContext['logo']> {
  if (!url) return Promise.resolve(null);
  if (!logoCache.has(url)) logoCache.set(url, fetchLogo(url));
  return logoCache.get(url)!;
}

async function fetchLogo(url: string): Promise<CocContext['logo']> {
  try {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) return null;
    const blob = await res.blob();
    if (!blob.type.startsWith('image/')) return null;
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(String(fr.result));
      fr.onerror = reject;
      fr.readAsDataURL(blob);
    });
    // Raster via canvas so SVG/WebP logos also work in jsPDF.
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const w = img.naturalWidth || 300;
    const h = img.naturalHeight || 100;
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
    return { dataUrl: canvas.toDataURL('image/png'), width: w, height: h };
  } catch {
    return null;
  }
}

/** "Abu Dhabi, …, Abu Dhabi" → the address once; the emirate only when it's not already in it. */
const withEmirate = (address: string, emirate?: string | null) =>
  !emirate || address.toLowerCase().includes(emirate.toLowerCase()) ? address : `${address}, ${emirate}`;

/** "same_day" → "Same Day". */
const titleCase = (s: string) => s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());

const duration = (mins: number) =>
  mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : mins < 1 ? '< 1 min' : `${mins} min`;

/**
 * Draws the certificate. No OTPs are ever printed.
 *
 * Reading order: who issued it and for which job (header) → did it arrive
 * (status) → the three numbers people ask about (custody time, waiting,
 * verified handovers) → from / to → what and who → the timeline as evidence.
 * Every block is measured before it is drawn, so long addresses wrap instead
 * of being cut, and the footer is anchored to the bottom of every page with
 * content breaking to a new page above it.
 */
export function renderCocPdf(job: CocJobData, driver: DriverContact | null, pod: PodFix[], ctx: CocContext): jsPDF {
  const tpl = ctx.template;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ink = '#0f172a';
  const body = '#334155';
  const muted = '#64748b';
  const line = '#e2e8f0';
  const panel = '#f8fafc';
  const accent = tpl.accent_color;
  const success = '#059669';
  const warn = '#b45309';
  const W = 210;
  const H = 297;
  const M = 18;
  const CW = W - 2 * M;
  const brand = ctx.brand;
  const PT = 0.3528; // mm per pt
  const lh = (size: number) => size * PT * 1.35; // line height in mm

  const font = (size: number, style: 'normal' | 'bold' = 'normal', color = ink) => {
    doc.setFont('helvetica', style);
    doc.setFontSize(size);
    doc.setTextColor(color);
  };
  /** Wrap at the current font. */
  const wrap = (text: string, width: number): string[] => doc.splitTextToSize(text || '—', width);
  /** Draws lines from a baseline, returns the height used. */
  const lines = (ls: string[], x: number, y: number, size: number, opts?: { align?: 'right' | 'center' }) => {
    ls.forEach((l, i) => doc.text(l, x, y + i * lh(size), opts));
    return ls.length * lh(size);
  };
  const label = (text: string, x: number, y: number, color = muted) => {
    font(7, 'bold', color);
    doc.setCharSpace(0.25);
    doc.text(text.toUpperCase(), x, y);
    doc.setCharSpace(0);
  };

  const stops = job.job_kind && job.job_kind !== 'one_way' ? [...(job.stops ?? [])].sort((a, b) => a.seq - b.seq) : [];
  const multi = stops.length > 0;
  const roundTrip = job.job_kind === 'round_trip';
  const completed = job.status === 'completed';

  // ── Footer (measured first: content must stop above it on every page) ──
  font(7.5);
  const note: string[] = tpl.footer_note.trim()
    ? tpl.footer_note.trim().split('\n').flatMap((l) => wrap(l, CW)).slice(0, 4)
    : [];
  const refY = H - 10;
  const noteTop = refY - 5 - note.length * lh(7.5);
  const promoY = noteTop - 1;
  const footerTop = (ctx.promo ? promoY - 5 : noteTop) - 3;
  const bottom = footerTop - 6;

  // ── Header band ──
  const headerH = 34;
  const drawHeader = (continued: boolean) => {
    doc.setFillColor(tpl.header_color);
    doc.rect(0, 0, W, continued ? 16 : headerH, 'F');
    if (continued) {
      font(8, 'bold', '#ffffff');
      doc.text(`${brand.toUpperCase()}  ·  ${tpl.title.toUpperCase()}`, M, 10);
      doc.text(`${job.job_ref ?? ''} (continued)`, W - M, 10, { align: 'right' });
      return;
    }
    if (tpl.show_logo && ctx.logo) {
      const maxH = 13, maxW = 70;
      const scale = Math.min(maxH / ctx.logo.height, maxW / ctx.logo.width);
      doc.addImage(ctx.logo.dataUrl, 'PNG', M, 7, ctx.logo.width * scale, ctx.logo.height * scale);
    } else {
      font(20, 'bold', '#ffffff');
      doc.text(brand.toUpperCase(), M, 17);
    }
    font(7.5, 'bold', '#cbd5e1');
    doc.setCharSpace(0.4);
    doc.text(tpl.title.toUpperCase(), M, 27);
    doc.text('JOB REF', W - M, 11, { align: 'right' });
    doc.setCharSpace(0);
    font(15, 'bold', '#ffffff');
    doc.text(job.job_ref ?? '—', W - M, 18.5, { align: 'right' });
    font(7.5, 'normal', '#cbd5e1');
    doc.text(`Issued ${ctx.formatTime(new Date())} (${ctx.timeZoneLabel})`, W - M, 27, { align: 'right' });
  };
  drawHeader(false);

  let y = headerH + 7;
  /** Starts a new page when `need` mm don't fit above the footer. */
  const ensure = (need: number) => {
    if (y + need <= bottom) return;
    doc.addPage();
    drawHeader(true);
    y = 26;
  };

  const details = tpl.company_details.trim();
  if (details) {
    font(7.5, 'normal', muted);
    const ls = details.split('\n').flatMap((l) => wrap(l, CW)).slice(0, 4);
    y += lines(ls, M, y - 2, 7.5) + 3;
  }

  // ── Handover facts, used by the summary and the timeline ──
  const pickupFix = fixFor(pod, ['driver_pickup', 'client_pickup']);
  const deliveryFix = fixFor(pod, ['driver_delivery', 'client_delivery']);
  const pickedAt = job.driver_pickup_at || job.client_pickup_at;
  const deliveredAt = job.client_delivery_at || job.driver_delivery_at;
  const stopFix = (st: CocStop) => pod.find((p) => p.step === 'stop_handover' && p.stop_id === st.id) ?? null;
  const waits = (job.waits ?? []).filter((w) => w.ended_at);
  const legWait = (leg: CocWait['leg'], stopId?: string) =>
    waits.find((w) => (stopId ? w.stop_id === stopId : w.leg === leg && !w.stop_id));

  const handovers = multi
    ? stops.filter((st) => !(st.skipped_at && !st.handed_at)).map((st) => ({
        at: st.handed_at, override: stopFix(st)?.method === 'ops_override' || st.method === 'ops_override',
      }))
    : [
        { at: pickedAt, override: pickupFix?.method === 'ops_override' },
        { at: deliveredAt, override: deliveryFix?.method === 'ops_override' },
      ];
  const handed = handovers.filter((h) => h.at);
  const overrides = handed.filter((h) => h.override).length;

  // ── Status ──
  const lastAt = multi ? [...stops].reverse().find((st) => st.handed_at)?.handed_at : deliveredAt;
  const statusTitle = completed
    ? multi ? `${roundTrip ? 'Round trip' : `All ${stops.length} stops`} done — custody chain complete` : 'Delivered — custody chain complete'
    : `In progress — ${titleCase(job.status)}`;
  const statusSub = completed && lastAt
    ? `${multi ? 'Last handover' : 'Handed to the recipient'} ${ctx.formatTime(lastAt)}`
    : `${handed.length} of ${handovers.length} handovers confirmed so far`;
  doc.setFillColor(completed ? '#ecfdf5' : '#f1f5f9');
  doc.roundedRect(M, y, CW, 15, 2.5, 2.5, 'F');
  const cx = M + 8.5, cy = y + 7.5;
  doc.setFillColor(completed ? success : accent);
  doc.circle(cx, cy, 3.6, 'F');
  doc.setDrawColor('#ffffff');
  doc.setLineWidth(0.7);
  if (completed) {
    doc.line(cx - 1.6, cy + 0.1, cx - 0.4, cy + 1.3);
    doc.line(cx - 0.4, cy + 1.3, cx + 1.7, cy - 1.2);
  } else {
    doc.line(cx, cy - 1.8, cx, cy);
    doc.line(cx, cy, cx + 1.4, cy + 1);
  }
  font(11, 'bold', completed ? '#047857' : ink);
  doc.text(statusTitle, M + 15, y + 6.5);
  font(8.5, 'normal', body);
  doc.text(statusSub, M + 15, y + 11.4);
  y += 15 + 4;

  // ── Summary tiles ──
  const start = multi ? stops.find((st) => st.handed_at)?.handed_at : pickedAt;
  const end = lastAt;
  const tiles: { label: string; value: string; sub: string; tone?: string }[] = [];
  if (tpl.show_transit_time && start && end) {
    const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
    tiles.push({ label: 'Time in custody', value: duration(mins), sub: multi ? 'first to last handover' : 'pickup to delivery' });
  }
  const waited = waits.filter((w) => (w.wait_min ?? 0) > 0);
  if (waited.length) {
    const mins = waited.reduce((a, w) => a + (w.wait_min ?? 0), 0);
    const charge = waited.reduce((a, w) => a + finalCharge(w), 0);
    tiles.push({
      label: 'Driver waiting',
      value: `${mins} min`,
      sub: charge > 0 ? `${cocMoney(charge, waited[0].currency)} waiting charge` : 'within free time · no charge',
      tone: charge > 0 ? warn : undefined,
    });
  }
  tiles.push({
    label: 'Handovers verified',
    value: `${handed.length} of ${handovers.length}`,
    sub: overrides ? `${overrides} confirmed by ${brand} operations` : 'each by a one-time code',
  });
  const gap = 4;
  const tw = (CW - gap * (tiles.length - 1)) / tiles.length;
  tiles.forEach((t, i) => {
    const x = M + i * (tw + gap);
    doc.setFillColor(panel);
    doc.setDrawColor(line);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, tw, 19, 2, 2, 'FD');
    label(t.label, x + 4.5, y + 5.5);
    font(14, 'bold', t.tone ?? ink);
    doc.text(t.value, x + 4.5, y + 12.1);
    font(7.5, 'normal', t.tone ?? muted);
    doc.text(wrap(t.sub, tw - 9)[0], x + 4.5, y + 16.2);
  });
  y += 19 + 6;

  // ── From / To ──
  const cardW = (CW - 8) / 2;
  const inner = cardW - 10;
  type Block = { label: string; name: string; sub?: string | null; address?: string };
  const measure = (b: Block) => {
    font(11, 'bold'); const n = wrap(b.name, inner);
    font(8.5); const s = b.sub ? wrap(b.sub, inner) : [];
    font(9); const a = b.address ? wrap(b.address, inner) : [];
    return { n, s, a, h: 7 + n.length * lh(11) + s.length * lh(8.5) + (a.length ? 1.5 + a.length * lh(9) : 0) + 3 };
  };
  const card = (b: Block, m: ReturnType<typeof measure>, x: number, h: number) => {
    doc.setDrawColor(line);
    doc.setLineWidth(0.25);
    doc.roundedRect(x, y, cardW, h, 2, 2, 'S');
    label(b.label, x + 5, y + 5.5);
    let yy = y + 10.8;
    font(11, 'bold'); yy += lines(m.n, x + 5, yy, 11);
    if (m.s.length) { font(8.5, 'normal', muted); yy += lines(m.s, x + 5, yy, 8.5); }
    if (m.a.length) { font(9, 'normal', body); lines(m.a, x + 5, yy + 1, 9); }
  };
  const pair = (a: Block, b: Block, arrow: boolean) => {
    const ma = measure(a), mb = measure(b);
    const h = Math.max(ma.h, mb.h);
    ensure(h);
    card(a, ma, M, h);
    card(b, mb, M + cardW + 8, h);
    if (arrow) {
      // A small arrow between the cards (Helvetica has no → glyph).
      const ax = M + cardW + 4, ay = y + h / 2;
      doc.setDrawColor(muted);
      doc.setLineWidth(0.4);
      doc.line(ax - 2, ay, ax + 2, ay);
      doc.line(ax + 0.6, ay - 1.3, ax + 2, ay);
      doc.line(ax + 0.6, ay + 1.3, ax + 2, ay);
    }
    y += h + 4;
  };

  if (multi) {
    pair(
      { label: 'Client', name: job.company_name || job.sender_name, sub: job.company_name ? job.sender_name : null },
      { label: 'Route', name: `${stops.length} stops${roundTrip ? ' · round trip' : ''}`, sub: `${stops.filter((s) => s.kind === 'pickup').length} pickup · ${stops.filter((s) => s.kind === 'drop').length} drop-off` },
      false,
    );
  } else {
    pair(
      { label: 'From · sender', name: job.sender_name, sub: job.company_name, address: withEmirate(job.pickup_location, job.pickup_emirate) },
      { label: 'To · recipient', name: job.recipient_name, address: withEmirate(job.delivery_location, job.delivery_emirate) },
      true,
    );
  }

  // ── Item / service / driver ──
  const vehicle = driver && tpl.show_vehicle ? [driver.vehicle_make, driver.vehicle_model, driver.vehicle_plate].filter(Boolean).join(' ') : '';
  const facts: [string, string, string?][] = [
    ['Item', titleCase(job.item_type || '—')],
    ['Service', titleCase(job.urgency || '—')],
    ['Driver', driver?.full_name || `${brand} courier`, vehicle],
  ];
  const fw = CW / 3;
  ensure(16);
  facts.forEach(([l, v, s], i) => {
    const x = M + i * fw;
    label(l, x, y + 3);
    font(10, 'bold');
    doc.text(wrap(v, fw - 4)[0], x, y + 8.5);
    if (s) { font(8.5, 'normal', muted); doc.text(wrap(s, fw - 4)[0], x, y + 12.6); }
  });
  y += 15;

  // ── Stops (multi-stop) ──
  if (multi) {
    ensure(12);
    label('Stops', M, y);
    y += 5;
    stops.forEach((st) => {
      const who = st.contact_name || st.company;
      font(9, 'normal', body);
      const ls = wrap(`${st.kind === 'pickup' ? 'Pickup' : 'Drop-off'} — ${withEmirate(st.address, st.emirate)}${who ? ` (${who})` : ''}${st.item_note ? ` · ${st.item_note}` : ''}`, CW - 8);
      ensure(ls.length * lh(9) + 1.5);
      font(9, 'bold');
      doc.text(`${st.seq}.`, M, y);
      font(9, 'normal', body);
      y += lines(ls, M + 6, y, 9) + 1.5;
    });
    y += 4;
  }

  // ── Timeline ──
  ensure(22);
  doc.setDrawColor(line);
  doc.setLineWidth(0.25);
  doc.line(M, y, W - M, y);
  y += 7.5;
  font(12, 'bold');
  doc.text('Custody timeline', M, y);
  y += 7;

  const verifiedBy = (fix: PodFix | null, codeText: string) =>
    fix?.method === 'ops_override' ? `Confirmed by ${brand} operations` : codeText;
  type Event = { label: string; at?: string | null; note: string; fix?: PodFix | null; address?: [number | null | undefined, number | null | undefined]; skipped?: boolean; wait?: CocWait };
  const events: Event[] = multi ? [
    { label: 'Job booked', at: job.created_at, note: `Manifest logged with ${brand} dispatch` },
    ...stops.map((st): Event => {
      const fix = stopFix(st);
      const who = st.contact_name || st.company;
      const arrived = st.arrived_at ? ` · driver arrived ${ctx.formatTime(st.arrived_at)}` : '';
      if (st.skipped_at && !st.handed_at) {
        return {
          label: `Stop ${st.seq} · Not visited${who ? ` (${who})` : ''}`,
          at: null,
          note: `${st.address} · Job ended by ${brand} dispatch before this stop`,
          skipped: true,
        };
      }
      return {
        label: `Stop ${st.seq} · ${st.kind === 'pickup' ? 'Custody to driver' : 'Custody to recipient'}${who ? ` (${who})` : ''}`,
        at: st.handed_at,
        note: `${st.address}${arrived} · ${fix?.method === 'ops_override' || st.method === 'ops_override'
          ? `Confirmed by ${brand} operations` : 'Verified by one-time code'}`,
        fix,
        address: [st.lat, st.lng],
        wait: st.id ? legWait('stop', st.id) : undefined,
      };
    }),
  ] : [
    { label: 'Job booked', at: job.created_at, note: `Manifest logged with ${brand} dispatch` },
    { label: 'Package ready at origin', at: job.sender_ready_at, note: 'Sender confirmed package prepared' },
    { label: 'Driver arrived at pickup', at: job.driver_arrived_pickup_at, note: withEmirate(job.pickup_location, job.pickup_emirate), wait: legWait('pickup') },
    {
      label: 'Custody transferred to driver',
      at: pickedAt,
      note: verifiedBy(pickupFix, 'Handover verified by one-time code'),
      fix: pickupFix,
      address: [job.pickup_lat, job.pickup_lng],
    },
    { label: 'Driver arrived at destination', at: job.driver_arrived_delivery_at, note: withEmirate(job.delivery_location, job.delivery_emirate), wait: legWait('dropoff') },
    {
      label: 'Custody transferred to recipient',
      at: deliveredAt,
      note: verifiedBy(deliveryFix, 'Receipt verified by one-time code'),
      fix: deliveryFix,
      address: [job.delivery_lat, job.delivery_lng],
    },
  ];

  const textX = M + 8;
  const timeW = 42;
  const textW = CW - 8 - timeW - 4;
  events.forEach((e, i) => {
    const done = Boolean(e.at);
    // Measure the row.
    font(10, 'bold'); const head = wrap(e.label, textW);
    font(8.5); const noteLs = wrap(e.note, textW);
    const wn = waitNote(e.wait);
    const charged = e.wait ? finalCharge(e.wait) > 0 && !isWaived(e.wait) : false;
    const waitLs = wn ? wrap(wn, textW) : [];
    const f = e.at && tpl.show_gps ? e.fix : null;
    const gps = f && f.driver_lat != null && f.driver_lng != null ? f : null;
    const rowH = head.length * lh(10) + (noteLs.length + waitLs.length + (gps ? 1 : 0)) * lh(8.5) + 4;
    ensure(rowH);

    // Dot and the line down to the next event.
    doc.setFillColor(done ? success : '#cbd5e1');
    doc.circle(M + 2, y - 1.2, 1.7, 'F');
    if (i < events.length - 1) {
      doc.setDrawColor(done ? '#a7f3d0' : line);
      doc.setLineWidth(0.5);
      doc.line(M + 2, y + 1.2, M + 2, y + rowH - 3.6);
    }

    font(10, done ? 'bold' : 'normal', done ? ink : muted);
    let yy = y + lines(head, textX, y, 10);
    font(8.5, done ? 'bold' : 'normal', done ? body : muted);
    doc.text(done ? ctx.formatTime(e.at!) : e.skipped ? 'Not visited' : 'Not recorded', W - M, y, { align: 'right' });
    font(8.5, 'normal', muted);
    yy += lines(noteLs, textX, yy, 8.5);
    if (waitLs.length) {
      font(8.5, charged ? 'bold' : 'normal', charged ? warn : body);
      yy += lines(waitLs, textX, yy, 8.5);
    }
    // Where the handover happened, as a tappable map link.
    if (gps) {
      const coords = `GPS ${gps.driver_lat!.toFixed(5)}, ${gps.driver_lng!.toFixed(5)}`;
      const [aLat, aLng] = e.address ?? [null, null];
      const off = aLat != null && aLng != null ? metersBetween(gps.driver_lat!, gps.driver_lng!, aLat, aLng) : null;
      const extra = [
        gps.accuracy_m != null ? `±${Math.round(gps.accuracy_m)} m` : null,
        off != null ? (off < 1000 ? `${Math.round(off)} m from booked address` : `${(off / 1000).toFixed(1)} km from booked address`) : null,
      ].filter(Boolean).join(' · ');
      font(8.5, 'normal', accent);
      doc.textWithLink(coords, textX, yy, { url: `https://maps.google.com/?q=${gps.driver_lat},${gps.driver_lng}` });
      if (extra) {
        font(8.5, 'normal', muted);
        doc.text(`  ·  ${extra}`, textX + doc.getTextWidth(coords), yy);
      }
    }
    y += rowH;
  });

  // ── Footer on every page ──
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.setDrawColor(line);
    doc.setLineWidth(0.25);
    doc.line(M, footerTop, W - M, footerTop);
    if (ctx.promo) {
      font(8.5, 'bold', accent);
      const promo = wrap(ctx.promo.text, CW)[0];
      doc.text(promo, W / 2, promoY, { align: 'center' });
      if (ctx.promo.url) {
        const w = doc.getTextWidth(promo);
        doc.link(W / 2 - w / 2, promoY - 3.5, w, 5, { url: ctx.promo.url });
      }
    }
    font(7.5, 'normal', muted);
    lines(note, W / 2, noteTop + lh(7.5), 7.5, { align: 'center' });
    doc.text(`${brand} Chain of Custody · ${job.job_ref ?? ''} · ${ctx.issuedBy}${pages > 1 ? ` · page ${p} of ${pages}` : ''}`, W / 2, refY, { align: 'center' });
  }
  doc.setPage(pages);

  return doc;
}

export const cocFileName = (brand: string, jobRef?: string | null) =>
  `${brand.replace(/[^A-Za-z0-9]+/g, '-')}-COC-${jobRef ?? 'job'}.pdf`;

/** A finished job with every step recorded — what the Settings preview prints. */
export const SAMPLE_COC_JOB: CocJobData = (() => {
  const t0 = Date.now() - 3 * 3600_000;
  const at = (min: number) => new Date(t0 + min * 60_000).toISOString();
  return {
    job_ref: 'SAMPLE-0001',
    status: 'completed',
    sender_name: 'Aisha Rahman',
    company_name: 'Example Legal LLP',
    recipient_name: 'Omar Haddad',
    pickup_location: 'Gate Village 3, DIFC',
    pickup_emirate: 'Dubai',
    delivery_location: 'Al Maryah Island, ADGM',
    delivery_emirate: 'Abu Dhabi',
    pickup_lat: 25.2116, pickup_lng: 55.2797,
    delivery_lat: 24.5005, delivery_lng: 54.3896,
    item_type: 'documents',
    urgency: 'immediate',
    created_at: at(0),
    sender_ready_at: at(8),
    driver_arrived_pickup_at: at(31),
    driver_pickup_at: at(34),
    driver_arrived_delivery_at: at(132),
    client_delivery_at: at(136),
  };
})();

export const SAMPLE_COC_DRIVER: DriverContact = {
  full_name: 'Sample Driver', phone: null, vehicle_type: 'sedan',
  vehicle_make: 'Toyota', vehicle_model: 'Camry', vehicle_plate: 'D 12345',
};

export const SAMPLE_COC_POD: PodFix[] = [
  { step: 'driver_pickup', method: 'otp', driver_lat: 25.21171, driver_lng: 55.27985, accuracy_m: 9, fix_age_s: 4, confirmed_at: SAMPLE_COC_JOB.driver_pickup_at! },
  { step: 'client_delivery', method: 'otp', driver_lat: 24.50061, driver_lng: 54.38971, accuracy_m: 12, fix_age_s: 6, confirmed_at: SAMPLE_COC_JOB.client_delivery_at! },
];
