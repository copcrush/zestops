import type { HTMLAttributes, ReactNode } from "react";

import { cn } from "./cn";

export function Card({ className, children, ...divProps }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("rounded-brutal border-2 border-ink bg-white shadow-brutal", className)} {...divProps}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, actions, titleId }: {
  title: ReactNode; description?: ReactNode; actions?: ReactNode; titleId?: string;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-ink px-5 py-4">
      <div className="min-w-0">
        <h2 id={titleId} className="text-lg font-bold leading-tight">{title}</h2>
        {description ? <p className="mt-0.5 text-sm text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
}
