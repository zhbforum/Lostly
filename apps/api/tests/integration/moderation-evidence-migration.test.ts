import { expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { EVIDENCE_RETENTION_MS } from '@/moderation/evidence';

if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test')
  throw new Error('Migration checks require lostly_test');

test('migration preserves snapshot age, removes private audit metadata and never fabricates legacy decision evidence', async () => {
  const schema = 'evidence_migration_' + crypto.randomUUID().replaceAll('-', '');
  const migration = await Bun.file(
    new URL(
      '../../drizzle/20261102174210_moderation_evidence_lifecycle/migration.sql',
      import.meta.url,
    ),
  ).text();
  const reportId = crypto.randomUUID();
  const profileDecisionId = crypto.randomUUID();
  const oldDecisionId = crypto.randomUUID();
  const targetId = crypto.randomUUID();
  const profileAppealId = crypto.randomUUID();
  const legacyAppealId = crypto.randomUUID();
  const createdAt = new Date('2026-01-01T00:00:00Z');
  await db.transaction(async (tx) => {
    await tx.execute(sql.raw(`CREATE SCHEMA "${schema}"`));
    await tx.execute(sql.raw(`SET LOCAL search_path TO "${schema}"`));
    await tx.execute(sql`CREATE TABLE moderation_cases (
      id uuid PRIMARY KEY, kind text NOT NULL, target_type text NOT NULL, target_id uuid NOT NULL,
      parent_event_id uuid, evidence jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL)`);
    await tx.execute(sql`CREATE TABLE moderation_events (
      id uuid PRIMARY KEY, target_id uuid NOT NULL, action text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL)`);
    await tx.execute(sql`INSERT INTO moderation_events (id, target_id, action, metadata, created_at) VALUES
      (${profileDecisionId}::uuid, ${targetId}::uuid, 'reset_profile',
        jsonb_build_object('fields', jsonb_build_array('bio'), 'previousProfile', jsonb_build_object('bio', 'Historical private bio')), ${createdAt.toISOString()}::timestamptz),
      (${oldDecisionId}::uuid, ${targetId}::uuid, 'hide_listing', '"Malformed legacy content"'::jsonb, ${createdAt.toISOString()}::timestamptz)`);
    await tx.execute(sql`INSERT INTO moderation_cases (id, kind, target_type, target_id, parent_event_id, evidence, created_at) VALUES
      (${reportId}::uuid, 'report', 'listing', ${targetId}::uuid, NULL,
        jsonb_build_object('text', 'Reported content', 'listingId', ${targetId}::text), ${createdAt.toISOString()}::timestamptz),
      (${profileAppealId}::uuid, 'appeal', 'user', ${targetId}::uuid, ${profileDecisionId}::uuid,
        '{"text":"Old appeal copy"}', ${createdAt.toISOString()}::timestamptz),
      (${legacyAppealId}::uuid, 'appeal', 'listing', ${targetId}::uuid, ${oldDecisionId}::uuid,
        '{"text":"Untrustworthy inherited content"}', ${createdAt.toISOString()}::timestamptz)`);
    for (const statement of migration
      .split('--> statement-breakpoint')
      .filter((value) => value.trim()))
      await tx.execute(sql.raw(statement));
    const snapshots = await tx.execute<{ id: string; payload: { text: string }; expires_at: Date }>(
      sql`SELECT * FROM moderation_evidence ORDER BY id`,
    );
    expect(snapshots).toHaveLength(2);
    for (const snapshot of snapshots)
      expect(new Date(snapshot.expires_at).getTime()).toBe(
        createdAt.getTime() + EVIDENCE_RETENTION_MS,
      );
    expect(snapshots.find((snapshot) => snapshot.id === profileDecisionId)!.payload.text).toBe(
      'Historical private bio',
    );
    const cases = await tx.execute<{ id: string; evidence_id: string | null; evidence: object }>(
      sql`SELECT * FROM moderation_cases`,
    );
    expect(cases.find((record) => record.id === reportId)!.evidence_id).toBe(reportId);
    expect(cases.find((record) => record.id === profileAppealId)!.evidence_id).toBe(
      profileDecisionId,
    );
    expect(cases.find((record) => record.id === legacyAppealId)!.evidence_id).toBeNull();
    expect(JSON.stringify(cases)).not.toMatch(
      /Reported content|private bio|Old appeal|Untrustworthy/,
    );
    const events = await tx.execute(sql`SELECT metadata FROM moderation_events`);
    expect(JSON.stringify(events)).not.toMatch(
      /private bio|previousProfile|previousAvatarId|Malformed/,
    );
    await tx.execute(sql.raw(`DROP SCHEMA "${schema}" CASCADE`));
  });
});
