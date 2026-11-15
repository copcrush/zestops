import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { Logo } from "@/components/layout/logo";
import { Alert } from "@/components/ui/feedback";
import { DemoLoginButton } from "@/features/auth/components/demo-login-button";
import { LoginForm } from "@/features/auth/components/login-form";
import { getCurrentSession } from "@/features/auth/server/current-session";
import { isPublicDemoEnabled } from "@/features/auth/server/demo-access";
import { getServerEnvironment } from "@/lib/server/env";
import { getSafeRedirectPath } from "@/lib/shared/safe-redirect";

export const metadata: Metadata = { title: "Sign in" };

const reasonMessages: Record<string, { tone: "info" | "warning"; text: string }> = {
  expired: { tone: "warning", text: "Your session expired. Please sign in again." },
  "signed-out": { tone: "info", text: "You have been signed out." },
};

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, reason } = await searchParams;
  const redirectPath = getSafeRedirectPath(typeof next === "string" ? next : null);

  if (await getCurrentSession()) {
    redirect(redirectPath);
  }

  const reasonMessage = typeof reason === "string" ? reasonMessages[reason] : undefined;
  const showLocalDemoAccounts = getServerEnvironment().APP_ENV === "development";

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <section aria-hidden className="relative hidden overflow-hidden border-r-2 border-ink bg-lime lg:flex lg:flex-col lg:justify-between lg:p-12">
        <Logo />
        <div className="relative z-10 max-w-sm xl:max-w-md">
          <p className="font-mono text-xs font-bold uppercase tracking-[0.2em]">Financial ops · Service health</p>
          <p className="mt-4 text-5xl font-bold leading-[1.05] tracking-tight">
            Payments in check.<br />Services in orbit.
          </p>
          <p className="mt-5 text-lg">
            Simulated payments, idempotent APIs, SSRF-safe monitoring and incident response — in one dashboard.
          </p>
        </div>
        <div className="relative z-10 flex flex-wrap gap-2">
          {["Go · Gin", "Python · FastAPI", "Next.js", "PostgreSQL"].map((technology) => (
            <span key={technology} className="rounded-md border-2 border-ink bg-white px-2 py-1 font-mono text-xs font-bold">
              {technology}
            </span>
          ))}
        </div>
        <div className="absolute -right-28 -top-16 size-64 rotate-12 rounded-[48px] border-2 border-ink bg-lemon shadow-brutal-lg" />
        <div className="absolute -bottom-16 -right-10 size-48 -rotate-6 rounded-full border-2 border-ink bg-nova shadow-brutal-lg" />
        <div className="absolute right-12 top-56 size-12 rotate-45 border-2 border-ink bg-sky shadow-brutal" />
      </section>

      <main className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-3xl font-bold tracking-tight">Sign in</h1>
          <p className="mt-1 text-muted">Use your ZestOps account to continue.</p>

          {reasonMessage ? <Alert tone={reasonMessage.tone} className="mt-6">{reasonMessage.text}</Alert> : null}

          <div className="mt-6 rounded-brutal border-2 border-ink bg-white p-6 shadow-brutal-lg">
            <LoginForm redirectPath={redirectPath} />
          </div>

          {isPublicDemoEnabled() ? (
            <div className="mt-6 rounded-brutal border-2 border-ink bg-nova/40 p-5 shadow-brutal">
              <p className="font-bold">Just looking around?</p>
              <p className="mb-4 mt-1 text-sm">
                Explore the dashboard with a shared read-only viewer account. No sign-up needed.
              </p>
              <DemoLoginButton />
            </div>
          ) : null}

          {showLocalDemoAccounts ? (
            <div className="mt-6 rounded-brutal border-2 border-dashed border-ink bg-lemon-soft p-4 text-sm">
              <p className="font-bold">Local demo accounts (development only)</p>
              <ul className="mt-2 space-y-1 font-mono text-xs">
                <li>admin@zestops.demo / LocalAdmin#2026</li>
                <li>viewer@zestops.demo / LocalViewer#2026</li>
              </ul>
            </div>
          ) : null}

          <p className="mt-6 text-xs text-muted">
            Portfolio project. All payments are simulated — never enter real card or banking details.
          </p>
        </div>
      </main>
    </div>
  );
}
