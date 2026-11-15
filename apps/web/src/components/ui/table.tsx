import type { ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

import { cn } from "./cn";

/**
 * Responsive table wrapper: scrolls horizontally on small screens instead of
 * overflowing. `relative` matters: without it, absolutely positioned children
 * (screen-reader-only labels) escape the scroll box and widen the whole page.
 */
export function DataTable({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <caption className="sr-only">{caption}</caption>
        {children}
      </table>
    </div>
  );
}

export function TableHeaderCell({ className, ...cellProps }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th scope="col" className={cn(
      "whitespace-nowrap border-b-2 border-ink bg-mist px-4 py-2.5 font-mono text-[11px] font-bold uppercase",
      "tracking-[0.12em] text-muted", className)} {...cellProps} />
  );
}

export function TableCell({ className, ...cellProps }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("border-b border-ink/15 px-4 py-3 align-middle", className)} {...cellProps} />;
}
