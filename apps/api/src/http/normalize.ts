// Transforms run before schema validation: never call string methods on unchecked input.
export function trimFields(body: unknown, fields: readonly string[]): void {
  normalizeFields(
    body,
    Object.fromEntries(fields.map((field) => [field, (value: string) => value.trim()])),
  );
}

export function normalizeFields(
  body: unknown,
  normalizers: Record<string, (value: string) => string>,
): void {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return;
  const record = body as Record<string, unknown>;
  for (const [field, normalize] of Object.entries(normalizers)) {
    if (typeof record[field] === 'string') record[field] = normalize(record[field]);
  }
}
