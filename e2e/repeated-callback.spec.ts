import { expect, test } from '@playwright/test';
import {
  accountMenuTrigger,
  decideAuthorization,
  demoUsers,
  providerState,
  resetProvider,
  signIn,
} from './support';

/**
 * Repeated handling of the OAuth callback: the redirect URI must never be
 * exchanged twice, whether the page is simply reloaded after a successful
 * sign-in or the same link is opened again.
 */
test.describe('repeated callback handling', () => {
  test.beforeEach(async ({ request }) => {
    await resetProvider(request);
  });

  test('reloading the callback page after success keeps the session and sends no new request', async ({
    page,
    request,
  }) => {
    const [user] = await demoUsers(request);
    await signIn(page, user.username);
    await expect(page).toHaveURL(/\/home$/);
    const before = await providerState(request);

    await page.reload();

    await expect(page).toHaveURL(/\/home$/);
    await expect(accountMenuTrigger(page)).toBeVisible();
    const after = await providerState(request);
    expect(after.counters.tokenRequests).toBe(before.counters.tokenRequests);
  });

  test('opening the exact callback link again in a new tab does not replay the code', async ({
    page,
    context,
    request,
  }) => {
    const [user] = await demoUsers(request);

    await page.goto('/login');
    await decideAuthorization(page, { username: user.username, decision: 'approve' });
    // Capture the redirect URI (code + state) before Angular consumes it and
    // moves the address bar to the dashboard.
    await page.waitForURL(/\/oauth\/callback\?/);
    const callbackUrl = page.url();
    await page.waitForURL((url) => url.pathname !== '/oauth/callback');
    await expect(page).toHaveURL(/\/home$/);
    const before = await providerState(request);

    // A brand-new tab has no pending transaction in its own sessionStorage
    // (it is scoped to the tab that started the sign-in), so this reproduces
    // a bookmarked or shared redirect link rather than a same-tab reload.
    const otherTab = await context.newPage();
    await otherTab.goto(callbackUrl);

    await expect(otherTab.getByRole('heading', { name: 'Sign-in could not be completed' })).toBeVisible();
    await expect(otherTab.getByRole('alert')).toHaveText(
      'No sign-in request is pending in this browser tab. Please start sign-in again.',
    );
    await expect(otherTab.getByRole('button', { name: 'Restart sign-in' })).toBeVisible();

    const after = await providerState(request);
    expect(after.counters.tokenRequests).toBe(before.counters.tokenRequests);

    // The first tab is unaffected: its own session is still the one in use.
    await expect(accountMenuTrigger(page)).toBeVisible();
    await otherTab.close();
  });
});
