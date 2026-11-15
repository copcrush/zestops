/** Types mirroring the Go Payment API JSON (see docs/api/payment-api.openapi.yaml). */
export type PaymentStatus = "pending" | "processing" | "succeeded" | "failed" | "cancelled";
export type PaymentMethod = "card" | "bank_transfer" | "promptpay" | "e_wallet";

export const PAYMENT_STATUSES: readonly PaymentStatus[] = ["pending", "processing", "succeeded", "failed", "cancelled"];
export const PAYMENT_METHODS: readonly PaymentMethod[] = ["card", "bank_transfer", "promptpay", "e_wallet"];

export interface Payment {
  id: string;
  reference: string;
  merchant_reference: string;
  description: string;
  amount_minor: number;
  currency: string;
  payment_method: PaymentMethod;
  status: PaymentStatus;
  failure_reason: string | null;
  created_by: string;
  is_demo_seed: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

export interface PaymentEvent {
  id: number;
  from_status: PaymentStatus | null;
  to_status: PaymentStatus;
  actor_id: string;
  actor_role: string;
  note: string | null;
  request_id: string | null;
  occurred_at: string;
}

export interface PaymentDetails {
  payment: Payment;
  events: PaymentEvent[];
}

export interface PaymentPage {
  data: Payment[];
  next_cursor: string | null;
}

export interface Currency {
  code: string;
  display_name: string;
  minor_unit_exponent: number;
}

export interface PaymentSummary {
  total_count: number;
  count_by_status: Record<PaymentStatus, number>;
  succeeded_totals: { currency: string; total_amount_minor: string; payment_count: number }[];
  created_last_24_hours: number;
  success_rate_percent: number | null;
}
