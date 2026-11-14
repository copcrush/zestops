"""In-memory token-bucket rate limiter, keyed by authenticated user.

Limitation: counters live in this process. Several instances would each keep
their own counters (documented in docs/KNOWN_LIMITATIONS.md).
"""

from __future__ import annotations

import math
import time
from dataclasses import dataclass


@dataclass
class _Bucket:
    tokens: float
    last_refill: float


class RateLimiter:
    def __init__(self, requests_per_minute: int) -> None:
        self.capacity = float(requests_per_minute)
        self.refill_per_second = requests_per_minute / 60.0
        self._buckets: dict[str, _Bucket] = {}
        self._last_cleanup = time.monotonic()

    def try_acquire(self, client_key: str) -> float | None:
        """Take one token. Returns None if allowed, else seconds to wait before retrying."""
        now = time.monotonic()
        self._cleanup_idle_buckets(now)

        bucket = self._buckets.get(client_key)
        if bucket is None:
            bucket = _Bucket(tokens=self.capacity, last_refill=now)
            self._buckets[client_key] = bucket

        elapsed = now - bucket.last_refill
        bucket.tokens = min(self.capacity, bucket.tokens + elapsed * self.refill_per_second)
        bucket.last_refill = now

        if bucket.tokens >= 1:
            bucket.tokens -= 1
            return None
        return max(1.0, math.ceil((1 - bucket.tokens) / self.refill_per_second))

    def _cleanup_idle_buckets(self, now: float) -> None:
        if now - self._last_cleanup < 60:
            return
        idle_after_seconds = 600
        self._buckets = {
            key: bucket
            for key, bucket in self._buckets.items()
            if now - bucket.last_refill < idle_after_seconds
        }
        self._last_cleanup = now
