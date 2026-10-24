import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { moderationCases } from '@/db/schema';

export async function isCaseEvidence(objectKey: string) {
  const [record] = await db
    .select({ id: moderationCases.id })
    .from(moderationCases)
    .where(sql`${moderationCases.evidence}->'images' @> ${JSON.stringify([{ objectKey }])}::jsonb`)
    .limit(1);
  return Boolean(record);
}
