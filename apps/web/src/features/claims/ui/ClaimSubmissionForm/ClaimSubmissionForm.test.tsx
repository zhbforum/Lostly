import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';
import { createClaim } from '@/features/claims/api/claims-api';
import { CLAIM_CONSTRAINTS, type ClaimResponse } from '@/features/claims/model/types';
import { ApiError } from '@/shared/api/client';
import { readDraft } from '@/shared/model/form-drafts';
import { deferred } from '@/test/deferred';
import { claim } from '@/test/fixtures/claims';
import { ClaimSubmissionForm } from './ClaimSubmissionForm';

vi.mock('@/features/claims/api/claims-api');

beforeEach(() => vi.resetAllMocks());

it('validates trimmed proof at the minimum boundary and allows correcting the error', async () => {
  const actor = userEvent.setup();
  const onCreated = vi.fn();
  const proof = 'x'.repeat(CLAIM_CONSTRAINTS.verificationDetailsMinLength);
  const saved = claim({ verificationDetails: proof });
  vi.mocked(createClaim).mockResolvedValue({ claim: saved });

  render(<ClaimSubmissionForm listingId="listing-1" onCreated={onCreated} />);

  const input = screen.getByRole('textbox', { name: /Proof of ownership/ });

  await actor.type(input, `  ${proof.slice(1)}  `);
  await actor.click(screen.getByRole('button', { name: 'Submit private claim' }));

  expect(input).toBeInvalid();
  expect(input).toHaveAccessibleDescription('Please provide at least 10 characters.');
  expect(createClaim).not.toHaveBeenCalled();

  await actor.clear(input);
  await actor.type(input, `  ${proof}  `);

  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  await actor.click(screen.getByRole('button', { name: 'Submit private claim' }));

  expect(createClaim).toHaveBeenCalledExactlyOnceWith('listing-1', { verificationDetails: proof });
  expect(onCreated).toHaveBeenCalledExactlyOnceWith(saved);
});

it('disables edits and duplicate submissions until the claim is confirmed, then discards its draft', async () => {
  const actor = userEvent.setup();
  const pending = deferred<ClaimResponse>();
  const onCreated = vi.fn();
  const saved = claim();
  vi.mocked(createClaim).mockReturnValue(pending.promise);

  render(<ClaimSubmissionForm listingId="listing-1" onCreated={onCreated} />);

  const input = screen.getByRole('textbox', { name: /Proof of ownership/ });

  await actor.type(input, saved.verificationDetails);
  await actor.click(screen.getByRole('button', { name: 'Submit private claim' }));

  expect(input).toBeDisabled();

  const pendingButton = screen.getByRole('button', { name: 'Submitting claim…' });

  expect(pendingButton).toBeDisabled();

  await actor.click(pendingButton);

  expect(createClaim).toHaveBeenCalledOnce();
  expect(onCreated).not.toHaveBeenCalled();
  expect(readDraft('claim:listing-1')).toBe(saved.verificationDetails);

  await act(async () => pending.resolve({ claim: saved }));

  expect(onCreated).toHaveBeenCalledExactlyOnceWith(saved);
  expect(readDraft('claim:listing-1')).toBeUndefined();
});

it.each([
  [
    new ApiError(429, 'RATE_LIMITED', 'Wait a minute before submitting another claim.'),
    'Wait a minute before submitting another claim.',
  ],
  [new TypeError('Internal network details'), 'We could not submit your claim. Please try again.'],
] as const)(
  'retains private proof after %s and permits an explicit retry',
  async (error, feedback) => {
    const actor = userEvent.setup();
    const saved = claim();
    const onCreated = vi.fn();
    vi.mocked(createClaim).mockRejectedValueOnce(error).mockResolvedValueOnce({ claim: saved });
    const view = render(<ClaimSubmissionForm listingId="listing-1" onCreated={onCreated} />);

    await actor.type(
      screen.getByRole('textbox', { name: /Proof of ownership/ }),
      saved.verificationDetails,
    );
    await actor.click(screen.getByRole('button', { name: 'Submit private claim' }));

    expect(await screen.findByRole('alert')).toHaveTextContent(feedback);
    expect(screen.getByRole('textbox', { name: /Proof of ownership/ })).toHaveValue(
      saved.verificationDetails,
    );
    expect(onCreated).not.toHaveBeenCalled();
    expect(createClaim).toHaveBeenCalledOnce();

    view.unmount();
    render(<ClaimSubmissionForm listingId="listing-1" onCreated={onCreated} />);

    expect(screen.getByRole('textbox', { name: /Proof of ownership/ })).toHaveValue(
      saved.verificationDetails,
    );

    await actor.click(screen.getByRole('button', { name: 'Submit private claim' }));

    expect(onCreated).toHaveBeenCalledExactlyOnceWith(saved);
    expect(createClaim).toHaveBeenCalledTimes(2);
  },
);

it('keeps drafts isolated between reports', async () => {
  const actor = userEvent.setup();
  const first = render(<ClaimSubmissionForm listingId="first" onCreated={vi.fn()} />);

  await actor.type(
    screen.getByRole('textbox', { name: /Proof of ownership/ }),
    'Private proof for the first report.',
  );
  first.unmount();

  const second = render(<ClaimSubmissionForm listingId="second" onCreated={vi.fn()} />);

  expect(screen.getByRole('textbox', { name: /Proof of ownership/ })).toHaveValue('');

  await actor.type(
    screen.getByRole('textbox', { name: /Proof of ownership/ }),
    'Private proof for the second report.',
  );
  second.unmount();
  render(<ClaimSubmissionForm listingId="first" onCreated={vi.fn()} />);

  expect(screen.getByRole('textbox', { name: /Proof of ownership/ })).toHaveValue(
    'Private proof for the first report.',
  );
  expect(createClaim).not.toHaveBeenCalled();
});
