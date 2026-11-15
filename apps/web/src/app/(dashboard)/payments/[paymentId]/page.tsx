import { ArrowLeft, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { DemoSeedBadge } from "@/components/ui/badge";
import { ButtonLink } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, ErrorState } from "@/components/ui/feedback";
import { PageHeader } from "@/components/ui/page-header";
import { PaymentStatusBadge } from "@/components/ui/status-badges";
import { hasPermission } from "@/features/auth/permissions";
import { requireSession } from "@/features/auth/server/current-session";
import { PaymentActions } from "@/features/payments/components/payment-actions";
import { getPaymentDetails, listCurrencies } from "@/features/payments/server/payment-api";
import { BackendRequestError, describeBackendFailure } from "@/lib/server/backend-client";
import { formatDateTime, humanize, shortId } from "@/lib/shared/format";
import { DEFAULT_MINOR_UNIT_EXPONENTS, formatMoney } from "@/lib/shared/money";
import { uuidSchema } from "@/lib/shared/validation-schemas";
import type { PaymentDetails } from "@/types/payments";

export const metadata: Metadata = { title: "Payment details" };

export default async function PaymentDetailsPage({ params }: PageProps<"/payments/[paymentId]">) {
  const { user } = await requireSession();
  const { paymentId } = await params;
  if (!uuidSchema.safeParse(paymentId).success) {
    notFound();
  }

  let details: PaymentDetails;
  try {
    details = await getPaymentDetails(user, paymentId);
  } catch (error) {
    if (error instanceof BackendRequestError && error.status === 404) {
      notFound();
    }
    return (
      <>
        <ButtonLink href="/payments" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>Payments</ButtonLink>
        <ErrorState message={describeBackendFailure(error)} />
      </>
    );
  }

  const currencies = await listCurrencies(user).catch(() => null);
  const exponent = currencies?.find((currency) => currency.code === details.payment.currency)?.minor_unit_exponent
    ?? DEFAULT_MINOR_UNIT_EXPONENTS[details.payment.currency] ?? 2;
  const { payment, events } = details;
  const canOperate = hasPermission(user.role, "simulatePayment") && payment.status === "pending";

  const facts: [string, React.ReactNode][] = [
    ["Merchant reference", <span key="m" className="font-mono">{payment.merchant_reference}</span>],
    ["Payment method", humanize(payment.payment_method)],
    ["Currency", payment.currency],
    ["Amount (minor units)", <span key="a" className="tabular font-mono">{payment.amount_minor}</span>],
    ["Created", formatDateTime(payment.created_at)],
    ["Completed", formatDateTime(payment.completed_at)],
    ["Created by", <span key="c" className="font-mono">{payment.created_by === user.id ? "You" : `user ${shortId(payment.created_by)}`}</span>],
    ["Payment ID", <span key="i" className="break-all font-mono text-xs">{payment.id}</span>],
  ];

  return (
    <>
      <ButtonLink href="/payments" variant="ghost" size="sm" icon={<ArrowLeft aria-hidden className="size-4" />}>Payments</ButtonLink>
      <div className="mt-4">
        <PageHeader eyebrow={payment.reference} title={formatMoney(payment.amount_minor, payment.currency, exponent)}
                    description={payment.description || "No description"}
                    actions={<div className="flex items-center gap-2">{payment.is_demo_seed ? <DemoSeedBadge /> : null}<PaymentStatusBadge status={payment.status} /></div>} />
      </div>

      {payment.status === "failed" && payment.failure_reason ? (
        <Alert tone="danger" title="Payment failed" className="mb-6">{payment.failure_reason}</Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Details" />
          <CardBody>
            <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
              {facts.map(([label, value]) => (
                <div key={label}>
                  <dt className="font-mono text-[11px] font-bold uppercase tracking-[0.12em] text-muted">{label}</dt>
                  <dd className="mt-0.5 text-[15px]">{value}</dd>
                </div>
              ))}
            </dl>
          </CardBody>
        </Card>

        <div className="flex flex-col gap-6">
          {canOperate ? (
            <Card className="bg-lemon-soft">
              <CardHeader title="Simulation workflow" description="Admins can settle or cancel pending payments." />
              <CardBody><PaymentActions paymentId={payment.id} reference={payment.reference} /></CardBody>
            </Card>
          ) : (
            <Alert tone="info" title={payment.status === "pending" ? "Read-only access" : "Payment is final"}>
              {payment.status === "pending"
                ? "Only administrators can run the simulation workflow."
                : "Succeeded, failed and cancelled payments cannot change again."}
            </Alert>
          )}

          <Card>
            <CardHeader title="Status history" description="Append-only audit trail stored by the Payment API" />
            <CardBody>
              <ol className="relative flex flex-col gap-4 border-l-2 border-ink pl-5">
                {events.map((event) => (
                  <li key={event.id} className="relative">
                    <span aria-hidden className="absolute -left-[29px] top-1 grid size-4 place-items-center rounded-full border-2 border-ink bg-lime" />
                    <div className="flex flex-wrap items-center gap-2">
                      {event.from_status ? <><PaymentStatusBadge status={event.from_status} /><span aria-hidden>→</span></> : null}
                      <PaymentStatusBadge status={event.to_status} />
                    </div>
                    {event.note ? <p className="mt-1 text-sm">{event.note}</p> : null}
                    <p className="mt-0.5 flex items-center gap-1 text-xs text-muted">
                      <ShieldCheck aria-hidden className="size-3" />
                      {formatDateTime(event.occurred_at)} · {event.actor_role} {event.actor_id === user.id ? "(you)" : shortId(event.actor_id)}
                    </p>
                  </li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
