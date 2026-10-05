import type { ClaimMessagePreview } from './types';

export function conversationMessagePreview(message: ClaimMessagePreview | null): string {
  if (!message) return 'Claim submitted · No messages yet';
  if (message.body !== null) return message.body;
  return message.attachmentCount === 1 ? 'Photo' : `${message.attachmentCount} photos`;
}

export function formatConversationActivity(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const minutes = Math.max(0, Math.floor((now.getTime() - date.getTime()) / 60_000));
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`;
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? ({ year: 'numeric' } as const) : {}),
  }).format(date);
}

export function messageDay(value: string, now = new Date()): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  if (day(date) === day(now)) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (day(date) === day(yesterday)) return 'Yesterday';
  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  }).format(date);
}

export function messageTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('en', { hour: '2-digit', minute: '2-digit', hour12: false }).format(
        date,
      );
}
