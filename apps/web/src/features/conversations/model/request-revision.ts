import { getSessionGeneration } from '@/shared/api/session-events';

/** One instance per resource/controller. Invalidate when applying a mutation result. */
export function createRequestRevision() {
  const owner = Symbol();
  let revision = 0;
  let disposed = false;
  const capture = () => ({ owner, revision, sessionGeneration: getSessionGeneration() });
  return {
    capture,
    isCurrent: (request: ReturnType<typeof capture>) =>
      !disposed &&
      request.owner === owner &&
      request.revision === revision &&
      request.sessionGeneration === getSessionGeneration(),
    invalidate: () => {
      revision += 1;
    },
    dispose: () => {
      disposed = true;
    },
  };
}
