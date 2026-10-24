import { and, count, desc, eq, getTableColumns, gt, inArray, isNull, sql } from 'drizzle-orm';
import type { CaseStatus, CreateReportInput } from '@lostly/contracts/moderation';
import type { PageQuery } from '@lostly/contracts/pagination';
import { db, type DatabaseTransaction } from '@/db';
import {
  claims,
  listings,
  moderationCases,
  moderationEvents,
  moderationNotes,
  moderationNotifications,
  users,
} from '@/db/schema';
import { claimMessageAttachments, claimMessages } from '@/db/conversations';
import { listingImages } from '@/db/listing-images';
import { findConversationForMember } from '@/conversations/authorization';
import { avatarKeys } from '@/profile/queries';
import { lockListing } from '@/listings/locking';
import {
  cursorCondition,
  decodeCursor,
  pageFromRows,
  timestampCursorValue,
} from '@/pagination/cursor';
import type { ObjectStorage } from '@/storage/object-storage';
import { audit, checkCase, notify } from './audit';
import { conflict, ModerationError, notFound } from './errors';

export const publicCaseSelection = {
  id: moderationCases.id,
  kind: moderationCases.kind,
  targetType: moderationCases.targetType,
  targetId: moderationCases.targetId,
  reporterId: moderationCases.reporterId,
  assigneeId: moderationCases.assigneeId,
  category: moderationCases.category,
  description: moderationCases.description,
  status: moderationCases.status,
  version: moderationCases.version,
  parentEventId: moderationCases.parentEventId,
  publicResolution: moderationCases.publicResolution,
  createdAt: moderationCases.createdAt,
  updatedAt: moderationCases.updatedAt,
};

async function reportEvidence(
  tx: DatabaseTransaction,
  userId: string,
  targetType: CreateReportInput['targetType'],
  targetId: string,
) {
  if (targetType === 'conversation') {
    const conversation = await findConversationForMember(targetId, userId, tx);
    if (!conversation) notFound();
    return {
      text: 'Conversation reported; individual messages require their own reports.',
      conversationId: targetId,
      listingId: conversation.listingId,
    };
  }
  if (targetType === 'message') {
    const [reference] = await tx
      .select({ conversationId: claimMessages.conversationId })
      .from(claimMessages)
      .where(eq(claimMessages.id, targetId));
    const conversation = reference
      ? await findConversationForMember(reference.conversationId, userId, tx)
      : null;
    if (!conversation || !(await lockListing(tx, conversation.listingId, 'share'))) notFound();
    const [message] = await tx.select().from(claimMessages).where(eq(claimMessages.id, targetId));
    if (
      !message ||
      message.isHidden ||
      !(await findConversationForMember(message.conversationId, userId, tx))
    )
      notFound();
    const images = await tx
      .select({
        id: claimMessageAttachments.id,
        objectKey: claimMessageAttachments.objectKey,
        width: claimMessageAttachments.width,
        height: claimMessageAttachments.height,
      })
      .from(claimMessageAttachments)
      .where(eq(claimMessageAttachments.messageId, targetId));
    return {
      text: message.body ?? '',
      conversationId: message.conversationId,
      userId: message.senderUserId,
      images,
    };
  }
  if (targetType === 'claim') {
    const [record] = await tx
      .select({ claim: claims, ownerId: listings.createdByUserId, hidden: listings.isHidden })
      .from(claims)
      .innerJoin(listings, eq(listings.id, claims.listingId))
      .where(eq(claims.id, targetId));
    if (
      !record ||
      record.hidden ||
      (record.claim.claimantUserId !== userId && record.ownerId !== userId)
    )
      notFound();
    return {
      text: record.claim.verificationDetails,
      listingId: record.claim.listingId,
      userId: record.claim.claimantUserId,
    };
  }
  if (targetType === 'user' || targetType === 'avatar') {
    const [person] = await tx.select().from(users).where(eq(users.id, targetId)).for('share');
    if (!person || (targetType === 'avatar' && !person.avatarId)) notFound();
    const images = person.avatarId
      ? [
          {
            id: person.avatarId,
            objectKey: avatarKeys(person.id, person.avatarId, person.avatarAnimated).image,
            width: 256,
            height: 256,
          },
        ]
      : [];
    return {
      text: [person.displayName, person.username, person.bio].filter(Boolean).join('\n'),
      userId: person.id,
      images,
    };
  }
  const [reference] =
    targetType === 'listing'
      ? [{ listingId: targetId }]
      : await tx
          .select({ listingId: listingImages.listingId })
          .from(listingImages)
          .where(eq(listingImages.id, targetId));
  if (!reference || !(await lockListing(tx, reference.listingId, 'share'))) notFound();
  const [record] =
    targetType === 'listing'
      ? await tx
          .select()
          .from(listings)
          .where(and(eq(listings.id, targetId), eq(listings.isHidden, false)))
      : await tx
          .select(getTableColumns(listings))
          .from(listingImages)
          .innerJoin(listings, eq(listings.id, listingImages.listingId))
          .where(
            and(
              eq(listingImages.id, targetId),
              eq(listingImages.isHidden, false),
              eq(listings.isHidden, false),
            ),
          );
  if (!record) notFound();
  const images = await tx
    .select({
      id: listingImages.id,
      objectKey: listingImages.objectKey,
      width: listingImages.width,
      height: listingImages.height,
    })
    .from(listingImages)
    .where(
      and(
        eq(listingImages.listingId, record.id),
        eq(listingImages.isHidden, false),
        targetType === 'listing_image' ? eq(listingImages.id, targetId) : undefined,
      ),
    );
  return {
    text: record.title + '\n' + record.description,
    listingId: record.id,
    userId: record.createdByUserId,
    images,
  };
}

