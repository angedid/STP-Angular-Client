import { expect, test } from '@playwright/test';
import { decideAuthorization, demoUsers, expectVisited, resetProvider, watchNavigations } from './support';

/**
 * Unauthenticated access to a guarded route: the route guard sends the
 * visitor to `/login` with the requested page remembered as `returnUrl`, and
 * sign-in brings them back to it.
 */
test.describe('unauthenticated protected access', () => {
  test.beforeEach(async ({ request }) => {
    await resetProvider(request);
  });

  test('redirects to sign-in with returnUrl and lands back on the requested page', async ({
    page,
    request,
  }) => {
    const [user] = (await demoUsers(request)).filter((candidate) => candidate.hasTenant);

    // /login redirects to the provider as soon as it mounts, too fast for a
    // URL assertion to reliably observe the intermediate step; the navigation
    // history proves it was reached with the right returnUrl regardless.
    const history = watchNavigations(page);
    await page.goto('/tenants');
    expectVisited(history, '/login?returnUrl=%2Ftenants');

    await decideAuthorization(page, { username: user.username, decision: 'approve' });

    await expect(page).toHaveURL(/\/tenants$/);
    await expect(page.locator('h1.page-title')).toHaveText(user.tenantName!);
  });

  test('never redirects outside the application, even with a crafted returnUrl', async ({
    page,
    request,
  }) => {
    const [user] = await demoUsers(request);

    // A protocol-relative value is not a safe in-app path; the guard and
    // /login only ever accept `/...`, never `//...` (see isSafeReturnUrl).
    await page.goto('/login?returnUrl=%2F%2Fevil.test%2Fphish');
    await decideAuthorization(page, { username: user.username, decision: 'approve' });

    await expect(page).toHaveURL(/\/home$/);
  });
});
