import { expect, test } from '@playwright/test';
import { decideAuthorization, expectVisited, PROVIDER_ORIGIN, resetProvider, watchNavigations } from './support';

/**
 * Authorization denial: the resource owner presses "Deny" on the provider's
 * sign-in page (`error=access_denied`).
 */
test.describe('authorization denial', () => {
  test.beforeEach(async ({ request }) => {
    await resetProvider(request);
  });

  test('shows an explanation and keeps the visitor signed out, without navigating further', async ({
    page,
  }) => {
    await page.goto('/login');
    await decideAuthorization(page, { decision: 'deny' });

    await expect(page).toHaveURL(/\/oauth\/callback\?.*error=access_denied/);
    await expect(page.getByRole('heading', { name: 'Sign-in could not be completed' })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText(
      /did not authorize the request \(access_denied\)/,
    );
    const restart = page.getByRole('button', { name: 'Restart sign-in' });
    await expect(restart).toBeVisible();

    // The route must not have moved on its own: denial is not a sign-in.
    expect(new URL(page.url()).pathname).toBe('/oauth/callback');

    // Still a visitor: a guarded route sends back to /login, then straight on
    // to the provider (LoginComponent redirects as soon as it mounts) — the
    // in-app step is checked from the navigation history to avoid that race.
    const history = watchNavigations(page);
    await page.goto('/home');
    expectVisited(history, '/login?returnUrl=%2Fhome');

    // The explicit restart starts a brand-new transaction.
    await page.goto('/oauth/callback?error=access_denied&state=stale');
    await page.getByRole('button', { name: 'Restart sign-in' }).click();
    await expect(page).toHaveURL(new RegExp(`^${PROVIDER_ORIGIN}/oauth/authorize`));
  });
});
