import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';

import { authRoutes, guestRoutes, routes } from './app.routes';
import { AUTH_CONFIG, AuthConfig } from './auth.config';
import { authGuard } from './auth.guard';
import { authInterceptor } from './auth.interceptor';
import { AuthService, EXTERNAL_REDIRECT } from './auth.service';
import { AuthSession } from './auth-session';
import { AuthTransaction } from './auth-transaction';
import { AuthorizationCallbackComponent } from './authorization-callback/authorization-callback.component';
import { CLOCK } from './clock';
import { FourOFour } from './four-ofour/four-ofour';
import { HomeComponent } from './home/home.component';
import { LoginComponent } from './login/login.component';
import { PlaceholderComponent } from './placeholder/placeholder.component';
import { RegisterComponent } from './register/register.component';
import { TenantDetailComponent } from './tenant-detail/tenant-detail.component';
import { FakeClock } from './testing/fake-clock';
import { WelcomeComponent } from './welcome/welcome.component';

const CONFIG: AuthConfig = {
  authorizationEndpoint: 'http://auth.test/oauth/authorize',
  tokenEndpoint: 'http://auth.test/oauth/token',
  clientId: 'test-client',
  redirectUri: 'http://app.test/oauth/callback',
  scope: '',
  userInfoEndpoint: 'http://auth.test/api/user',
  logoutEndpoint: 'http://auth.test/api/logout',
  logoutMethod: 'POST',
  tenantsEndpoint: 'http://auth.test/api/tenants',
  transactionStorageKey: 'test.routing.transaction',
  transactionTtlMs: 10 * 60 * 1000,
  sessionStorageKey: 'test.routing.session',
};

const NOW = 1_700_000_000_000;
const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const VALID_STATE = 'c2VjcmV0LXN0YXRlLXZhbHVlLTEyMzQ1Ng';
const VALID_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';

const PROTECTED: ReadonlyArray<[string, unknown]> = [
  ['/home', HomeComponent],
  ['/profile', PlaceholderComponent],
  ['/tenants', TenantDetailComponent],
  ['/eligibility', PlaceholderComponent],
  ['/vendors', PlaceholderComponent],
  ['/alerts', PlaceholderComponent],
  ['/credits/new', PlaceholderComponent],
];

const PUBLIC: ReadonlyArray<[string, unknown]> = [
  ['/', WelcomeComponent],
  ['/login', LoginComponent],
  ['/register', RegisterComponent],
  ['/oauth/callback?code=abc&state=xyz', AuthorizationCallbackComponent],
];

const UNKNOWN = ['/does-not-exist', '/home/extra', '/tenants/123', '/admin'];

/**
 * Session management seen from the router: the real route table, guard,
 * interceptor and `AuthService`, a fake clock and a mocked token endpoint.
 */
