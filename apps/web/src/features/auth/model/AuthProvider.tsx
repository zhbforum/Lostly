import { type ReactNode, useEffect, useRef, useState } from 'react';
import {
  getCurrentUser,
  login as loginRequest,
  logout as logoutRequest,
  register as registerRequest,
} from '@/features/auth/api/auth-api';
import { AuthContext, type AuthStatus } from '@/features/auth/model/auth-context';
import type { AuthUser, LoginInput, RegisterInput } from '@/features/auth/model/types';
import { ApiError } from '@/shared/api/client';
import { advanceSessionGeneration, subscribeToSessionExpiry } from '@/shared/api/session-events';
import { clearDrafts, selectDraftOwner } from '@/shared/model/form-drafts';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [sessionExpired, setSessionExpired] = useState(false);
  const operation = useRef(0);
  const authenticated = useRef(false);

  function authenticate(nextUser: AuthUser) {
    advanceSessionGeneration();
    selectDraftOwner(nextUser.id);
    authenticated.current = true;
    setUser(nextUser);
    setStatus('authenticated');
    setSessionExpired(false);
  }

  useEffect(() => {
    const unsubscribe = subscribeToSessionExpiry(() => {
      operation.current += 1;
      setSessionExpired(authenticated.current);
      authenticated.current = false;
      setUser(null);
      setStatus('unauthenticated');
    });
    const controller = new AbortController();
    const version = ++operation.current;
    void getCurrentUser(controller.signal)
      .then((response) => {
        if (!controller.signal.aborted && version === operation.current)
          authenticate(response.user);
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || version !== operation.current) return;
        setUser(null);
        setStatus(error instanceof ApiError && error.status === 401 ? 'unauthenticated' : 'error');
      });
    return () => {
      controller.abort();
      operation.current += 1;
      unsubscribe();
    };
  }, []);

  async function signIn(request: () => Promise<{ user: AuthUser }>) {
    const version = ++operation.current;
    advanceSessionGeneration();
    const response = await request();
    if (version === operation.current) authenticate(response.user);
  }

  function login(input: LoginInput) {
    return signIn(() => loginRequest(input));
  }
  function register(input: RegisterInput) {
    return signIn(() => registerRequest(input));
  }

  async function logout() {
    const version = ++operation.current;
    advanceSessionGeneration();
    clearDrafts();
    await logoutRequest();
    if (version !== operation.current) return;
    advanceSessionGeneration();
    authenticated.current = false;
    setUser(null);
    setStatus('unauthenticated');
    setSessionExpired(false);
  }

  return (
    <AuthContext.Provider value={{ user, status, sessionExpired, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}
