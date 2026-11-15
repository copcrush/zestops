"use client";

import { Activity, CreditCard, LayoutDashboard, Menu, ScrollText, Settings, Siren, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useState } from "react";

import { hasPermission } from "@/features/auth/permissions";
import { LogoutButton } from "@/features/auth/components/logout-button";
import { useSession } from "@/features/auth/components/session-provider";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/components/ui/cn";

import { Logo } from "./logo";

const navigationItems = [
  { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/monitoring", label: "Monitoring", icon: Activity },
  { href: "/incidents", label: "Incidents", icon: Siren },
  { href: "/audit", label: "Audit log", icon: ScrollText, adminOnly: true },
  { href: "/settings", label: "Settings", icon: Settings },
];

function NavigationLinks({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { user } = useSession();
  const visibleItems = navigationItems.filter((item) => !item.adminOnly || hasPermission(user.role, "viewAuditLog"));

  return (
    <ul className="flex flex-col gap-1.5">
      {visibleItems.map((item) => {
        const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link href={item.href} onClick={onNavigate} aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "flex items-center gap-3 rounded-brutal border-2 px-3 py-2.5 text-[15px] font-semibold transition-all",
                    isActive
                      ? "border-ink bg-lime shadow-brutal-sm"
                      : "border-transparent hover:border-ink hover:bg-white",
                  )}>
              <Icon aria-hidden className="size-[18px]" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function UserCard() {
  const { user } = useSession();
  return (
    <div className="rounded-brutal border-2 border-ink bg-white p-3 shadow-brutal-sm">
      <div className="flex items-center gap-3">
        <span aria-hidden className="grid size-10 shrink-0 place-items-center rounded-full border-2 border-ink bg-nova font-bold">
          {user.displayName.slice(0, 1).toUpperCase()}
        </span>
        <div className="min-w-0">
          <p className="truncate text-sm font-bold">{user.displayName}</p>
          <p className="truncate text-xs text-muted">{user.email}</p>
        </div>
      </div>
      <div className="mt-3 flex items-center justify-between gap-2">
        <Badge tone={user.role === "admin" ? "lemon" : "sky"}>{user.role}</Badge>
        <LogoutButton />
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  // Closed again by NavigationLinks' onNavigate when a link is chosen.
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh lg:grid lg:grid-cols-[264px_1fr]">
      <a href="#main-content"
         className="sr-only z-50 rounded-md border-2 border-ink bg-lemon px-3 py-2 font-semibold focus:not-sr-only focus:fixed focus:left-4 focus:top-4">
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="sticky top-0 hidden h-dvh flex-col gap-6 border-r-2 border-ink bg-paper/95 p-5 lg:flex">
        <Link href="/dashboard" aria-label="ZestOps home"><Logo /></Link>
        <nav aria-label="Main navigation" className="flex-1"><NavigationLinks /></nav>
        <UserCard />
      </aside>

      {/* Mobile top bar */}
      <header className="sticky top-0 z-40 flex items-center justify-between border-b-2 border-ink bg-paper/95 px-4 py-3 backdrop-blur lg:hidden">
        <Link href="/dashboard" aria-label="ZestOps home"><Logo /></Link>
        <button type="button" onClick={() => setIsMobileMenuOpen((isOpen) => !isOpen)}
                aria-expanded={isMobileMenuOpen} aria-controls="mobile-navigation"
                className="rounded-brutal border-2 border-ink bg-white p-2 shadow-brutal-sm">
          {isMobileMenuOpen ? <X aria-hidden className="size-5" /> : <Menu aria-hidden className="size-5" />}
          <span className="sr-only">{isMobileMenuOpen ? "Close menu" : "Open menu"}</span>
        </button>
      </header>
      {isMobileMenuOpen ? (
        <div id="mobile-navigation" className="border-b-2 border-ink bg-paper px-4 pb-4 pt-2 lg:hidden">
          <nav aria-label="Main navigation"><NavigationLinks onNavigate={() => setIsMobileMenuOpen(false)} /></nav>
          <div className="mt-4"><UserCard /></div>
        </div>
      ) : null}

      <main id="main-content" tabIndex={-1} className="min-w-0 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
        <div className="mx-auto max-w-6xl">{children}</div>
      </main>
    </div>
  );
}