describe('session-aware routing', () => {
  let router: Router;
  let httpTesting: HttpTestingController;
  let clock: FakeClock;
  let redirect: ReturnType<typeof vi.fn<(url: string) => void>>;

  const session = (overrides: Partial<AuthSession> = {}): AuthSession => ({
    accessToken: 'access-token-value',
    tokenType: 'Bearer',
    refreshToken: null,
    expiresAt: NOW + 3_600_000,
    user: { username: `jane@${TENANT_ID}`, displayName: 'Jane', photoUrl: null },
    ...overrides,
  });

  /** Writes a session as a previous page would have left it. */
  const storeSession = (overrides: Partial<AuthSession> = {}): AuthSession => {
    const stored = session(overrides);
    sessionStorage.setItem(CONFIG.sessionStorageKey, JSON.stringify(stored));
    return stored;
  };
  const storedSession = (): AuthSession | null => {
    const raw = sessionStorage.getItem(CONFIG.sessionStorageKey);
    return raw === null ? null : (JSON.parse(raw) as AuthSession);
  };
  const storedTransaction = (): AuthTransaction | null => {
    const raw = sessionStorage.getItem(CONFIG.transactionStorageKey);
    return raw === null ? null : (JSON.parse(raw) as AuthTransaction);
  };

  const leafComponent = (): unknown => {
    let snapshot: ActivatedRouteSnapshot = router.routerState.snapshot.root;
    while (snapshot.firstChild) {
      snapshot = snapshot.firstChild;
    }
    return snapshot.component;
  };
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    sessionStorage.clear();
    clock = new FakeClock(NOW);
    redirect = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        { provide: AUTH_CONFIG, useValue: CONFIG },
        { provide: CLOCK, useValue: clock },
        { provide: EXTERNAL_REDIRECT, useValue: (url: string) => redirect(url) },
      ],
    });
    router = TestBed.inject(Router);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
  });

  describe('route configuration', () => {
    it('keeps the wildcard route last and unique', () => {
      expect(routes.at(-1)?.path).toBe('**');
      expect(routes.filter((route) => route.path === '**')).toHaveLength(1);
      expect(routes.at(-1)?.component).toBe(FourOFour);
    });

    it('guards every signed-in route and none of the public ones', () => {
      expect(authRoutes.length).toBe(PROTECTED.length);
      for (const route of authRoutes) {
        expect(route.canActivate).toEqual([authGuard]);
      }
      for (const route of guestRoutes) {
        expect(route.canActivate).toBeUndefined();
      }
      expect(guestRoutes.map((route) => route.path)).toEqual([
        '',
        'login',
        'register',
        'oauth/callback',
      ]);
    });
  });

  describe('unauthenticated access', () => {
    it.each(PROTECTED)('sends a visitor opening %s to sign in, remembering it', async (path) => {
      await expect(router.navigateByUrl(path)).resolves.toBe(true);

      expect(leafComponent()).toBe(LoginComponent);
      expect(router.url).toBe(`/login?returnUrl=${encodeURIComponent(path)}`);
      httpTesting.expectNone(() => true);
    });

    it.each(PUBLIC)('keeps the public page %s reachable', async (url, component) => {
      await expect(router.navigateByUrl(url)).resolves.toBe(true);

      expect(leafComponent()).toBe(component);
      expect(router.url).toBe(url);
    });

    it.each(UNKNOWN)('shows the not-found page for %s, not the sign-in page', async (url) => {
      await expect(router.navigateByUrl(url)).resolves.toBe(true);

      expect(leafComponent()).toBe(FourOFour);
      expect(router.url).toBe(url);
    });
  });

  describe('authenticated access', () => {
    beforeEach(() => {
      storeSession();
    });

    it.each(PROTECTED)('opens %s directly with a valid session', async (path, component) => {
      await expect(router.navigateByUrl(path)).resolves.toBe(true);

      expect(leafComponent()).toBe(component);
      expect(router.url).toBe(path);
      httpTesting.expectNone(() => true);
      expect(TestBed.inject(AuthService).isAuthenticated()).toBe(true);
    });

    it.each(PUBLIC)('still reaches the public page %s', async (url, component) => {
      await expect(router.navigateByUrl(url)).resolves.toBe(true);

      expect(leafComponent()).toBe(component);
    });

    it.each(UNKNOWN)('shows the not-found page for %s', async (url) => {
      await expect(router.navigateByUrl(url)).resolves.toBe(true);

      expect(leafComponent()).toBe(FourOFour);
    });

    it('restores the stored session for the first guarded navigation, no request', async () => {
      await router.navigateByUrl('/tenants');

      const authService = TestBed.inject(AuthService);
      expect(authService.getSession()).toEqual(session());
      expect(leafComponent()).toBe(TenantDetailComponent);
    });
  });

  describe('expired sessions', () => {
    it('lets the session through until the very last millisecond', async () => {
      const stored = storeSession();
      clock.set(stored.expiresAt! - 1);

      await router.navigateByUrl('/home');

      expect(leafComponent()).toBe(HomeComponent);
      expect(storedSession()).toEqual(stored);
    });

    it('asks to sign in again from the expiry instant when there is no refresh token', async () => {
      const stored = storeSession();
      clock.set(stored.expiresAt!);

      await router.navigateByUrl('/home');

      expect(leafComponent()).toBe(LoginComponent);
      expect(router.url).toBe('/login?returnUrl=%2Fhome');
      expect(storedSession()).toBeNull();
      expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
      httpTesting.expectNone(() => true);
    });

    it('renews an expired session with its refresh token and opens the page', async () => {
      const stored = storeSession({ refreshToken: 'refresh-token-value' });
      clock.set(stored.expiresAt! + 60_000);

      const navigation = router.navigateByUrl('/tenants');
      await settle();
      const refresh = httpTesting.expectOne(CONFIG.tokenEndpoint);
      const body = new URLSearchParams(refresh.request.body as string);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe('refresh-token-value');
      expect(refresh.request.headers.has('Authorization')).toBe(false);
      refresh.flush({
        token_type: 'Bearer',
        access_token: 'renewed-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 1800,
      });
      await expect(navigation).resolves.toBe(true);

      expect(leafComponent()).toBe(TenantDetailComponent);
      expect(router.url).toBe('/tenants');
      expect(storedSession()).toMatchObject({
        accessToken: 'renewed-token',
        refreshToken: 'rotated-refresh-token',
        expiresAt: clock.now() + 1_800_000,
        user: stored.user,
      });
    });

    it('asks to sign in again when the refresh token is rejected; session forgotten', async () => {
      const stored = storeSession({ refreshToken: 'refresh-token-value' });
      clock.set(stored.expiresAt!);

      const navigation = router.navigateByUrl('/vendors');
      await settle();
      httpTesting
        .expectOne(CONFIG.tokenEndpoint)
        .flush({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' });
      await expect(navigation).resolves.toBe(true);

      expect(leafComponent()).toBe(LoginComponent);
      expect(router.url).toBe('/login?returnUrl=%2Fvendors');
      expect(storedSession()).toBeNull();
      expect(TestBed.inject(AuthService).isAuthenticated()).toBe(false);
    });

    it('asks to sign in again when the refresh cannot reach the server', async () => {
      const stored = storeSession({ refreshToken: 'refresh-token-value' });
      clock.set(stored.expiresAt!);

      const navigation = router.navigateByUrl('/home');
      await settle();
      httpTesting.expectOne(CONFIG.tokenEndpoint).error(new ProgressEvent('error'));
      await navigation;

      expect(leafComponent()).toBe(LoginComponent);
      expect(storedSession()).toBeNull();
    });

    it('keeps public pages reachable with an expired session, without refreshing', async () => {
      const stored = storeSession({ refreshToken: 'refresh-token-value' });
      clock.set(stored.expiresAt!);

      await router.navigateByUrl('/register');

      expect(leafComponent()).toBe(RegisterComponent);
      httpTesting.expectNone(() => true);
      expect(storedSession()).toEqual(stored);
    });
  });

  describe('return destinations', () => {
    let harness: RouterTestingHarness;

    beforeEach(async () => {
      harness = await RouterTestingHarness.create();
    });

    it('brings the visitor back to the protected page, query string included', async () => {
      await harness.navigateByUrl('/tenants?tab=1');
      await settle();

      expect(router.url).toBe('/login?returnUrl=%2Ftenants%3Ftab%3D1');
      expect(redirect).toHaveBeenCalledTimes(1);
      const authorizationUrl = new URL(redirect.mock.calls[0][0] as string);
      expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
        CONFIG.authorizationEndpoint,
      );
      expect(authorizationUrl.toString()).not.toContain('tenants');
      expect(storedTransaction()?.returnUrl).toBe('/tenants?tab=1');
    });

    it.each(['https://evil.test/', '//evil.test', 'home', '/\\evil.test'])(
      'ignores the return destination %s offered to the sign-in page',
      async (returnUrl) => {
        await harness.navigateByUrl(`/login?returnUrl=${encodeURIComponent(returnUrl)}`);
        await settle();

        expect(redirect).toHaveBeenCalledTimes(1);
        expect(storedTransaction()).not.toBeNull();
        expect(storedTransaction()).not.toHaveProperty('returnUrl');
      },
    );

    it('lands on the remembered page after the sign-in completes', async () => {
      sessionStorage.setItem(
        CONFIG.transactionStorageKey,
        JSON.stringify({
          state: VALID_STATE,
          codeVerifier: VALID_VERIFIER,
          redirectUri: CONFIG.redirectUri,
          createdAt: NOW,
          expiresAt: NOW + CONFIG.transactionTtlMs,
          returnUrl: '/tenants?tab=1',
        } satisfies AuthTransaction),
      );

      const callback = harness.navigateByUrl(
        `/oauth/callback?code=def50200a1b2&state=${VALID_STATE}`,
      );
      await settle();
      httpTesting
        .expectOne(CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'fresh-token', expires_in: 3600 });
      await settle();
      httpTesting
        .expectOne(CONFIG.userInfoEndpoint)
        .flush({ username: `jane@${TENANT_ID}`, name: 'Jane' });
      await callback;
      await settle();

      expect(router.url).toBe('/tenants?tab=1');
      expect(leafComponent()).toBe(TenantDetailComponent);
      expect(storedSession()).toMatchObject({ accessToken: 'fresh-token' });
      // Once rendered, the page loads its data with the new token through the interceptor.
      harness.detectChanges();
      await settle();
      const tenant = httpTesting.expectOne(`${CONFIG.tenantsEndpoint}/${TENANT_ID}`);
      expect(tenant.request.headers.get('Authorization')).toBe('Bearer fresh-token');
      tenant.flush({ id: TENANT_ID, name: 'Acme' });
    });

    it('lands on the home page when no destination was remembered', async () => {
      sessionStorage.setItem(
        CONFIG.transactionStorageKey,
        JSON.stringify({
          state: VALID_STATE,
          codeVerifier: VALID_VERIFIER,
          redirectUri: CONFIG.redirectUri,
          createdAt: NOW,
          expiresAt: NOW + CONFIG.transactionTtlMs,
        } satisfies AuthTransaction),
      );

      const callback = harness.navigateByUrl(
        `/oauth/callback?code=def50200a1b2&state=${VALID_STATE}`,
      );
      await settle();
      httpTesting
        .expectOne(CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'fresh-token', expires_in: 3600 });
      await settle();
      httpTesting
        .expectOne(CONFIG.userInfoEndpoint)
        .flush({ username: `jane@${TENANT_ID}`, name: 'Jane' });
      await callback;
      await settle();

      expect(router.url).toBe('/home');
      expect(leafComponent()).toBe(HomeComponent);
      harness.detectChanges();
      await settle();
      httpTesting.expectOne(`${CONFIG.tenantsEndpoint}/${TENANT_ID}`).flush({ name: 'Acme' });
    });
  });
});
