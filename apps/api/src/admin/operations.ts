import { and, count, desc, eq, gte, lte, inArray, or, sql } from 'drizzle-orm';
import type { PageQuery } from '@lostly/contracts/pagination';
import type { ModerationAction } from '@lostly/contracts/moderation';
import { LISTING_IMAGE_CONSTRAINTS } from '@lostly/contracts/listings';
import { db, type DatabaseTransaction } from '@/db';
import {
  authIdentities,
  claims,
  listings,
  moderationCases,
  moderationEvents,
  sessions,
  users,
} from '@/db/schema';
import { claimConversations, claimMessages } from '@/db/conversations';
import { listingImages } from '@/db/listing-images';
import {
  cursorCondition,
  decodeCursor,
  pageFromRows,
  timestampCursorValue,
} from '@/pagination/cursor';
import { publicListingSelection } from '@/listings/selection';
import { lockListing } from '@/listings/locking';
import { findImages, toListingImage } from '@/listing-images/queries';
import { profileSelection, toProfile } from '@/profile/queries';
import { claimUsername } from '@/profile/usernames';
import { accountRestriction } from '@/moderation/restrictions';
import { profileEvidence } from '@/moderation/evidence';
import { audit, checkCase, notify, type ModerationCommand } from '@/moderation/audit';
import { conflict, ModerationError, notFound } from '@/moderation/errors';
import type { ObjectStorage } from '@/storage/object-storage';

export async function operationDashboard(actorUserId: string) {
  const [totals] = await db
    .select({
      open: sql<number>`count(*) filter (where ${moderationCases.status} = 'open')::int`,
      inReview: sql<number>`count(*) filter (where ${moderationCases.status} = 'in_review')::int`,
      mine: sql<number>`count(*) filter (where ${moderationCases.assigneeId} = ${actorUserId}::uuid and ${moderationCases.status} in ('open','in_review'))::int`,
      unassigned: sql<number>`count(*) filter (where ${moderationCases.assigneeId} is null and ${moderationCases.status} in ('open','in_review'))::int`,
      overdue: sql<number>`count(*) filter (where ${moderationCases.status} in ('open','in_review') and ${moderationCases.createdAt} < now() - interval '48 hours')::int`,
      appeals: sql<number>`count(*) filter (where ${moderationCases.kind} = 'appeal' and ${moderationCases.status} in ('open','in_review'))::int`,
    })
    .from(moderationCases);
  const [restricted] = await db
    .select({ value: count() })
    .from(users)
    .where(or(eq(users.suspendedPermanently, true), sql`${users.suspendedUntil} > now()`));
  return { ...totals!, restrictedUsers: restricted!.value };
}

export function listAdministrators() {
  return db
    .select({ id: users.id, displayName: users.displayName })
    .from(users)
    .where(eq(users.role, 'admin'))
    .orderBy(users.displayName)
    .limit(100);
}

export async function auditPage(
  query: PageQuery & {
    actorId?: string;
    targetId?: string;
    action?: ModerationAction;
    caseId?: string;
    from?: string;
    to?: string;
  },
) {
  const scope = JSON.stringify([
    'audit',
    query.actorId,
    query.targetId,
    query.action,
    query.caseId,
    query.from,
    query.to,
  ]);
  const cursor = query.cursor ? decodeCursor(query.cursor, scope) : null;
  if (query.cursor && !cursor)
    throw new ModerationError(400, 'INVALID_CURSOR', 'Invalid audit cursor');
  const rows = await db
    .select({
      id: moderationEvents.id,
      actorUserId: moderationEvents.actorUserId,
      targetId: moderationEvents.targetId,
      targetType: moderationEvents.targetType,
      caseId: moderationEvents.caseId,
      parentEventId: moderationEvents.parentEventId,
      action: moderationEvents.action,
      reason: moderationEvents.reason,
      createdAt: moderationEvents.createdAt,
      metadata: moderationEvents.metadata,
      actorName: users.displayName,
      cursorValue: timestampCursorValue(moderationEvents.createdAt),
    })
    .from(moderationEvents)
    .leftJoin(users, eq(users.id, moderationEvents.actorUserId))
    .where(
      and(
        query.actorId ? eq(moderationEvents.actorUserId, query.actorId) : undefined,
        query.targetId ? eq(moderationEvents.targetId, query.targetId) : undefined,
        query.action ? eq(moderationEvents.action, query.action) : undefined,
        query.from ? gte(moderationEvents.createdAt, new Date(query.from)) : undefined,
        query.to ? lte(moderationEvents.createdAt, new Date(query.to)) : undefined,
        query.caseId
          ? or(
              eq(moderationEvents.caseId, query.caseId),
              and(
                eq(moderationEvents.targetType, 'case'),
                eq(moderationEvents.targetId, query.caseId),
              ),
            )
          : undefined,
        cursor
          ? cursorCondition(moderationEvents.createdAt, moderationEvents.id, cursor, false)
          : undefined,
      ),
    )
    .orderBy(desc(moderationEvents.createdAt), desc(moderationEvents.id))
    .limit((query.limit ?? 20) + 1);
  return pageFromRows(
    rows.map((row) => ({ ...row, metadata: safeAuditMetadata(row.metadata) })),
    query.limit ?? 20,
    scope,
  );
}

