import type { ApiError } from '@/shared/api/client';
import type { ClaimMessage } from './types';

export interface PendingSendOperation {
  readonly conversationId: string;
  readonly operationId: string;
  readonly body: string;
  readonly sessionGeneration: number;
  readonly createdAt: string;
  readonly status: 'sending' | 'uncertain' | 'rate-limited';
  readonly mayBePersisted: boolean;
  readonly retryAfterUntil?: number;
}

export type SendResult =
  | { status: 'sent'; operation: PendingSendOperation; message: ClaimMessage }
  | { status: 'uncertain'; operation: PendingSendOperation; error?: ApiError }
  | { status: 'rate-limited'; operation: PendingSendOperation }
  | { status: 'rejected'; operation: PendingSendOperation; error: ApiError }
  | { status: 'invalid' | 'ignored' };

export type SendStart =
  | {
      accepted: false;
      result: Extract<SendResult, { status: 'ignored' | 'invalid' }>;
    }
  | {
      // The operation is already registered; the registry owns its outgoing body.
      accepted: true;
      operation: PendingSendOperation;
      completion: Promise<SendResult>;
    };

export type SendRegistry = Readonly<Record<string, readonly PendingSendOperation[]>>;

export interface ConversationSendContextValue {
  operations: SendRegistry;
  sendMessage: (conversationId: string, body: string) => SendStart;
  retry: (conversationId: string, operationId: string) => Promise<SendResult>;
  subscribeToResults: (listener: (result: SendResult) => void) => () => void;
}
