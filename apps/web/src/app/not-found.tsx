import { Compass } from "lucide-react";
import { connection } from "next/server";

import { Logo } from "@/components/layout/logo";
import { ButtonLink } from "@/components/ui/button";

export default async function NotFoundPage() {
  await connection(); // dynamic, so the CSP nonce applies (see unauthorized/page.tsx)
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-6 px-4 text-center">
      <Logo />
      <div className="w-full max-w-md rounded-brutal border-2 border-ink bg-white p-8 shadow-brutal-lg">
        <div className="mx-auto grid size-16 place-items-center rounded-full border-2 border-ink bg-sky shadow-brutal-sm">
          <Compass aria-hidden className="size-8" />
        </div>
        <p className="mt-4 font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted">Error 404</p>
        <h1 className="mt-1 text-2xl font-bold">Lost in orbit</h1>
        <p className="mt-2 text-muted">The page you are looking for does not exist or was moved.</p>
        <div className="mt-6"><ButtonLink href="/dashboard" variant="primary">Go to overview</ButtonLink></div>
      </div>
    </main>
  );
}
