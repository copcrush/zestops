"use client";

import { Plus } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/features/auth/components/session-provider";
import { createIdempotencyKey, fieldErrorFor, sendApiRequest } from "@/lib/browser/api-client";
import type { FieldError } from "@/lib/shared/api-error";
import { formatMoney, parseDecimalToMinorUnits } from "@/lib/shared/money";
import { createPaymentRequestSchema } from "@/lib/shared/validation-schemas";
import { type Currency, type Payment, PAYMENT_METHODS } from "@/types/payments";

const paymentMethodLabels: Record<string, string> = {
  card: "Card (simulated)", bank_transfer: "Bank transfer", promptpay: "PromptPay", e_wallet: "E-wallet",
};

export function CreatePaymentDialog({ currencies }: { currencies: Currency[] }) {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();

  const [isOpen, setIsOpen] = useState(false);
  const [merchantReference, setMerchantReference] = useState("");
  const [amountInput, setAmountInput] = useState("");
  const [currencyCode, setCurrencyCode] = useState(currencies.find((currency) => currency.code === "THB")?.code
    ?? currencies[0]?.code ?? "THB");
  const [paymentMethod, setPaymentMethod] = useState<string>("promptpay");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  // One key per opened form: retries/double-clicks reuse it, so only one payment is ever created.
  const [idempotencyKey, setIdempotencyKey] = useState(createIdempotencyKey);

  const selectedCurrency = currencies.find((currency) => currency.code === currencyCode);
  const minorUnitExponent = selectedCurrency?.minor_unit_exponent ?? 2;
  const amountPreview = useMemo(() => {
    const parsedAmount = parseDecimalToMinorUnits(amountInput, minorUnitExponent);
    return parsedAmount.ok ? formatMoney(parsedAmount.amountMinor, currencyCode, minorUnitExponent) : null;
  }, [amountInput, currencyCode, minorUnitExponent]);

  function resetForm() {
    setMerchantReference("");
    setAmountInput("");
    setDescription("");
    setFieldErrors([]);
    setFormError(null);
    setIdempotencyKey(createIdempotencyKey());
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const parsedAmount = parseDecimalToMinorUnits(amountInput, minorUnitExponent);
    const clientErrors: FieldError[] = parsedAmount.ok ? [] : [{ field: "amount_minor", message: parsedAmount.error }];
    const requestBody = {
      merchant_reference: merchantReference.trim(),
      description: description.trim(),
      amount_minor: parsedAmount.ok ? parsedAmount.amountMinor : 0,
      currency: currencyCode,
      payment_method: paymentMethod,
      idempotency_key: idempotencyKey,
    };
    const validation = createPaymentRequestSchema.safeParse(requestBody);
    if (!validation.success) {
      clientErrors.push(...validation.error.issues
        .filter((issue) => !(issue.path[0] === "amount_minor" && !parsedAmount.ok))
        .map((issue) => ({ field: String(issue.path[0]), message: issue.message })));
    }
    if (clientErrors.length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setFieldErrors([]);
    setIsSubmitting(true);
    const result = await sendApiRequest<Payment>("/api/payments", { method: "POST", csrfToken, body: requestBody });
    setIsSubmitting(false);

    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.message);
      return;
    }
    showToast("success", `Payment ${result.data.reference} created (pending).`);
    setIsOpen(false);
    resetForm();
    router.push(`/payments/${result.data.id}`);
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} icon={<Plus aria-hidden className="size-4" />}>New payment</Button>
      <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="New simulated payment"
              description="No real money moves. The payment starts as pending.">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field id="merchant_reference" label="Merchant reference" required
                 hint="Your order or invoice number, e.g. ORDER-1042."
                 error={fieldErrorFor(fieldErrors, "merchant_reference")}>
            {(controlProps) => (
              <TextInput {...controlProps} value={merchantReference} maxLength={64} autoComplete="off"
                         onChange={(event) => setMerchantReference(event.target.value)} />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-[1fr_140px]">
            <Field id="amount" label="Amount" required error={fieldErrorFor(fieldErrors, "amount_minor")}
                   hint={amountPreview ? `Will be charged as ${amountPreview}` : "Decimal amount, e.g. 1250.50"}>
              {(controlProps) => (
                <TextInput {...controlProps} value={amountInput} inputMode="decimal" autoComplete="off"
                           className="tabular font-mono" onChange={(event) => setAmountInput(event.target.value)} />
              )}
            </Field>
            <Field id="currency" label="Currency" required error={fieldErrorFor(fieldErrors, "currency")}>
              {(controlProps) => (
                <SelectInput {...controlProps} value={currencyCode} onChange={(event) => setCurrencyCode(event.target.value)}>
                  {currencies.map((currency) => (
                    <option key={currency.code} value={currency.code}>{currency.code}</option>
                  ))}
                </SelectInput>
              )}
            </Field>
          </div>
          <Field id="payment_method" label="Payment method" required error={fieldErrorFor(fieldErrors, "payment_method")}>
            {(controlProps) => (
              <SelectInput {...controlProps} value={paymentMethod} onChange={(event) => setPaymentMethod(event.target.value)}>
                {PAYMENT_METHODS.map((method) => <option key={method} value={method}>{paymentMethodLabels[method]}</option>)}
              </SelectInput>
            )}
          </Field>
          <Field id="description" label="Description" hint="Optional, up to 280 characters."
                 error={fieldErrorFor(fieldErrors, "description")}>
            {(controlProps) => (
              <TextArea {...controlProps} value={description} maxLength={280}
                        onChange={(event) => setDescription(event.target.value)} />
            )}
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button type="submit" isLoading={isSubmitting}>Create payment</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