function safeAuditMetadata(metadata: Record<string, unknown>) {
  const allowed = [
    'before',
    'after',
    'fields',
    'revoked',
    'listingId',
    'conversationId',
    'afterVersion',
    'reviewedAt',
    'cause',
    'caseId',
    'noteId',
  ];
  return Object.fromEntries(Object.entries(metadata).filter(([key]) => allowed.includes(key)));
}

export async function userDetails(id: string, storage: ObjectStorage) {
  const [person] = await db
    .select({
      ...profileSelection,
      email: users.email,
      role: users.role,
      suspendedPermanently: users.suspendedPermanently,
      suspendedUntil: users.suspendedUntil,
      suspensionReason: users.suspensionReason,
      moderationVersion: users.moderationVersion,
    })
    .from(users)
    .where(eq(users.id, id));
  if (!person) notFound();
  const [sessionCount] = await db
    .select({ value: count() })
    .from(sessions)
    .where(and(eq(sessions.userId, id), sql`${sessions.expiresAt} > now()`));
  const identities = await db
    .select({ provider: authIdentities.provider, createdAt: authIdentities.createdAt })
    .from(authIdentities)
    .where(eq(authIdentities.userId, id));
  return {
    user: {
      ...toProfile(person, storage),
      email: person.email,
      role: person.role,
      restriction: accountRestriction(person),
      moderationVersion: person.moderationVersion,
    },
    activeSessions: sessionCount!.value,
    identities,
  };
}

export async function listingDetails(id: string, storage: ObjectStorage) {
  const [listing] = await db
    .select({
      ...publicListingSelection,
      isHidden: listings.isHidden,
      owner: { id: users.id, displayName: users.displayName },
    })
    .from(listings)
    .innerJoin(users, eq(users.id, listings.createdByUserId))
    .where(eq(listings.id, id));
  if (!listing) notFound();
  const images = await db
    .select()
    .from(listingImages)
    .where(eq(listingImages.listingId, id))
    .orderBy(listingImages.position)
    .limit(100);
  const [totals] = await db.select({ value: count() }).from(claims).where(eq(claims.listingId, id));
  return {
    listing,
    images: images.map((image) => ({
      ...toListingImage(image, storage),
      isHidden: image.isHidden,
    })),
    claimCount: totals!.value,
  };
}

export async function claimDetails(id: string) {
  const [record] = await db
    .select({
      id: claims.id,
      status: claims.status,
      createdAt: claims.createdAt,
      updatedAt: claims.updatedAt,
      reviewedAt: claims.reviewedAt,
      reviewerId: claims.reviewedByUserId,
      listing: {
        id: listings.id,
        title: listings.title,
        status: listings.status,
        version: listings.version,
        isHidden: listings.isHidden,
        ownerId: listings.createdByUserId,
      },
      claimant: { id: users.id, displayName: users.displayName },
      conversation: {
        id: claimConversations.id,
        moderationClosed: claimConversations.moderationClosed,
      },
    })
    .from(claims)
    .innerJoin(listings, eq(listings.id, claims.listingId))
    .innerJoin(users, eq(users.id, claims.claimantUserId))
    .leftJoin(claimConversations, eq(claimConversations.claimId, claims.id))
    .where(eq(claims.id, id));
  if (!record) notFound();
  return { claim: record };
}

