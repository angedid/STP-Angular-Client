import {
  HttpClient,
  HttpErrorResponse,
  provideHttpClient,
  withInterceptors,
} from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AUTH_CONFIG, AuthConfig } from './auth.config';
import { authInterceptor, isLogoutUrl, isProtectedUrl } from './auth.interceptor';
import { AuthService } from './auth.service';
import { FakeClock } from './testing/fake-clock';

const CONFIG: AuthConfig = {
  authorizationEndpoint: 'http://auth.test/oauth/authorize',
  tokenEndpoint: 'http://auth.test/oauth/token',
  clientId: 'test-client',
  redirectUri: 'http://app.test/oauth/callback',
  scope: '',
  userInfoEndpoint: 'http://auth.test/api/user',
  logoutEndpoint: 'http://auth.test/api/logout',
  logoutMethod: 'POST',
  tenantsEndpoint: 'http://api.test/api/tenants',
  transactionStorageKey: 'test.transaction',
  transactionTtlMs: 1000,
  sessionStorageKey: 'test.session',
};

const TENANT_URL = `${CONFIG.tenantsEndpoint}/550e8400-e29b-41d4-a716-446655440000`;
const LOGOUT_URL = `${CONFIG.logoutEndpoint}/jane`;

/** The parts of a session the interceptor looks at. */
interface FakeSession {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
}

