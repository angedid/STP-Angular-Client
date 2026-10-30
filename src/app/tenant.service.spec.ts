import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AUTH_CONFIG, AuthConfig, DEVELOPMENT_AUTH_CONFIG } from './auth.config';
import { authInterceptor } from './auth.interceptor';
import { AuthService, AuthSession } from './auth.service';
import { TenantService } from './tenant.service';
import { FakeClock } from './testing/fake-clock';

const TENANT_ID = '550e8400-e29b-41d4-a716-446655440000';
const CONFIG: AuthConfig = { ...DEVELOPMENT_AUTH_CONFIG, tenantsEndpoint: 'http://api.test/api/tenants' };
const TENANT_URL = `${CONFIG.tenantsEndpoint}/${TENANT_ID}`;

const session = (username: string, expiresAt: number | null = null): AuthSession => ({
  accessToken: 'access-token-value',
  tokenType: 'Bearer',
  refreshToken: null,
  expiresAt,
  user: { username, displayName: 'Jane Doe', photoUrl: null },
});

/**
 * The service relies on `authInterceptor` for the token, the expiry check and
 * `401` answers, so the interceptor is part of these tests.
 */
describe('TenantService', () => {
  let service: TenantService;
  let httpTesting: HttpTestingController;
  let router: Router;
  let currentSession: AuthSession | null;
  let clearSession: ReturnType<typeof vi.fn>;

  const NOW = 5_000;
  const clock = new FakeClock(NOW);
  /** Lets the interceptor's asynchronous token check run before expecting a request. */
  const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    clock.set(NOW);
    currentSession = session(`jane@${TENANT_ID}`);
    clearSession = vi.fn(() => {
      currentSession = null;
    });
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AUTH_CONFIG, useValue: CONFIG },
        {
          provide: AuthService,
          useValue: {
            getSession: () => currentSession,
            isAuthenticated: () => currentSession !== null,
            getAccessToken: () => currentSession?.accessToken ?? null,
            isSessionExpired: () =>
              currentSession !== null &&
              currentSession.expiresAt !== null &&
              currentSession.expiresAt <= clock.now(),
            refreshSession: vi.fn().mockResolvedValue(false),
            ensureValidSession: async () =>
              currentSession !== null &&
              (currentSession.expiresAt === null || currentSession.expiresAt > clock.now()),
            clearSession,
          },
        },
      ],
    });
    service = TestBed.inject(TenantService);
    httpTesting = TestBed.inject(HttpTestingController);
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.restoreAllMocks();
  });

  describe('before any request', () => {
    it('refuses when nobody is signed in', async () => {
      currentSession = null;

      const result = await service.loadCurrentTenant();

      expect(result).toMatchObject({ status: 'error', reason: 'not_signed_in' });
      httpTesting.expectNone(() => true);
    });

    it('refuses a malformed identifier', async () => {
      currentSession = session('jane');

      const result = await service.loadCurrentTenant();

      expect(result).toMatchObject({ status: 'error', reason: 'malformed_identifier' });
      expect((result as { message: string }).message).toContain('username@tenant');
      httpTesting.expectNone(() => true);
    });

    it('refuses an identifier whose tenant part is not a UUID', async () => {
      currentSession = session('jane@acme');

      const result = await service.loadCurrentTenant();

      expect(result).toMatchObject({ status: 'error', reason: 'invalid_tenant_id' });
      expect((result as { message: string }).message).toContain('UUID');
      httpTesting.expectNone(() => true);
    });

    it('reports an expired token without contacting the server; the session is ended', async () => {
      currentSession = session(`jane@${TENANT_ID}`, NOW);

      const result = await service.loadCurrentTenant();

      expect(result).toMatchObject({ status: 'error', reason: 'session_expired' });
      httpTesting.expectNone(() => true);
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });
  });

  describe('request', () => {
    it('fetches the tenant by UUID with the bearer token on a single-slash path', async () => {
      currentSession = session(`jane@${TENANT_ID}`, NOW + 1);

      const pending = service.loadCurrentTenant();
      await settle();
      const request = httpTesting.expectOne(TENANT_URL);

      expect(request.request.method).toBe('GET');
      expect(request.request.url).not.toContain('//tenants');
      expect(request.request.headers.get('Authorization')).toBe('Bearer access-token-value');
      expect(request.request.headers.get('Accept')).toBe('application/json');

      request.flush({ id: TENANT_ID, name: 'Acme' });
      await expect(pending).resolves.toMatchObject({ status: 'success' });
    });

    it('keeps the UUID as written by the identifier', async () => {
      currentSession = session(`jane@${TENANT_ID.toUpperCase()}`);

      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(`${CONFIG.tenantsEndpoint}/${TENANT_ID.toUpperCase()}`).flush({});
      await pending;
    });

    it('prepares every returned property for display', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(TENANT_URL).flush({
        id: TENANT_ID,
        name: 'Acme Wholesale',
        country_code: 'CM',
        active: true,
        vendorCount: 12,
        description: null,
        address: { city: 'Douala' },
      });

      const result = await pending;
      expect(result).toEqual({
        status: 'success',
        tenant: {
          id: TENANT_ID,
          name: 'Acme Wholesale',
          fields: [
            { label: 'Id', value: TENANT_ID },
            { label: 'Name', value: 'Acme Wholesale' },
            { label: 'Country code', value: 'CM' },
            { label: 'Active', value: 'true' },
            { label: 'Vendor count', value: '12' },
            { label: 'Description', value: '—' },
            { label: 'Address', value: JSON.stringify({ city: 'Douala' }, null, 2) },
          ],
        },
      });
    });

    it('unwraps a data envelope', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(TENANT_URL).flush({ data: { id: 3, name: 'Acme' } });

      const result = await pending;
      expect(result).toMatchObject({
        status: 'success',
        tenant: {
          id: '3',
          name: 'Acme',
          fields: [
            { label: 'Id', value: '3' },
            { label: 'Name', value: 'Acme' },
          ],
        },
      });
    });

    it('accepts a tenant without name', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(TENANT_URL).flush({ id: TENANT_ID });

      await expect(pending).resolves.toMatchObject({
        status: 'success',
        tenant: { name: null, fields: [{ label: 'Id', value: TENANT_ID }] },
      });
    });
  });

  describe('failures', () => {
    it('treats a 401 answer as an expired session, which the interceptor ends', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting
        .expectOne(TENANT_URL)
        .flush({ message: 'Unauthenticated.' }, { status: 401, statusText: 'Unauthorized' });

      await expect(pending).resolves.toMatchObject({ status: 'error', reason: 'session_expired' });
      expect(clearSession).toHaveBeenCalledTimes(1);
      expect(router.navigateByUrl).toHaveBeenCalledTimes(1);
    });

    it('keeps the session on other failures', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 403, statusText: 'Forbidden' });
      await pending;

      expect(clearSession).not.toHaveBeenCalled();
      expect(router.navigateByUrl).not.toHaveBeenCalled();
    });

    it('explains a missing tenant', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 404, statusText: 'Not Found' });

      await expect(pending).resolves.toMatchObject({ status: 'error', reason: 'not_found' });
    });

    it('explains a forbidden tenant', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(null, { status: 403, statusText: 'Forbidden' });

      const result = await pending;
      expect(result).toMatchObject({ status: 'error', reason: 'request_rejected' });
      expect((result as { message: string }).message).toMatch(/not allowed/i);
    });

    it('explains a server error', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting
        .expectOne(TENANT_URL)
        .flush(null, { status: 500, statusText: 'Internal Server Error' });

      const result = await pending;
      expect(result).toMatchObject({ status: 'error', reason: 'request_rejected' });
      expect((result as { message: string }).message).toContain('HTTP 500');
    });

    it('explains a network failure', async () => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(TENANT_URL).error(new ProgressEvent('error'));

      await expect(pending).resolves.toMatchObject({ status: 'error', reason: 'network_error' });
    });

    it.each([
      ['an array', []],
      ['a string', 'tenant'],
      ['null', null],
    ])('rejects an unreadable body (%s)', async (_label, body) => {
      const pending = service.loadCurrentTenant();
      await settle();
      httpTesting.expectOne(TENANT_URL).flush(body);

      await expect(pending).resolves.toMatchObject({ status: 'error', reason: 'invalid_response' });
    });
  });
});