async function moderatableUser(tx: DatabaseTransaction, id: string) {
  // Notification foreign keys can still acquire KEY SHARE while account writes serialize.
  const [person] = await tx.select().from(users).where(eq(users.id, id)).for('no key update');
  if (!person) notFound();
  if (person.role === 'admin')
    throw new ModerationError(
      403,
      'OWNER_MANAGED_ACCOUNT',
      'Administrator accounts are managed by project owners.',
    );
  return person;
}

export async function restrictUser(
  id: string,
  actorUserId: string,
  input: ModerationCommand & {
    expectedVersion: number;
    permanent: boolean;
    until?: string | null;
    remove?: boolean;
  },
) {
  const until = input.until ? new Date(input.until) : null;
  if (
    !input.remove &&
    !input.permanent &&
    (!until ||
      !Number.isFinite(until.getTime()) ||
      until <= new Date() ||
      until.getTime() > Date.now() + 366 * 86_400_000)
  ) {
    throw new ModerationError(
      400,
      'INVALID_RESTRICTION',
      'A temporary restriction must expire within the next year.',
    );
  }
  return db.transaction(async (tx) => {
    const person = await moderatableUser(tx, id);
    if (person.moderationVersion !== input.expectedVersion) conflict();
    const before = accountRestriction(person);
    if (input.remove && !before) conflict();
    await tx
      .update(users)
      .set({
        suspendedPermanently: !input.remove && input.permanent,
        suspendedUntil: input.remove || input.permanent ? null : until,
        suspensionReason: input.remove
          ? null
          : (input.publicReason ??
            'Your account has been restricted. You can view this decision and submit an appeal.'),
        moderationVersion: person.moderationVersion + 1,
        updatedAt: new Date(),
      })
      .where(eq(users.id, id));
    if (!input.remove) await tx.delete(sessions).where(eq(sessions.userId, id));
    const event = await audit(tx, {
      actorUserId,
      targetType: 'user',
      targetId: id,
      action: input.remove ? 'unsuspend_user' : 'suspend_user',
      reason: input.reason,
      caseId: input.caseId,
      metadata: {
        before: { restricted: Boolean(before), until: before?.until ?? null },
        after: {
          restricted: !input.remove,
          until: input.remove || input.permanent ? null : until?.toISOString(),
        },
      },
    });
    await notify(tx, event, {
      userId: id,
      title: input.remove ? 'Account restriction removed' : 'Account restricted',
      message:
        input.publicReason ??
        (input.remove
          ? 'Your account can use Lostly again.'
          : 'Your account has been restricted. Sign in to view this decision and appeal.'),
      canAppeal: !input.remove,
    });
  });
}

export async function revokeUserSessions(
  id: string,
  actorUserId: string,
  input: ModerationCommand & { expectedVersion: number },
) {
  return db.transaction(async (tx) => {
    const person = await moderatableUser(tx, id);
    if (person.moderationVersion !== input.expectedVersion) conflict();
    const revoked = await tx
      .delete(sessions)
      .where(eq(sessions.userId, id))
      .returning({ id: sessions.id });
    await tx
      .update(users)
      .set({ moderationVersion: person.moderationVersion + 1 })
      .where(eq(users.id, id));
    const event = await audit(tx, {
      actorUserId,
      targetType: 'user',
      targetId: id,
      action: 'revoke_sessions',
      reason: input.reason,
      caseId: input.caseId,
      metadata: { revoked: revoked.length },
    });
    await notify(tx, event, {
      userId: id,
      title: 'Sessions ended',
      message:
        input.publicReason ??
        'Your existing sessions were ended by an administrator. You can sign in again.',
    });
  });
}

