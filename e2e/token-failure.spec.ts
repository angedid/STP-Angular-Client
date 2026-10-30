import { expect, test } from '@playwright/test';
import {
  accountMenuTrigger,
  decideAuthorization,
  demoUsers,
  expectVisited,
  resetProvider,
  watchNavigations,
} from './support';

/**
 * Token failure: the authorization step succeeds (a code is issued), but the
 * token endpoint the client calls next fails — rejected by the server, or
 * unreachable. Armed per-code from the provider's sign-in page (see
 * "Token exchange scenario" in README § "Local demo without the private
 * server").
 */
test.describe('token failure', () => {
  test.beforeEach(async ({ request }) => {
    await resetProvider(request);
  });

  test('a rejected token exchange is explained and leaves the visitor signed out', async ({
    page,
    request,
  }) => {
    const [user] = await demoUsers(request);

    await page.goto('/login');
    await decideAuthorization(page, { username: user.username, decision: 'approve', tokenError: 'server_error' });

    await expect(page).toHaveURL(/\/oauth\/callback\?/);
    await expect(page.getByRole('heading', { name: 'Sign-in could not be completed' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText(/rejected the request \(server_error\)/);

    // No session was created: the sidebar never appears, and the dashboard
    // sends a visitor back to sign-in (checked from the navigation history,
    // since /login redirects onward to the provider as soon as it mounts).
    await expect(accountMenuTrigger(page)).toHaveCount(0);
    const history = watchNavigations(page);
    await page.goto('/home');
    expectVisited(history, '/login?returnUrl=%2Fhome');
  });

  test('an unreachable token endpoint is reported as a network failure', async ({ page, request }) => {
    const [user] = await demoUsers(request);

    await page.goto('/login');
    await decideAuthorization(page, {
      username: user.username,
      decision: 'approve',
      tokenError: 'network_failure',
    });

    await expect(page.getByRole('heading', { name: 'Sign-in could not be completed' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText(/sign-in server could not be reached/i);
  });

  test('the authorization code is not reusable after a failed exchange', async ({ page, request }) => {
    const [user] = await demoUsers(request);
    await page.goto('/login');
    await decideAuthorization(page, {
      username: user.username,
      decision: 'approve',
      tokenError: 'invalid_grant',
    });
    const callbackUrl = page.url();
    await expect(page.getByRole('alert')).toBeVisible();

    // The pending transaction was consumed by the first (failed) attempt:
    // reloading the same callback URL finds nothing to resume, rather than
    // silently retrying the exchange.
    await page.goto(callbackUrl);
    await expect(page.getByRole('alert')).toHaveText(
      'No sign-in request is pending in this browser tab. Please start sign-in again.',
    );
  });
});