async function caseAdmission(tx: DatabaseTransaction, userId: string) {
  // Serialize submissions across API instances without locking unrelated profile updates.
  await tx.execute(
    sql`select pg_advisory_xact_lock(hashtextextended(${'moderation:' + userId},0))`,
  );
  const [recent] = await tx
    .select({ value: count() })
    .from(moderationCases)
    .where(
      and(
        eq(moderationCases.reporterId, userId),
        gt(moderationCases.createdAt, new Date(Date.now() - 600_000)),
      ),
    );
  if (recent!.value >= 5)
    throw new ModerationError(
      429,
      'REPORT_RATE_LIMITED',
      'Too many reports. Please try again later.',
    );
}

export async function createReport(userId: string, input: CreateReportInput) {
  return db.transaction(async (tx) => {
    await caseAdmission(tx, userId);
    const [existing] = await tx
      .select({ id: moderationCases.id })
      .from(moderationCases)
      .where(
        and(
          eq(moderationCases.reporterId, userId),
          eq(moderationCases.targetType, input.targetType),
          eq(moderationCases.targetId, input.targetId),
          eq(moderationCases.kind, 'report'),
          inArray(moderationCases.status, ['open', 'in_review']),
        ),
      );
    if (existing)
      throw new ModerationError(
        409,
        'REPORT_EXISTS',
        'You already have an open report for this item.',
      );
    const evidence = await reportEvidence(tx, userId, input.targetType, input.targetId);
    const [record] = await tx
      .insert(moderationCases)
      .values({
        targetType: input.targetType,
        targetId: input.targetId,
        category: input.category,
        description: input.description,
        reporterId: userId,
        evidence,
      })
      .returning(publicCaseSelection);
    return { case: record! };
  });
}

export async function createAppeal(userId: string, eventId: string, description: string) {
  return db.transaction(async (tx) => {
    await caseAdmission(tx, userId);
    const [decision] = await tx
      .select()
      .from(moderationNotifications)
      .where(
        and(
          eq(moderationNotifications.userId, userId),
          eq(moderationNotifications.eventId, eventId),
          eq(moderationNotifications.canAppeal, true),
        ),
      );
    if (!decision) notFound();
    const [existing] = await tx
      .select({ id: moderationCases.id })
      .from(moderationCases)
      .where(
        and(eq(moderationCases.reporterId, userId), eq(moderationCases.parentEventId, eventId)),
      );
    if (existing)
      throw new ModerationError(
        409,
        'APPEAL_EXISTS',
        'An appeal has already been submitted for this decision.',
      );
    const [event] = await tx
      .select({
        caseId: moderationEvents.caseId,
        metadata: moderationEvents.metadata,
        targetType: moderationEvents.targetType,
        targetId: moderationEvents.targetId,
      })
      .from(moderationEvents)
      .where(eq(moderationEvents.id, eventId));
    const [source] = event?.caseId
      ? await tx
          .select({ evidence: moderationCases.evidence })
          .from(moderationCases)
          .where(eq(moderationCases.id, event.caseId))
      : [];
    const [record] = await tx
      .insert(moderationCases)
      .values({
        kind: 'appeal',
        reporterId: userId,
        targetType: decision.targetType as CreateReportInput['targetType'],
        targetId: decision.targetId,
        category: 'other',
        description,
        parentEventId: eventId,
        evidence: source?.evidence ?? {
          listingId:
            event?.targetType === 'listing'
              ? event.targetId
              : typeof event?.metadata['listingId'] === 'string'
                ? event.metadata['listingId']
                : undefined,
          userId: event?.targetType === 'user' ? event.targetId : undefined,
        },
      })
      .returning(publicCaseSelection);
    return { case: record! };
  });
}

