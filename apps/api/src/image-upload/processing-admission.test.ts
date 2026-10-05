import { expect, test } from 'bun:test';
import { createImageProcessingAdmission } from './processing-admission';

test('shares two permits and restores capacity without allowing double-release underflow', () => {
  const admission = createImageProcessingAdmission();
  const first = admission.tryAcquire();
  const second = admission.tryAcquire();
  expect(first).toBeFunction();
  expect(second).toBeFunction();
  expect(admission.tryAcquire()).toBeNull();
  first!();
  const replacement = admission.tryAcquire();
  expect(replacement).toBeFunction();
  first!();
  expect(admission.tryAcquire()).toBeNull();
  second!();
  replacement!();
  expect(admission.tryAcquire()).toBeFunction();
  expect(admission.tryAcquire()).toBeFunction();
  expect(admission.tryAcquire()).toBeNull();
});
