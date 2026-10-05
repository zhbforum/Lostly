import { and, asc, count, desc, eq, exists, gt, lt, sql } from 'drizzle-orm';
import {
  CONVERSATION_MESSAGE_PAGINATION,
  type ConversationInboxQuery,
  type ConversationMessagesQuery,
} from '@lostly/contracts/conversations';
import { db } from '@/db';
import {
  claimConversations,
  claimConversationMembers,
  claimMessages,
  claimMessageAttachments,
} from '@/db/conversations';
import { claims, listings, users } from '@/db/schema';
import { canSendConversationMessages } from '@/domain/conversation';
import { findCovers } from '@/listing-images/queries';
import { lockListing } from '@/listings/locking';
import {
  cursorCondition,
  decodeCursor,
  pageFromRows,
  timestampCursorValue,
} from '@/pagination/cursor';
import type { ObjectStorage } from '@/storage/object-storage';
import { objectStorage } from '@/storage/r2-storage';
import { conversationAccessPredicate, findConversationForMember } from './authorization';
import { hydrateMessages } from './attachments';
import { messageSelection } from './selection';
import { unreadMessageCount, unreadMessagePredicate } from './unread';

const lastActivityAt = sql`coalesce(${claimConversations.lastMessageAt}, ${claimConversations.createdAt})`;

function otherParticipantJoin(userId: string) {
  return eq(
    users.id,
    sql`case when ${claims.claimantUserId} = ${userId}::uuid
    then ${listings.createdByUserId} else ${claims.claimantUserId} end`,
  );
}

export async function listConversations(
  userId: string,
  query: ConversationInboxQuery = {},
  storage: ObjectStorage = objectStorage,
) {
  const scope = `conversation-inbox:${userId}`;
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor) return { ok: false, reason: 'invalid-cursor' } as const;
  const limit = query.limit ?? 20;
  const latest = db
    .select({
      ...messageSelection,
      attachmentCount: sql<number>`(select count(*)::int from ${claimMessageAttachments}
        where ${eq(claimMessageAttachments.messageId, claimMessages.id)})`.as('attachment_count'),
    })
    .from(claimMessages)
    .where(eq(claimMessages.conversationId, claimConversations.id))
    .orderBy(desc(claimMessages.sequence))
    .limit(1)
    .as('latest_message');
  const rows = await db
    .select({
      id: claimConversations.id,
      claim: { id: claims.id, status: claims.status },
      listing: {
        id: listings.id,
        kind: listings.kind,
        status: listings.status,
        title: listings.title,
      },
      otherParticipant: { id: users.id, displayName: users.displayName },
      lastMessage: {
        id: latest.id,
        sequence: latest.sequence,
        senderUserId: latest.senderUserId,
        body: latest.body,
        attachmentCount: latest.attachmentCount,
        createdAt: latest.createdAt,
      },
      lastActivityAt: lastActivityAt.mapWith(claimConversations.createdAt),
      cursorValue: timestampCursorValue(lastActivityAt),
      unreadCount: unreadMessageCount(userId),
    })
    .from(claimConversations)
    .innerJoin(
      claimConversationMembers,
      eq(claimConversationMembers.conversationId, claimConversations.id),
    )
    .innerJoin(claims, eq(claims.id, claimConversations.claimId))
    .innerJoin(listings, eq(listings.id, claims.listingId))
    .innerJoin(users, otherParticipantJoin(userId))
    .leftJoinLateral(latest, sql`true`)
    .where(
      and(
        conversationAccessPredicate(userId),
        cursor ? cursorCondition(lastActivityAt, claimConversations.id, cursor, false) : undefined,
      ),
    )
    .orderBy(desc(lastActivityAt), desc(claimConversations.id))
    .limit(limit + 1);
  const { items, pageInfo } = pageFromRows(rows, limit, scope);
  const covers = await findCovers([...new Set(items.map((row) => row.listing.id))], storage);
  return {
    ok: true,
    value: {
      conversations: items.map((row) => ({
        ...row,
        listing: { ...row.listing, coverImage: covers.get(row.listing.id) ?? null },
        canSendMessages: canSendConversationMessages(row.claim.status),
      })),
      pageInfo,
    },
  } as const;
}

