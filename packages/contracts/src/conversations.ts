export const CONVERSATION_CONSTRAINTS = {
  messageMinLength: 1,
  messageMaxLength: 2000,
} as const;

export interface ClaimMessage {
  id: string;
  conversationId: string;
  sequence: number;
  senderUserId: string;
  body: string;
  createdAt: string;
}

export interface SendClaimMessageInput {
  body: string;
}
