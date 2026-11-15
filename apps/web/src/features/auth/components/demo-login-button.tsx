"use client";

import { Eye } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";
import { isApiErrorBody } from "@/lib/shared/api-error";

/** "Explore as guest": signs in to the shared read-only viewer account without a password. */
export function DemoLoginButton() {
  const [isStarting, setIsStarting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  async function startDemo() {
    setIsStarting(true);
    setErrorMessage(null);
    try {
      const response = await fetch("/api/auth/demo", { method: "POST", credentials: "same-origin" });
      if (response.ok) {
        // Full page load so every Server Component renders with the new session.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination
        window.location.assign("/dashboard");
        return;
      }
      const responseBody: unknown = await response.json().catch(() => null);
      setErrorMessage(isApiErrorBody(responseBody) ? responseBody.error.message : "The demo is unavailable right now.");
    } catch {
      setErrorMessage("Network error. Please try again.");
    }
    setIsStarting(false);
  }

  return (
    <div className="flex flex-col gap-3">
      {errorMessage ? <Alert tone="danger">{errorMessage}</Alert> : null}
      <Button variant="accent" onClick={startDemo} isLoading={isStarting} className="w-full"
              icon={<Eye aria-hidden className="size-4" />}>
        Explore as guest (read-only)
      </Button>
    </div>
  );
}
