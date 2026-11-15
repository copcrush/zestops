import type { ReactNode } from "react";

import { cn } from "./cn";

const accentClasses = {
  lime: "bg-lime",
  lemon: "bg-lemon",
  nova: "bg-nova",
  sky: "bg-sky",
  coral: "bg-coral",
} as const;

export function StatCard({ label, value, hint, icon, accent = "lime" }: {
  label: string; value: ReactNode; hint?: ReactNode; icon?: ReactNode; accent?: keyof typeof accentClasses;
}) {
  return (
    <div className="relative overflow-hidden rounded-brutal border-2 border-ink bg-white p-4 shadow-brutal">
      <div className="flex items-start justify-between gap-3">
        <p className="font-mono text-[11px] font-bold uppercase tracking-[0.14em] text-muted">{label}</p>
        {icon ? (
          <span className={cn("grid size-9 place-items-center rounded-lg border-2 border-ink", accentClasses[accent])}>
            {icon}
          </span>
        ) : null}
      </div>
      <p className="tabular mt-2 font-mono text-3xl font-bold leading-none tracking-tight">{value}</p>
      {hint ? <p className="mt-2 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}
