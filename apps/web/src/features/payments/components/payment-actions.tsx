"use client";

import { Ban, CircleCheck, CircleX } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, TextInput } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/features/auth/components/session-provider";
import { sendApiRequest } from "@/lib/browser/api-client";
import type { Payment } from "@/types/payments";

type PendingAction = "succeeded" | "failed" | "cancel" | null;

/** Admin controls for the simulation workflow. The Payment API enforces the state machine. */
export function PaymentActions({ paymentId, reference }: { paymentId: string; reference: string }) {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<PendingAction>(null);
  const [isFailureDialogOpen, setIsFailureDialogOpen] = useState(false);
  const [failureReason, setFailureReason] = useState("Simulated: card declined by issuer");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function runAction(action: Exclude<PendingAction, null>, body?: unknown) {
    setActiveAction(action);
    setErrorMessage(null);
    const path = action === "cancel" ? `/api/payments/${paymentId}/cancel` : `/api/payments/${paymentId}/simulate`;
    const result = await sendApiRequest<Payment>(path, { method: "POST", csrfToken, body });
    setActiveAction(null);
    if (!result.ok) {
      setErrorMessage(result.message);
      showToast("error", result.message);
      return false;
    }
    showToast("success", `${reference} is now ${result.data.status}.`);
    router.refresh();
    return true;
  }

  async function submitFailure(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const reason = failureReason.trim();
    if (await runAction("failed", { outcome: "failed", ...(reason ? { failure_reason: reason } : {}) })) {
      setIsFailureDialogOpen(false);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => runAction("succeeded", { outcome: "succeeded" })} isLoading={activeAction === "succeeded"}
                disabled={activeAction !== null} icon={<CircleCheck aria-hidden className="size-4" />}>
          Simulate success
        </Button>
        <Button variant="danger" onClick={() => setIsFailureDialogOpen(true)} disabled={activeAction !== null}
                icon={<CircleX aria-hidden className="size-4" />}>
          Simulate failure
        </Button>
        <Button variant="secondary" onClick={() => runAction("cancel")} isLoading={activeAction === "cancel"}
                disabled={activeAction !== null} icon={<Ban aria-hidden className="size-4" />}>
          Cancel payment
        </Button>
      </div>
      <Dialog isOpen={isFailureDialogOpen} onClose={() => setIsFailureDialogOpen(false)} title="Simulate a failed payment"
              description={`${reference} will move to "failed". This cannot be undone.`}>
        <form onSubmit={submitFailure} className="flex flex-col gap-4">
          <Field id="failure_reason" label="Failure reason" hint="Shown in the payment history (max 200 characters).">
            {(controlProps) => (
              <TextInput {...controlProps} value={failureReason} maxLength={200}
                         onChange={(event) => setFailureReason(event.target.value)} />
            )}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsFailureDialogOpen(false)}>Back</Button>
            <Button type="submit" variant="danger" isLoading={activeAction === "failed"}>Mark as failed</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
