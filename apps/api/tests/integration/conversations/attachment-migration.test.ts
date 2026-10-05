import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { db, type DatabaseTransaction } from '@/db';

if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test')
  throw new Error('Attachment migration tests require lostly_test');

const migrationName = '20261004235303_conversation_message_attachments';
const migrationsDirectory = new URL('../../../drizzle/', import.meta.url);

async function applyMigration(tx: DatabaseTransaction, name: string) {
  const migration = await Bun.file(new URL(`${name}/migration.sql`, migrationsDirectory)).text();
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await tx.execute(sql.raw(statement));
  }
}

test.each([false, true])(
  'attachment migration preserves historical conversations and text: %s',
  async (seedHistory) => {
    const rollback = new Error('Roll back isolated attachment migration schema');
    try {
      await db.transaction(async (tx) => {
        const schema = sql.identifier(
          'attachment_migration_' + crypto.randomUUID().replaceAll('-', ''),
        );
        await tx.execute(sql`create schema ${schema}`);
        await tx.execute(sql`set local search_path to ${schema}`);
        for (const name of (await readdir(migrationsDirectory)).sort()) {
          if (name < migrationName) await applyMigration(tx, name);
        }
        if (seedHistory) {
          const people = await tx.execute<{ id: string }>(sql`
          insert into users (email, display_name, password_hash)
          values ('owner@example.com', 'Owner', 'unused'), ('claimant@example.com', 'Claimant', 'unused') returning id
        `);
          const listings = await tx.execute<{ id: string }>(sql`
          insert into listings (created_by_user_id, kind, title, description, location, occurred_on)
          values (${people[0]!.id}, 'found', 'Historical report', 'Description', 'Berlin', '2026-09-01') returning id
        `);
          const claims = await tx.execute<{ id: string }>(sql`
          insert into claims (listing_id, claimant_user_id, verification_details)
          values (${listings[0]!.id}, ${people[1]!.id}, 'Private proof') returning id
        `);
          const rooms = await tx.execute<{ id: string }>(sql`
          insert into claim_conversations (claim_id, next_message_sequence, last_message_at)
          values (${claims[0]!.id}, 4, '2026-09-01T12:00:00.123456Z') returning id
        `);
          for (const person of people)
            await tx.execute(sql`
          insert into claim_conversation_members (conversation_id, user_id, last_read_sequence)
          values (${rooms[0]!.id}, ${person.id}, 2)
        `);
          const bodies = ['  Historical\r\ntext 😀  ', 'a'.repeat(2000), '😀'.repeat(2000)];
          for (const [index, body] of bodies.entries())
            await tx.execute(sql`
          insert into claim_messages (conversation_id, sequence, sender_user_id, client_operation_id, body, created_at)
          values (${rooms[0]!.id}, ${index + 1}, ${people[0]!.id}, ${crypto.randomUUID()}, ${body}, '2026-09-01T12:00:00.123456Z')
        `);
        }
        const tables = ['claim_messages', 'claim_conversations', 'claim_conversation_members'];
        const before = [];
        for (const table of tables)
          before.push(
            Array.from(
              await tx.execute(
                sql`select row_to_json(t) as row from ${sql.identifier(table)} t order by row_to_json(t)::text`,
              ),
            ),
          );
        await applyMigration(tx, migrationName);
        for (const [index, table] of tables.entries()) {
          expect(
            Array.from(
              await tx.execute(
                sql`select row_to_json(t) as row from ${sql.identifier(table)} t order by row_to_json(t)::text`,
              ),
            ),
          ).toEqual(before[index]!);
        }
        expect(await tx.execute(sql`select * from claim_message_attachments`)).toHaveLength(0);
        if (seedHistory) {
          await tx.execute(sql`update claim_messages set body = null where sequence = 1`);
          expect(
            await tx.execute(sql`select id from claim_messages where body is null`),
          ).toHaveLength(1);
        }
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  },
  15000,
);
