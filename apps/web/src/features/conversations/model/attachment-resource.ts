import { getSessionGeneration, subscribeToSessionGeneration } from '@/shared/api/session-events';
import { refreshMessageAttachments } from '../api/conversations-api';
import { isConversationUnavailable, isReadTargetMissing } from './conversation-errors';
import {
  ATTACHMENT_REFRESH_LEAD_MS,
  earliestAttachmentExpiry,
  reconcileAttachmentCapabilities,
} from './attachment-capabilities';
import type { ClaimMessage, ClaimMessageAttachment } from './types';

interface AttachmentSnapshot {
  attachments: ClaimMessageAttachment[];
  version: number;
  unavailable: boolean;
  conversationUnavailable: boolean;
  refreshing: boolean;
  retryable: boolean;
  automaticAvailable: boolean;
  failed: readonly string[];
}

let nextResourceId = 0;

function createAttachmentResource(conversationId: string, messageId: string, forget: () => void) {
  const id = nextResourceId++;
  const generation = getSessionGeneration();
  let disposed = false;
  let state: AttachmentSnapshot = {
    attachments: [],
    version: 0,
    unavailable: false,
    conversationUnavailable: false,
    refreshing: false,
    retryable: false,
    automaticAvailable: true,
    failed: [],
  };
  const listeners = new Set<() => void>();
  const loaded = new Set<string>();
  let consumedAtVersion: number | null = null;
  let pending: Promise<void> | null = null;
  let moderated = false;
  let visibilityVersion = 0;
  const active = () => !disposed && generation === getSessionGeneration();
  function publish(patch: Partial<AttachmentSnapshot>) {
    state = { ...state, ...patch };
    for (const listener of [...listeners]) listener();
  }
  function install(incoming: readonly ClaimMessageAttachment[], explicit = false) {
    if (!active() || moderated || state.conversationUnavailable || (state.unavailable && !explicit))
      return;
    if (!explicit && !incoming.length && state.attachments.length) return;
    const attachments = reconcileAttachmentCapabilities(state.attachments, incoming);
    if (attachments === state.attachments) return;
    // A new effective set needs its own load evidence, even after a partial freshness merge.
    loaded.clear();
    publish({
      attachments,
      version: state.version + 1,
      unavailable: false,
      failed: [],
      retryable: false,
    });
  }
  function unavailable() {
    loaded.clear();
    publish({
      attachments: [],
      version: state.version + 1,
      unavailable: true,
      automaticAvailable: false,
      failed: [],
      retryable: false,
    });
  }
  function recover(explicit: boolean, eligible = false): Promise<void> {
    if (!active() || moderated || state.conversationUnavailable) return Promise.resolve();
    if (pending) return pending;
    if (!explicit && (!eligible || !state.automaticAvailable || state.unavailable))
      return Promise.resolve();
    consumedAtVersion = state.version;
    const visibility = visibilityVersion;
    // Install the single-flight entry before notifying consumers (including synchronous listeners).
    const request = Promise.resolve().then(async () => {
      if (!active()) return;
      try {
        const response = await refreshMessageAttachments(conversationId, messageId);
        if (!active() || moderated || visibility !== visibilityVersion) return;
        if (!response.attachments.length) {
          unavailable();
          return;
        }
        install(response.attachments, explicit);
        if (
          earliestAttachmentExpiry(state.attachments) <= Date.now() + ATTACHMENT_REFRESH_LEAD_MS ||
          state.version === consumedAtVersion
        )
          publish({ retryable: true });
      } catch (error) {
        if (!active()) return;
        // Keep only classifications, never server error text or capability URLs in errors/logs.
        if (isConversationUnavailable(error)) {
          loaded.clear();
          publish({
            attachments: [],
            version: state.version + 1,
            conversationUnavailable: true,
            failed: [],
          });
        } else if (isReadTargetMissing(error)) unavailable();
        // A newer fully loaded fresh set may have completed recovery while this request ran.
        else if (consumedAtVersion !== null) publish({ retryable: true });
      } finally {
        if (pending === request) pending = null;
        if (active()) {
          // A conversation 404 terminates the mounted thread, not the message forever.
          // A later authorized history load after restore must be able to start a new resource.
          if (state.conversationUnavailable) forget();
          publish({ refreshing: false });
        }
      }
    });
    pending = request;
    publish({ refreshing: true, automaticAvailable: false, retryable: false });
    return request;
  }
  return {
    id,
    getSnapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    ingest: (attachments: readonly ClaimMessageAttachment[]) => install(attachments),
    setModerated(hidden: boolean) {
      if (moderated === hidden) return;
      moderated = hidden;
      visibilityVersion++;
      if (hidden) unavailable();
      else publish({ unavailable: false, automaticAvailable: true });
    },
    recover,
    isCurrent: (version: number) => active() && version === state.version,
    loaded(version: number, attachmentId: string) {
      if (
        !active() ||
        version !== state.version ||
        state.failed.includes(attachmentId) ||
        !state.attachments.some((a) => a.id === attachmentId)
      )
        return;
      loaded.add(attachmentId);
      if (
        consumedAtVersion !== null &&
        state.version > consumedAtVersion &&
        loaded.size === state.attachments.length &&
        earliestAttachmentExpiry(state.attachments) > Date.now() + ATTACHMENT_REFRESH_LEAD_MS
      ) {
        consumedAtVersion = null;
        publish({ automaticAvailable: true, retryable: false });
      }
    },
    failed(version: number, attachmentId: string) {
      if (
        !active() ||
        version !== state.version ||
        !state.attachments.some((a) => a.id === attachmentId)
      )
        return;
      loaded.delete(attachmentId);
      if (!state.failed.includes(attachmentId))
        publish({ failed: [...state.failed, attachmentId] });
    },
    dispose() {
      disposed = true;
      loaded.clear();
      pending = null;
      publish({
        attachments: [],
        version: state.version + 1,
        unavailable: false,
        refreshing: false,
        retryable: false,
        automaticAvailable: false,
        failed: [],
      });
      listeners.clear();
    },
  };
}

export type MessageAttachmentResource = ReturnType<typeof createAttachmentResource>;

// Memory-only, session-scoped authority. No timers or automatic requests without a mounted consumer.
// Retaining tombstones across navigation prevents a passive reload from resurrecting capabilities.
const resources = new Map<string, MessageAttachmentResource>();
subscribeToSessionGeneration(() => {
  const previous = [...resources.values()];
  resources.clear();
  for (const resource of previous) resource.dispose();
});

export function acceptMessageAttachments(message: ClaimMessage): MessageAttachmentResource {
  const key = JSON.stringify([getSessionGeneration(), message.conversationId, message.id]);
  let resource = resources.get(key);
  if (!resource) {
    resource = createAttachmentResource(message.conversationId, message.id, () => {
      if (resources.get(key) === resource) resources.delete(key);
    });
    resources.set(key, resource);
  }
  resource.setModerated(Boolean(message.isHidden));
  resource.ingest(message.isHidden ? [] : message.attachments);
  return resource;
}
