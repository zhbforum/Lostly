import { type ReactNode, useEffect, useState } from 'react';

import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from '@/features/auth/api/auth-api';
import { AuthContext, type AuthStatus } from '@/features/auth/model/auth-context';
import type { AuthUser, LoginInput, RegisterInput } from '@/features/auth/model/types';
import { ApiError } from '@/shared/api/client';

interface AuthProviderProps {
  children: ReactNode;
}

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      try {
        const response = await getCurrentUser();

        if (cancelled) {
          return;
        }

        setUser(response.user);
        setStatus('authenticated');
      } catch (error) {
        if (cancelled) {
          return;
        }

        if (error instanceof ApiError && error.status === 401) {
          setUser(null);
          setStatus('unauthenticated');
          return;
        }

        setUser(null);
        setStatus('error');
      }
    }

    void bootstrap();

    return () => {
      cancelled = true;
    };
  }, []);

  async function login(input: LoginInput): Promise<void> {
    const response = await loginRequest(input);

    setUser(response.user);
    setStatus('authenticated');
  }

  async function register(input: RegisterInput): Promise<void> {
    const response = await registerRequest(input);

    setUser(response.user);
    setStatus('authenticated');
  }

  async function logout(): Promise<void> {
    await logoutRequest();

    setUser(null);
    setStatus('unauthenticated');
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        status,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
