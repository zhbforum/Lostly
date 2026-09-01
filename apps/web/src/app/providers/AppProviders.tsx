import type { ReactNode } from 'react';
import { BrowserRouter } from 'react-router';

import { AuthProvider } from '@/features/auth/model/AuthProvider';

interface AppProvidersProps {
  children: ReactNode;
}

export function AppProviders({ children }: AppProvidersProps) {
  return (
    <BrowserRouter>
      <AuthProvider>{children}</AuthProvider>
    </BrowserRouter>
  );
}
