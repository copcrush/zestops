import { ShieldX } from "lucide-react";
import type { Metadata } from "next";
import { connection } from "next/server";

import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui/button";

export const metadata: Metadata = { title: "Access denied" };

export default async function UnauthorizedPage() {
  // Render per request so the CSP nonce from src/proxy.ts can be applied to scripts
  // (a statically prerendered page has no nonce, and its scripts would be blocked).
  await connection();
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div className="w-full max-w-md rounded-brutal border-2 border-ink bg-white p-8 shadow-brutal-lg">
        <div className="mx-auto grid size-16 place-items-center rounded-full border-2 border-ink bg-coral shadow-brutal-sm">
          <ShieldX aria-hidden className="size-8" />
        </div>
        <p className="mt-4 font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">Error 403</p>
        <h1 className="mt-1 text-2xl font-bold">You don&apos;t have access to this page</h1>
        <p className="mt-2 text-muted">
          Your role does not include this permission. Ask an administrator if you think this is a mistake.
        </p>
        <div className="mt-6 flex justify-center gap-2">
          <ButtonLink href="/dashboard" variant="primary">Back to overview</ButtonLink>
        </div>
      </div>
    </main>
  );
}
