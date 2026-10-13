import { useEffect, useState } from 'react';
import type { PublicProfile } from '@lostly/contracts/profile';
import { ApiError } from '@/shared/api/client';
import { reconcileProfileAvatar } from '@/shared/model/profile-avatar';
import { getPublicProfile } from '../api/profile-api';

type State =
  { status: 'loading' | 'error' | 'not-found' } | { status: 'success'; profile: PublicProfile };

export function usePublicProfile(id: string, lookup: 'id' | 'username' = 'id') {
  const [retry, setRetry] = useState(0);
  const [settled, setSettled] = useState<{ key: string; state: State } | null>(null);
  const key = JSON.stringify([lookup, id, retry]);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    let profile: PublicProfile | undefined;
    let pending = false;
    async function load() {
      if (pending || controller.signal.aborted) return;
      pending = true;
      clearTimeout(timer);
      try {
        const response = await getPublicProfile(id, controller.signal, lookup);
        if (controller.signal.aborted) return;
        profile = {
          ...response.profile,
          avatar: reconcileProfileAvatar(profile?.avatar, response.profile.avatar) ?? null,
        };
        setSettled({ key, state: { status: 'success', profile } });
        if (profile.avatar)
          timer = setTimeout(
            () => void load(),
            Math.max(1000, Date.parse(profile.avatar.urlExpiresAt) - Date.now() - 60_000),
          );
      } catch (error) {
        if (controller.signal.aborted) return;
        if (error instanceof ApiError && [404, 422].includes(error.status)) {
          profile = undefined;
          setSettled({ key, state: { status: 'not-found' } });
        } else if (profile) {
          timer = setTimeout(() => void load(), 60_000);
        } else setSettled({ key, state: { status: 'error' } });
      } finally {
        pending = false;
      }
    }
    function visible() {
      if (
        !document.hidden &&
        profile?.avatar &&
        Date.parse(profile.avatar.urlExpiresAt) - Date.now() < 60_000
      )
        void load();
    }
    void load();
    document.addEventListener('visibilitychange', visible);
    return () => {
      controller.abort();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [id, key, lookup]);
  return {
    state: settled?.key === key ? settled.state : { status: 'loading' as const },
    refresh: () => setRetry((value) => value + 1),
  };
}
