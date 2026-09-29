import { useCallback, useEffect, useRef } from 'react';

interface Options {
  task: (signal: AbortSignal) => Promise<void>;
  intervalMs: number;
  enabled?: boolean;
  resourceKey?: string | number;
}

/** The resource callback owns error presentation. Refreshes coalesce behind an active request. */
export function useVisiblePolling({ task, intervalMs, enabled = true, resourceKey }: Options) {
  const latestTask = useRef(task);
  const trigger = useRef<(() => void) | null>(null);
  useEffect(() => {
    latestTask.current = task;
  }, [task]);

  useEffect(() => {
    if (!enabled) return;
    let stopped = false;
    let running = false;
    let requested = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    const clearTimer = () => {
      clearTimeout(timer);
      timer = undefined;
    };
    async function run() {
      if (stopped || document.hidden) return;
      if (running) {
        requested = true;
        return;
      }
      clearTimer();
      requested = false;
      running = true;
      controller = new AbortController();
      try {
        await latestTask.current(controller.signal);
      } catch {
        // Errors are shown by the resource; a rejected request must not stop future polling.
      } finally {
        running = false;
        controller = null;
        if (!stopped && !document.hidden) {
          if (requested) void run();
          else timer = setTimeout(() => void run(), intervalMs);
        }
      }
    }
    const refresh = () => {
      clearTimer();
      requested = true;
      if (running) controller?.abort();
      else void run();
    };
    const onVisibility = () => {
      if (document.hidden) {
        clearTimer();
        controller?.abort();
      } else refresh();
    };
    trigger.current = refresh;
    document.addEventListener('visibilitychange', onVisibility);
    void run();
    return () => {
      stopped = true;
      clearTimer();
      controller?.abort();
      document.removeEventListener('visibilitychange', onVisibility);
      if (trigger.current === refresh) trigger.current = null;
    };
  }, [enabled, intervalMs, resourceKey]);

  return useCallback(() => trigger.current?.(), []);
}
