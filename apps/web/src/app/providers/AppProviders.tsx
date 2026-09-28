import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';

import { AuthProvider } from '@/features/auth/model/AuthProvider';
import { ConversationSendProvider } from '@/features/conversations/model/ConversationSendProvider';
import { ConversationUnreadProvider } from '@/features/conversations/model/ConversationUnreadProvider';

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ConversationSendProvider>
          <ConversationUnreadProvider>{children}</ConversationUnreadProvider>
        </ConversationSendProvider>
      </AuthProvider>
    </BrowserRouter>
  );
}
