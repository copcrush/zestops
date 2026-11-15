"use client";

import { LogIn } from "lucide-react";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, TextInput } from "@/components/ui/form-controls";
import { extractFieldErrors, isApiErrorBody } from "@/lib/shared/api-error";
import { loginRequestSchema } from "@/lib/shared/validation-schemas";

/**
 * Uncontrolled inputs (values read from FormData on submit): whatever the user
 * typed before React finished hydrating is kept, and there is no hydration mismatch.
 */
export function LoginForm({ redirectPath }: { redirectPath: string }) {
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const formData = new FormData(event.currentTarget);
    const parsed = loginRequestSchema.safeParse({
      email: String(formData.get("email") ?? "").trim(),
      password: String(formData.get("password") ?? ""),
    });
    if (!parsed.success) {
      setFieldErrors(Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message])));
      return;
    }
    setFieldErrors({});
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.data),
        credentials: "same-origin",
      });
      if (response.ok) {
        // Full navigation so every Server Component re-renders with the new session.
        window.location.assign(redirectPath);
        return;
      }
      const responseBody: unknown = await response.json().catch(() => null);
      if (isApiErrorBody(responseBody)) {
        setFormError(responseBody.error.message);
        setFieldErrors(Object.fromEntries(extractFieldErrors(responseBody.error.details)
          .map((fieldError) => [fieldError.field, fieldError.message])));
      } else {
        setFormError("Sign-in failed. Please try again.");
      }
    } catch {
      setFormError("Network error. Check your connection and try again.");
    }
    setIsSubmitting(false);
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4" aria-describedby={formError ? "login-error" : undefined}>
      {formError ? <div id="login-error"><Alert tone="danger">{formError}</Alert></div> : null}
      <Field id="email" label="E-mail" error={fieldErrors.email} required>
        {(controlProps) => (
          <TextInput {...controlProps} type="email" name="email" autoComplete="username" inputMode="email" required />
        )}
      </Field>
      <Field id="password" label="Password" error={fieldErrors.password} required>
        {(controlProps) => (
          <TextInput {...controlProps} type="password" name="password" autoComplete="current-password" required />
        )}
      </Field>
      <Button type="submit" isLoading={isSubmitting} className="mt-2 w-full" icon={<LogIn aria-hidden className="size-4" />}>
        {isSubmitting ? "Signing in…" : "Sign in"}
      </Button>
    </form>
  );
}
