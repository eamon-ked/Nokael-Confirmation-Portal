import type { ElementType } from 'react';
import { CheckCircle2, Circle, MapPin, Package, ShieldCheck, Truck } from 'lucide-react';
import { Job } from '@/src/types';
import { formatUAETime } from '@/src/lib/utils';

/**
 * Real Chain of Custody timeline — every node is backed by an actual
 * database timestamp on `job`, not a role-based generic description.
 * Replaces the old two-node "Departure/Destination Protocol" list and the
 * generic custodian copy in StepCompletedView, which described the current
 * *role* ("Certified Courier Team", "In Transit") but never the underlying
 * handover events or when they actually happened.
 */

interface Milestone {
  key: string;
  label: string;
  detail: string;
  timestamp: string | null | undefined;
  icon: ElementType;
}

function buildMilestones(job: Job): Milestone[] {
  return [
    {
      key: 'created',
      label: 'Manifest Logged',
      detail: `${job.pickup_location}, ${job.pickup_emirate}`,
      timestamp: job.created_at,
      icon: Package,
    },
    {
      key: 'sender_ready',
      label: 'Package Ready at Origin',
      detail: 'Sender confirmed the bundle is prepared for collection',
      timestamp: job.sender_ready_at,
      icon: CheckCircle2,
    },
    {
      key: 'driver_arrived_pickup',
      label: 'Courier Arrived — Pickup',
      detail: `Reached ${job.pickup_location}`,
      timestamp: job.driver_arrived_pickup_at,
      icon: MapPin,
    },
    {
      key: 'pickup_handover',
      label: 'Custody Transferred to Courier',
      detail: job.client_pickup_at && job.driver_pickup_at
        ? 'Verified by both sender and courier codes'
        : 'Awaiting two-sided code verification',
      timestamp: job.driver_pickup_at || job.client_pickup_at,
      icon: Truck,
    },
    {
      key: 'driver_arrived_delivery',
      label: 'Courier Arrived — Destination',
      detail: `Reached ${job.delivery_location}`,
      timestamp: job.driver_arrived_delivery_at,
      icon: MapPin,
    },
    {
      key: 'delivery_handover',
      label: 'Custody Transferred to Recipient',
      detail: job.client_delivery_at && job.driver_delivery_at
        ? 'Verified by both courier and recipient codes'
        : 'Awaiting two-sided code verification',
      timestamp: job.client_delivery_at || job.driver_delivery_at,
      icon: ShieldCheck,
    },
  ];
}

export default function CustodyTimeline({ job, compact = false }: { job: Job; compact?: boolean }) {
  const milestones = buildMilestones(job);
  const lastDoneIndex = milestones.reduce((acc, m, i) => (m.timestamp ? i : acc), -1);

  return (
    <div className={compact ? 'space-y-5' : 'space-y-7'}>
      <div className="flex items-center justify-between">
        <span className="eyebrow">Chain of Custody</span>
        <span className="timeline-time">
          {lastDoneIndex >= 0 ? `Updated ${formatUAETime(milestones[lastDoneIndex].timestamp)}` : 'Awaiting first update'}
        </span>
      </div>

      <ol className="relative border-l border-nokael-border pl-6 space-y-6">
        {milestones.map((m, i) => {
          const done = Boolean(m.timestamp);
          const isNext = !done && i === lastDoneIndex + 1;
          const Icon = m.icon;
          return (
            <li key={m.key} className="relative">
              <span
                className={`absolute -left-[29px] top-0.5 w-4 h-4 rounded-full flex items-center justify-center ring-4 ring-white
                  ${done ? 'bg-nokael-success' : isNext ? 'bg-nokael-accent' : 'bg-slate-200'}`}
              >
                {done ? (
                  <CheckCircle2 className="w-4 h-4 text-white -m-[3px]" strokeWidth={2.5} />
                ) : (
                  <Circle className="w-1.5 h-1.5 text-white fill-white" />
                )}
              </span>

              <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                <p className={`flex items-center gap-1.5 ${done ? 'headline-md' : 'text-[14px] font-medium text-nokael-text-muted'}`}>
                  <Icon className={`w-3.5 h-3.5 ${done ? 'text-nokael-success' : 'text-slate-300'}`} />
                  {m.label}
                </p>
                {m.timestamp && <span className="timeline-time">{formatUAETime(m.timestamp)}</span>}
                {!m.timestamp && isNext && (
                  <span className="text-[11px] font-semibold text-nokael-accent">In progress</span>
                )}
              </div>
              <p className="body-text mt-0.5 text-[13px]">{m.detail}</p>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
