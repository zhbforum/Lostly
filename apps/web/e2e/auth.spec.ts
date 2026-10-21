import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { barrier } from './support/barrier.ts';

const api = 'http://localhost:3000';
const csrf = { 'X-CSRF-Protection': '1' };

function account(displayName: string) {
  return {
    displayName,
    email: `auth-${crypto.randomUUID()}@example.com`,
    password: 'a long auth e2e-only password',
  };
}

async function register(request: APIRequestContext, credentials: ReturnType<typeof account>) {
  const response = await request.post(`${api}/auth/register`, { headers: csrf, data: credentials });
  expect(response.status()).toBe(201);
}

async function signIn(page: Page, credentials: ReturnType<typeof account>) {
  await page.getByLabel('Email', { exact: true }).fill(credentials.email);
  await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}

function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  return errors;
}

async function createReport(request: APIRequestContext) {
  const response = await request.post(`${api}/listings`, {
    headers: csrf,
    data: {
      kind: 'found',
      title: 'Auth E2E blue backpack',
      description: 'A blue backpack found beside the library.',
      location: 'Central library',
      occurredOn: '2026-09-01',
    },
  });
  expect(response.status()).toBe(201);
  return (await response.json()).listing as { id: string; version: number; title: string };
}

test('registers through the browser, returns to a deep link and keeps the session after reload', async ({
  page,
  context,
}) => {
  const errors = watchErrors(page);
  const credentials = account('New member');
  const destination = '/listings?kind=found#results';

  await test.step('Follow the protected deep link to registration', async () => {
    await page.goto(destination);

    await expect(page).toHaveURL(/\/login$/);

    await page.getByRole('link', { name: 'Create an account' }).click();
    await page.getByLabel('Display name', { exact: true }).fill(credentials.displayName);
    await page.getByLabel('Email', { exact: true }).fill(credentials.email);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
  });

  await test.step('Register and return to the original filters and fragment', async () => {
    const registration = page.waitForResponse(
      (response) =>
        response.url() === `${api}/auth/register` && response.request().method() === 'POST',
    );

    await page.getByRole('button', { name: 'Create account', exact: true }).click();

    expect((await registration).status()).toBe(201);
    await expect(page).toHaveURL(new URL(destination, 'http://localhost:4173').href);
    await expect(page.getByLabel('Report type')).toHaveValue('found');
    await expect(page.getByRole('button', { name: 'Account: New member' })).toBeVisible();
  });

  await test.step('Keep the same authenticated identity after a document reload', async () => {
    await page.reload();

    await expect(page.getByRole('button', { name: 'Account: New member' })).toBeVisible();
    await expect(page).toHaveURL(new URL(destination, 'http://localhost:4173').href);

    const session = await context.request.get(`${api}/auth/me`);

    expect(session.status()).toBe(200);
    expect((await session.json()).user).toMatchObject({
      email: credentials.email,
      displayName: credentials.displayName,
    });
  });

  expect(errors).toEqual([]);
});

test('restores an edit after session revocation and sign-in without automatically replaying the save', async ({
  page,
  context,
  request,
}) => {
  const errors = watchErrors(page);
  const credentials = account('Returning member');

  await register(context.request, credentials);

  const listing = await createReport(context.request);
  const destination = `/listings/${listing.id}/edit?source=activity#form`;

  await test.step('Edit the report without saving the draft', async () => {
    await page.goto(destination);
    await page.getByLabel('Title', { exact: true }).fill('My unsaved backpack title');
    await page
      .getByLabel('Description', { exact: true })
      .fill('Private unsaved identifying description.');
    await page.getByLabel('Location', { exact: true }).fill('Library reception');
  });

  await test.step('Revoke the server session while retaining the browser cookie', async () => {
    // Revoke the server session through a separate client, leaving the browser cookie in place.
    const cookies = await context.cookies(api);

    expect(cookies.length).toBeGreaterThan(0);

    const revoked = await request.post(`${api}/auth/logout`, {
      headers: { ...csrf, Cookie: cookies.map(({ name, value }) => `${name}=${value}`).join('; ') },
    });

    expect(revoked.status()).toBe(204);
    expect(await context.cookies(api)).toEqual(cookies);
  });

  const saves: unknown[] = [];

  page.on('request', (outgoing) => {
    if (outgoing.url() === `${api}/listings/${listing.id}` && outgoing.method() === 'PATCH')
      saves.push(outgoing.postDataJSON());
  });

  await test.step('Reject the expired-session save and request sign-in', async () => {
    const rejected = page.waitForResponse(
      (response) =>
        response.url() === `${api}/listings/${listing.id}` &&
        response.request().method() === 'PATCH',
    );

    await page.getByRole('button', { name: 'Save changes', exact: true }).click();

    expect((await rejected).status()).toBe(401);
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByText(/Your session expired/)).toBeVisible();
  });

  await test.step('Restore the draft after sign-in without replaying the save', async () => {
    await signIn(page, credentials);

    await expect(page).toHaveURL(new URL(destination, 'http://localhost:4173').href);
    await expect(page.getByLabel('Title', { exact: true })).toHaveValue(
      'My unsaved backpack title',
    );
    await expect(page.getByLabel('Description', { exact: true })).toHaveValue(
      'Private unsaved identifying description.',
    );
    await expect(page.getByLabel('Location', { exact: true })).toHaveValue('Library reception');
    expect(saves).toHaveLength(1);

    const before = await context.request.get(`${api}/listings/${listing.id}`);

    expect(before.status()).toBe(200);
    expect((await before.json()).listing).toMatchObject({
      title: listing.title,
      version: listing.version,
    });
  });

  await test.step('Persist the restored draft only after an explicit save', async () => {
    await page.getByRole('button', { name: 'Save changes', exact: true }).click();

    await expect(
      page.getByRole('heading', { name: 'My unsaved backpack title', exact: true }),
    ).toBeVisible();
    expect(saves).toHaveLength(2);
    expect(saves[1]).toEqual(saves[0]);

    const saved = await context.request.get(`${api}/listings/${listing.id}`);

    expect((await saved.json()).listing).toMatchObject({
      title: 'My unsaved backpack title',
      version: listing.version + 1,
    });

    await page.reload();

    await expect(
      page.getByRole('heading', { name: 'My unsaved backpack title', exact: true }),
    ).toBeVisible();
  });

  expect(errors).toEqual([]);
});