export async function findConversationDetail(
  conversationId: string,
  userId: string,
  storage: ObjectStorage = objectStorage,
) {
  const [row] = await db
    .select({
      id: claimConversations.id,
      claim: {
        id: claims.id,
        status: claims.status,
        verificationDetails: claims.verificationDetails,
        handoverDetails: claims.handoverDetails,
        createdAt: claims.createdAt,
        reviewedAt: claims.reviewedAt,
      },
      listing: {
        id: listings.id,
        kind: listings.kind,
        status: listings.status,
        title: listings.title,
        location: listings.location,
        occurredOn: listings.occurredOn,
      },
      otherParticipant: { id: users.id, displayName: users.displayName },
      participantRole: sql<
        'claimant' | 'owner'
      >`case when ${claims.claimantUserId} = ${userId}::uuid
      then 'claimant' else 'owner' end`,
      unreadCount: unreadMessageCount(userId),
    })
    .from(claimConversations)
    .innerJoin(
      claimConversationMembers,
      eq(claimConversationMembers.conversationId, claimConversations.id),
    )
    .innerJoin(claims, eq(claims.id, claimConversations.claimId))
    .innerJoin(listings, eq(listings.id, claims.listingId))
    .innerJoin(users, otherParticipantJoin(userId))
    .where(and(eq(claimConversations.id, conversationId), conversationAccessPredicate(userId)))
    .limit(1);
  if (!row) return null;
  const covers = await findCovers([row.listing.id], storage);
  return {
    ...row,
    listing: { ...row.listing, coverImage: covers.get(row.listing.id) ?? null },
    canSendMessages: canSendConversationMessages(row.claim.status),
  };
}

export async function countUnreadConversations(userId: string) {
  const [row] = await db
    .select({ unreadConversationCount: count() })
    .from(claimConversations)
    .innerJoin(
      claimConversationMembers,
      eq(claimConversationMembers.conversationId, claimConversations.id),
    )
    .innerJoin(claims, eq(claims.id, claimConversations.claimId))
    .innerJoin(listings, eq(listings.id, claims.listingId))
    .where(
      and(
        conversationAccessPredicate(userId),
        exists(
          db
            .select({ id: claimMessages.id })
            .from(claimMessages)
            .where(unreadMessagePredicate(userId)),
        ),
      ),
    );
  return { unreadConversationCount: row?.unreadConversationCount ?? 0 };
}

export async function findConversationMessages(
  conversationId: string,
  userId: string,
  query: ConversationMessagesQuery = {},
  storage: ObjectStorage = objectStorage,
) {
  const { before, after } = query;
  const limit = query.limit ?? CONVERSATION_MESSAGE_PAGINATION.defaultLimit;
  if (
    (before !== undefined && after !== undefined) ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > CONVERSATION_MESSAGE_PAGINATION.maxLimit ||
    (before !== undefined && (!Number.isInteger(before) || before < 1 || before > 2147483647)) ||
    (after !== undefined && (!Number.isInteger(after) || after < 0 || after > 2147483647))
  )
    return { ok: false, reason: 'invalid-message-query' } as const;
  return db.transaction(async (tx) => {
    const reference = await findConversationForMember(conversationId, userId, tx);
    if (!reference) return { ok: false, reason: 'conversation-not-found' } as const;
    const listing = await lockListing(tx, reference.listingId, 'share');
    if (!listing || listing.isHidden)
      return { ok: false, reason: 'conversation-not-found' } as const;

    // Recheck access in the page query after acquiring the listing lock. Keep the lock until
    // attachment URLs have been signed: hide either commits first or waits for issuance.
    const order = after !== undefined ? asc : desc;
    const page = tx
      .select(messageSelection)
      .from(claimMessages)
      .where(
        and(
          eq(claimMessages.conversationId, claimConversations.id),
          before !== undefined ? lt(claimMessages.sequence, before) : undefined,
          after !== undefined ? gt(claimMessages.sequence, after) : undefined,
        ),
      )
      .orderBy(order(claimMessages.sequence))
      .limit(limit + 1)
      .as('message_page');
    const rows = await tx
      .select({
        conversationId: claimConversations.id,
        message: {
          id: page.id,
          conversationId: page.conversationId,
          sequence: page.sequence,
          senderUserId: page.senderUserId,
          body: page.body,
          createdAt: page.createdAt,
        },
      })
      .from(claimConversations)
      .innerJoin(
        claimConversationMembers,
        eq(claimConversationMembers.conversationId, claimConversations.id),
      )
      .innerJoin(claims, eq(claims.id, claimConversations.claimId))
      .innerJoin(listings, eq(listings.id, claims.listingId))
      .leftJoinLateral(page, sql`true`)
      .where(and(eq(claimConversations.id, conversationId), conversationAccessPredicate(userId)))
      .orderBy(order(page.sequence));
    if (!rows.length) return { ok: false, reason: 'conversation-not-found' } as const;
    const messages = rows.flatMap((row) => (row.message ? [row.message] : []));
    const selected = messages.slice(0, limit);
    if (after === undefined) selected.reverse();
    return {
      ok: true,
      value: {
        messages: await hydrateMessages(selected, storage, tx),
        pageInfo: { hasMore: messages.length > limit },
      },
    } as const;
  });
}
