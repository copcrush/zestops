/** Display helpers shared by server and browser components. */

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Bangkok",
});

export function formatDateTime(isoTimestamp: string | null | undefined): string {
  if (!isoTimestamp) {
    return "—";
  }
  return `${dateTimeFormatter.format(new Date(isoTimestamp))} ICT`;
}

export function formatRelativeTime(isoTimestamp: string | null | undefined, now: Date = new Date()): string {
  if (!isoTimestamp) {
    return "never";
  }
  const elapsedSeconds = Math.round((now.getTime() - new Date(isoTimestamp).getTime()) / 1000);
  if (elapsedSeconds < 60) {
    return "just now";
  }
  const units: [number, string][] = [[60 * 60 * 24, "day"], [60 * 60, "hour"], [60, "minute"]];
  for (const [secondsPerUnit, unitName] of units) {
    if (elapsedSeconds >= secondsPerUnit) {
      const count = Math.floor(elapsedSeconds / secondsPerUnit);
      return `${count} ${unitName}${count === 1 ? "" : "s"} ago`;
    }
  }
  return "just now";
}

export function shortId(id: string): string {
  return id.slice(0, 8);
}

export function humanize(value: string): string {
  const spaced = value.replaceAll("_", " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** "1 payment", "2 payments". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
