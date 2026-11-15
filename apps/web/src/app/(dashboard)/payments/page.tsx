import { ChevronRight, Filter, RotateCcw } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";

import { Button, ButtonLink } from "@/components/ui/button";
import { DemoSeedBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState, ErrorState } from "@/components/ui/feedback";
import { SelectInput, TextInput } from "@/components/ui/form-controls";
import { PageHeader } from "@/components/ui/page-header";
import { PaymentStatusBadge } from "@/components/ui/status-badges";
import { DataTable, TableCell, TableHeaderCell } from "@/components/ui/table";
import { hasPermission } from "@/features/auth/permissions";
import { requireSession } from "@/features/auth/server/current-session";
import { CreatePaymentDialog } from "@/features/payments/components/create-payment-dialog";
import { listCurrencies, listPayments } from "@/features/payments/server/payment-api";
import { describeBackendFailure } from "@/lib/server/backend-client";
import { formatDateTime, humanize } from "@/lib/shared/format";
import { DEFAULT_MINOR_UNIT_EXPONENTS, formatMoney } from "@/lib/shared/money";
import { PAYMENT_STATUSES, type PaymentStatus } from "@/types/payments";

export const metadata: Metadata = { title: "Payments" };

function readParam(value: string | string[] | undefined): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export default async function PaymentsPage({ searchParams }: PageProps<"/payments">) {
  const { user } = await requireSession();
  const params = await searchParams;
  const statusParam = readParam(params.status);
  const status = PAYMENT_STATUSES.includes(statusParam as PaymentStatus) ? statusParam as PaymentStatus : undefined;
  const search = readParam(params.search)?.trim().slice(0, 64);
  const cursor = readParam(params.cursor);

  const [paymentPage, currencies] = await Promise.allSettled([
    listPayments(user, { status, search, cursor, limit: 20 }),
    listCurrencies(user),
  ]);
  const exponents: Record<string, number> = currencies.status === "fulfilled"
    ? Object.fromEntries(currencies.value.map((currency) => [currency.code, currency.minor_unit_exponent]))
    : { ...DEFAULT_MINOR_UNIT_EXPONENTS };
  const canCreate = hasPermission(user.role, "createPayment") && currencies.status === "fulfilled";

  const nextPageParams = new URLSearchParams();
  if (status) nextPageParams.set("status", status);
  if (search) nextPageParams.set("search", search);

  return (
    <>
      <PageHeader eyebrow="Payments" title="Simulated payments"
                  description="Create payments and run them through the simulated processing workflow."
                  actions={canCreate && currencies.status === "fulfilled" ? <CreatePaymentDialog currencies={currencies.value} /> : null} />

      <Card>
        <form method="get" className="flex flex-wrap items-end gap-3 border-b-2 border-ink px-5 py-4" role="search"
              aria-label="Filter payments">
          <div className="flex min-w-48 flex-1 flex-col gap-1.5">
            <label htmlFor="search" className="text-sm font-semibold">Reference</label>
            <TextInput id="search" name="search" defaultValue={search} placeholder="PAY-… or merchant reference"
                       maxLength={64} />
          </div>
          <div className="flex w-44 flex-col gap-1.5">
            <label htmlFor="status" className="text-sm font-semibold">Status</label>
            <SelectInput id="status" name="status" defaultValue={status ?? ""}>
              <option value="">All statuses</option>
              {PAYMENT_STATUSES.map((paymentStatus) => <option key={paymentStatus} value={paymentStatus}>{humanize(paymentStatus)}</option>)}
            </SelectInput>
          </div>
          <Button type="submit" variant="secondary" icon={<Filter aria-hidden className="size-4" />}>Apply</Button>
          {status || search ? (
            <ButtonLink href="/payments" variant="ghost" icon={<RotateCcw aria-hidden className="size-4" />}>Reset</ButtonLink>
          ) : null}
        </form>

        {paymentPage.status === "rejected" ? (
          <ErrorState message={describeBackendFailure(paymentPage.reason)} />
        ) : paymentPage.value.data.length === 0 ? (
          <EmptyState title="No payments found"
                      description={status || search ? "Try a different filter." : "Create the first simulated payment."} />
        ) : (
          <>
            <DataTable caption="Payments, newest first">
              <thead>
                <tr>
                  <TableHeaderCell>Reference</TableHeaderCell>
                  <TableHeaderCell>Merchant ref.</TableHeaderCell>
                  <TableHeaderCell className="text-right">Amount</TableHeaderCell>
                  <TableHeaderCell>Method</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Created</TableHeaderCell>
                  <TableHeaderCell><span className="sr-only">Details</span></TableHeaderCell>
                </tr>
              </thead>
              <tbody>
                {paymentPage.value.data.map((payment) => (
                  <tr key={payment.id} className="hover:bg-lime-soft">
                    <TableCell>
                      <div className="flex flex-col items-start gap-1">
                        <Link href={`/payments/${payment.id}`} className="whitespace-nowrap font-mono text-xs font-bold hover:underline">{payment.reference}</Link>
                        {payment.is_demo_seed ? <DemoSeedBadge /> : null}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{payment.merchant_reference}</TableCell>
                    <TableCell className="tabular whitespace-nowrap text-right font-mono font-semibold">
                      {formatMoney(payment.amount_minor, payment.currency, exponents[payment.currency] ?? 2)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{humanize(payment.payment_method)}</TableCell>
                    <TableCell><PaymentStatusBadge status={payment.status} /></TableCell>
                    <TableCell className="whitespace-nowrap text-muted">{formatDateTime(payment.created_at)}</TableCell>
                    <TableCell>
                      <Link href={`/payments/${payment.id}`} aria-label={`Open ${payment.reference}`}
                            className="inline-grid size-8 place-items-center rounded-md border-2 border-ink bg-white hover:bg-lime">
                        <ChevronRight aria-hidden className="size-4" />
                      </Link>
                    </TableCell>
                  </tr>
                ))}
              </tbody>
            </DataTable>
            <nav aria-label="Pagination" className="flex items-center justify-between gap-3 px-5 py-3">
              <p className="text-sm text-muted">Showing {paymentPage.value.data.length} payments{cursor ? " (later page)" : ""}</p>
              <div className="flex gap-2">
                {cursor ? <ButtonLink href={`/payments?${nextPageParams.toString()}`} size="sm">First page</ButtonLink> : null}
                {paymentPage.value.next_cursor ? (
                  <ButtonLink size="sm" variant="primary"
                              href={`/payments?${new URLSearchParams([...nextPageParams, ["cursor", paymentPage.value.next_cursor]]).toString()}`}>
                    Next page
                  </ButtonLink>
                ) : null}
              </div>
            </nav>
          </>
        )}
      </Card>
    </>
  );
}
