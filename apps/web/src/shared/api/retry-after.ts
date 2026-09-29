export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (value === null || !value.trim()) return null;
  const header = value.trim();
  if (/^\d+$/.test(header)) {
    const seconds = Number(header);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }
  // Do not let Date.parse interpret malformed numeric delays as calendar dates.
  if (!/^[A-Za-z]{3},?\s/.test(header)) return null;
  const deadline = Date.parse(header);
  return Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : null;
}
