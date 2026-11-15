"use client";

import { MessageSquarePlus, Plus, Search, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, SelectInput, TextArea, TextInput } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/features/auth/components/session-provider";
import { fieldErrorFor, sendApiRequest } from "@/lib/browser/api-client";
import type { FieldError } from "@/lib/shared/api-error";
import { humanize } from "@/lib/shared/format";
import { INCIDENT_SEVERITIES, type IncidentDetail, type IncidentStatus } from "@/types/monitoring";

export function CreateIncidentDialog({ services }: { services: { id: string; name: string }[] }) {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [severity, setSeverity] = useState("medium");
  const [serviceId, setServiceId] = useState("");
  const [description, setDescription] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    const result = await sendApiRequest<IncidentDetail>("/api/incidents", {
      method: "POST", csrfToken,
      body: { title: title.trim(), severity, description: description.trim(), service_id: serviceId || null },
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.message);
      return;
    }
    showToast("success", `${result.data.reference} opened.`);
    setIsOpen(false);
    setTitle("");
    setDescription("");
    router.push(`/incidents/${result.data.id}`);
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} icon={<Plus aria-hidden className="size-4" />}>Report incident</Button>
      <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Report an incident"
              description="Opens a new incident in the 'open' state.">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field id="incident-title" label="Title" required error={fieldErrorFor(fieldErrors, "title")}>
            {(controlProps) => <TextInput {...controlProps} value={title} maxLength={120} onChange={(event) => setTitle(event.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="incident-severity" label="Severity" required error={fieldErrorFor(fieldErrors, "severity")}>
              {(controlProps) => (
                <SelectInput {...controlProps} value={severity} onChange={(event) => setSeverity(event.target.value)}>
                  {INCIDENT_SEVERITIES.map((level) => <option key={level} value={level}>{humanize(level)}</option>)}
                </SelectInput>
              )}
            </Field>
            <Field id="incident-service" label="Affected service" error={fieldErrorFor(fieldErrors, "service_id")}>
              {(controlProps) => (
                <SelectInput {...controlProps} value={serviceId} onChange={(event) => setServiceId(event.target.value)}>
                  <option value="">Not service-specific</option>
                  {services.map((service) => <option key={service.id} value={service.id}>{service.name}</option>)}
                </SelectInput>
              )}
            </Field>
          </div>
          <Field id="incident-description" label="What is happening?" error={fieldErrorFor(fieldErrors, "description")}>
            {(controlProps) => <TextArea {...controlProps} value={description} maxLength={2000} onChange={(event) => setDescription(event.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button type="submit" isLoading={isSubmitting}>Open incident</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

/** Investigate / add note / resolve. The Monitoring API enforces the state machine and row locking. */
export function IncidentWorkflow({ incidentId, status }: { incidentId: string; status: IncidentStatus }) {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();
  const [note, setNote] = useState("");
  const [activeAction, setActiveAction] = useState<"investigating" | "resolved" | "note" | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);

  async function submit(action: "investigating" | "resolved" | "note") {
    setActiveAction(action);
    setFormError(null);
    const trimmedNote = note.trim();
    const result = action === "note"
      ? await sendApiRequest<IncidentDetail>(`/api/incidents/${incidentId}/notes`, { method: "POST", csrfToken, body: { note: trimmedNote } })
      : await sendApiRequest<IncidentDetail>(`/api/incidents/${incidentId}/status`, {
        method: "POST", csrfToken, body: { status: action, ...(trimmedNote ? { note: trimmedNote } : {}) },
      });
    setActiveAction(null);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.message);
      return;
    }
    setFieldErrors([]);
    setNote("");
    showToast("success", action === "note" ? "Note added." : `Incident is now ${action}.`);
    router.refresh();
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit("note");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {formError ? <Alert tone="danger">{formError}</Alert> : null}
      <Field id="incident-note" label="Note" hint="Required when resolving: describe the root cause and the fix."
             error={fieldErrorFor(fieldErrors, "note")}>
        {(controlProps) => <TextArea {...controlProps} value={note} maxLength={2000} onChange={(event) => setNote(event.target.value)} />}
      </Field>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="secondary" isLoading={activeAction === "note"} disabled={activeAction !== null}
                icon={<MessageSquarePlus aria-hidden className="size-4" />}>Add note</Button>
        {status === "open" ? (
          <Button variant="accent" onClick={() => submit("investigating")} isLoading={activeAction === "investigating"}
                  disabled={activeAction !== null} icon={<Search aria-hidden className="size-4" />}>Start investigating</Button>
        ) : null}
        <Button onClick={() => submit("resolved")} isLoading={activeAction === "resolved"} disabled={activeAction !== null}
                icon={<ShieldCheck aria-hidden className="size-4" />}>Resolve</Button>
      </div>
    </form>
  );
}
