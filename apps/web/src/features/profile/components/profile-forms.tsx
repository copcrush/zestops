"use client";

import { KeyRound, LogOut, Save } from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { Field, TextInput } from "@/components/ui/form-controls";
import { useToast } from "@/components/ui/toast";
import { useSession } from "@/features/auth/components/session-provider";
import { fieldErrorFor, sendApiRequest } from "@/lib/browser/api-client";
import type { FieldError } from "@/lib/shared/api-error";
import { MINIMUM_PASSWORD_LENGTH_SHARED } from "@/lib/shared/password-rules";
import { changePasswordRequestSchema } from "@/lib/shared/validation-schemas";

export function DisplayNameForm() {
  const { user, csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    const result = await sendApiRequest("/api/profile", { method: "PATCH", csrfToken, body: { display_name: displayName.trim() } });
    setIsSaving(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      showToast("error", result.message);
      return;
    }
    setFieldErrors([]);
    showToast("success", "Display name updated.");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      <Field id="display-name" label="Display name" error={fieldErrorFor(fieldErrors, "display_name")}>
        {(controlProps) => <TextInput {...controlProps} value={displayName} maxLength={80} onChange={(event) => setDisplayName(event.target.value)} />}
      </Field>
      <div><Button type="submit" isLoading={isSaving} icon={<Save aria-hidden className="size-4" />}>Save</Button></div>
    </form>
  );
}

export function ChangePasswordForm() {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSuccessMessage(null);
    const requestBody = { current_password: currentPassword, new_password: newPassword };
    const validation = changePasswordRequestSchema.safeParse(requestBody);
    const clientErrors: FieldError[] = validation.success ? [] : validation.error.issues.map((issue) => ({
      field: String(issue.path[0]), message: issue.message,
    }));
    if (newPassword !== confirmPassword) {
      clientErrors.push({ field: "confirm_password", message: "Passwords do not match." });
    }
    if (clientErrors.length > 0) {
      setFieldErrors(clientErrors);
      return;
    }

    setIsSaving(true);
    const result = await sendApiRequest<{ revoked_sessions: number }>("/api/profile/password", { method: "POST", csrfToken, body: requestBody });
    setIsSaving(false);
    if (!result.ok) {
      setFieldErrors(result.fieldErrors);
      showToast("error", result.message);
      return;
    }
    setFieldErrors([]);
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccessMessage(`Password changed. ${result.data.revoked_sessions} other session(s) were signed out.`);
    showToast("success", "Password changed.");
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
      {successMessage ? <Alert tone="success">{successMessage}</Alert> : null}
      <Field id="current-password" label="Current password" error={fieldErrorFor(fieldErrors, "current_password")}>
        {(controlProps) => <TextInput {...controlProps} type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />}
      </Field>
      <Field id="new-password" label="New password" hint={`At least ${MINIMUM_PASSWORD_LENGTH_SHARED} characters. A passphrase is easiest to remember.`}
             error={fieldErrorFor(fieldErrors, "new_password")}>
        {(controlProps) => <TextInput {...controlProps} type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />}
      </Field>
      <Field id="confirm-password" label="Confirm new password" error={fieldErrorFor(fieldErrors, "confirm_password")}>
        {(controlProps) => <TextInput {...controlProps} type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} />}
      </Field>
      <div><Button type="submit" isLoading={isSaving} icon={<KeyRound aria-hidden className="size-4" />}>Change password</Button></div>
    </form>
  );
}

export function RevokeOtherSessionsButton({ otherSessionCount }: { otherSessionCount: number }) {
  const { csrfToken } = useSession();
  const { showToast } = useToast();
  const router = useRouter();
  const [isRevoking, setIsRevoking] = useState(false);

  async function revoke() {
    setIsRevoking(true);
    const result = await sendApiRequest<{ revoked_sessions: number }>("/api/profile/sessions", { method: "DELETE", csrfToken });
    setIsRevoking(false);
    if (!result.ok) {
      showToast("error", result.message);
      return;
    }
    showToast("success", `${result.data.revoked_sessions} other session(s) signed out.`);
    router.refresh();
  }

  return (
    <Button variant="danger" size="sm" onClick={revoke} isLoading={isRevoking} disabled={otherSessionCount === 0}
            icon={<LogOut aria-hidden className="size-4" />}>
      Sign out other sessions
    </Button>
  );
}
