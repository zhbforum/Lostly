import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import type { UserProfile } from '@lostly/contracts/profile';
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
import { reconcileProfileAvatar } from '@/shared/model/profile-avatar';

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [sessionExpired, setSessionExpired] = useState(false);
  const operation = useRef(0);
  const authenticated = useRef(false);

  const updateProfile = useCallback((profile: UserProfile) => {
    setUser((current) =>
      current?.id === profile.id && (current.profileVersion ?? 0) <= profile.version
        ? {
            ...current,
            displayName: profile.displayName,
            username: profile.username,
            avatar: reconcileProfileAvatar(current.avatar, profile.avatar),
            profileVersion: profile.version,
          }
        : current,
    );
  }, []);

  const avatarExpiry = user?.avatar?.urlExpiresAt;
  const userId = user?.id;
  useEffect(() => {
    if (!avatarExpiry || !userId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let pending = false;
    async function renew() {
      if (pending || controller.signal.aborted) return;
      clearTimeout(timer);
      const version = operation.current;
      pending = true;
      try {
        const response = await getCurrentUser(controller.signal);
        if (
          !controller.signal.aborted &&
          version === operation.current &&
          response.user.id === userId
        ) {
          setUser((current) =>
            current?.id === userId &&
            (current.profileVersion ?? 0) <= (response.user.profileVersion ?? 0)
              ? {
                  ...response.user,
                  avatar: reconcileProfileAvatar(current.avatar, response.user.avatar),
                }
              : current,
          );
        }
      } catch {
        return;
      } finally {
        pending = false;
        if (!controller.signal.aborted) timer = setTimeout(() => void renew(), 60_000);
      }
    }
    function onVisible() {
      if (!document.hidden && Date.parse(avatarExpiry!) - Date.now() < 60_000) void renew();
    }
    timer = setTimeout(
      () => void renew(),
      Math.max(1000, Date.parse(avatarExpiry) - Date.now() - 60_000),
    );
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [avatarExpiry, userId]);

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
    <AuthContext.Provider
      value={{ user, status, sessionExpired, login, register, logout, updateProfile }}
    >
      {children}
    </AuthContext.Provider>
  );
}
