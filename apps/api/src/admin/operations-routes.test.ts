import { expect, spyOn, test } from 'bun:test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/lostly_test';
const { app } = await import('@/app');
const auth = await import('@/auth/service');
const operations = await import('./operations');
const service = await import('./service');
const cases = await import('@/moderation/cases');

test('requires an explicit report target type and category instead of applying enum defaults', async () => {
  const id = '550e8400-e29b-41d4-a716-446655440001';
  const session = spyOn(auth, 'getSession').mockResolvedValue({
    user: { id, email: 'member@example.test', displayName: 'Member', role: 'user' },
    session: { id, userId: id, expiresAt: new Date(Date.now() + 60000) },
  });
  const create = spyOn(cases, 'createReport').mockRejectedValue(
    new Error('Unexpected report creation'),
  );
  try {
    for (const body of [
      { targetId: id, category: 'other', description: 'Please review this report.' },
      { targetType: 'listing', targetId: id, description: 'Please review this report.' },
    ]) {
      const response = await app.handle(
        new Request('http://localhost/reports', {
          method: 'POST',
          headers: {
            cookie: 'lostly_session=test',
            'Content-Type': 'application/json',
            'X-CSRF-Protection': '1',
          },
          body: JSON.stringify(body),
        }),
      );
      expect(response.status).toBe(422);
    }
    expect(create).not.toHaveBeenCalled();
  } finally {
    create.mockRestore();
    session.mockRestore();
  }
});

test('forwards audit filters and keeps the dedicated audit route distinct from record browsing', async () => {
  const id = '550e8400-e29b-41d4-a716-446655440001';
  const session = spyOn(auth, 'getSession').mockResolvedValue({
    user: { id, email: 'admin@example.test', displayName: 'Moderator', role: 'admin' },
    session: { id, userId: id, expiresAt: new Date(Date.now() + 60000) },
  });
  const audit = spyOn(operations, 'auditPage').mockResolvedValue({
    items: [],
    pageInfo: { endCursor: null, hasNextPage: false },
  });
  try {
    const response = await app.handle(
      new Request('http://localhost/admin/audit?caseId=' + id, {
        headers: { cookie: 'lostly_session=test' },
      }),
    );
    expect(response.status).toBe(200);
    expect(audit).toHaveBeenCalledTimes(1);
    expect(audit.mock.calls[0]?.[0]).toEqual({ caseId: id });
    expect(audit.mock.calls[0]?.[0].limit).toBeUndefined();
  } finally {
    audit.mockRestore();
    session.mockRestore();
  }
});

test('omitted case and account filters do not silently default to the first enum value', async () => {
  const id = '550e8400-e29b-41d4-a716-446655440001';
  const session = spyOn(auth, 'getSession').mockResolvedValue({
    user: { id, email: 'admin@example.test', displayName: 'Moderator', role: 'admin' },
    session: { id, userId: id, expiresAt: new Date(Date.now() + 60000) },
  });
  const records = spyOn(service, 'adminRecords').mockResolvedValue({
    items: [],
    pageInfo: { endCursor: null, hasNextPage: false },
  });
  const queue = spyOn(cases, 'listCases').mockResolvedValue({
    items: [],
    pageInfo: { endCursor: null, hasNextPage: false },
  });
  try {
    const headers = { cookie: 'lostly_session=test' };
    expect(
      (await app.handle(new Request('http://localhost/admin/listings?q=backpack', { headers })))
        .status,
    ).toBe(200);
    expect(records.mock.calls[0]?.[1]).toEqual({ q: 'backpack' });
    expect(
      (await app.handle(new Request('http://localhost/admin/cases?kind=appeal', { headers })))
        .status,
    ).toBe(200);
    expect(queue.mock.calls[0]?.[0]).toEqual({
      kind: 'appeal',
      overdue: false,
      unassigned: false,
      active: false,
    });
  } finally {
    records.mockRestore();
    queue.mockRestore();
    session.mockRestore();
  }
});