describe('authInterceptor', () => {
  let http: HttpClient;
  let httpTesting: HttpTestingController;
  let router: Router;
  let session: FakeSession | null;
  let currentUrl: string;
  let authService: {
    isAuthenticated: () => boolean;
    getAccessToken: () => string | null;
    isSessionExpired: () => boolean;
    refreshSession: () => Promise<boolean>;
    ensureValidSession: () => Promise<boolean>;
    clearSession: ReturnType<typeof vi.fn>;
  };
  /**
   * The refresh operation behind `refreshSession`, which shares one in-flight
   * operation between concurrent callers exactly like `AuthService` does. By
   * default it fails, ending the session.
   */
  let performRefresh: ReturnType<typeof vi.fn<() => Promise<boolean>>>;
  let refreshInFlight: Promise<boolean> | null;

  const NOW = 1_000_000;
  const clock = new FakeClock(NOW);
  const valid = (): FakeSession => ({
    accessToken: 'access-token-value',
    refreshToken: null,
    expiresAt: NOW + 60_000,
  });
  const expired = (refreshToken: string | null = null): FakeSession => ({
    accessToken: 'expired-token',
    refreshToken,
    expiresAt: NOW - 1,
  });

  /** Issues a request and captures how it ends, without throwing. */
  const send = (url: string, method: 'GET' | 'POST' = 'GET') => {
    const outcome: { error?: unknown; body?: unknown } = {};
    http.request(method, url).subscribe({
      next: (body) => (outcome.body = body),
      error: (error: unknown) => (outcome.error = error),
    });
    return outcome;
  };
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));
  /** Makes the next refresh succeed, renewing the session with `accessToken`. */
  const refreshSucceedsWith = (accessToken: string): void => {
    performRefresh.mockImplementation(async () => {
      await Promise.resolve();
      session = { ...valid(), accessToken, refreshToken: 'rotated-refresh-token' };
      return true;
    });
  };
  const authorizationOf = (request: { request: { headers: { get(n: string): string | null } } }) =>
    request.request.headers.get('Authorization');
  const status = (outcome: { error?: unknown }): number | undefined =>
    outcome.error instanceof HttpErrorResponse ? outcome.error.status : undefined;

  beforeEach(() => {
    clock.set(NOW);
    session = valid();
    currentUrl = '/tenants';
    refreshInFlight = null;
    performRefresh = vi.fn(async () => {
      // Mirrors AuthService: the answer comes later, and a failed refresh ends the session.
      await Promise.resolve();
      session = null;
      return false;
    });
    authService = {
      isAuthenticated: () => session !== null,
      getAccessToken: () => session?.accessToken ?? null,
      isSessionExpired: () =>
        session !== null && session.expiresAt !== null && session.expiresAt <= clock.now(),
      refreshSession: () => {
        if (refreshInFlight === null) {
          refreshInFlight = performRefresh().finally(() => {
            refreshInFlight = null;
          });
        }
        return refreshInFlight;
      },
      ensureValidSession: async () => {
        if (session === null) {
          return false;
        }
        if (!authService.isSessionExpired()) {
          return true;
        }
        if (await authService.refreshSession()) {
          return !authService.isSessionExpired();
        }
        (authService.clearSession as () => void)();
        return false;
      },
      clearSession: vi.fn(() => {
        session = null;
      }),
    };
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTH_CONFIG, useValue: CONFIG },
        { provide: AuthService, useValue: authService },
      ],
    });
    http = TestBed.inject(HttpClient);
    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    Object.defineProperty(router, 'url', { get: () => currentUrl, configurable: true });
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.restoreAllMocks();
  });

  describe('attaching the token', () => {
    const apiUrls = [
      TENANT_URL,
      CONFIG.userInfoEndpoint,
      LOGOUT_URL,
      'http://api.test/api/credits?page=2',
    ];

    it.each(apiUrls)(
      'adds the bearer token to API requests (%s)',
      async (url) => {
        send(url);
        await settle();

        const request = httpTesting.expectOne(url);
        expect(request.request.headers.get('Authorization')).toBe('Bearer access-token-value');
        request.flush({});
      },
    );

    it.each([CONFIG.tokenEndpoint, CONFIG.authorizationEndpoint])(
      'never sends the token to the OAuth endpoints (%s)',
      (url) => {
        send(url, 'POST');

        const request = httpTesting.expectOne(url);
        expect(request.request.headers.has('Authorization')).toBe(false);
        request.flush({});
      },
    );

    it.each(['https://cdn.test/jane.png', 'http://other.test/api/tenants/1', 'images/logo.png'])(
      'never sends the token to other origins or relative URLs (%s)',
      (url) => {
        send(url);

        const request = httpTesting.expectOne(url);
        expect(request.request.headers.has('Authorization')).toBe(false);
        request.flush({});
      },
    );

    it('sends nothing when nobody is signed in', () => {
      session = null;

      send(CONFIG.userInfoEndpoint);

      const request = httpTesting.expectOne(CONFIG.userInfoEndpoint);
      expect(request.request.headers.has('Authorization')).toBe(false);
      request.flush({});
    });

    it('leaves an explicit Authorization header untouched', () => {
      http
        .get(CONFIG.userInfoEndpoint, { headers: { Authorization: 'Bearer fresh-token' } })
        .subscribe();

      const request = httpTesting.expectOne(CONFIG.userInfoEndpoint);
      expect(request.request.headers.get('Authorization')).toBe('Bearer fresh-token');
      request.flush({});
    });
  });

  describe('401 from an API request: refresh and retry once', () => {
    it('refreshes the session and retries the request once with the new token', async () => {
      refreshSucceedsWith('renewed-token');

      const outcome = send(TENANT_URL);
      await settle();
      const first = httpTesting.expectOne(TENANT_URL);
      expect(authorizationOf(first)).toBe('Bearer access-token-value');
      first.flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(performRefresh).toHaveBeenCalledTimes(1);
      const retry = httpTesting.expectOne(TENANT_URL);
      expect(authorizationOf(retry)).toBe('Bearer renewed-token');
      expect(retry.request.method).toBe('GET');
      retry.flush({ id: 1 });
      await settle();

      expect(outcome.body).toEqual({ id: 1 });
      expect(outcome.error).toBeUndefined();
      expect(authService.clearSession).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('retries with the same method and body', async () => {
      refreshSucceedsWith('renewed-token');

      http.post('http://api.test/api/credits', { amount: 5 }).subscribe({ error: () => undefined });
      await settle();
      httpTesting
        .expectOne('http://api.test/api/credits')
        .flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      const retry = httpTesting.expectOne('http://api.test/api/credits');
      expect(retry.request.method).toBe('POST');
      expect(retry.request.body).toEqual({ amount: 5 });
      expect(authorizationOf(retry)).toBe('Bearer renewed-token');
      retry.flush({});
    });

    it('ends the session when the retry is rejected too, without a third attempt', async () => {
      refreshSucceedsWith('renewed-token');

      const outcome = send(TENANT_URL);
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      httpTesting.expectNone(TENANT_URL);
      expect(performRefresh).toHaveBeenCalledTimes(1);
      expect(authService.clearSession).toHaveBeenCalledTimes(1);
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      expect(status(outcome)).toBe(401);
    });

    it('does not retry a request that was already sent with a freshly renewed token', async () => {
      session = expired('refresh-token-value');
      refreshSucceedsWith('renewed-token');

      const outcome = send(TENANT_URL);
      await settle();
      const request = httpTesting.expectOne(TENANT_URL);
      expect(authorizationOf(request)).toBe('Bearer renewed-token');
      request.flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      httpTesting.expectNone(TENANT_URL);
      expect(performRefresh).toHaveBeenCalledTimes(1);
      expect(authService.clearSession).toHaveBeenCalledTimes(1);
      expect(session).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      expect(status(outcome)).toBe(401);
    });

    it('triggers one refresh for requests that fail together and retries each once', async () => {
      refreshSucceedsWith('renewed-token');
      const urls = [TENANT_URL, CONFIG.userInfoEndpoint, 'http://api.test/api/credits'];

      const outcomes = urls.map((url) => send(url));
      await settle();
      for (const url of urls) {
        httpTesting.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });
      }
      await settle();

      expect(performRefresh).toHaveBeenCalledTimes(1);
      for (const url of urls) {
        const retry = httpTesting.expectOne(url);
        expect(authorizationOf(retry)).toBe('Bearer renewed-token');
        retry.flush({ url });
      }
      await settle();

      expect(outcomes.map((outcome) => outcome.body)).toEqual(urls.map((url) => ({ url })));
      expect(authService.clearSession).not.toHaveBeenCalled();
      httpTesting.expectNone(() => true);
    });

    it('retries without a new refresh when another request renewed the session', async () => {
      refreshSucceedsWith('renewed-token');

      const first = send(TENANT_URL);
      const second = send(CONFIG.userInfoEndpoint);
      await settle();
      // The first failure renews the session...
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();
      httpTesting.expectOne(TENANT_URL).flush({});
      // ...and a later failure of a request sent with the old token just retries.
      httpTesting
        .expectOne(CONFIG.userInfoEndpoint)
        .flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(performRefresh).toHaveBeenCalledTimes(1);
      const retry = httpTesting.expectOne(CONFIG.userInfoEndpoint);
      expect(authorizationOf(retry)).toBe('Bearer renewed-token');
      retry.flush({});
      await settle();
      expect(first.error).toBeUndefined();
      expect(second.error).toBeUndefined();
    });

    it('ends the session, redirects to sign-in with returnUrl, propagates the error', async () => {
      const outcome = send(TENANT_URL);
      await settle();
      httpTesting
        .expectOne(TENANT_URL)
        .flush({ message: 'Unauthenticated.' }, { status: 401, statusText: 'Unauthorized' });
      await settle();

      httpTesting.expectNone(TENANT_URL);
      expect(performRefresh).toHaveBeenCalledTimes(1);
      expect(session).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      const target = (router.navigateByUrl as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(router.serializeUrl(target)).toBe('/login?returnUrl=%2Ftenants');
      expect(status(outcome)).toBe(401);
    });

    it('clears a session the refresh left in place', async () => {
      performRefresh.mockResolvedValue(false);

      send(TENANT_URL);
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(authService.clearSession).toHaveBeenCalledTimes(1);
      expect(session).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('redirects only once when several requests fail together and refresh fails', async () => {
      const first = send(TENANT_URL);
      const second = send(CONFIG.userInfoEndpoint);
      const third = send('http://api.test/api/credits');
      await settle();
      for (const url of [TENANT_URL, CONFIG.userInfoEndpoint, 'http://api.test/api/credits']) {
        httpTesting.expectOne(url).flush(null, { status: 401, statusText: 'Unauthorized' });
      }
      await settle();

      expect(performRefresh).toHaveBeenCalledTimes(1);
      expect(session).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      expect([first, second, third].map(status)).toEqual([401, 401, 401]);
      httpTesting.expectNone(() => true);
    });

    it('does nothing more for a late 401 once the session is already gone', async () => {
      const outcome = send(TENANT_URL);
      await settle();
      session = null;
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(performRefresh).not.toHaveBeenCalled();
      expect(authService.clearSession).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(status(outcome)).toBe(401);
    });

    it('does not navigate again when already on the sign-in page', async () => {
      currentUrl = '/login?returnUrl=%2Fhome';

      send(TENANT_URL);
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(session).toBeNull();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('omits the returnUrl from the landing page', async () => {
      currentUrl = '/';

      send(TENANT_URL);
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      const target = (router.navigateByUrl as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(router.serializeUrl(target)).toBe('/login');
    });

    it.each([400, 403, 404, 500])('leaves the session alone on a %s answer', async (code) => {
      const outcome = send(TENANT_URL);
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: code, statusText: 'Error' });
      await settle();

      expect(authService.clearSession).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(status(outcome)).toBe(code);
    });

    it('leaves the session alone on a network failure', async () => {
      const outcome = send(TENANT_URL);
      await settle();
      httpTesting.expectOne(TENANT_URL).error(new ProgressEvent('error'));
      await settle();

      expect(authService.clearSession).not.toHaveBeenCalled();
      expect(status(outcome)).toBe(0);
    });
  });

  describe('expired session before an API request', () => {
    it('does not send the expired token: ends the session and answers 401 locally', async () => {
      session = expired(); // no refresh token: AuthService.refreshSession() resolves false

      const outcome = send(TENANT_URL);
      await settle();

      httpTesting.expectNone(TENANT_URL);
      expect(session).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      expect(status(outcome)).toBe(401);
      expect((outcome.error as HttpErrorResponse).url).toBe(TENANT_URL);
    });

    it('redirects once when several requests find the session expired together', async () => {
      session = expired('refresh-token-value');

      const outcomes = [send(TENANT_URL), send(CONFIG.userInfoEndpoint)];
      await settle();

      httpTesting.expectNone(() => true);
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      expect(outcomes.map(status)).toEqual([401, 401]);
    });

    it('renews the token first when a refresh token exists, then sends the request', async () => {
      session = expired('refresh-token-value');
      refreshSucceedsWith('renewed-token');

      send(TENANT_URL);
      await settle();

      expect(performRefresh).toHaveBeenCalledTimes(1);
      const request = httpTesting.expectOne(TENANT_URL);
      expect(request.request.headers.get('Authorization')).toBe('Bearer renewed-token');
      request.flush({});
      expect(authService.clearSession).not.toHaveBeenCalled();
    });

    it('ends the session when the refresh is refused', async () => {
      session = expired('refresh-token-value');

      const outcome = send(TENANT_URL);
      await settle();

      httpTesting.expectNone(TENANT_URL);
      expect(performRefresh).toHaveBeenCalledTimes(1);
      expect(session).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
      expect(status(outcome)).toBe(401);
    });
  });

  describe('logout endpoint exception', () => {
    it('keeps the session and propagates a 401 instead of redirecting', async () => {
      const outcome = send(LOGOUT_URL, 'POST');
      httpTesting.expectOne(LOGOUT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(authService.clearSession).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
      expect(session).toEqual(valid());
      expect(status(outcome)).toBe(401);
    });

    it('sends the request as it stands for an expired session, without renewing it', async () => {
      session = expired('refresh-token-value');

      send(LOGOUT_URL, 'POST');
      await settle();

      const request = httpTesting.expectOne(LOGOUT_URL);
      expect(request.request.headers.get('Authorization')).toBe('Bearer expired-token');
      expect(performRefresh).not.toHaveBeenCalled();
      request.flush(null, { status: 204, statusText: 'No Content' });
    });

    it('does not treat an expired session as valid when the revocation is refused', async () => {
      session = expired();
      const before = { ...session };

      const outcome = send(LOGOUT_URL, 'POST');
      httpTesting.expectOne(LOGOUT_URL).flush(null, { status: 401, statusText: 'Unauthorized' });
      await settle();

      expect(status(outcome)).toBe(401);
      expect(authService.clearSession).not.toHaveBeenCalled();
      expect(session).toEqual(before);
      expect(authService.isSessionExpired()).toBe(true);
      // The next API request still finds the session expired and ends it.
      send(TENANT_URL);
      await settle();
      httpTesting.expectNone(TENANT_URL);
      expect(session).toBeNull();
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });
  });
});

describe('isProtectedUrl', () => {
  it('recognises the API origins and excludes the OAuth endpoints', () => {
    expect(isProtectedUrl('http://api.test/anything', CONFIG)).toBe(true);
    expect(isProtectedUrl('http://auth.test/api/user', CONFIG)).toBe(true);
    expect(isProtectedUrl('http://auth.test/oauth/token', CONFIG)).toBe(false);
    expect(isProtectedUrl('http://auth.test/oauth/token?x=1', CONFIG)).toBe(false);
    expect(isProtectedUrl('http://auth.test/oauth/authorize', CONFIG)).toBe(false);
    expect(isProtectedUrl('https://api.test/anything', CONFIG)).toBe(false);
    expect(isProtectedUrl('http://api.test:8080/anything', CONFIG)).toBe(false);
    expect(isProtectedUrl('/api/tenants', CONFIG)).toBe(false);
    expect(isProtectedUrl('not a url', CONFIG)).toBe(false);
  });
});

describe('isLogoutUrl', () => {
  it('matches the revocation endpoint with or without a username', () => {
    expect(isLogoutUrl(CONFIG.logoutEndpoint, CONFIG)).toBe(true);
    expect(isLogoutUrl(`${CONFIG.logoutEndpoint}/jane%40tenant`, CONFIG)).toBe(true);
    expect(isLogoutUrl(`${CONFIG.logoutEndpoint}?x=1`, CONFIG)).toBe(true);
    expect(isLogoutUrl('http://auth.test/api/logout-history', CONFIG)).toBe(false);
    expect(isLogoutUrl(CONFIG.userInfoEndpoint, CONFIG)).toBe(false);
  });
});
