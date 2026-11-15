import "server-only";

import { type BackendActor, getFromBackend } from "@/lib/server/backend-client";
import type { Currency, PaymentDetails, PaymentPage, PaymentStatus, PaymentSummary } from "@/types/payments";

/** Typed read helpers for the Go Payment API (used by Server Components). */

export interface PaymentListQuery {
  status?: PaymentStatus;
  search?: string;
  cursor?: string;
  limit?: number;
}

export function listPayments(actor: BackendActor, listQuery: PaymentListQuery = {}): Promise<PaymentPage> {
  const searchParams = new URLSearchParams();
  if (listQuery.status) searchParams.set("status", listQuery.status);
  if (listQuery.search) searchParams.set("search", listQuery.search);
  if (listQuery.cursor) searchParams.set("cursor", listQuery.cursor);
  searchParams.set("limit", String(listQuery.limit ?? 20));
  return getFromBackend<PaymentPage>("payment", `/v1/payments?${searchParams.toString()}`, actor);
}

export async function getPaymentDetails(actor: BackendActor, paymentId: string): Promise<PaymentDetails> {
  return (await getFromBackend<{ data: PaymentDetails }>("payment",
    `/v1/payments/${encodeURIComponent(paymentId)}`, actor)).data;
}

export async function getPaymentSummary(actor: BackendActor): Promise<PaymentSummary> {
  return (await getFromBackend<{ data: PaymentSummary }>("payment", "/v1/payments/summary", actor)).data;
}

export async function listCurrencies(actor: BackendActor): Promise<Currency[]> {
  return (await getFromBackend<{ data: Currency[] }>("payment", "/v1/currencies", actor)).data;
}