export async function resetUserProfile(
  id: string,
  actorUserId: string,
  input: ModerationCommand & {
    expectedVersion: number;
    fields: ('bio' | 'avatar' | 'displayName' | 'username')[];
  },
) {
  return db.transaction(async (tx) => {
    const person = await moderatableUser(tx, id);
    if (person.profileVersion !== input.expectedVersion) conflict();
    const changes: Partial<typeof users.$inferInsert> = {
      profileVersion: person.profileVersion + 1,
      updatedAt: new Date(),
    };
    if (input.fields.includes('bio')) changes.bio = '';
    if (input.fields.includes('displayName')) {
      changes.displayName = 'Lostly member';
      changes.displayNameChangedAt = null;
    }
    if (input.fields.includes('avatar')) {
      changes.avatarId = null;
      changes.avatarAnimated = false;
    }
    if (input.fields.includes('username')) {
      changes.usernameChangedAt = null;
      changes.username = 'user_' + crypto.randomUUID().replaceAll('-', '').slice(0, 24);
      await claimUsername(tx, id, changes.username);
    }
    await tx.update(users).set(changes).where(eq(users.id, id));
    const event = await audit(tx, {
      actorUserId,
      targetType: 'user',
      targetId: id,
      action: 'reset_profile',
      reason: input.reason,
      caseId: input.caseId,
      metadata: { fields: input.fields },
      evidence: profileEvidence(person, input.fields),
    });
    await notify(tx, event, {
      userId: id,
      title: 'Profile moderated',
      message:
        input.publicReason ??
        'A moderator removed content from your profile. You may update your profile with appropriate content.',
      canAppeal: true,
    });
    // Retain removed avatar objects for case evidence; no ordinary endpoint can issue their URLs.
  });
}

export async function moderateListingImage(
  id: string,
  actorUserId: string,
  hidden: boolean,
  input: ModerationCommand & { expectedVersion: number },
) {
  return db.transaction(async (tx) => {
    const [image] = await tx.select().from(listingImages).where(eq(listingImages.id, id));
    if (!image) notFound();
    const listing = await lockListing(tx, image.listingId);
    if (!listing) notFound();
    const [current] = await tx.select().from(listingImages).where(eq(listingImages.id, id));
    if (!current) notFound();
    if (listing.version !== input.expectedVersion || current.isHidden === hidden) conflict();
    const [visible] = await tx
      .select({ value: count() })
      .from(listingImages)
      .where(and(eq(listingImages.listingId, listing.id), eq(listingImages.isHidden, false)));
    if (!hidden && visible!.value >= LISTING_IMAGE_CONSTRAINTS.maxCount)
      throw new ModerationError(
        409,
        'IMAGE_LIMIT',
        'Remove a replacement photo before restoring this photo.',
      );
    await tx
      .update(listingImages)
      .set({ isHidden: hidden, ...(!hidden ? { position: visible!.value } : {}) })
      .where(eq(listingImages.id, id));
    for (const [position, visibleImage] of (await findImages(listing.id, tx)).entries()) {
      if (visibleImage.position !== position)
        await tx
          .update(listingImages)
          .set({ position })
          .where(eq(listingImages.id, visibleImage.id));
    }
    await tx
      .update(listings)
      .set({ version: listing.version + 1, updatedAt: new Date() })
      .where(eq(listings.id, listing.id));
    const event = await audit(tx, {
      actorUserId,
      targetType: 'listing_image',
      targetId: id,
      action: hidden ? 'hide_listing_image' : 'restore_listing_image',
      reason: input.reason,
      caseId: input.caseId,
      metadata: { listingId: listing.id, before: current.isHidden, after: hidden },
    });
    await notify(tx, event, {
      userId: listing.createdByUserId,
      title: hidden ? 'Report photo hidden' : 'Report photo restored',
      message:
        input.publicReason ??
        (hidden
          ? 'A moderator hid a photo from your report. The report remains available unless moderated separately.'
          : 'A photo from your report has been restored.'),
      canAppeal: hidden,
    });
  });
}

