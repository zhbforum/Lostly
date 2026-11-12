import { and, asc, eq } from 'drizzle-orm';
import { db, type DatabaseTransaction } from '@/db';
import { claimMessageAttachments, claimMessages } from '@/db/conversations';
import { messageSelection } from './selection';

export interface MessageOperation {
  conversationId: string;
  userId: string;
  clientOperationId: string;
}
export interface MessageFingerprint {
  body: string | null;
  sourceHashes: string[];
}

export async function findMessageOperation(
  input: MessageOperation,
  executor: typeof db | DatabaseTransaction = db,
) {
  const [message] = await executor
    .select({ ...messageSelection, body: claimMessages.body })
    .from(claimMessages)
    .where(
      and(
        eq(claimMessages.conversationId, input.conversationId),
        eq(claimMessages.senderUserId, input.userId),
        eq(claimMessages.clientOperationId, input.clientOperationId),
      ),
    )
    .limit(1);
  if (!message) return null;
  const rows = await executor
    .select({ sourceHash: claimMessageAttachments.sourceHash })
    .from(claimMessageAttachments)
    .where(eq(claimMessageAttachments.messageId, message.id))
    .orderBy(asc(claimMessageAttachments.position));
  return {
    message: { ...message, body: message.isHidden ? null : message.body },
    body: message.body,
    sourceHashes: rows.map((row) => row.sourceHash),
  };
}

export function sameMessageFingerprint(a: MessageFingerprint, b: MessageFingerprint) {
  return (
    a.body === b.body &&
    a.sourceHashes.length === b.sourceHashes.length &&
    a.sourceHashes.every((hash, index) => hash === b.sourceHashes[index])
  );
}
