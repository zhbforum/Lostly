import { safeReturnTo } from './return-to';

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function getConversationReturn(value: unknown): { to: string; steps: number } | null {
  const { returnTo, conversationReturnSteps: steps } = record(value);
  if (
    typeof returnTo !== 'string' ||
    safeReturnTo(returnTo) !== returnTo ||
    !/^\/messages\/[^/?#]+$/.test(returnTo) ||
    typeof steps !== 'number' ||
    !Number.isSafeInteger(steps) ||
    steps < 1
  )
    return null;
  return { to: returnTo, steps };
}

// Track only pushes within the report flow. Replacements preserve the depth.
// This keeps Back to conversation correct after claim pagination or report editing,
// without inspecting React Router's private browser-history state.
export function advanceConversationReturn(value: unknown): Record<string, unknown> {
  const state = record(value);
  const origin = getConversationReturn(state);
  return origin ? { ...state, conversationReturnSteps: origin.steps + 1 } : state;
}
