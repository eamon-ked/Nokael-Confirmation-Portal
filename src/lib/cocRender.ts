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
  step: 'client_pickup' | 'driver_pickup' | 'driver_delivery' | 'client_delivery';
  method: 'otp' | 'ops_override';
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

/** Draws the certificate. No OTPs are ever printed. */
export function renderCocPdf(job: CocJobData, driver: DriverContact | null, pod: PodFix[], ctx: CocContext): jsPDF {
  const tpl = ctx.template;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ink = '#0f172a';
  const muted = '#64748b';
  const accent = tpl.accent_color;
  const success = '#10b981';
  const W = 210;
  const M = 18;
  const brand = ctx.brand;

  // Header band
  doc.setFillColor(tpl.header_color);
  doc.rect(0, 0, W, 38, 'F');
  doc.setTextColor('#ffffff');
  if (tpl.show_logo && ctx.logo) {
    const maxH = 14, maxW = 70;
    const scale = Math.min(maxH / ctx.logo.height, maxW / ctx.logo.width);
    doc.addImage(ctx.logo.dataUrl, 'PNG', M, 8, ctx.logo.width * scale, ctx.logo.height * scale);
  } else {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(22);
    doc.text(brand.toUpperCase(), M, 18);
  }
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(tpl.title.toUpperCase(), M, 28);
  doc.text(`Job ref  ${job.job_ref ?? ''}`, W - M, 18, { align: 'right' });
  doc.text(`Issued  ${ctx.formatTime(new Date())} (${ctx.timeZoneLabel})`, W - M, 26, { align: 'right' });

  let y = 52;
  const details = tpl.company_details.trim();
  if (details) {
    doc.setFontSize(8);
    doc.setTextColor(muted);
    const lines = details.split('\n').flatMap((l) => doc.splitTextToSize(l, W - 2 * M)).slice(0, 4);
    doc.text(lines, M, 45);
    y = 45 + lines.length * 3.6 + 9;
  }

  const label = (text: string, x: number, yy: number) => {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7.5);
    doc.setTextColor(muted);
    doc.text(text.toUpperCase(), x, yy);
  };
  const value = (text: string, x: number, yy: number, maxW = 80) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(10.5);
    doc.setTextColor(ink);
    const lines = doc.splitTextToSize(text || '—', maxW);
    doc.text(lines, x, yy);
    return lines.length * 5;
  };

  // Status line
  const completed = job.status === 'completed';
  doc.setFillColor(completed ? '#ecfdf5' : '#f1f5f9');
  doc.roundedRect(M, y - 7, W - 2 * M, 12, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(completed ? success : accent);
  doc.text(completed ? 'DELIVERED — CUSTODY CHAIN COMPLETE' : `STATUS: ${job.status.replace(/_/g, ' ').toUpperCase()}`, M + 4, y);
  y += 16;

  // Parties
  const col2 = W / 2 + 4;
  label('Sender', M, y);
  label('Recipient', col2, y);
  y += 6;
  const h1 = value(`${job.sender_name}${job.company_name ? `\n${job.company_name}` : ''}`, M, y);
  const h2 = value(job.recipient_name, col2, y);
  y += Math.max(h1, h2) + 5;

  label('Collected from', M, y);
  label('Delivered to', col2, y);
  y += 6;
  const h3 = value(`${job.pickup_location}, ${job.pickup_emirate}`, M, y);
  const h4 = value(`${job.delivery_location}, ${job.delivery_emirate}`, col2, y);
  y += Math.max(h3, h4) + 5;

  label('Item', M, y);
  label('Driver', col2, y);
  y += 6;
  value(`${job.item_type} · ${job.urgency}`.toUpperCase(), M, y);
  const vehicle = driver && tpl.show_vehicle ? [driver.vehicle_make, driver.vehicle_model, driver.vehicle_plate].filter(Boolean).join(' ') : '';
  const h5 = value(`${driver?.full_name || `${brand} courier`}${vehicle ? `\n${vehicle}` : ''}`, col2, y);
  y += Math.max(5, h5) + 10;

  // Timeline
  doc.setDrawColor('#e2e8f0');
  doc.line(M, y, W - M, y);
  y += 10;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(ink);
  doc.text('Custody events', M, y);
  y += 9;

  const pickupFix = fixFor(pod, ['driver_pickup', 'client_pickup']);
  const deliveryFix = fixFor(pod, ['driver_delivery', 'client_delivery']);
  const verifiedBy = (fix: PodFix | null, codeText: string) =>
    fix?.method === 'ops_override' ? `Confirmed by ${brand} operations` : codeText;

  type Event = { label: string; at?: string | null; note: string; fix?: PodFix | null; address?: [number | null | undefined, number | null | undefined] };
  const events: Event[] = [
    { label: 'Job booked', at: job.created_at, note: `Manifest logged with ${brand} dispatch` },
    { label: 'Package ready at origin', at: job.sender_ready_at, note: 'Sender confirmed package prepared' },
    { label: 'Driver arrived at pickup', at: job.driver_arrived_pickup_at, note: job.pickup_location },
    {
      label: 'Custody transferred to driver',
      at: job.driver_pickup_at || job.client_pickup_at,
      note: verifiedBy(pickupFix, 'Handover verified by one-time code'),
      fix: pickupFix,
      address: [job.pickup_lat, job.pickup_lng],
    },
    { label: 'Driver arrived at destination', at: job.driver_arrived_delivery_at, note: job.delivery_location },
    {
      label: 'Custody transferred to recipient',
      at: job.client_delivery_at || job.driver_delivery_at,
      note: verifiedBy(deliveryFix, 'Receipt verified by one-time code'),
      fix: deliveryFix,
      address: [job.delivery_lat, job.delivery_lng],
    },
  ];

  events.forEach((e, i) => {
    const done = Boolean(e.at);
    doc.setFillColor(done ? success : '#cbd5e1');
    doc.circle(M + 2, y - 1.3, 1.8, 'F');
    if (i < events.length - 1) {
      doc.setDrawColor(done ? success : '#e2e8f0');
      doc.setLineWidth(0.4);
      doc.line(M + 2, y + 1, M + 2, y + 11);
    }
    doc.setFont('helvetica', done ? 'bold' : 'normal');
    doc.setFontSize(10);
    doc.setTextColor(done ? ink : muted);
    doc.text(e.label, M + 8, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.text(done ? ctx.formatTime(e.at!) : 'Not recorded', W - M, y, { align: 'right' });
    doc.setFontSize(8.5);
    doc.setTextColor(muted);
    doc.text(doc.splitTextToSize(e.note, 120)[0], M + 8, y + 4.5);

    // Where the handover happened, as a tappable map link.
    const f = e.at && tpl.show_gps ? e.fix : null;
    if (f && f.driver_lat != null && f.driver_lng != null) {
      const coords = `${f.driver_lat.toFixed(5)}, ${f.driver_lng.toFixed(5)}`;
      const [aLat, aLng] = e.address ?? [null, null];
      const off = aLat != null && aLng != null ? metersBetween(f.driver_lat, f.driver_lng, aLat, aLng) : null;
      const extra = [
        f.accuracy_m != null ? `±${Math.round(f.accuracy_m)} m` : null,
        off != null ? (off < 1000 ? `${Math.round(off)} m from booked address` : `${(off / 1000).toFixed(1)} km from booked address`) : null,
      ].filter(Boolean).join(' · ');
      doc.setTextColor(accent);
      doc.textWithLink(`GPS ${coords}`, M + 8, y + 9, { url: `https://maps.google.com/?q=${f.driver_lat},${f.driver_lng}` });
      if (extra) {
        doc.setTextColor(muted);
        doc.text(`  ·  ${extra}`, M + 8 + doc.getTextWidth(`GPS ${coords}`), y + 9);
      }
      y += 4.5;
    }
    y += 13;
  });

  // Transit time
  const start = job.driver_pickup_at || job.client_pickup_at;
  const end = job.client_delivery_at || job.driver_delivery_at;
  if (tpl.show_transit_time && start && end) {
    const mins = Math.max(0, Math.round((new Date(end).getTime() - new Date(start).getTime()) / 60000));
    y += 4;
    doc.setFillColor('#f8fafc');
    doc.roundedRect(M, y, W - 2 * M, 14, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(muted);
    doc.text('TOTAL TIME IN CUSTODY', M + 5, y + 8.8);
    doc.setFontSize(12);
    doc.setTextColor(ink);
    doc.text(mins >= 60 ? `${Math.floor(mins / 60)} h ${mins % 60} min` : mins < 1 ? '< 1 min' : `${mins} min`, W - M - 5, y + 9, { align: 'right' });
  }

  // Footer: the company's note (bottom-up so longer notes grow upwards), then the reference line.
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(muted);
  const note = tpl.footer_note.trim()
    ? tpl.footer_note.trim().split('\n').flatMap((l) => doc.splitTextToSize(l, W - 2 * M)).slice(0, 4)
    : [];
  note.forEach((line: string, i: number) => doc.text(line, W / 2, 280 - (note.length - 1 - i) * 4, { align: 'center' }));
  doc.text(`${brand} Chain of Custody · ${job.job_ref ?? ''} · ${ctx.issuedBy}`, W / 2, 285, { align: 'center' });

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
