import type { ReactNode } from 'react';
import { vi } from 'vitest';
import { AuthContext, type AuthContextValue } from '@/features/auth/model/auth-context';
import { ConversationUnreadContext } from '@/features/conversations/model/use-conversation-unread';
import { profileUser } from './fixtures/profile';

export function TestSession({
  children,
  auth = {},
}: {
  children: ReactNode;
  auth?: Partial<AuthContextValue>;
}) {
  return (
    <AuthContext.Provider
      value={{
        user: profileUser(),
        status: 'authenticated',
        login: vi.fn(),
        register: vi.fn(),
        logout: vi.fn(),
        updateProfile: vi.fn(),
        ...auth,
      }}
    >
      <ConversationUnreadContext.Provider
        value={{ unreadConversationCount: 0, refreshUnread: vi.fn() }}
      >
        {children}
      </ConversationUnreadContext.Provider>
    </AuthContext.Provider>
  );
}
