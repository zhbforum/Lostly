import { useLocation, useSearchParams } from 'react-router';
import { advanceConversationReturn } from '@/shared/navigation/conversation-return';

export function useCursorNavigation(parameter = 'cursor') {
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const cursor = params.get(parameter) ?? undefined;
  const saved: unknown = location.state?.pagination;
  const previous: Array<string | null> =
    Array.isArray(saved) && saved.every((value) => value === null || typeof value === 'string')
      ? saved
      : [];

  function setCursor(nextCursor: string | null, history: Array<string | null>) {
    const next = new URLSearchParams(params);
    if (nextCursor) next.set(parameter, nextCursor);
    else next.delete(parameter);
    setParams(next, {
      state: { ...advanceConversationReturn(location.state), pagination: history },
    });
  }

  return {
    cursor,
    hasPrevious: Boolean(cursor),
    previousLabel: previous.length > 0 ? 'Previous' : 'First page',
    next: (value: string) => setCursor(value, [...previous, cursor ?? null]),
    previous: () => setCursor(previous.at(-1) ?? null, previous.slice(0, -1)),
    reset: () => setCursor(null, []),
    changeFilters: (values: Record<string, string | undefined>) => {
      const next = new URLSearchParams(params);
      next.delete(parameter);
      for (const [key, value] of Object.entries(values)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      setParams(next, { state: { ...advanceConversationReturn(location.state), pagination: [] } });
    },
  };
}
