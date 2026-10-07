import { expect, test } from '@playwright/test';
import {
  attachmentServer,
  attachmentSet,
  browserTime,
  historyMessage,
} from './support/conversation-attachment-server.ts';
import { barrier, chooseImages, expectDecoded, pngImage } from './support/conversation-images.ts';

test('committed image 404 survives unavailable and SPA return, then 429 and same-operation replay', async ({
  page,
}) => {
  const state = await attachmentServer(page);
  let documents = 0;
  page.on('request', (request) => {
    if (request.resourceType() === 'document') documents++;
  });
  state.send = (attempt) => {
    if (attempt === 1) {
      state.messages.push({
        ...historyMessage(1, attachmentSet('A-1', 1)),
        senderUserId: 'me',
        body: state.sends[0]!.body as string,
      });
      state.hidden = true;
      return {
        status: 404,
        json: { error: { code: 'CONVERSATION_NOT_FOUND', message: 'Unavailable after commit' } },
      };
    }
    if (attempt === 2)
      return {
        status: 429,
        headers: { 'Retry-After': '10' },
        json: { error: { code: 'RATE_LIMITED', message: 'Admission busy' } },
      };
    return { json: { message: state.messages[0] } };
  };
  await page.goto('/messages/A');
  const input = page.getByRole('textbox', { name: 'Write a message' });
  await input.fill('  Keep this photo with my claim.  ');
  await chooseImages(page, 1);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'This conversation is no longer available.' }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  expect(state.sends).toHaveLength(1);
  const operationId = state.sends[0]!.key;
  state.hidden = false;
  await page.getByRole('button', { name: 'Back to messages', exact: true }).click();
  await page.getByRole('button', { name: 'Refresh conversations' }).click();
  await page.locator('a[href="/messages/A"]').click();
  const pending = page.locator(`[data-operation-id="${operationId}"]`);
  await expect(pending).toContainText('Delivery status unknown');
  await expect(input).not.toBeEditable();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('button', { name: 'Add photos', exact: true })).toBeDisabled();
  await pending.getByRole('button', { name: 'Retry to confirm' }).click();
  await expect(pending).toContainText('Temporarily rate-limited.');
  const retry = pending.getByRole('button', { name: 'Retry', exact: true });
  await expect(retry).toBeDisabled();
  await expect(pending).toContainText(/Try again in \d+s/);
  await expect(input).not.toBeEditable();
  expect(state.sends).toHaveLength(2);
  await page.clock.runFor(10_100);
  await expect(retry).toBeEnabled();
  await retry.click();
  await expect(page.locator('[data-operation-id]')).toHaveCount(0);
  await expect(page.locator('[data-message-id]')).toHaveCount(1);
  await expectDecoded(page.locator('[data-message-id="A-1"] img'), 1);
  await expect(input).toBeEditable();
  expect(state.sends).toHaveLength(3);
  expect(state.sends[1]).toEqual(state.sends[0]);
  expect(state.sends[2]).toEqual(state.sends[0]);
  expect(state.sends[0]!.body).toBe('Keep this photo with my claim.');
  expect(state.messages).toHaveLength(1);
  expect(documents).toBe(1);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('definitive read-only image send restores caption and unsent photo count', async ({
  page,
}) => {
  const state = await attachmentServer(page);
  state.send = () => {
    state.writable = false;
    return {
      status: 409,
      json: { error: { code: 'CONVERSATION_READ_ONLY', message: 'Read only' } },
    };
  };
  await page.goto('/messages/A');
  await page
    .getByRole('textbox', { name: 'Write a message' })
    .fill('  These are my identifying photos.  ');
  await chooseImages(page, 2);
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  const readonly = page.getByRole('region', { name: 'Read-only conversation' });
  await expect(readonly).toContainText('Your unsent draft has been kept');
  await expect(readonly).toContainText('2 unsent photos attached.');
  await expect(readonly.getByRole('textbox', { name: 'Unsent draft' })).toHaveValue(
    'These are my identifying photos.',
  );
  await expect(readonly.getByRole('textbox', { name: 'Unsent draft' })).not.toBeEditable();
  await expect(page.getByRole('textbox', { name: 'Write a message' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add photos' })).toHaveCount(0);
  await expect(page.locator('[data-operation-id], img[src^="blob:"]')).toHaveCount(0);
  expect(state.messages).toHaveLength(0);
  expect(state.sends).toHaveLength(1);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

for (const brokenReplacement of [false, true]) {
  test(
    brokenReplacement
      ? 'broken replacement images cannot auto-loop; manual Retry recovers'
      : 'simultaneous image errors coalesce to one message refresh and decode replacements',
    async ({ page }) => {
      const old = attachmentSet('A-1');
      const replacement = attachmentSet('A-1', 2, 'replacement', browserTime + 1_800_000);
      const working = attachmentSet('A-1', 2, 'manual', browserTime + 2_700_000);
      const state = await attachmentServer(page, [historyMessage(1, old)]);
      const imageErrors = barrier();
      const refresh = barrier();
      for (const attachment of old)
        state.images.set(attachment.url, { status: 503, gate: imageErrors.promise });
      if (brokenReplacement)
        for (const attachment of replacement) state.images.set(attachment.url, { status: 503 });
      state.refresh = async (_id, attempt) => {
        await refresh.promise;
        return { json: { attachments: attempt === 1 ? replacement : working } };
      };
      try {
        await page.goto('/messages/A');
        const row = page.locator('[data-message-id="A-1"]');
        await expect.poll(() => state.imageRequests.length).toBe(2);
        imageErrors.release();
        await expect(row.getByRole('img', { name: /unavailable$/ })).toHaveCount(2);
        await expect.poll(() => state.refreshes.length).toBe(1);
        expect(state.refreshes[0]).toEqual({
          conversationId: 'A',
          messageId: 'A-1',
          method: 'POST',
          body: null,
        });
        refresh.release();
        if (brokenReplacement) {
          await expect
            .poll(() => state.imageResponses.filter((url) => url.includes('/replacement/')).length)
            .toBe(2);
          await expect(row.getByRole('img', { name: /unavailable$/ })).toHaveCount(2);
          const retry = row.getByRole('button', { name: 'Retry images' });
          await expect(retry).toBeVisible();
          // Real resize/rerender and a completed polling cycle must not replenish the budget.
          await page.getByRole('textbox', { name: 'Write a message' }).fill('An unrelated draft');
          await page.setViewportSize({ width: 390, height: 844 });
          await page.clock.runFor(4_100);
          await expect.poll(() => state.after.length).toBeGreaterThan(0);
          expect(state.refreshes).toHaveLength(1);
          const box = await retry.boundingBox();
          expect(box!.width).toBeGreaterThanOrEqual(44);
          expect(box!.height).toBeGreaterThanOrEqual(44);
          await retry.click();
          await expect.poll(() => state.refreshes.length).toBe(2);
        }
        await expectDecoded(row.locator('img'), 2);
        await expect(row.getByRole('button', { name: 'Retry images' })).toHaveCount(0);
        await expect(row.locator('img').nth(0)).toHaveAttribute(
          'src',
          (brokenReplacement ? working : replacement)[0]!.url,
        );
        await expect(row.locator('img').nth(1)).toHaveAttribute(
          'src',
          (brokenReplacement ? working : replacement)[1]!.url,
        );
        expect(state.refreshes).toHaveLength(brokenReplacement ? 2 : 1);
        expect(state.errors).toEqual([]);
        expect(state.unexpected).toEqual([]);
      } finally {
        imageErrors.release();
        refresh.release();
      }
    },
  );
}

test('real observer leaves offscreen near-expiry capabilities alone until the group enters its zone', async ({
  page,
}) => {
  const old = attachmentSet('A-1', 1, 'near', browserTime + 45_000);
  const messages = Array.from({ length: 50 }, (_, index) => historyMessage(index + 1));
  messages[0] = historyMessage(1, old);
  const state = await attachmentServer(page, messages);
  const fresh = attachmentSet('A-1', 1, 'fresh', browserTime + 900_000);
  state.refresh = () => ({ json: { attachments: fresh } });
  await page.goto('/messages/A');
  const group = page.locator('[data-message-id="A-1"] [role="group"]');
  const distance = () =>
    group.evaluate((element) => {
      const root = element.closest('[aria-label="Message history"]')!.getBoundingClientRect();
      const target = element.getBoundingClientRect();
      return { above: root.top - target.bottom, below: target.top - root.bottom };
    });
  // The production observer's 200px rootMargin is part of this geometry assertion,
  // not a mocked IntersectionObserver or merely DOM visibility.
  await expect.poll(async () => (await distance()).above).toBeGreaterThan(200);
  await page.clock.runFor(4_100);
  await expect.poll(() => state.after.length).toBeGreaterThan(0);
  expect(state.refreshes).toHaveLength(0);
  await group.scrollIntoViewIfNeeded();
  await expect
    .poll(async () => {
      const { above, below } = await distance();
      return above < 0 && below < 0;
    })
    .toBe(true);
  await expect.poll(() => state.refreshes.length).toBe(1);
  await expectDecoded(group.locator('img'), 1);
  await expect(group.locator('img')).toHaveAttribute('src', fresh[0]!.url);
  expect(state.refreshes).toHaveLength(1);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('an attachment from an older history page decodes after real pagination', async ({ page }) => {
  const messages = Array.from({ length: 61 }, (_, index) => historyMessage(index + 1));
  messages[0] = historyMessage(1, attachmentSet('A-1', 1));
  const state = await attachmentServer(page, messages);
  await page.goto('/messages/A');
  await expect(page.locator('[data-message-id]')).toHaveCount(50);
  await expect(page.locator('[data-message-id="A-1"]')).toHaveCount(0);
  const older = page.waitForResponse((response) => {
    const url = new URL(response.url());
    return url.pathname === '/conversations/A/messages' && url.searchParams.get('before') === '12';
  });
  await page.getByRole('button', { name: 'Load earlier messages', exact: true }).click();
  expect((await (await older).json()).messages[0].id).toBe('A-1');
  await expect(page.locator('[data-message-id]')).toHaveCount(61);
  await expectDecoded(page.locator('[data-message-id="A-1"] img'), 1);
  expect(state.refreshes).toHaveLength(0);
  expect(state.errors).toEqual([]);
  expect(state.unexpected).toEqual([]);
});

test('a URL expiring between render and click never opens; only the next fresh click opens a tab', async ({
  page,
  context,
}) => {
  const old = attachmentSet('A-1', 1);
  const fresh = attachmentSet('A-1', 1, 'fresh', browserTime + 2_700_000);
  const state = await attachmentServer(page, [{ ...historyMessage(1, old), senderUserId: 'me' }]);
  const recovery = barrier();
  state.refresh = async () => {
    await recovery.promise;
    return { json: { attachments: fresh } };
  };
  const popups: string[] = [];
  page.on('popup', (popup) => popups.push(popup.url()));
  try {
    await page.goto('/messages/A');
    const row = page.locator('[data-message-id="A-1"]');
    await expectDecoded(row.locator('img'), 1);
    const link = row.getByRole('link', { name: 'Attached image 1 of 1' });
    await expect(link).toHaveAttribute('href', old[0]!.url);
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer');
    await expect(link).toHaveAttribute('referrerpolicy', 'no-referrer');
    // Pause after mount without advancing a polling interval. Own messages avoid
    // unrelated read-pointer responses rerendering away this deliberately stale link.
    await page.clock.pauseAt((await page.evaluate(() => Date.now())) + 250);
    // Date.now changes, but the scheduled expiry callback deliberately does not run.
    await page.clock.setSystemTime(browserTime + 900_001);
    await expect(link).toHaveAttribute('href', old[0]!.url);
    expect(state.refreshes).toHaveLength(0);
    await link.click();
    await expect.poll(() => state.refreshes.length).toBe(1);
    await expect(row.locator(`a[href="${old[0]!.url}"]`)).toHaveCount(0);
    expect(popups).toEqual([]);
    expect(context.pages()).toHaveLength(1);
    recovery.release();
    await expectDecoded(row.locator('img'), 1);
    await expect(link).toHaveAttribute('href', fresh[0]!.url);
    expect(popups).toEqual([]);
    expect(context.pages()).toHaveLength(1);
    const opened = page.waitForEvent('popup');
    await link.click();
    const popup = await opened;
    await popup.waitForLoadState('load');
    await expect(popup).toHaveURL(fresh[0]!.url);
    await expectDecoded(popup.locator('img'), 1);
    expect(popups).toHaveLength(1);
    expect(state.refreshes).toHaveLength(1);
    expect(state.errors).toEqual([]);
    expect(state.unexpected).toEqual([]);
    await popup.close();
  } finally {
    recovery.release();
  }
});

test('attachment tombstone survives a valid held after=50 page and the next catch-up requests after=51', async ({
  page,
}) => {
  const state = await attachmentServer(
    page,
    Array.from({ length: 50 }, (_, index) => historyMessage(index + 1)),
  );
  const catchUp = barrier();
  const captured = barrier();
  const imageError = barrier();
  const old = attachmentSet('A-51', 1);
  const fresh = attachmentSet('A-51', 1, 'recovered', browserTime + 1_800_000);
  state.images.set(old[0]!.url, { status: 503, gate: imageError.promise });
  let heldMessages: ReturnType<typeof historyMessage>[] = [];
  state.history = async (after, response) => {
    if (after === 50 && response.messages.some((message) => message.sequence === 51)) {
      heldMessages = response.messages;
      captured.release();
      await catchUp.promise;
    }
  };
  state.refresh = (_id, attempt) => ({ json: { attachments: attempt === 1 ? [] : fresh } });
  try {
    await page.goto('/messages/A');
    await expect(page.locator('[data-message-id]')).toHaveCount(50);
    await chooseImages(page, 1);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const row = page.locator('[data-message-id="A-51"]');
    await expect(row).toHaveCount(1);
    await expect(page.locator('[data-operation-id]')).toHaveCount(0);
    await page.clock.runFor(4_100);
    await captured.promise;
    expect(heldMessages.map((message) => message.sequence)).toEqual([51]);
    expect(heldMessages[0]!.attachments).toEqual(old);
    imageError.release();
    await expect(
      row.getByRole('group', { name: 'Attachments unavailable', exact: true }),
    ).toBeVisible();
    expect(state.refreshes).toHaveLength(1);
    const accepted = page.waitForResponse((response) => {
      const url = new URL(response.url());
      return url.pathname === '/conversations/A/messages' && url.searchParams.get('after') === '50';
    });
    catchUp.release();
    expect((await (await accepted).json()).messages[0].sequence).toBe(51);
    // Positive protocol proof: the page was merged, not discarded on validation/error.
    await page.clock.runFor(4_100);
    await expect.poll(() => state.after.includes(51)).toBe(true);
    await expect(
      row.getByRole('group', { name: 'Attachments unavailable', exact: true }),
    ).toBeVisible();
    await expect(row.locator('img, a[href]')).toHaveCount(0);
    await expect(page.getByText(/Could not check for new messages/)).toHaveCount(0);
    await expect(page.locator('[data-message-id]')).toHaveCount(51);
    expect(state.imageRequests.filter((url) => url === old[0]!.url)).toHaveLength(1);
    await row.getByRole('button', { name: 'Retry images' }).click();
    await expectDecoded(row.locator('img'), 1);
    await expect(row.locator('img')).toHaveAttribute('src', fresh[0]!.url);
    expect(state.refreshes).toHaveLength(2);
    expect(state.errors).toEqual([]);
    expect(state.unexpected).toEqual([]);
  } finally {
    imageError.release();
    catchUp.release();
  }
});

for (const width of [1280, 390, 320]) {
  test(`remote image grids and extreme ratios remain bounded at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    // Cover 1..4 images, both single-image extremes and an extreme in a grid row.
    const messages = [1, 1, 2, 3, 4].map((count, index) =>
      historyMessage(index + 1, attachmentSet(`A-${index + 1}`, count)),
    );
    const state = await attachmentServer(page, messages);
    for (const [index, dimensions] of [
      [0, [1, 2048]],
      [1, [2048, 1]],
      [4, [1, 2048]],
    ] as const) {
      const attachment = messages[index]!.attachments[0]!;
      [attachment.width, attachment.height] = dimensions;
      state.images.set(attachment.url, { bytes: pngImage(attachment.width, attachment.height) });
    }
    messages[3]!.body = 'Caption and images stay together.';
    await page.goto('/messages/A');
    await chooseImages(page, 4);
    await expectDecoded(page.getByRole('list', { name: 'Selected images' }).locator('img'), 4);
    for (const message of messages) {
      const row = page.locator(`[data-message-id="${message.id}"]`);
      await expectDecoded(row.locator('img'), message.attachments.length);
      for (const [index, attachment] of message.attachments.entries()) {
        const image = row.locator('img').nth(index);
        await expect(image).toHaveAttribute(
          'alt',
          `Attached image ${index + 1} of ${message.attachments.length}`,
        );
        await expect(image).toHaveAttribute('width', String(attachment.width));
        await expect(image).toHaveAttribute('height', String(attachment.height));
        await expect(image).toHaveAttribute('loading', 'lazy');
        await expect(image).toHaveAttribute('decoding', 'async');
        await expect(image).toHaveAttribute('referrerpolicy', 'no-referrer');
        await expect(image).toHaveCSS('object-fit', 'contain');
        const dimensions = await image.evaluate((element) => {
          const cell = element.parentElement!.parentElement!.getBoundingClientRect();
          const root = element.closest('[aria-label="Message history"]')!.getBoundingClientRect();
          return {
            width: cell.width,
            height: cell.height,
            left: cell.left,
            right: cell.right,
            paneLeft: root.left,
            paneRight: root.right,
          };
        });
        expect(dimensions.height).toBeGreaterThanOrEqual(dimensions.width / 2 - 1);
        expect(dimensions.height).toBeLessThanOrEqual(dimensions.width * 2 + 1);
        expect(dimensions.height).toBeLessThanOrEqual(721);
        expect(dimensions.left).toBeGreaterThanOrEqual(dimensions.paneLeft);
        expect(dimensions.right).toBeLessThanOrEqual(dimensions.paneRight);
      }
    }
    await expect(page.locator('[data-message-id="A-4"]')).toContainText(
      'Caption and images stay together.',
    );
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(state.refreshes).toHaveLength(0);
    expect(state.errors).toEqual([]);
    expect(state.unexpected).toEqual([]);
  });
}

for (const width of [390, 320]) {
  test(`selected image remove controls have 44px touch targets at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 });
    const state = await attachmentServer(page);
    await page.goto('/messages/A');
    await chooseImages(page, 4);
    await expectDecoded(page.getByRole('list', { name: 'Selected images' }).locator('img'), 4);
    await expect(page.getByRole('status', { name: '4 of 4 images selected' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add photos', exact: true })).toBeDisabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect(state.errors).toEqual([]);
    expect(state.unexpected).toEqual([]);

    for (const name of ['Add photos', 'Send']) {
      const control = page.getByRole('button', { name, exact: true });
      const box = await control.boundingBox();
      expect(box!.width, `${name} touch target width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `${name} touch target height`).toBeGreaterThanOrEqual(44);
    }
    for (let index = 1; index <= 4; index++) {
      const remove = page.getByRole('button', { name: `Remove image ${index}`, exact: true });
      await expect(remove).toBeEnabled();
      await expect(remove).toBeInViewport({ ratio: 1 });
      const box = await remove.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width, `Remove image ${index} touch target width`).toBeGreaterThanOrEqual(44);
      expect(box!.height, `Remove image ${index} touch target height`).toBeGreaterThanOrEqual(44);
      const geometry = await remove.evaluate((button) => {
        const rect = button.getBoundingClientRect();
        const preview = button.closest('li')!.getBoundingClientRect();
        const neighbors = [...button.closest('form')!.querySelectorAll('button, textarea')];
        // Probe the center and every edge, including the newly expanded hit area.
        const points = [
          [rect.width / 2, rect.height / 2],
          [2, rect.height / 2],
          [rect.width - 2, rect.height / 2],
          [rect.width / 2, 2],
          [rect.width / 2, rect.height - 2],
        ];
        return {
          insidePreview:
            rect.left >= preview.left &&
            rect.right <= preview.right &&
            rect.top >= preview.top &&
            rect.bottom <= preview.bottom,
          allPointsHitButton: points.every(([x, y]) =>
            button.contains(document.elementFromPoint(rect.left + x!, rect.top + y!)),
          ),
          overlapsNeighbor: neighbors.some((neighbor) => {
            if (neighbor === button) return false;
            const other = neighbor.getBoundingClientRect();
            return (
              rect.left < other.right &&
              rect.right > other.left &&
              rect.top < other.bottom &&
              rect.bottom > other.top
            );
          }),
        };
      });
      expect(geometry, `Remove image ${index} is unobstructed`).toEqual({
        insidePreview: true,
        allPointsHitButton: true,
        overlapsNeighbor: false,
      });
    }
    await page.getByRole('button', { name: 'Remove image 1', exact: true }).click();
    await expect(page.getByRole('status', { name: '3 of 4 images selected' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Add photos', exact: true })).toBeEnabled();
    // Exercise every remaining control through its expanded edge, without forced clicks.
    for (let remaining = 3; remaining > 0; remaining--) {
      await page
        .getByRole('button', { name: `Remove image ${remaining}`, exact: true })
        .click({ position: { x: 2, y: 22 } });
      await expect(
        page.getByRole('status', { name: `${remaining - 1} of 4 images selected` }),
      ).toBeVisible();
    }
    await expect(page.getByRole('list', { name: 'Selected images' }).locator('img')).toHaveCount(0);
    expect(state.errors).toEqual([]);
  });
}
