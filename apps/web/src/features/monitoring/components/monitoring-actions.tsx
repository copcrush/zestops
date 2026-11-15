"use client";

import { Play, Plus, Power, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Alert } from "@/components/ui/feedback";
import { Field, TextArea, TextInput } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/features/auth/components/session-provider";
import { fieldErrorFor, sendApiRequest } from "@/lib/browser/api-client";
import type { FieldError } from "@/lib/shared/api-error";
import type { MonitoredService, RunChecksResult } from "@/types/monitoring";

function describeCheckRun(result: RunChecksResult): string {
  const downCount = result.results.filter((check) => check.status === "down").length;
  const summary = `${result.results.length} check${result.results.length === 1 ? "" : "s"} finished, ${downCount} down`;
  return result.incidents_opened > 0 ? `${summary}. ${result.incidents_opened} incident(s) opened automatically.` : `${summary}.`;
}

export function RunAllChecksButton() {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();
  const [isRunning, setIsRunning] = useState(false);

  async function runChecks() {
    setIsRunning(true);
    const result = await sendApiRequest<RunChecksResult>("/api/monitoring/checks", { method: "POST", csrfToken });
    setIsRunning(false);
    if (!result.ok) {
      showToast("error", result.message);
      return;
    }
    showToast(result.data.results.some((check) => check.status === "down") ? "error" : "success",
      describeCheckRun(result.data));
    router.refresh();
  }

  return (
    <Button variant="accent" onClick={runChecks} isLoading={isRunning} icon={<RefreshCw aria-hidden className="size-4" />}>
      {isRunning ? "Checking…" : "Run all checks"}
    </Button>
  );
}

export function ServiceRowActions({ service }: { service: MonitoredService }) {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();
  const [activeAction, setActiveAction] = useState<"check" | "toggle" | null>(null);

  async function checkNow() {
    setActiveAction("check");
    const result = await sendApiRequest<RunChecksResult>(`/api/monitoring/services/${service.id}/checks`,
      { method: "POST", csrfToken });
    setActiveAction(null);
    if (!result.ok) {
      showToast("error", result.message);
      return;
    }
    const check = result.data.results[0];
    showToast(check?.status === "down" ? "error" : "success",
      `${service.name}: ${check?.status ?? "checked"}${check?.latency_ms != null ? ` in ${check.latency_ms} ms` : ""}. `
      + (result.data.incidents_opened > 0 ? "An incident was opened." : ""));
    router.refresh();
  }

  async function toggleEnabled() {
    setActiveAction("toggle");
    const result = await sendApiRequest<MonitoredService>(`/api/monitoring/services/${service.id}`,
      { method: "PATCH", csrfToken, body: { is_enabled: !service.is_enabled } });
    setActiveAction(null);
    if (!result.ok) {
      showToast("error", result.message);
      return;
    }
    showToast("success", `${service.name} ${result.data.is_enabled ? "enabled" : "disabled"}.`);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button size="sm" variant="secondary" onClick={checkNow} isLoading={activeAction === "check"}
              disabled={!service.is_enabled || activeAction !== null} icon={<Play aria-hidden className="size-3.5" />}
              aria-label={`Check ${service.name} now`}>
        Check
      </Button>
      <Button size="sm" variant="ghost" onClick={toggleEnabled} isLoading={activeAction === "toggle"}
              disabled={activeAction !== null} icon={<Power aria-hidden className="size-3.5" />}
              aria-label={`${service.is_enabled ? "Disable" : "Enable"} ${service.name}`}>
        {service.is_enabled ? "Disable" : "Enable"}
      </Button>
    </div>
  );
}

export function RegisterServiceDialog({ allowedTargets }: { allowedTargets: string[] }) {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const [name, setName] = useState("");
  const [targetUrl, setTargetUrl] = useState(allowedTargets[0] ? `${allowedTargets[0]}/health/ready` : "");
  const [description, setDescription] = useState("");
  const [expectedStatusCode, setExpectedStatusCode] = useState("200");
  const [timeoutMilliseconds, setTimeoutMilliseconds] = useState("3000");
  const [degradedThresholdMilliseconds, setDegradedThresholdMilliseconds] = useState("1000");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setFormError(null);
    const result = await sendApiRequest<MonitoredService>("/api/monitoring/services", {
      method: "POST", csrfToken, body: {
        name: name.trim(), description: description.trim(), target_url: targetUrl.trim(),
        expected_status_code: Number(expectedStatusCode), timeout_ms: Number(timeoutMilliseconds),
        degraded_threshold_ms: Number(degradedThresholdMilliseconds),
      },
    });
    setIsSubmitting(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      setFormError(result.message);
      return;
    }
    showToast("success", `${result.data.name} registered.`);
    setIsOpen(false);
    setName("");
    setDescription("");
    setFieldErrors([]);
    router.refresh();
  }

  return (
    <>
      <Button onClick={() => setIsOpen(true)} icon={<Plus aria-hidden className="size-4" />}>Register service</Button>
      <Dialog isOpen={isOpen} onClose={() => setIsOpen(false)} title="Register an approved service"
              description="Only URLs on the server-side allowlist can be monitored (SSRF protection).">
        <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
          {formError ? <Alert tone="danger">{formError}</Alert> : null}
          <Field id="service-name" label="Name" required error={fieldErrorFor(fieldErrors, "name")}>
            {(controlProps) => <TextInput {...controlProps} value={name} maxLength={80} onChange={(event) => setName(event.target.value)} />}
          </Field>
          <Field id="target-url" label="Health check URL" required error={fieldErrorFor(fieldErrors, "target_url")}
                 hint={allowedTargets.length > 0 ? `Approved origins: ${allowedTargets.join(", ")}` : "No approved origins are configured."}>
            {(controlProps) => <TextInput {...controlProps} value={targetUrl} inputMode="url" className="font-mono text-sm"
                                          onChange={(event) => setTargetUrl(event.target.value)} />}
          </Field>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field id="expected-status" label="Expected status" error={fieldErrorFor(fieldErrors, "expected_status_code")}>
              {(controlProps) => <TextInput {...controlProps} value={expectedStatusCode} inputMode="numeric" onChange={(event) => setExpectedStatusCode(event.target.value)} />}
            </Field>
            <Field id="timeout" label="Timeout (ms)" error={fieldErrorFor(fieldErrors, "timeout_ms")}>
              {(controlProps) => <TextInput {...controlProps} value={timeoutMilliseconds} inputMode="numeric" onChange={(event) => setTimeoutMilliseconds(event.target.value)} />}
            </Field>
            <Field id="degraded" label="Slow after (ms)" error={fieldErrorFor(fieldErrors, "degraded_threshold_ms")}>
              {(controlProps) => <TextInput {...controlProps} value={degradedThresholdMilliseconds} inputMode="numeric" onChange={(event) => setDegradedThresholdMilliseconds(event.target.value)} />}
            </Field>
          </div>
          <Field id="service-description" label="Description" error={fieldErrorFor(fieldErrors, "description")}>
            {(controlProps) => <TextArea {...controlProps} value={description} maxLength={280} onChange={(event) => setDescription(event.target.value)} />}
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsOpen(false)}>Cancel</Button>
            <Button type="submit" isLoading={isSubmitting}>Register</Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}
