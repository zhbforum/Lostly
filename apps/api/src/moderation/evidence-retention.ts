import { sql } from 'drizzle-orm';
import { db } from '@/db';
import { moderationCases } from '@/db/schema';

export async function isCaseEvidence(objectKey: string) {
  const [record] = await db
    .select({ id: moderationCases.id })
    .from(moderationCases)
    .where(
      sql`exists (select 1 from jsonb_array_elements(coalesce(${moderationCases.evidence}->'images', '[]'::jsonb)) image where image->>'objectKey' = ${objectKey})`,
    )
    .limit(1);
  return Boolean(record);
}
