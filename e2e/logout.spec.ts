import { expect, test } from '@playwright/test';
import {
  accountMenuTrigger,
  armLogoutFailure,
  demoUsers,
  expectVisited,
  openAccountMenu,
  resetProvider,
  SESSION_STORAGE_KEY,
  signIn,
  watchNavigations,
} from './support';

/**
 * Logout: only a confirmed revocation signs the user out and restores the
 * guest layout; a refused revocation must leave the session and the route
 * exactly as they were.
 */
test.describe('logout', () => {
  test.beforeEach(async ({ request }) => {
    await resetProvider(request);
  });

  test('a confirmed logout clears the session and returns to the guest layout', async ({
    page,
    request,
  }) => {
    const [user] = await demoUsers(request);
    await signIn(page, user.username);
    await expect(page).toHaveURL(/\/home$/);

    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Logout' }).click();

    await expect(page).toHaveURL('http://localhost:4200/');
    await expect(page.getByRole('link', { name: 'Connexion' })).toBeVisible();
    await expect(page.getByRole('link', { name: "S'enregistrer" })).toBeVisible();
    await expect(accountMenuTrigger(page)).toHaveCount(0);
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_STORAGE_KEY)).toBeNull();

    // The session is really gone server-side too: a guarded route asks again
    // (checked from the navigation history: /login redirects to the provider
    // as soon as it mounts, too fast for a URL assertion to reliably catch).
    const history = watchNavigations(page);
    await page.goto('/home');
    expectVisited(history, '/login?returnUrl=%2Fhome');
  });

  test('a refused revocation keeps the user signed in, with an explanation and no navigation', async ({
    page,
    request,
  }) => {
    const [user] = await demoUsers(request);
    await signIn(page, user.username);
    await armLogoutFailure(request, true);

    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Logout' }).click();

    await expect(page.getByRole('alert')).toHaveText(
      /did not revoke the session\. You are still signed in/,
    );
    // Still on the dashboard, still signed in: nothing navigated away.
    await expect(page).toHaveURL(/\/home$/);
    await expect(accountMenuTrigger(page)).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SESSION_STORAGE_KEY)).not.toBeNull();

    // Letting the revocation succeed now still signs the user out.
    await armLogoutFailure(request, false);
    await openAccountMenu(page);
    await page.getByRole('menuitem', { name: 'Logout' }).click();
    await expect(page).toHaveURL('http://localhost:4200/');
  });
});