test('switching accounts isolates private history, drafts and a delayed committed send', async ({
  page,
  context,
  request,
}) => {
  const errors = watchErrors(page);
  const first = account('First member');
  const second = account('Second member');

  await register(request, second);
  await register(request, account('Finder'));

  const listing = await createReport(request);

  await register(context.request, first);

  const claimed = await context.request.post(`${api}/listings/${listing.id}/claims`, {
    headers: csrf,
    data: { verificationDetails: 'My private initials are engraved inside.' },
  });

  expect(claimed.status()).toBe(201);

  const { claim } = await claimed.json();
  const messagesUrl = `${api}/conversations/${claim.conversationId}/messages`;
  const original = await context.request.post(messagesUrl, {
    headers: { ...csrf, 'Idempotency-Key': crypto.randomUUID() },
    data: { body: 'First member private message' },
  });

  expect(original.status()).toBe(201);

  await test.step('Leave a private draft and open the first account conversation', async () => {
    await page.goto('/listings/new?kind=lost');
    await page.getByLabel('Title', { exact: true }).fill('First member private draft');
    await page.getByRole('link', { name: 'Back to home' }).click();
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: /^Messages/ })
      .click();
    await page.locator(`[data-conversation-id="${claim.conversationId}"]`).click();

    await expect(
      page
        .getByRole('list', { name: 'Messages' })
        .getByText('First member private message', { exact: true }),
    ).toBeVisible();
  });

  const committed = barrier();
  const release = barrier();
  const delivered = barrier();
  let sends = 0;

  await page.route(messagesUrl, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    sends += 1;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed.release();
    await release.promise;
    try {
      await route.fulfill({ response });
    } finally {
      delivered.release();
    }
  });

  try {
    await test.step('Commit a send while withholding its response from the browser', async () => {
      await page
        .getByRole('textbox', { name: 'Write a message' })
        .fill('First member delayed private message');
      await page.getByRole('button', { name: 'Send', exact: true }).click();
      await committed.promise;

      await expect(page.locator('[data-operation-id]')).toContainText('Sending…');
    });

    await test.step('Switch accounts before the old send completes', async () => {
      await page.getByRole('button', { name: 'Account: First member' }).click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();

      await expect(page).toHaveURL(/\/login$/);

      await signIn(page, second);

      await expect(
        page.getByRole('heading', { name: 'This conversation is no longer available.' }),
      ).toBeVisible();
    });

    await test.step('Ignore the old response without exposing private messages', async () => {
      release.release();
      await delivered.promise;

      await expect(page.getByRole('button', { name: 'Account: Second member' })).toBeVisible();
      await expect(page.locator('[data-message-id], [data-operation-id]')).toHaveCount(0);
      await expect(page.getByText('First member private message', { exact: true })).toHaveCount(0);
      await expect(
        page.getByText('First member delayed private message', { exact: true }),
      ).toHaveCount(0);
      expect(sends).toBe(1);

      const persisted = await request.get(messagesUrl);

      expect(persisted.status()).toBe(200);
      expect(
        (await persisted.json()).messages.map((message: { body: string }) => message.body),
      ).toEqual(['First member private message', 'First member delayed private message']);
    });

    await test.step('Keep private history and drafts isolated during back navigation', async () => {
      await page.goBack();

      await expect(page).toHaveURL(/\/messages$/);
      await expect(page.locator('[data-conversation-id]')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Account: Second member' })).toBeVisible();

      await page.goBack();

      await expect(page).toHaveURL('http://localhost:4173/');

      await page.goBack();

      await expect(page).toHaveURL(/\/listings\/new\?kind=lost$/);
      await expect(page.getByLabel('Title', { exact: true })).toHaveValue('');
      expect(errors).toEqual([]);
    });
  } finally {
    release.release();
  }
});