export async function moderateMessage(
  id: string,
  actorUserId: string,
  hidden: boolean,
  input: ModerationCommand & { caseId: string },
) {
  return db.transaction(async (tx) => {
    const [record] = await tx
      .select({ message: claimMessages, listingId: claims.listingId })
      .from(claimMessages)
      .innerJoin(claimConversations, eq(claimConversations.id, claimMessages.conversationId))
      .innerJoin(claims, eq(claims.id, claimConversations.claimId))
      .where(eq(claimMessages.id, id));
    if (!record) notFound();
    const [source] = await tx
      .select({ targetType: moderationCases.targetType, targetId: moderationCases.targetId })
      .from(moderationCases)
      .where(eq(moderationCases.id, input.caseId));
    if (!source || source.targetType !== 'message' || source.targetId !== id)
      throw new ModerationError(
        403,
        'CASE_SCOPE_MISMATCH',
        'Message moderation requires a report about this message.',
      );
    if (!(await lockListing(tx, record.listingId))) notFound();
    const [message] = await tx
      .select()
      .from(claimMessages)
      .where(eq(claimMessages.id, id))
      .for('update');
    if (!message) notFound();
    if (message.isHidden === hidden) conflict();
    await tx.update(claimMessages).set({ isHidden: hidden }).where(eq(claimMessages.id, id));
    await tx
      .update(claimConversations)
      .set({ contentVersion: sql`${claimConversations.contentVersion} + 1` })
      .where(eq(claimConversations.id, message.conversationId));
    const event = await audit(tx, {
      actorUserId,
      targetType: 'message',
      targetId: id,
      action: hidden ? 'hide_message' : 'restore_message',
      reason: input.reason,
      caseId: input.caseId,
      metadata: { conversationId: message.conversationId, before: message.isHidden, after: hidden },
    });
    await notify(tx, event, {
      userId: message.senderUserId,
      title: hidden ? 'Message hidden' : 'Message restored',
      message:
        input.publicReason ??
        (hidden ? 'A moderator hid a message you sent.' : 'A message you sent was restored.'),
      canAppeal: hidden,
    });
  });
}

export async function moderateConversation(
  caseId: string,
  actorUserId: string,
  closed: boolean,
  input: ModerationCommand,
) {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({ context: moderationCases.context })
      .from(moderationCases)
      .where(eq(moderationCases.id, caseId));
    const id = source?.context.conversationId;
    if (!id) notFound();
    const [reference] = await tx
      .select({ listingId: claims.listingId })
      .from(claimConversations)
      .innerJoin(claims, eq(claims.id, claimConversations.claimId))
      .where(eq(claimConversations.id, id));
    if (!reference || !(await lockListing(tx, reference.listingId))) notFound();
    const [conversation] = await tx
      .select()
      .from(claimConversations)
      .where(eq(claimConversations.id, id))
      .for('update');
    if (!conversation) notFound();
    if (conversation.moderationClosed === closed) conflict();
    await tx
      .update(claimConversations)
      .set({ moderationClosed: closed })
      .where(eq(claimConversations.id, id));
    const event = await audit(tx, {
      actorUserId,
      targetType: 'conversation',
      targetId: id,
      action: closed ? 'close_conversation' : 'reopen_conversation',
      reason: input.reason,
      caseId,
    });
    const [claim] = await tx
      .select({ claimantId: claims.claimantUserId, ownerId: listings.createdByUserId })
      .from(claims)
      .innerJoin(listings, eq(listings.id, claims.listingId))
      .where(eq(claims.id, conversation.claimId));
    for (const userId of [claim!.claimantId, claim!.ownerId])
      await notify(tx, event, {
        userId,
        title: closed ? 'Conversation paused' : 'Conversation resumed',
        message:
          input.publicReason ??
          (closed
            ? 'Sending messages in this conversation was paused by a moderator. Existing messages remain available.'
            : 'Sending messages in this conversation is available again.'),
        canAppeal: closed,
      });
  });
}