function pageCursor(
  query: PageQuery,
  scope: string,
  table: { createdAt: typeof moderationCases.createdAt; id: typeof moderationCases.id },
) {
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor)
    throw new ModerationError(400, 'INVALID_CURSOR', 'Invalid page cursor');
  return cursor ? cursorCondition(table.createdAt, table.id, cursor, false) : undefined;
}

export async function listCases(
  query: PageQuery & {
    status?: CaseStatus;
    assigneeId?: string;
    reporterId?: string;
    targetId?: string;
    kind?: 'report' | 'appeal';
    overdue?: boolean;
    unassigned?: boolean;
    active?: boolean;
  },
) {
  const scope = JSON.stringify([
    'cases',
    query.status,
    query.assigneeId,
    query.reporterId,
    query.targetId,
    query.kind,
    query.overdue,
    query.unassigned,
    query.active,
  ]);
  const rows = await db
    .select({
      ...publicCaseSelection,
      cursorValue: timestampCursorValue(moderationCases.createdAt),
    })
    .from(moderationCases)
    .where(
      and(
        pageCursor(query, scope, moderationCases),
        query.status ? eq(moderationCases.status, query.status) : undefined,
        query.active ? inArray(moderationCases.status, ['open', 'in_review']) : undefined,
        query.assigneeId ? eq(moderationCases.assigneeId, query.assigneeId) : undefined,
        query.unassigned
          ? and(
              isNull(moderationCases.assigneeId),
              inArray(moderationCases.status, ['open', 'in_review']),
            )
          : undefined,
        query.reporterId ? eq(moderationCases.reporterId, query.reporterId) : undefined,
        query.targetId ? eq(moderationCases.targetId, query.targetId) : undefined,
        query.kind ? eq(moderationCases.kind, query.kind) : undefined,
        query.overdue
          ? and(
              inArray(moderationCases.status, ['open', 'in_review']),
              sql`${moderationCases.createdAt} < now() - interval '48 hours'`,
            )
          : undefined,
      ),
    )
    .orderBy(desc(moderationCases.createdAt), desc(moderationCases.id))
    .limit((query.limit ?? 20) + 1);
  return pageFromRows(rows, query.limit ?? 20, scope);
}

export async function listNotifications(userId: string, query: PageQuery) {
  const scope = 'notifications:' + userId;
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor)
    throw new ModerationError(400, 'INVALID_CURSOR', 'Invalid page cursor');
  const rows = await db
    .select({
      id: moderationNotifications.id,
      eventId: moderationNotifications.eventId,
      targetType: moderationNotifications.targetType,
      targetId: moderationNotifications.targetId,
      title: moderationNotifications.title,
      message: moderationNotifications.message,
      canAppeal: moderationNotifications.canAppeal,
      readAt: moderationNotifications.readAt,
      createdAt: moderationNotifications.createdAt,
      cursorValue: timestampCursorValue(moderationNotifications.createdAt),
    })
    .from(moderationNotifications)
    .where(
      and(
        eq(moderationNotifications.userId, userId),
        cursor
          ? cursorCondition(
              moderationNotifications.createdAt,
              moderationNotifications.id,
              cursor,
              false,
            )
          : undefined,
      ),
    )
    .orderBy(desc(moderationNotifications.createdAt), desc(moderationNotifications.id))
    .limit((query.limit ?? 20) + 1);
  const [unread] = await db
    .select({ value: count() })
    .from(moderationNotifications)
    .where(and(eq(moderationNotifications.userId, userId), isNull(moderationNotifications.readAt)));
  return {
    notifications: pageFromRows(rows, query.limit ?? 20, scope),
    unreadCount: unread!.value,
  };
}

export async function markNotificationRead(userId: string, id: string) {
  const [record] = await db
    .update(moderationNotifications)
    .set({ readAt: sql`coalesce(${moderationNotifications.readAt}, now())` })
    .where(and(eq(moderationNotifications.id, id), eq(moderationNotifications.userId, userId)))
    .returning({ id: moderationNotifications.id });
  if (!record) notFound();
}

