import type { ReactNode } from "react";

import { cn } from "./cn";

export type BadgeTone = "lime" | "lemon" | "coral" | "nova" | "sky" | "mist" | "ink";

const toneClasses: Record<BadgeTone, string> = {
  lime: "bg-lime",
  lemon: "bg-lemon",
  coral: "bg-coral",
  nova: "bg-nova",
  sky: "bg-sky",
  mist: "bg-mist",
  ink: "bg-ink text-paper",
};

export function Badge({ tone = "mist", icon, className, children }: {
  tone?: BadgeTone; icon?: ReactNode; className?: string; children: ReactNode;
}) {
  return (
    <span className={cn(
      "inline-flex items-center gap-1 whitespace-nowrap rounded-md border-2 border-ink px-1.5 py-0.5",
      "font-mono text-[11px] font-bold uppercase leading-none tracking-wide",
      toneClasses[tone], className)}>
      {icon}
      {children}
    </span>
  );
}

/** Marks rows created by the seed scripts, so demo data is never mistaken for real activity. */
export function DemoSeedBadge() {
  return <Badge tone="nova" className="text-[10px]">Demo seed</Badge>;
}
