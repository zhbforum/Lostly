import '@testing-library/jest-dom/vitest';

import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';
import { clearDrafts } from '@/shared/model/form-drafts';
import { advanceSessionGeneration } from '@/shared/api/session-events';

afterEach(() => {
  cleanup();
  clearDrafts();
  advanceSessionGeneration();
});
