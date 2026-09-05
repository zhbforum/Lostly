import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { clearDrafts } from '@/shared/model/form-drafts';

afterEach(() => {
  cleanup();
  clearDrafts();
});
