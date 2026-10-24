import { expect, spyOn, test } from 'bun:test';
process.env.DATABASE_URL ??= 'postgresql://unused:unused@127.0.0.1:1/lostly_test';
const { app } = await import('@/app');
const auth = await import('@/auth/service');
const operations = await import('./operations');

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
    expect(audit.mock.calls[0]?.[0]).toMatchObject({ caseId: id });
    expect(audit.mock.calls[0]?.[0].limit).toBeUndefined();
  } finally {
    audit.mockRestore();
    session.mockRestore();
  }
});
