import "server-only";

import { query } from "@/lib/server/db";

/**
 * Fixed-window rate limiting stored in PostgreSQL, so the limit is shared by
 * every server instance (important on serverless hosting such as Vercel).
 * Returns true if the request is allowed.
 */
export async function consumeRateLimit(bucketKey: string, maximumHits: number, windowSeconds: number):
  Promise<boolean> {
  const rows = await query<{ hit_count: number }>(
    `INSERT INTO identity.rate_limit_buckets (bucket_key, window_start, hit_count)
     VALUES ($1, to_timestamp(floor(extract(epoch FROM now()) / $2) * $2), 1)
     ON CONFLICT (bucket_key, window_start)
     DO UPDATE SET hit_count = identity.rate_limit_buckets.hit_count + 1
     RETURNING hit_count`,
    [bucketKey.slice(0, 200), windowSeconds],
  );
  return (rows[0]?.hit_count ?? 0) <= maximumHits;
}
