import { expect, Page, test } from '@playwright/test';
import {
  accountMenuTrigger,
  decideAuthorization,
  demoUsers,
  expectVisited,
  resetProvider,
  signIn,
  watchNavigations,
} from './support';

/**
 * Successful sign-in and navigation through the signed-in area.
 *
 * Covers: the guest landing page, the redirect to the provider, picking an
 * account, landing on the dashboard, the sidebar reflecting the session, and
 * moving between guarded routes without losing it.
 */
test.describe('successful sign-in and navigation', () => {
  test.beforeEach(async ({ request }) => {
    await resetProvider(request);
  });

  test('signs in from the landing page and reaches the dashboard', async ({ page, request }) => {
    const [user] = (await demoUsers(request)).filter((candidate) => candidate.hasTenant);

    await page.goto('/');
    await expect(page.getByRole('heading', { name: /welcome on asso platform/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Connexion' })).toBeVisible();

    // LoginComponent redirects to the provider as soon as it mounts, so the
    // in-app /login step is observed from the navigation history rather than
    // from a URL assertion that could race it.
    const history = watchNavigations(page);
    await page.getByRole('link', { name: 'Connexion' }).click();
    await decideAuthorization(page, { username: user.username, decision: 'approve' });
    await page.waitForURL((url) => url.origin === 'http://localhost:4200' && url.pathname !== '/oauth/callback');
    expectVisited(history, '/login');

    await expect(page).toHaveURL(/\/home$/);
    await expect(accountMenuTrigger(page)).toBeVisible();
    await expect(page.locator('.user-name')).toHaveText(user.name ?? user.username.split('@')[0]);
    await expect(page.locator('h1.page-title')).toHaveText('Tableau de bord');
    // The establishment name comes from the provider's tenant endpoint once it answers.
    await expect(page.locator('p.page-subtitle')).toHaveText(user.tenantName!);
  });

  test('moves from the dashboard to the tenant page and back without losing the session', async ({
    page,
    request,
  }) => {
    const [user] = (await demoUsers(request)).filter((candidate) => candidate.hasTenant);
    await signIn(page, user.username);
    await expect(page).toHaveURL(/\/home$/);

    await openAccountMenuAndGoToTenants(page);
    await expect(page).toHaveURL(/\/tenants$/);
    await expect(page.locator('h1.page-title')).toHaveText(user.tenantName!);
    const fields = page.locator('dl.tenant-fields');
    await expect(fields.locator('dt', { hasText: 'Name' })).toBeVisible();
    await expect(fields.locator('dd').filter({ hasText: user.tenantName! })).toBeVisible();

    await page.getByRole('link', { name: 'Tableau de bord' }).click();
    await expect(page).toHaveURL(/\/home$/);
    await expect(accountMenuTrigger(page)).toBeVisible();
  });
});

async function openAccountMenuAndGoToTenants(page: Page): Promise<void> {
  await accountMenuTrigger(page).click();
  await page.getByRole('menuitem', { name: 'Tenants' }).click();
}
