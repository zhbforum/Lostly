import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { advanceSessionGeneration, getSessionGeneration } from '@/shared/api/session-events';
import { readDraft, saveDraft, selectDraftOwner } from '@/shared/model/form-drafts';
import {
  readConversationDraft,
  saveConversationDraft,
  useConversationDraft,
} from './message-drafts';

it('keeps ordered File refs only in memory, survives navigation and does not change other form retention', () => {
  const persistent = vi.spyOn(Storage.prototype, 'setItem');
  const file = new File(['photo'], 'private.jpg');
  const a = renderHook(() => useConversationDraft('A'));

  act(() => a.result.current.setDraft({ text: 'Draft A', images: [file, file] }));
  a.unmount();

  const b = renderHook(() => useConversationDraft('B'));

  expect(b.result.current.draft).toEqual({ text: '', images: [] });

  const reopened = renderHook(() => useConversationDraft('A'));

  expect(reopened.result.current.draft.text).toBe('Draft A');
  expect(reopened.result.current.draft.images[0]).toBe(file);
  expect(reopened.result.current.draft.images[1]).toBe(file);
  expect(persistent).not.toHaveBeenCalled();

  persistent.mockRestore();
});

it('clears stored and mounted drafts on generation change, rejects stale writes, including same-owner relogin', () => {
  selectDraftOwner('same-user');
  saveDraft('unrelated-form', 'keep existing policy');

  const oldGeneration = getSessionGeneration();
  const file = new File(['photo'], 'private.jpg');
  const mounted = renderHook(() => useConversationDraft('A'));
  const staleSet = mounted.result.current.setDraft;

  act(() => staleSet({ text: 'Private', images: [file] }));
  act(() => advanceSessionGeneration());

  expect(mounted.result.current.draft).toEqual({ text: '', images: [] });
  expect(readConversationDraft('A')).toEqual({ text: '', images: [] });

  act(() => staleSet({ text: 'Stale', images: [file] }));

  expect(
    saveConversationDraft('A', { text: 'Late rejection', images: [file] }, oldGeneration),
  ).toBe(false);

  act(() => {
    advanceSessionGeneration();
    selectDraftOwner('same-user');
  });

  expect(readConversationDraft('A')).toEqual({ text: '', images: [] });
  expect(readDraft('unrelated-form')).toBe('keep existing policy');
});
