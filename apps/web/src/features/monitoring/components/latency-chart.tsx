import type { CheckResult } from "@/types/monitoring";

const statusColors: Record<CheckResult["status"], string> = {
  up: "#9fd067", degraded: "#ffe66d", down: "#ff9b8f",
};

/**
 * Latency bars for recent checks, drawn with SVG attributes (no inline styles,
 * so it works under the strict Content-Security-Policy). Oldest on the left.
 */
export function LatencyChart({ checks }: { checks: CheckResult[] }) {
  const orderedChecks = [...checks].reverse().slice(-40);
  if (orderedChecks.length === 0) {
    return null;
  }
  const chartHeight = 120;
  const barWidth = 14;
  const gap = 6;
  const maximumLatency = Math.max(100, ...orderedChecks.map((check) => check.latency_ms ?? 0));
  const chartWidth = orderedChecks.length * (barWidth + gap);

  return (
    <figure>
      <svg viewBox={`0 0 ${chartWidth} ${chartHeight + 4}`} className="h-36 w-full" preserveAspectRatio="none" role="img"
           aria-label={`Latency of the last ${orderedChecks.length} checks, maximum ${maximumLatency} milliseconds`}>
        <line x1="0" y1={chartHeight} x2={chartWidth} y2={chartHeight} stroke="#141414" strokeWidth="2" />
        {orderedChecks.map((check, index) => {
          const barHeight = check.status === "down" && check.latency_ms === null
            ? chartHeight
            : Math.max(4, ((check.latency_ms ?? 0) / maximumLatency) * (chartHeight - 6));
          return (
            <rect key={check.id} x={index * (barWidth + gap) + gap / 2} y={chartHeight - barHeight} width={barWidth}
                  height={barHeight} rx="2" fill={statusColors[check.status]} stroke="#141414" strokeWidth="2">
              <title>{`${check.status} · ${check.latency_ms ?? "–"} ms · ${check.checked_at}`}</title>
            </rect>
          );
        })}
      </svg>
      <figcaption className="mt-2 flex flex-wrap gap-4 text-xs text-muted">
        <span>Max {maximumLatency} ms</span>
        {(["up", "degraded", "down"] as const).map((status) => (
          <span key={status} className="inline-flex items-center gap-1">
            <svg aria-hidden viewBox="0 0 10 10" className="size-2.5"><rect width="10" height="10" fill={statusColors[status]} stroke="#141414" strokeWidth="2" /></svg>
            {status}
          </span>
        ))}
      </figcaption>
    </figure>
  );
}
