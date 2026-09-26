import { jsPDF } from 'jspdf';
import { Job } from '@/src/types';
import { formatUAETime } from '@/src/lib/utils';

export interface DriverContact {
  full_name: string | null;
  phone: string | null;
  vehicle_type: string | null;
  vehicle_make: string | null;
  vehicle_model: string | null;
  vehicle_plate: string | null;
}

/**
 * Client-side Chain of Custody certificate for the /:token/track page.
 * Built only from what get_job_by_token (+ get_job_driver_by_token) already
 * hands this token — no OTPs are ever printed, only the fact that each
 * handover was code-verified and when.
 */
export function downloadCocPdf(job: Job, driver: DriverContact | null) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const ink = '#0f172a';
  const muted = '#64748b';
  const accent = '#0369A1';
  const success = '#10b981';
  const W = 210;
  const M = 18;

  // Header band
  doc.setFillColor(ink);
  doc.rect(0, 0, W, 38, 'F');
  doc.setTextColor('#ffffff');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(22);
  doc.text('NOKAEL', M, 18);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text('CHAIN OF CUSTODY CERTIFICATE', M, 26);
  doc.setFontSize(9);
  doc.text(`Job ref  ${job.job_ref}`, W - M, 18, { align: 'right' });
  doc.text(`Issued  ${formatUAETime(new Date())} (UAE)`, W - M, 26, { align: 'right' });

  let y = 52;
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
  const vehicle = driver ? [driver.vehicle_make, driver.vehicle_model, driver.vehicle_plate].filter(Boolean).join(' ') : '';
  const h5 = value(`${driver?.full_name || 'Nokael courier'}${vehicle ? `\n${vehicle}` : ''}`, col2, y);
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

  const events: { label: string; at?: string | null; note: string }[] = [
    { label: 'Job booked', at: job.created_at, note: 'Manifest logged with Nokael dispatch' },
    { label: 'Package ready at origin', at: job.sender_ready_at, note: 'Sender confirmed package prepared' },
    { label: 'Driver arrived at pickup', at: job.driver_arrived_pickup_at, note: job.pickup_location },
    {
      label: 'Custody transferred to driver',
      at: job.driver_pickup_at || job.client_pickup_at,
      note: 'Handover verified by one-time code',
    },
    { label: 'Driver arrived at destination', at: job.driver_arrived_delivery_at, note: job.delivery_location },
    {
      label: 'Custody transferred to recipient',
      at: job.client_delivery_at || job.driver_delivery_at,
      note: 'Receipt verified by one-time code',
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
    doc.text(done ? formatUAETime(e.at!) : 'Not recorded', W - M, y, { align: 'right' });
    doc.setFontSize(8.5);
    doc.setTextColor(muted);
    doc.text(doc.splitTextToSize(e.note, 120)[0], M + 8, y + 4.5);
    y += 13;
  });

  // Transit time
  const start = job.driver_pickup_at || job.client_pickup_at;
  const end = job.client_delivery_at || job.driver_delivery_at;
  if (start && end) {
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

  // Footer
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(muted);
  doc.text('Each handover was confirmed with a single-use code held by the party receiving custody.', W / 2, 280, { align: 'center' });
  doc.text(`Nokael Chain of Custody · ${job.job_ref} · ${window.location.host}`, W / 2, 285, { align: 'center' });

  doc.save(`Nokael-COC-${job.job_ref}.pdf`);
}
