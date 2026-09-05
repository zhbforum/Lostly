import { useCallback, useEffect, useState } from 'react';
import { discardDraft, readDraft, saveDraft } from './form-drafts';

export function useFormDraft<T>(key: string, initialValue: () => T) {
  const [value, setValue] = useState<T>(() => readDraft<T>(key) ?? initialValue());
  useEffect(() => {
    saveDraft(key, value);
  }, [key, value]);
  const discard = useCallback(() => discardDraft(key), [key]);
  return [value, setValue, discard] as const;
}