export async function reverseCaseDecision(
  caseId: string,
  actorUserId: string,
  input: ModerationCommand & { expectedVersion: number },
) {
  // Lock the listing before the case, consistently with the original moderation actions.
  const [source] = await db
    .select({ parentEventId: moderationCases.parentEventId })
    .from(moderationCases)
    .where(eq(moderationCases.id, caseId));
  const [decision] = source?.parentEventId
    ? await db.select().from(moderationEvents).where(eq(moderationEvents.id, source.parentEventId))
    : [];
  if (!decision) notFound();
  const [root] = decision.parentEventId
    ? await db
        .select()
        .from(moderationEvents)
        .where(eq(moderationEvents.id, decision.parentEventId))
    : [decision];
  if (!root || !['archive_listing', 'reject_claim'].includes(root.action))
    throw new ModerationError(
      409,
      'NO_REVERSIBLE_DECISION',
      'Use the target record to correct this decision.',
    );
  const listingId = root.action === 'archive_listing' ? root.targetId : root.metadata['listingId'];
  if (typeof listingId !== 'string') conflict();
  return db.transaction(async (tx) => {
    const listing = await lockListing(tx, listingId);
    if (!listing) notFound();
    const record = await checkCase(tx, caseId, actorUserId);
    if (record.kind !== 'appeal' || listing.version !== input.expectedVersion) conflict();
    if (root.action === 'archive_listing') {
      if (
        listing.status !== 'archived' ||
        listing.version !== root.metadata['afterVersion'] ||
        !['active', 'resolved'].includes(String(root.metadata['before']))
      )
        conflict();
      const before = root.metadata['before'] as 'active' | 'resolved';
      await tx
        .update(listings)
        .set({ status: before, version: listing.version + 1, updatedAt: new Date() })
        .where(eq(listings.id, listing.id));
      const event = await audit(tx, {
        actorUserId,
        targetType: 'listing',
        targetId: listing.id,
        action: 'restore_archived_listing',
        caseId,
        reason: input.reason,
        parentEventId: root.id,
        metadata: { before: 'archived', after: before },
      });
      await notify(tx, event, {
        userId: listing.createdByUserId,
        title: 'Report archive reversed',
        message:
          input.publicReason ??
          'The archive decision was reversed after review. The report keeps its current visibility.',
      });
      const children = await tx
        .select()
        .from(moderationEvents)
        .where(
          and(
            eq(moderationEvents.parentEventId, root.id),
            eq(moderationEvents.action, 'reject_claim'),
          ),
        );
      for (const child of children)
        await reopenReviewedClaim(tx, child, listing.id, actorUserId, caseId, input.reason);
    } else {
      if (listing.status !== 'active') conflict();
      const [approved] = await tx
        .select({ id: claims.id })
        .from(claims)
        .where(and(eq(claims.listingId, listing.id), eq(claims.status, 'approved')))
        .limit(1);
      if (
        approved ||
        !(await reopenReviewedClaim(tx, root, listing.id, actorUserId, caseId, input.reason))
      )
        conflict();
    }
  });
}

async function reopenReviewedClaim(
  tx: DatabaseTransaction,
  decision: typeof moderationEvents.$inferSelect,
  listingId: string,
  actorUserId: string,
  caseId: string,
  reason: string,
) {
  const timestamp = decision.metadata['reviewedAt'];
  if (typeof timestamp !== 'string') return false;
  const [latest] = await tx
    .select({ id: moderationEvents.id })
    .from(moderationEvents)
    .where(
      and(
        eq(moderationEvents.targetType, 'claim'),
        eq(moderationEvents.targetId, decision.targetId),
        inArray(moderationEvents.action, ['reject_claim', 'reopen_claim']),
      ),
    )
    .orderBy(desc(moderationEvents.id))
    .limit(1);
  if (latest?.id !== decision.id) return false;
  const [claim] = await tx
    .update(claims)
    .set({
      status: 'pending',
      reviewedAt: null,
      reviewedByUserId: null,
      handoverDetails: null,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(claims.id, decision.targetId),
        eq(claims.listingId, listingId),
        eq(claims.status, 'rejected'),
        eq(claims.reviewedByUserId, decision.actorUserId),
        eq(claims.reviewedAt, new Date(timestamp)),
      ),
    )
    .returning({ id: claims.id, userId: claims.claimantUserId });
  if (!claim) return false;
  const event = await audit(tx, {
    actorUserId,
    targetType: 'claim',
    targetId: claim.id,
    action: 'reopen_claim',
    caseId,
    reason,
    parentEventId: decision.id,
    metadata: { listingId },
  });
  await notify(tx, event, {
    userId: claim.userId,
    title: 'Claim reopened',
    message:
      'The moderation decision was reversed. Your claim is pending again; the report owner will review it.',
  });
  return true;
}
