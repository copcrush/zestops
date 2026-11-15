"use client";

import { RotateCcw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Alert } from "@/components/ui/feedback";

/** Error boundary for dashboard pages: shows a safe message, never stack traces. */
export default function DashboardError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="mx-auto max-w-xl py-10">
      <Alert tone="danger" title="This page could not be loaded">
        <p>A service may be temporarily unavailable. Try again in a moment.</p>
        {error.digest ? <p className="mt-1 font-mono text-xs">Reference: {error.digest}</p> : null}
      </Alert>
      <Button className="mt-4" onClick={reset} icon={<RotateCcw aria-hidden className="size-4" />}>Try again</Button>
    </div>
  );
}
