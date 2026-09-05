interface Bucket {
  count: number;
  expiresAt: number;
}

// Bounded process-local limiter. A shared gateway/Redis limiter is still needed across replicas.
export function createRateLimiter(limit: number, windowMs: number, maxKeys = 10000) {
  const buckets = new Map<string, Bucket>();
  let nextSweep = 0;
  return (key: string, now = Date.now()): number | null => {
    if (now >= nextSweep) {
      for (const [id, bucket] of buckets) if (bucket.expiresAt <= now) buckets.delete(id);
      nextSweep = now + windowMs;
    }
    let bucket = buckets.get(key);
    if (!bucket || bucket.expiresAt <= now) {
      if (!bucket && buckets.size >= maxKeys)
        return Math.max(1, Math.ceil((nextSweep - now) / 1000));
      bucket = { count: 0, expiresAt: now + windowMs };
      buckets.set(key, bucket);
    }
    if (bucket.count >= limit) return Math.max(1, Math.ceil((bucket.expiresAt - now) / 1000));
    bucket.count += 1;
    return null;
  };
}
