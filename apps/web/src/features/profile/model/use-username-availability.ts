import { useEffect, useState } from 'react';
import { usernameIssue } from '@lostly/contracts/profile';
import { checkUsername } from '../api/profile-api';

type Status = 'checking' | 'available' | 'taken' | 'error';
export function useUsernameAvailability(username: string, enabled: boolean) {
  const [result, setResult] = useState<{ username: string; status: Status } | null>(null);
  const active = enabled && Boolean(username) && !usernameIssue(username);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await checkUsername(username, controller.signal);
        if (!controller.signal.aborted)
          setResult({ username, status: response.available ? 'available' : 'taken' });
      } catch {
        if (!controller.signal.aborted) setResult({ username, status: 'error' });
      }
    }, 350);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [username, active]);
  return active ? (result?.username === username ? result.status : 'checking') : null;
}
