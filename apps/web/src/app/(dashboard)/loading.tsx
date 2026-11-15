import { Skeleton } from "@/components/ui/feedback";

/** Shown instantly while a dashboard page loads its data on the server. */
export default function DashboardLoading() {
  return (
    <div role="status" aria-label="Loading page">
      <Skeleton className="h-4 w-28" />
      <Skeleton className="mt-3 h-10 w-72" />
      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-28 rounded-brutal" />)}
      </div>
      <Skeleton className="mt-6 h-72 rounded-brutal" />
      <span className="sr-only">Loading…</span>
    </div>
  );
}
