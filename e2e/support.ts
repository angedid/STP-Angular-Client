import { APIRequestContext, Page, expect } from '@playwright/test';

/** Origin of the local OAuth test provider started by `playwright.config.ts`. */
export const PROVIDER_ORIGIN = 'http://localhost:9001';

/** Key `AuthSessionStore` writes to; kept identical between the demo and
 * the development settings (see `auth.config.local-demo.ts`). */
export const SESSION_STORAGE_KEY = 'stp.oauth.session';

export interface DemoUser {
  readonly username: string;
  readonly name: string | null;
  readonly label: string;
  readonly hasTenant: boolean;
  readonly tenantName: string | null;
}

/** Clears every authorization code, token and armed scenario of the provider. */
export async function resetProvider(request: APIRequestContext): Promise<void> {
  const response = await request.post(`${PROVIDER_ORIGIN}/__demo/reset`);
  expect(response.ok(), 'resetting the provider between tests').toBeTruthy();
}

/** Fictional accounts, discovered from the provider instead of duplicated here. */
export async function demoUsers(request: APIRequestContext): Promise<DemoUser[]> {
  const response = await request.get(`${PROVIDER_ORIGIN}/__demo/users`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/** Counters and armed scenarios, used to prove a code/token was not replayed. */
export async function providerState(request: APIRequestContext): Promise<{
  counters: { tokenRequests: number; refreshes: number; logouts: number };
}> {
  const response = await request.get(`${PROVIDER_ORIGIN}/__demo/state`);
  expect(response.ok()).toBeTruthy();
  return response.json();
}

/** Fails the next `times` token request(s) with the given OAuth error. */
export async function armTokenError(
  request: APIRequestContext,
  error: string,
  times = 1,
): Promise<void> {
  const response = await request.post(`${PROVIDER_ORIGIN}/__demo/token-error`, {
    data: { error, times },
  });
  expect(response.ok()).toBeTruthy();
}

/** Makes the revocation endpoint answer 500 (or stop doing so) until changed. */
export async function armLogoutFailure(request: APIRequestContext, enabled: boolean): Promise<void> {
  const response = await request.post(`${PROVIDER_ORIGIN}/__demo/logout-failure`, {
    data: { enabled },
  });
  expect(response.ok()).toBeTruthy();
}

/**
 * Drives the provider's sign-in page (`GET /oauth/authorize`): selects
 * `username` when approving, optionally a token-error scenario, then submits
 * Approve or Deny. Assumes the browser already landed on that page.
 */
export async function decideAuthorization(
  page: Page,
  options: { username?: string; decision: 'approve' | 'deny'; tokenError?: string },
): Promise<void> {
  await expect(page).toHaveURL(new RegExp(`^${PROVIDER_ORIGIN}/oauth/authorize`));
  await expect(page.getByRole('heading', { name: /Sign in to/ })).toBeVisible();
  if (options.username) {
    await page.locator(`input[name="username"][value="${options.username}"]`).check();
  }
  if (options.tokenError) {
    await page.locator('select[name="token_error"]').selectOption(options.tokenError);
  }
  await page.locator(`button[name="decision"][value="${options.decision}"]`).click();
}

/**
 * Full, successful sign-in starting from `/login`: picks `username` on the
 * provider's page and waits until the callback has handed the browser back to
 * the application (wherever it lands — `/home` or a remembered `returnUrl`).
 */
export async function signIn(page: Page, username: string): Promise<void> {
  await page.goto('/login');
  await decideAuthorization(page, { username, decision: 'approve' });
  await page.waitForURL((url) => url.origin === new URL('http://localhost:4200').origin && url.pathname !== '/oauth/callback');
}

/** `true` while the account menu trigger (photo + name) is visible. */
export function accountMenuTrigger(page: Page) {
  return page.getByRole('button', { name: /Account menu for/ });
}

/** Opens the sidebar's account menu. */
export async function openAccountMenu(page: Page): Promise<void> {
  await accountMenuTrigger(page).click();
}

export interface NavigationHistory {
  readonly urls: readonly string[];
}

/**
 * Records every main-frame navigation from now on.
 *
 * The guard's redirect to `/login` and `LoginComponent`'s own redirect to the
 * provider happen one after the other within a single `page.goto()` or click,
 * often well under the interval a polling `expect(page).toHaveURL()` samples
 * at. Call this *before* triggering the navigation, then use
 * {@link expectVisited} to assert an intermediate, same-origin step (such as
 * `/login?returnUrl=...`) was really reached, independently of timing.
 */
export function watchNavigations(page: Page): NavigationHistory {
  const urls: string[] = [page.url()];
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) {
      urls.push(frame.url());
    }
  });
  return { urls };
}

/** Asserts that `path` (pathname + search, e.g. `/login?returnUrl=%2Fhome`) was visited. */
export function expectVisited(history: NavigationHistory, path: string): void {
  const visited = history.urls.some((url) => {
    const parsed = new URL(url, 'http://localhost:4200');
    return parsed.pathname + parsed.search === path;
  });
  expect(visited, `expected ${path} to have been visited; saw:\n${history.urls.join('\n')}`).toBe(
    true,
  );
}
