import { AppShell } from "@/components/layout/app-shell";
import { ToastProvider } from "@/components/ui/toast";
import { SessionProvider } from "@/features/auth/components/session-provider";
import { requireSession } from "@/features/auth/server/current-session";
import { createCsrfToken } from "@/features/auth/server/csrf";

/**
 * Layout for every signed-in page. Note: layouts do not re-run on every client
 * navigation, so each page ALSO calls requireSession() before loading data.
 */
export default async function DashboardLayout({ children }: LayoutProps<"/">) {
  const session = await requireSession();
  return (
    <SessionProvider user={session.user} csrfToken={createCsrfToken(session.sessionId)}>
      <ToastProvider>
        <AppShell>{children}</AppShell>
      </ToastProvider>
    </SessionProvider>
  );
}
