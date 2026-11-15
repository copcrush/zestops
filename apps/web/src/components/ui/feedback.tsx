import { AlertTriangle, CheckCircle2, Info, SearchX, XCircle } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "./cn";

type AlertTone = "info" | "success" | "warning" | "danger";

const alertStyles: Record<AlertTone, { className: string; icon: ReactNode }> = {
  info: { className: "bg-sky/60", icon: <Info aria-hidden className="size-5 shrink-0" /> },
  success: { className: "bg-lime", icon: <CheckCircle2 aria-hidden className="size-5 shrink-0" /> },
  warning: { className: "bg-lemon", icon: <AlertTriangle aria-hidden className="size-5 shrink-0" /> },
  danger: { className: "bg-coral-soft", icon: <XCircle aria-hidden className="size-5 shrink-0" /> },
};

export function Alert({ tone = "info", title, children, className }: {
  tone?: AlertTone; title?: string; children?: ReactNode; className?: string;
}) {
  const style = alertStyles[tone];
  return (
    <div role={tone === "danger" ? "alert" : "status"}
         className={cn("flex gap-3 rounded-brutal border-2 border-ink px-4 py-3 shadow-brutal-sm", style.className, className)}>
      {style.icon}
      <div className="min-w-0 text-sm">
        {title ? <p className="font-bold">{title}</p> : null}
        {children ? <div className={cn(title && "mt-0.5")}>{children}</div> : null}
      </div>
    </div>
  );
}

export function EmptyState({ title, description, action, icon }: {
  title: string; description?: string; action?: ReactNode; icon?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 px-6 py-12 text-center">
      <div className="grid size-14 place-items-center rounded-full border-2 border-ink bg-lemon-soft shadow-brutal-sm">
        {icon ?? <SearchX aria-hidden className="size-6" />}
      </div>
      <div>
        <p className="text-base font-bold">{title}</p>
        {description ? <p className="mx-auto mt-1 max-w-sm text-sm text-muted">{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function ErrorState({ title = "Could not load this section", message, action }: {
  title?: string; message: string; action?: ReactNode;
}) {
  return (
    <div className="p-4">
      <Alert tone="danger" title={title}>
        <p>{message}</p>
        {action ? <div className="mt-3">{action}</div> : null}
      </Alert>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-ink/10", className)} />;
}
