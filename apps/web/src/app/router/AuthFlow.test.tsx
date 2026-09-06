import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider } from '@/features/auth/model/AuthProvider';
import { ownerReport } from '@/test/fixtures/listing-management';
import { AppRouter } from './AppRouter';

// Only the date widget is simplified; router, provider, forms and API client are real.
vi.mock('@/features/listings/ui/ListingFormFields/ListingDateField/ListingDateField', () => ({
  ListingDateField: ({ value, onChange }: { value: string; onChange: (value: string) => void }) => (
    <label>
      Date
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  ),
}));
const user = { id: 'user-1', email: 'alex@example.com', displayName: 'Alex', role: 'user' };
const listing = {
  id: '550e8400-e29b-41d4-a716-446655440001',
  kind: 'found',
  status: 'active',
  title: 'Blue backpack',
  description: 'A blue backpack with a front pocket.',
  location: 'Berlin library',
  occurredOn: '2026-09-01',
  createdAt: '2026-09-01T10:00:00Z',
  updatedAt: '2026-09-01T10:00:00Z',
};
const unauthorized = () =>
  Response.json({ error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }, { status: 401 });
function Position() {
  const location = useLocation();
  return (
    <output aria-label="Current URL">{location.pathname + location.search + location.hash}</output>
  );
}
function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AuthProvider>
        <AppRouter />
        <Position />
      </AuthProvider>
    </MemoryRouter>,
  );
}
async function login() {
  const actor = userEvent.setup();
  await actor.type(await screen.findByLabelText('Email'), user.email);
  await actor.type(screen.getByLabelText('Password'), 'a long test password');
  await actor.click(screen.getByRole('button', { name: 'Sign in' }));
  return actor;
}
afterEach(() => vi.unstubAllGlobals());

describe('authentication and report flow', () => {
  it.each([false, true])(
    'returns to edit after session expiry with version-safe fields (server changed: %s)',
    async (serverChanged) => {
      const report = ownerReport();
      const edited = {
        title: 'Edited backpack',
        description: 'An unsaved description with more detail.',
        location: 'Central library',
        occurredOn: '2026-09-02',
      };
      const fresh = {
        ...report.listing,
        title: 'Updated in another tab',
        description: 'A newer server description.',
        location: 'New server location',
        occurredOn: '2026-09-03',
        updatedAt: '2026-09-03T10:00:00.000Z',
      };
      let reauthenticated = false;
      let updates = 0;
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string, options: RequestInit) => {
          if (url.endsWith('/auth/me')) return Response.json({ user });
          if (url.endsWith('/auth/login')) {
            reauthenticated = true;
            return Response.json({ user });
          }
          if (url.endsWith('/listings/' + report.listing.id)) {
            if (options.method === 'PATCH') {
              updates += 1;
              expect(JSON.parse(options.body as string)).toEqual(edited);
              return unauthorized();
            }
            return Response.json({
              ...report,
              listing: reauthenticated && serverChanged ? fresh : report.listing,
            });
          }
          throw new Error('Unexpected request');
        }),
      );

      const destination = `/listings/${report.listing.id}/edit?source=activity#form`;
      renderApp(destination);
      await screen.findByLabelText('Title', {}, { timeout: 5000 });
      for (const [label, value] of Object.entries({
        Title: edited.title,
        Description: edited.description,
        Location: edited.location,
        Date: edited.occurredOn,
      })) {
        fireEvent.change(screen.getByLabelText(label), { target: { value } });
      }
      const actor = userEvent.setup();
      await actor.click(screen.getByRole('button', { name: 'Save changes' }));
      await screen.findByText(/Your session expired/);
      expect(screen.getByLabelText('Current URL')).toHaveTextContent('/login');
      expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
      await login();

      const expected = serverChanged ? fresh : edited;
      expect(await screen.findByLabelText('Title')).toHaveValue(expected.title);
      expect(screen.getByLabelText('Description')).toHaveValue(expected.description);
      expect(screen.getByLabelText('Location')).toHaveValue(expected.location);
      expect(screen.getByLabelText('Date')).toHaveValue(expected.occurredOn);
      expect(screen.getByLabelText('Current URL')).toHaveTextContent(destination);
      expect(updates).toBe(1); // Reauthentication must not replay PATCH.
    },
  );

  it('returns to a deep link with its query and hash after switching auth pages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.endsWith('/auth/me')) return unauthorized();
        if (url.endsWith('/auth/login')) return Response.json({ user });
        if (url.endsWith('/listings/' + listing.id))
          return Response.json({
            listing,
            capabilities: {
              canClaim: false,
              canReviewClaims: false,
              canEdit: false,
              canResolve: false,
              canArchive: false,
            },
            claim: null,
          });
        throw new Error('Unexpected request');
      }),
    );
    const destination = '/listings/' + listing.id + '?source=shared#claims';
    renderApp(destination);
    const actor = userEvent.setup();
    await actor.click(await screen.findByRole('link', { name: 'Create an account' }));
    await actor.click(screen.getByRole('link', { name: 'Sign in' }));
    await login();
    // The first lazy details import includes the real accessible dialog library.
    await screen.findByRole('heading', { name: listing.title }, { timeout: 5000 });
    expect(screen.getByLabelText('Current URL')).toHaveTextContent(destination);
    // Allow the full authentication flow in addition to the lazy-route wait above.
  }, 10_000);

  it('restores a draft after session expiry and opens the created report', async () => {
    let creates = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, options: RequestInit) => {
        if (url.endsWith('/auth/me') || url.endsWith('/auth/login')) return Response.json({ user });
        if (url.endsWith('/listings') && options.method === 'POST') {
          creates += 1;
          if (creates === 1) return unauthorized();
          expect(JSON.parse(options.body as string)).toMatchObject({
            title: listing.title,
            description: listing.description,
          });
          return Response.json({ listing }, { status: 201 });
        }
        if (url.endsWith('/listings/' + listing.id))
          return Response.json({
            listing,
            capabilities: {
              canClaim: false,
              canReviewClaims: false,
              canEdit: false,
              canResolve: false,
              canArchive: false,
            },
            claim: null,
          });
        throw new Error('Unexpected request');
      }),
    );
    renderApp('/listings/new?kind=found');
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: listing.title } });
    fireEvent.change(screen.getByLabelText('Description'), {
      target: { value: listing.description },
    });
    fireEvent.change(screen.getByLabelText('Location'), { target: { value: listing.location } });
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: listing.occurredOn } });
    const actor = userEvent.setup();
    await actor.click(screen.getByRole('button', { name: 'Create report' }));
    await screen.findByText(/Your session expired/);
    await login();
    expect(await screen.findByLabelText('Title')).toHaveValue(listing.title);
    expect(screen.getByLabelText('Description')).toHaveValue(listing.description);
    expect(screen.getByLabelText('Date')).toHaveValue(listing.occurredOn);
    expect(creates).toBe(1); // Never silently replay a mutation on reauthentication.
    await actor.click(screen.getByRole('button', { name: 'Create report' }));
    await actor.click(await screen.findByRole('link', { name: 'View report' }));
    await screen.findByRole('heading', { name: listing.title });
    await waitFor(() => expect(creates).toBe(2));
  });
});
