export type JobStatus = 'pending' | 'client_pickup' | 'driver_pickup' | 'driver_delivery' | 'completed';

export interface Job {
  id: string;
  job_ref: string;
  source: string;
  sender_name: string;
  sender_phone: string;
  recipient_name: string;
  recipient_phone: string;
  pickup_emirate: string;
  pickup_location: string;
  delivery_emirate: string;
  delivery_location: string;
  item_type: string;
  urgency: string;
  status: JobStatus;
  client_pickup_at: string | null;
  driver_pickup_at: string | null;
  driver_delivery_at: string | null;
  client_delivery_at: string | null;
  pickup_lat: number | null;
  pickup_lng: number | null;
  delivery_lat: number | null;
  delivery_lng: number | null;
  created_at: string;
  // OTP System Columns
  otp_sender?: string;
  otp_driver_pickup?: string;
  otp_driver_delivery?: string;
  otp_recipient?: string;
}

export type Step = 'client-pickup' | 'driver-pickup' | 'driver-delivery' | 'client-delivery';

export const VALID_STEPS: Step[] = ['client-pickup', 'driver-pickup', 'driver-delivery', 'client-delivery'];

export const STEP_CONFIG: Record<Step, {
  token_field: string;
  at_field: keyof Job;
  partner_at_field: keyof Job;
  my_otp_field: keyof Job;
  rpc_step: string; // The exact step ID the RPC 'confirm_job_step' expects
  prerequisite_status: JobStatus;
  button_text: string;
  success_message: string;
  not_yet_message: string;
  role: 'sender' | 'driver' | 'recipient';
  partner_role: string;
}> = {
  'client-pickup': {
    token_field: 'token_client_pickup',
    at_field: 'client_pickup_at',
    partner_at_field: 'driver_pickup_at',
    my_otp_field: 'otp_sender',
    rpc_step: 'client_pickup',
    prerequisite_status: 'pending',
    button_text: 'Verify Handover',
    success_message: 'Confirmed. Your package is now with the Nokael driver.',
    not_yet_message: 'Your job is being prepared. This link will activate once your driver is assigned.',
    role: 'sender',
    partner_role: 'Courier'
  },
  'driver-pickup': {
    token_field: 'token_driver_pickup',
    at_field: 'driver_pickup_at',
    partner_at_field: 'client_pickup_at',
    my_otp_field: 'otp_driver_pickup',
    rpc_step: 'driver_pickup',
    prerequisite_status: 'client_pickup',
    button_text: 'Confirm Collection',
    success_message: 'Confirmed. Package collected. Proceed to delivery.',
    not_yet_message: 'Waiting for the sender to confirm handover.',
    role: 'driver',
    partner_role: 'Sender'
  },
  'driver-delivery': {
    token_field: 'token_driver_delivery',
    at_field: 'driver_delivery_at',
    partner_at_field: 'client_delivery_at',
    my_otp_field: 'otp_driver_delivery',
    rpc_step: 'driver_delivery',
    prerequisite_status: 'driver_pickup',
    button_text: 'Verify Delivery',
    success_message: 'Confirmed. Delivery logged.',
    not_yet_message: 'Package not yet confirmed collected.',
    role: 'driver',
    partner_role: 'Recipient'
  },
  'client-delivery': {
    token_field: 'token_client_delivery',
    at_field: 'client_delivery_at',
    partner_at_field: 'driver_delivery_at',
    my_otp_field: 'otp_recipient',
    rpc_step: 'client_delivery',
    prerequisite_status: 'driver_delivery',
    button_text: 'Verify Receipt',
    success_message: 'Confirmed. Your receipt has been logged.',
    not_yet_message: 'Your package is on its way.',
    role: 'recipient',
    partner_role: 'Courier'
  }
};
