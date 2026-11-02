import { and, eq, gt, isNull, lte, sql } from 'drizzle-orm';
import { db, type DatabaseTransaction } from '@/db';
import { moderationEvidence, users } from '@/db/schema';
import { listingImages } from '@/db/listing-images';
import { claimMessageAttachments } from '@/db/conversations';
import type { ObjectStorage } from '@/storage/object-storage';
import { evidenceContext } from './evidence';

export async function isCaseEvidence(
  objectKey: string,
  executor: typeof db | DatabaseTransaction = db,
) {
  const [record] = await executor
    .select({ id: moderationEvidence.id })
    .from(moderationEvidence)
    .where(
      and(
        isNull(moderationEvidence.purgedAt),
        gt(moderationEvidence.expiresAt, new Date()),
        sql`exists (select 1 from jsonb_array_elements(coalesce(${moderationEvidence.payload}->'images', '[]'::jsonb)) image where image->>'objectKey' = ${objectKey})`,
      ),
    )
    .limit(1);
  return Boolean(record);
}

async function isOrdinaryObject(tx: DatabaseTransaction, key: string) {
  const [row] = await tx.execute<{ present: boolean }>(sql`select (
    exists(select 1 from ${listingImages} where ${listingImages.objectKey} = ${key}) or
    exists(select 1 from ${claimMessageAttachments} where ${claimMessageAttachments.objectKey} = ${key}) or
    exists(select 1 from ${users} where 'avatars/' || ${users.id}::text || '/' || ${users.avatarId}::text || '.webp' = ${key})
  ) as present`);
  return row!.present;
}

export async function purgeExpiredEvidence(storage: ObjectStorage) {
  const expired = await db
    .select({ id: moderationEvidence.id })
    .from(moderationEvidence)
    .where(and(lte(moderationEvidence.expiresAt, new Date()), isNull(moderationEvidence.purgedAt)))
    .orderBy(moderationEvidence.expiresAt, moderationEvidence.id)
    .limit(100);
  let purged = 0;
  for (const { id } of expired) {
    try {
      purged += await db.transaction(async (tx) => {
        const [record] = await tx
          .select()
          .from(moderationEvidence)
          .where(
            and(
              eq(moderationEvidence.id, id),
              lte(moderationEvidence.expiresAt, new Date()),
              isNull(moderationEvidence.purgedAt),
            ),
          )
          .for('update', { skipLocked: true });
        if (!record) return 0;
        for (const { objectKey } of record.payload.images ?? []) {
          if ((await isOrdinaryObject(tx, objectKey)) || (await isCaseEvidence(objectKey, tx)))
            continue;
          await storage.delete(objectKey);
          // Animated avatar previews share the original avatar's lifetime.
          if (objectKey.startsWith('avatars/') && objectKey.endsWith('.webp'))
            await storage.delete(objectKey.slice(0, -5) + '-still.webp');
        }
        // Keep identifiers for case navigation, never the expired text or object keys.
        await tx
          .update(moderationEvidence)
          .set({ payload: evidenceContext(record.payload), purgedAt: new Date() })
          .where(eq(moderationEvidence.id, id));
        return 1;
      });
    } catch {
      // Keep the row pending if object storage or commit fails; deletes are idempotent.
      console.error(
        JSON.stringify({ level: 'error', event: 'evidence_cleanup_failed', evidenceId: id }),
      );
    }
  }
  return purged;
}

export function startEvidenceCleanup(storage: ObjectStorage) {
  let running = false;
  let stopped = false;
  async function run() {
    if (running || stopped) return;
    running = true;
    try {
      await purgeExpiredEvidence(storage);
    } catch {
      console.error(JSON.stringify({ level: 'error', event: 'evidence_cleanup_failed' }));
    } finally {
      running = false;
    }
  }
  const timer = setInterval(() => {
    void run();
  }, 15 * 60_000);
  timer.unref();
  void run();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
