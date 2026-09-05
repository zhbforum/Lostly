import { useCallback, useEffect, useState } from 'react';

export type ResourceState<T> =
  { status: 'loading' } | { status: 'error' } | { status: 'success'; data: T };

export function useApiResource<T>(key: string, fetcher: (signal: AbortSignal) => Promise<T>) {
  const [version, setVersion] = useState(0);
  const [settled, setSettled] = useState<{ key: string; state: ResourceState<T> } | null>(null);
  const requestKey = JSON.stringify([key, version]);
  useEffect(() => {
    const controller = new AbortController();
    void fetcher(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted)
          setSettled({ key: requestKey, state: { status: 'success', data } });
      })
      .catch(() => {
        if (!controller.signal.aborted) setSettled({ key: requestKey, state: { status: 'error' } });
      });
    return () => controller.abort();
  }, [requestKey, fetcher]);
  const refresh = useCallback(() => setVersion((value) => value + 1), []);
  const state: ResourceState<T> =
    settled?.key === requestKey ? settled.state : { status: 'loading' };
  return { state, refresh };
}
