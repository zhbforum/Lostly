import { expect, test } from 'bun:test';
import { readdir } from 'node:fs/promises';
import { sql } from 'drizzle-orm';
import { db, type DatabaseTransaction } from '@/db';

if (!process.env.DATABASE_URL || new URL(process.env.DATABASE_URL).pathname !== '/lostly_test')
  throw new Error('Conversation migration tests require lostly_test');

const migrationName = '20260923184437_claim_conversations';
const migrationsDirectory = new URL('../../../drizzle/', import.meta.url);

async function applyMigration(tx: DatabaseTransaction, name: string) {
  const migration = await Bun.file(new URL(`${name}/migration.sql`, migrationsDirectory)).text();
  for (const statement of migration.split('--> statement-breakpoint')) {
    if (statement.trim()) await tx.execute(sql.raw(statement));
  }
}

test.each([false, true])(
  'migrates an isolated old schema with historical claims: %s',
  async (seedClaims) => {
    const rollback = new Error('Roll back the isolated migration test schema');
    try {
      await db.transaction(async (tx) => {
        const schema = sql.identifier(
          'conversation_migration_' + crypto.randomUUID().replaceAll('-', ''),
        );
        await tx.execute(sql`create schema ${schema}`);
        await tx.execute(sql`set local search_path to ${schema}`);
        for (const name of (await readdir(migrationsDirectory)).sort()) {
          if (name < migrationName) await applyMigration(tx, name);
        }
        if (seedClaims) {
          const people = await tx.execute<{ id: string }>(sql`
          insert into users (email, display_name, password_hash)
          values ('owner@example.com', 'Owner', 'unused'), ('claimant@example.com', 'Claimant', 'unused')
          returning id
        `);
          for (const status of ['pending', 'approved', 'rejected']) {
            for (const hidden of [false, true]) {
              const listingStatus =
                status === 'pending' ? 'active' : status === 'approved' ? 'resolved' : 'archived';
              const reports = await tx.execute<{ id: string }>(sql`
              insert into listings (created_by_user_id, kind, status, is_hidden, title, description, location, occurred_on)
              values (${people[0]!.id}, 'found', ${listingStatus}, ${hidden}, 'Historical report', 'Description', 'Berlin', '2026-09-01')
              returning id
            `);
              await tx.execute(sql`
              insert into claims (listing_id, claimant_user_id, status, verification_details, handover_details, created_at)
              values (${reports[0]!.id}, ${people[1]!.id}, ${status}, 'Private historical proof',
                ${status === 'approved' ? 'Private handover instructions' : null}, '2026-09-01T12:00:00.123456Z')
            `);
            }
          }
        }
        const before = await tx.execute(
          sql`select row_to_json(claims) as claim from claims order by id`,
        );
        await applyMigration(tx, migrationName);
        const after = await tx.execute(
          sql`select row_to_json(claims) as claim from claims order by id`,
        );
        expect(Array.from(after)).toEqual(Array.from(before));
        const rows = await tx.execute<{
          claim_id: string;
          conversation_id: string | null;
          correct_time: boolean;
          next_message_sequence: number;
          last_message_at: null;
          members: number;
          claimant_member: boolean;
          owner_member: boolean;
          unread_initialized: boolean;
        }>(sql`
        select c.id as claim_id, room.id as conversation_id, room.created_at = c.created_at as correct_time,
          room.next_message_sequence, room.last_message_at, count(member.user_id)::int as members,
          bool_or(member.user_id = c.claimant_user_id) as claimant_member,
          bool_or(member.user_id = listing.created_by_user_id) as owner_member,
          bool_and(member.last_read_sequence = 0 and member.created_at = room.created_at) as unread_initialized
        from claims c join listings listing on listing.id = c.listing_id
        left join claim_conversations room on room.claim_id = c.id
        left join claim_conversation_members member on member.conversation_id = room.id
        group by c.id, listing.id, room.id
      `);
        expect(rows).toHaveLength(seedClaims ? 6 : 0);
        for (const row of rows) {
          expect(row.conversation_id).toBeString();
          expect(row).toMatchObject({
            correct_time: true,
            next_message_sequence: 1,
            last_message_at: null,
            members: 2,
            claimant_member: true,
            owner_member: true,
            unread_initialized: true,
          });
        }
        expect(await tx.execute(sql`select id from claim_messages`)).toHaveLength(0);
        throw rollback;
      });
    } catch (error) {
      if (error !== rollback) throw error;
    }
  },
  15000,
);