export async function caseDetails(id: string, query: PageQuery = {}) {
  const [record] = await db
    .select({ ...publicCaseSelection, evidence: moderationCases.evidence })
    .from(moderationCases)
    .where(eq(moderationCases.id, id));
  if (!record) notFound();
  const { evidence, ...safe } = record;
  const [decision] = record.parentEventId
    ? await db.select().from(moderationEvents).where(eq(moderationEvents.id, record.parentEventId))
    : [];
  const [root] = decision?.parentEventId
    ? await db
        .select()
        .from(moderationEvents)
        .where(eq(moderationEvents.id, decision.parentEventId))
    : [decision];
  const listingId =
    root?.action === 'archive_listing'
      ? root.targetId
      : root?.action === 'reject_claim' && typeof root.metadata['listingId'] === 'string'
        ? root.metadata['listingId']
        : null;
  const [reversibleListing] = listingId
    ? await db
        .select({ id: listings.id, version: listings.version })
        .from(listings)
        .where(eq(listings.id, listingId))
    : [];
  const scope = 'case-notes:' + id;
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor)
    throw new ModerationError(400, 'INVALID_CURSOR', 'Invalid page cursor');
  const notes = await db
    .select({
      id: moderationNotes.id,
      actorUserId: moderationNotes.actorUserId,
      body: moderationNotes.body,
      createdAt: moderationNotes.createdAt,
      cursorValue: timestampCursorValue(moderationNotes.createdAt),
    })
    .from(moderationNotes)
    .where(
      and(
        eq(moderationNotes.caseId, id),
        cursor
          ? cursorCondition(moderationNotes.createdAt, moderationNotes.id, cursor, false)
          : undefined,
      ),
    )
    .orderBy(desc(moderationNotes.createdAt), desc(moderationNotes.id))
    .limit((query.limit ?? 20) + 1);
  return {
    case: safe,
    reversibleListing: reversibleListing ?? null,
    related: {
      listingId: evidence.listingId ?? listingId,
      userId: evidence.userId ?? null,
      conversationId: evidence.conversationId ?? null,
    },
    notes: pageFromRows(notes, query.limit ?? 20, scope),
  };
}

export async function assignCase(
  id: string,
  actorUserId: string,
  assigneeId: string | null,
  expectedVersion: number,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select()
      .from(moderationCases)
      .where(eq(moderationCases.id, id))
      .for('update');
    if (!record) notFound();
    if (record.version !== expectedVersion || !['open', 'in_review'].includes(record.status))
      conflict();
    if (assigneeId) {
      const [person] = await tx
        .select({ id: users.id })
        .from(users)
        .where(and(eq(users.id, assigneeId), eq(users.role, 'admin')));
      if (!person)
        throw new ModerationError(400, 'INVALID_ASSIGNEE', 'Assignee must be an administrator.');
    }
    await tx
      .update(moderationCases)
      .set({
        assigneeId,
        status: assigneeId ? 'in_review' : 'open',
        version: record.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(moderationCases.id, id));
    await audit(tx, {
      actorUserId,
      targetType: 'case',
      targetId: id,
      action: 'assign_case',
      reason,
      metadata: { before: record.assigneeId, after: assigneeId },
    });
  });
}

export async function decideCase(
  id: string,
  actorUserId: string,
  expectedVersion: number,
  status: 'resolved' | 'dismissed',
  publicResolution: string,
  reason: string,
) {
  return db.transaction(async (tx) => {
    const record = await checkCase(tx, id, actorUserId);
    if (record.version !== expectedVersion) conflict();
    // Audit before closing; case-linked state changes only accept open cases.
    const event = await audit(tx, {
      actorUserId,
      targetType: 'case',
      targetId: id,
      caseId: id,
      action: status === 'resolved' ? 'resolve_case' : 'dismiss_case',
      reason,
      metadata: { before: record.status, after: status },
    });
    await tx
      .update(moderationCases)
      .set({ status, publicResolution, version: record.version + 1, updatedAt: new Date() })
      .where(eq(moderationCases.id, id));
    if (record.reporterId)
      await notify(tx, event, {
        userId: record.reporterId,
        title: record.kind === 'appeal' ? 'Appeal reviewed' : 'Report reviewed',
        message: publicResolution,
      });
  });
}

export async function addCaseNote(id: string, actorUserId: string, body: string) {
  return db.transaction(async (tx) => {
    await checkCase(tx, id, actorUserId);
    const [note] = await tx
      .insert(moderationNotes)
      .values({ caseId: id, actorUserId, body })
      .returning({ id: moderationNotes.id });
    await audit(tx, {
      actorUserId,
      targetType: 'case',
      targetId: id,
      caseId: id,
      action: 'add_case_note',
      reason: 'Internal note added',
      metadata: { noteId: note!.id },
    });
  });
}

export async function revealEvidence(
  id: string,
  actorUserId: string,
  reason: string,
  storage: ObjectStorage,
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ evidence: moderationCases.evidence })
      .from(moderationCases)
      .where(eq(moderationCases.id, id))
      .for('share');
    if (!record) notFound();
    await audit(tx, {
      actorUserId,
      targetType: 'case',
      targetId: id,
      action: 'view_case_evidence',
      reason,
      metadata: { caseId: id },
    });
    return {
      text: record.evidence.text ?? '',
      images: (record.evidence.images ?? []).map(({ objectKey, ...image }) => ({
        ...image,
        ...storage.createReadUrl(objectKey, 300),
      })),
    };
  });
}
