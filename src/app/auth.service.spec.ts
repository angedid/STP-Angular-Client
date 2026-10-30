import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import { AUTH_CONFIG, AuthConfig } from './auth.config';
import { AuthService, AuthSession, EXTERNAL_REDIRECT } from './auth.service';
import { AuthTransaction } from './auth-transaction';
import { CLOCK } from './clock';
import { createCodeChallenge } from './pkce';
import { FakeClock } from './testing/fake-clock';

const TEST_CONFIG: AuthConfig = {
  authorizationEndpoint: 'http://auth.test/oauth/authorize',
  tokenEndpoint: 'http://auth.test/oauth/token',
  clientId: 'test-client',
  redirectUri: 'http://app.test/oauth/callback',
  scope: '',
  userInfoEndpoint: 'http://auth.test/api/user',
  logoutEndpoint: 'http://auth.test/api/logout',
  logoutMethod: 'POST',
  tenantsEndpoint: 'http://auth.test/api/tenants',
  transactionStorageKey: 'test.oauth.transaction',
  transactionTtlMs: 10 * 60 * 1000,
  sessionStorageKey: 'test.oauth.session',
};

const VALID_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const VALID_STATE = 'c2VjcmV0LXN0YXRlLXZhbHVlLTEyMzQ1Ng';
const VALID_CODE = 'def50200a1b2c3d4e5f6';
/** 2023-11-14T22:13:20Z; every test starts here and only moves the fake clock explicitly. */
const NOW = 1_700_000_000_000;

const TOKEN_RESPONSE = {
  token_type: 'Bearer',
  expires_in: 3600,
  access_token: 'access-token-value',
  refresh_token: 'refresh-token-value',
};

const PROFILE_RESPONSE = {
  id: 7,
  username: 'jane.doe',
  name: 'Jane Doe',
  email: 'jane@example.test',
  photo_url: 'https://cdn.test/jane.png',
};

const EXPECTED_USER = {
  username: 'jane.doe',
  displayName: 'Jane Doe',
  photoUrl: 'https://cdn.test/jane.png',
};

describe('AuthService', () => {
  let service: AuthService;
  let httpTesting: HttpTestingController;
  let redirect: (url: string) => void;
  let clock: FakeClock;
  let consoleSpies: Array<{ mock: { calls: unknown[][] } }>;

  const storedTransaction = (): AuthTransaction | null => {
    const raw = sessionStorage.getItem(TEST_CONFIG.transactionStorageKey);
    return raw === null ? null : (JSON.parse(raw) as AuthTransaction);
  };

  const storedSession = (): AuthSession | null => {
    const raw = sessionStorage.getItem(TEST_CONFIG.sessionStorageKey);
    return raw === null ? null : (JSON.parse(raw) as AuthSession);
  };

  /** A second service instance, as created by a reload of the tab. */
  const reloadedService = (): AuthService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AUTH_CONFIG, useValue: TEST_CONFIG },
        { provide: EXTERNAL_REDIRECT, useValue: (url: string) => redirect(url) },
        { provide: CLOCK, useValue: clock },
      ],
    });
    httpTesting = TestBed.inject(HttpTestingController);
    return TestBed.inject(AuthService);
  };

  const storeTransaction = (overrides: Partial<AuthTransaction> = {}): AuthTransaction => {
    const now = clock.now();
    const transaction: AuthTransaction = {
      state: VALID_STATE,
      codeVerifier: VALID_VERIFIER,
      redirectUri: TEST_CONFIG.redirectUri,
      createdAt: now,
      expiresAt: now + TEST_CONFIG.transactionTtlMs,
      ...overrides,
    };
    sessionStorage.setItem(TEST_CONFIG.transactionStorageKey, JSON.stringify(transaction));
    return transaction;
  };

  /** Lets the service react to a flushed response before the next expectation. */
  const nextTick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /** Answers the pending token request, then the profile request it triggers. */
  const flushSignIn = async (profile: object | null = PROFILE_RESPONSE): Promise<void> => {
    httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).flush(TOKEN_RESPONSE);
    await nextTick();
    httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint).flush(profile);
  };

  /** Runs a complete, successful sign-in. */
  const signIn = async (): Promise<void> => {
    storeTransaction();
    const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
    await flushSignIn();
    await expect(pending).resolves.toEqual({ status: 'success' });
  };

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    redirect = vi.fn();
    clock = new FakeClock(NOW);
    consoleSpies = (['log', 'info', 'debug', 'warn', 'error'] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => undefined),
    );

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AUTH_CONFIG, useValue: TEST_CONFIG },
        { provide: EXTERNAL_REDIRECT, useValue: (url: string) => redirect(url) },
        { provide: CLOCK, useValue: clock },
      ],
    });
    service = TestBed.inject(AuthService);
    httpTesting = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpTesting.verify();
    vi.restoreAllMocks();
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
    expect(service.isAuthenticated()).toBe(false);
    expect(service.getAccessToken()).toBeNull();
    expect(service.user()).toBeNull();
  });

  describe('authorization request', () => {
    it('builds an S256 PKCE request whose state is independent from the code verifier', async () => {
      const url = new URL(await service.createAuthorizationUrl());
      const transaction = storedTransaction();

      expect(url.origin + url.pathname).toBe(TEST_CONFIG.authorizationEndpoint);
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('client_id')).toBe(TEST_CONFIG.clientId);
      expect(url.searchParams.get('redirect_uri')).toBe(TEST_CONFIG.redirectUri);
      expect(url.searchParams.get('code_challenge_method')).toBe('S256');
      expect(url.searchParams.has('client_secret')).toBe(false);

      expect(transaction).not.toBeNull();
      const state = url.searchParams.get('state');
      expect(state).toBe(transaction!.state);
      expect(state).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(transaction!.codeVerifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(state).not.toBe(transaction!.codeVerifier);
      expect(url.searchParams.get('code_challenge')).toBe(
        await createCodeChallenge(transaction!.codeVerifier),
      );
      // Neither the verifier nor the challenge are mistaken for one another.
      expect(url.searchParams.get('code_challenge')).not.toBe(transaction!.codeVerifier);
    });

    it('stores a transaction valid for ten minutes in sessionStorage only', async () => {
      await service.createAuthorizationUrl();
      const transaction = storedTransaction();

      expect(transaction!.createdAt).toBe(NOW);
      expect(transaction!.expiresAt).toBe(NOW + 10 * 60 * 1000);
      expect(transaction!.redirectUri).toBe(TEST_CONFIG.redirectUri);
      expect(localStorage.length).toBe(0);
    });

    it('generates fresh values for every request', async () => {
      const first = new URL(await service.createAuthorizationUrl());
      const firstTransaction = storedTransaction();
      const second = new URL(await service.createAuthorizationUrl());
      const secondTransaction = storedTransaction();

      expect(first.searchParams.get('state')).not.toBe(second.searchParams.get('state'));
      expect(firstTransaction!.codeVerifier).not.toBe(secondTransaction!.codeVerifier);
      // Only the latest transaction is kept.
      expect(secondTransaction!.state).toBe(second.searchParams.get('state'));
    });

    it('remembers a same-origin return URL in the transaction', async () => {
      await service.createAuthorizationUrl('/tenants?tab=1');

      expect(storedTransaction()!.returnUrl).toBe('/tenants?tab=1');
    });

    it.each([null, 'https://evil.test/', '//evil.test', 'home', ''])(
      'ignores an unusable return URL (%s)',
      async (returnUrl) => {
        await service.createAuthorizationUrl(returnUrl);

        expect(storedTransaction()).not.toHaveProperty('returnUrl');
      },
    );

    it('never sends the return URL to the authorization server', async () => {
      const url = await service.createAuthorizationUrl('/tenants');

      expect(url).not.toContain('tenants');
    });

    it('redirects the browser to the authorization URL on startLogin', async () => {
      await service.startLogin();

      expect(redirect).toHaveBeenCalledTimes(1);
      const url = new URL((redirect as ReturnType<typeof vi.fn>).mock.calls[0][0] as string);
      expect(url.searchParams.get('state')).toBe(storedTransaction()!.state);
    });

    it('rejects startLogin without redirecting when the transaction cannot be stored', async () => {
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      await expect(service.startLogin()).rejects.toThrow();
      expect(redirect).not.toHaveBeenCalled();
    });
  });

  describe('callback validation (no token request must be sent)', () => {
    it.each([
      ['a missing code', { state: VALID_STATE }],
      ['an empty code', { code: '', state: VALID_STATE }],
      ['a code with control characters', { code: 'abc\n123', state: VALID_STATE }],
      ['a missing state', { code: VALID_CODE }],
      ['a malformed state', { code: VALID_CODE, state: 'bad state!' }],
    ])('rejects %s', async (_label, params) => {
      storeTransaction();

      const result = await service.handleCallback(params);

      expect(result).toMatchObject({ status: 'error', reason: 'invalid_callback' });
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
      expect(storedTransaction()).toBeNull();
      expect(service.isAuthenticated()).toBe(false);
    });

    it('reports an authorization error returned by the server', async () => {
      storeTransaction();

      const result = await service.handleCallback({ error: 'access_denied', state: VALID_STATE });

      expect(result).toMatchObject({ status: 'error', reason: 'authorization_denied' });
      expect((result as { message: string }).message).toContain('access_denied');
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
      expect(storedTransaction()).toBeNull();
    });

    it('does not echo an unsafe error code back to the user', async () => {
      const result = await service.handleCallback({
        error: '<img src=x onerror=alert(1)>',
        state: VALID_STATE,
      });

      expect(result.status).toBe('error');
      expect((result as { message: string }).message).not.toContain('<img');
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
    });

    it('rejects a callback when no transaction is pending', async () => {
      const result = await service.handleCallback({ code: VALID_CODE, state: VALID_STATE });

      expect(result).toMatchObject({ status: 'error', reason: 'transaction_missing' });
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
    });

    it('rejects an expired transaction and discards it', async () => {
      storeTransaction({ expiresAt: NOW - 1 });

      const result = await service.handleCallback({ code: VALID_CODE, state: VALID_STATE });

      expect(result).toMatchObject({ status: 'error', reason: 'transaction_expired' });
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
      expect(storedTransaction()).toBeNull();
    });

    it.each([
      ['invalid JSON', 'not json'],
      ['a non-object value', '"string"'],
      ['a missing code verifier', JSON.stringify({ state: VALID_STATE, expiresAt: 9e15 })],
      [
        'a code verifier that is too short',
        JSON.stringify({
          state: VALID_STATE,
          codeVerifier: 'short',
          redirectUri: TEST_CONFIG.redirectUri,
          createdAt: 1,
          expiresAt: 9e15,
        }),
      ],
    ])('rejects a malformed transaction (%s) and discards it', async (_label, raw) => {
      sessionStorage.setItem(TEST_CONFIG.transactionStorageKey, raw);

      const result = await service.handleCallback({ code: VALID_CODE, state: VALID_STATE });

      expect(result).toMatchObject({ status: 'error', reason: 'transaction_malformed' });
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
      expect(storedTransaction()).toBeNull();
    });

    it('rejects a state that does not match the pending transaction', async () => {
      storeTransaction({ state: 'YW5vdGhlci1zdGF0ZS12YWx1ZS0xMjM0NTY' });

      const result = await service.handleCallback({ code: VALID_CODE, state: VALID_STATE });

      expect(result).toMatchObject({ status: 'error', reason: 'state_mismatch' });
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
      expect(storedTransaction()).toBeNull();
    });
  });

  describe('token exchange', () => {
    it('sends the code and verifier to the token endpoint without any client secret', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      const request = httpTesting.expectOne(TEST_CONFIG.tokenEndpoint);

      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
      const body = new URLSearchParams(request.request.body as string);
      expect(body.get('grant_type')).toBe('authorization_code');
      expect(body.get('client_id')).toBe(TEST_CONFIG.clientId);
      expect(body.get('redirect_uri')).toBe(TEST_CONFIG.redirectUri);
      expect(body.get('code')).toBe(VALID_CODE);
      expect(body.get('code_verifier')).toBe(VALID_VERIFIER);
      expect(body.has('client_secret')).toBe(false);

      request.flush(TOKEN_RESPONSE);
      await nextTick();
      httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint).flush(PROFILE_RESPONSE);
      await expect(pending).resolves.toEqual({ status: 'success' });
    });

    it('loads the user profile with the new access token before succeeding', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).flush(TOKEN_RESPONSE);
      await nextTick();
      const profileRequest = httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint);

      expect(profileRequest.request.method).toBe('GET');
      expect(profileRequest.request.headers.get('Authorization')).toBe(
        `Bearer ${TOKEN_RESPONSE.access_token}`,
      );
      expect(profileRequest.request.headers.get('Accept')).toBe('application/json');
      expect(service.isAuthenticated()).toBe(false);

      profileRequest.flush(PROFILE_RESPONSE);
      await expect(pending).resolves.toEqual({ status: 'success' });
      expect(service.user()).toEqual(EXPECTED_USER);
    });

    it('only succeeds once both servers have answered', async () => {
      storeTransaction();
      let settled = false;

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      void pending.then(() => (settled = true));
      const request = httpTesting.expectOne(TEST_CONFIG.tokenEndpoint);

      await Promise.resolve();
      expect(settled).toBe(false);
      expect(service.isAuthenticated()).toBe(false);

      request.flush(TOKEN_RESPONSE);
      await nextTick();
      const profileRequest = httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint);
      expect(settled).toBe(false);
      expect(service.isAuthenticated()).toBe(false);

      profileRequest.flush(PROFILE_RESPONSE);
      await pending;
      expect(settled).toBe(true);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.getAccessToken()).toBe(TOKEN_RESPONSE.access_token);
      expect(service.getSession()).toMatchObject({
        tokenType: 'Bearer',
        refreshToken: TOKEN_RESPONSE.refresh_token,
        user: EXPECTED_USER,
      });
      expect(service.getSession()!.expiresAt).toBe(NOW + TOKEN_RESPONSE.expires_in * 1000);
    });

    it('consumes the transaction before contacting the server', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      expect(storedTransaction()).toBeNull();

      await flushSignIn();
      await pending;
    });

    it('fails without a session when the profile request is rejected', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).flush(TOKEN_RESPONSE);
      await nextTick();
      httpTesting
        .expectOne(TEST_CONFIG.userInfoEndpoint)
        .flush({ message: 'Unauthenticated.' }, { status: 401, statusText: 'Unauthorized' });

      const result = await pending;
      expect(result).toMatchObject({ status: 'error', reason: 'profile_request_failed' });
      expect(service.isAuthenticated()).toBe(false);
      expect(service.getAccessToken()).toBeNull();
    });

    it.each([
      ['no body', null],
      ['an array', []],
      ['no username or email', { name: 'Jane Doe' }],
      ['an empty username', { username: '   ' }],
    ])('fails without a session when the profile is unusable (%s)', async (_label, profile) => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn(profile);

      const result = await pending;
      expect(result).toMatchObject({ status: 'error', reason: 'invalid_profile_response' });
      expect(service.isAuthenticated()).toBe(false);
    });

    it.each([
      [
        'shows only the username part of the identifier when no name is provided',
        { username: 'jane@550e8400-e29b-41d4-a716-446655440000' },
        {
          username: 'jane@550e8400-e29b-41d4-a716-446655440000',
          displayName: 'jane',
          photoUrl: null,
        },
      ],
      [
        'prefers the server-provided name over the identifier',
        { username: 'jane@550e8400-e29b-41d4-a716-446655440000', name: 'Jane Doe' },
        {
          username: 'jane@550e8400-e29b-41d4-a716-446655440000',
          displayName: 'Jane Doe',
          photoUrl: null,
        },
      ],
      [
        'falls back to the email when the username is missing, showing its local part',
        { email: 'jane@example.test' },
        { username: 'jane@example.test', displayName: 'jane', photoUrl: null },
      ],
      [
        'ignores a photo that is not an absolute http(s) URL',
        { username: 'jane', name: 'Jane', photo_url: 'javascript:alert(1)' },
        { username: 'jane', displayName: 'Jane', photoUrl: null },
      ],
      [
        'accepts alternative photo field names',
        { username: 'jane', avatar_url: 'http://cdn.test/a.png' },
        { username: 'jane', displayName: 'jane', photoUrl: 'http://cdn.test/a.png' },
      ],
    ])('%s', async (_label, profile, expectedUser) => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn(profile);

      await expect(pending).resolves.toEqual({ status: 'success' });
      expect(service.user()).toEqual(expectedUser);
    });

    it('reports a rejected request with the server error code', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush(
          { error: 'invalid_grant', error_description: 'The code is invalid' },
          { status: 400, statusText: 'Bad Request' },
        );

      const result = await pending;
      expect(result).toMatchObject({ status: 'error', reason: 'token_request_rejected' });
      expect((result as { message: string }).message).toContain('invalid_grant');
      expect(service.isAuthenticated()).toBe(false);
    });

    it('reports a network failure', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).error(new ProgressEvent('error'));

      const result = await pending;
      expect(result).toMatchObject({ status: 'error', reason: 'network_error' });
      expect((result as { message: string }).message).toMatch(/could not be reached/i);
      expect(service.isAuthenticated()).toBe(false);
    });

    it.each([
      ['no body', null],
      ['an empty access token', { token_type: 'Bearer', access_token: '' }],
      ['a missing access token', { token_type: 'Bearer', expires_in: 3600 }],
      ['an unsupported token type', { token_type: 'MAC', access_token: 'abc' }],
      ['a non-numeric expiry', { token_type: 'Bearer', access_token: 'abc', expires_in: 'soon' }],
      ['a string body', 'access_token=abc'],
    ])('rejects an invalid token response (%s)', async (_label, body) => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).flush(body);

      const result = await pending;
      expect(result).toMatchObject({ status: 'error', reason: 'invalid_token_response' });
      expect(service.isAuthenticated()).toBe(false);
    });

    it('accepts a token response without optional fields', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ token_type: 'bearer', access_token: 'abc' });
      await nextTick();
      httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint).flush(PROFILE_RESPONSE);

      await expect(pending).resolves.toEqual({ status: 'success' });
      expect(service.getSession()).toEqual({
        accessToken: 'abc',
        tokenType: 'bearer',
        refreshToken: null,
        expiresAt: null,
        user: EXPECTED_USER,
      });
    });
  });

  describe('transaction reuse', () => {
    it('sends a single token request when the same callback is processed twice concurrently', async () => {
      storeTransaction();

      const first = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      const second = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });

      await flushSignIn();

      await expect(first).resolves.toEqual({ status: 'success' });
      await expect(second).resolves.toEqual({ status: 'success' });
    });

    it('refuses to exchange the same transaction a second time after it completed', async () => {
      storeTransaction();

      const first = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn();
      await first;

      const second = await service.handleCallback({ code: VALID_CODE, state: VALID_STATE });

      expect(second).toMatchObject({ status: 'error', reason: 'transaction_missing' });
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
      // The first, successful exchange is not undone by the duplicate.
      expect(service.isAuthenticated()).toBe(true);
    });

    it('refuses to retry a failed exchange with the same transaction', async () => {
      storeTransaction();

      const first = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).error(new ProgressEvent('error'));
      await first;

      const second = await service.handleCallback({ code: VALID_CODE, state: VALID_STATE });

      expect(second).toMatchObject({ status: 'error', reason: 'transaction_missing' });
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
    });
  });

  describe('logging', () => {
    const secrets = [VALID_CODE, VALID_VERIFIER, TOKEN_RESPONSE.access_token, TOKEN_RESPONSE.refresh_token];

    const loggedText = (): string =>
      consoleSpies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map((arg: unknown) => JSON.stringify(arg) ?? String(arg)).join(' '))
        .join('\n');

    it('never writes codes, verifiers or tokens to the console on success', async () => {
      await service.createAuthorizationUrl();
      const verifier = storedTransaction()!.codeVerifier;
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn();
      await pending;

      const text = loggedText();
      for (const secret of [...secrets, verifier]) {
        expect(text).not.toContain(secret);
      }
    });

    it('never writes tokens to the console when restoring or refreshing a session', async () => {
      await service.createAuthorizationUrl();
      storeTransaction();
      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn();
      await pending;

      const reloaded = reloadedService();
      const refreshing = reloaded.refreshSession();
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({
          token_type: 'Bearer',
          access_token: 'renewed-token',
          refresh_token: 'renewed-refresh',
        });
      await refreshing;

      const text = loggedText();
      for (const secret of [...secrets, 'renewed-token', 'renewed-refresh']) {
        expect(text).not.toContain(secret);
      }
    });

    it('never writes codes or verifiers to the console on failure', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' });
      await pending;
      await service.handleCallback({ code: VALID_CODE, state: 'bad state!' });

      const text = loggedText();
      for (const secret of secrets) {
        expect(text).not.toContain(secret);
      }
    });
  });

  describe('session expiry', () => {
    it('is not expired without a session', () => {
      expect(service.isSessionExpired()).toBe(false);
    });

    it('dates the expiry from the moment the token response was received', async () => {
      storeTransaction();
      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      clock.advance(2_500); // the token endpoint takes a while to answer
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).flush(TOKEN_RESPONSE);
      await nextTick();
      httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint).flush(PROFILE_RESPONSE);
      await pending;

      expect(service.getSession()!.expiresAt).toBe(NOW + 2_500 + 3_600_000);
    });

    it('flips exactly at the announced expiry instant', async () => {
      await signIn();
      const expiresAt = service.getSession()!.expiresAt!;
      expect(expiresAt).toBe(NOW + 3_600_000);

      clock.set(expiresAt - 1);
      expect(service.isSessionExpired()).toBe(false);
      clock.set(expiresAt);
      expect(service.isSessionExpired()).toBe(true);
      clock.set(expiresAt + 1);
      expect(service.isSessionExpired()).toBe(true);
    });

    it('treats expires_in of zero as already expired', async () => {
      storeTransaction();
      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'abc', expires_in: 0 });
      await nextTick();
      httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint).flush(PROFILE_RESPONSE);
      await pending;

      expect(service.isAuthenticated()).toBe(true);
      expect(service.getSession()!.expiresAt).toBe(NOW);
      expect(service.isSessionExpired()).toBe(true);
    });

    it('never expires a session whose server did not announce an expiry', async () => {
      storeTransaction();
      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'abc' });
      await nextTick();
      httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint).flush(PROFILE_RESPONSE);
      await pending;

      clock.set(Number.MAX_SAFE_INTEGER);
      expect(service.isSessionExpired()).toBe(false);
    });

    it('clearSession forgets the session locally without contacting the server', async () => {
      await signIn();
      storeTransaction();

      service.clearSession();

      httpTesting.expectNone(() => true);
      expect(service.isAuthenticated()).toBe(false);
      expect(service.user()).toBeNull();
      expect(storedTransaction()).toBeNull();
    });
  });

  describe('session persistence', () => {
    it('stores the session in sessionStorage on success, never in localStorage', async () => {
      await signIn();

      expect(storedSession()).toEqual(service.getSession());
      expect(storedSession()!.accessToken).toBe(TOKEN_RESPONSE.access_token);
      expect(storedSession()!.user).toEqual(EXPECTED_USER);
      expect(localStorage.length).toBe(0);
    });

    it('stores nothing while the exchange is pending or after it fails', async () => {
      storeTransaction();

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).flush(TOKEN_RESPONSE);
      await nextTick();
      expect(storedSession()).toBeNull();
      httpTesting
        .expectOne(TEST_CONFIG.userInfoEndpoint)
        .flush({ message: 'nope' }, { status: 500, statusText: 'Internal Server Error' });
      await pending;

      expect(storedSession()).toBeNull();
    });

    it('restores the session when the service is created again (tab reload)', async () => {
      await signIn();

      const reloaded = reloadedService();

      expect(reloaded.isAuthenticated()).toBe(true);
      expect(reloaded.user()).toEqual(EXPECTED_USER);
      expect(reloaded.getAccessToken()).toBe(TOKEN_RESPONSE.access_token);
      expect(reloaded.getSession()).toEqual(service.getSession());
      httpTesting.expectNone(() => true);
    });

    it('starts signed out when the stored session expired without a refresh token', async () => {
      sessionStorage.setItem(
        TEST_CONFIG.sessionStorageKey,
        JSON.stringify({
          ...(await signedInSession()),
          expiresAt: NOW - 1,
          refreshToken: null,
        }),
      );

      const reloaded = reloadedService();

      expect(reloaded.isAuthenticated()).toBe(false);
      expect(storedSession()).toBeNull();
    });

    it('restores an expired session that has a refresh token so it can be renewed', async () => {
      const expiresAt = NOW - 1;
      sessionStorage.setItem(
        TEST_CONFIG.sessionStorageKey,
        JSON.stringify({ ...(await signedInSession()), expiresAt }),
      );

      const reloaded = reloadedService();

      expect(reloaded.isAuthenticated()).toBe(true);
      expect(reloaded.isSessionExpired()).toBe(true);
      const refreshing = reloaded.refreshSession();
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'renewed', expires_in: 60 });
      await expect(refreshing).resolves.toBe(true);
      expect(reloaded.isSessionExpired()).toBe(false);
    });

    it('starts signed out when the stored session is unreadable, and removes it', () => {
      sessionStorage.setItem(TEST_CONFIG.sessionStorageKey, '{"accessToken":"x"');

      const reloaded = reloadedService();

      expect(reloaded.isAuthenticated()).toBe(false);
      expect(storedSession()).toBeNull();
    });

    it('starts signed out when the stored session lacks a user profile', () => {
      sessionStorage.setItem(
        TEST_CONFIG.sessionStorageKey,
        JSON.stringify({
          accessToken: 'abc',
          tokenType: 'Bearer',
          refreshToken: null,
          expiresAt: null,
        }),
      );

      const reloaded = reloadedService();

      expect(reloaded.isAuthenticated()).toBe(false);
      expect(reloaded.user()).toBeNull();
    });

    it('still signs the user in for the current page when storage refuses to save', async () => {
      storeTransaction();
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('QuotaExceededError');
      });

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn();

      await expect(pending).resolves.toEqual({ status: 'success' });
      expect(service.isAuthenticated()).toBe(true);
    });

    it('removes the stored session on clearSession', async () => {
      await signIn();

      service.clearSession();

      expect(storedSession()).toBeNull();
      expect(reloadedService().isAuthenticated()).toBe(false);
    });

    it('reports the return URL of the transaction on success', async () => {
      storeTransaction({ returnUrl: '/tenants' });

      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn();

      await expect(pending).resolves.toEqual({ status: 'success', returnUrl: '/tenants' });
    });

    /** The session a normal sign-in produces, for building stored variants. */
    async function signedInSession(): Promise<AuthSession> {
      await signIn();
      const session = service.getSession()!;
      service.clearSession();
      return session;
    }
  });

  describe('refresh', () => {
    const refreshBody = (request: { request: { body: unknown } }): URLSearchParams =>
      new URLSearchParams(request.request.body as string);

    it('does nothing without a session or without a refresh token', async () => {
      await expect(service.refreshSession()).resolves.toBe(false);

      storeTransaction();
      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'abc', expires_in: 1 });
      await nextTick();
      httpTesting.expectOne(TEST_CONFIG.userInfoEndpoint).flush(PROFILE_RESPONSE);
      await pending;

      await expect(service.refreshSession()).resolves.toBe(false);
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
      expect(service.isAuthenticated()).toBe(true);
    });

    it('sends the refresh grant of a public client: no secret, no bearer header', async () => {
      await signIn();
      const before = service.getSession()!;

      const refreshing = service.refreshSession();
      const request = httpTesting.expectOne(TEST_CONFIG.tokenEndpoint);

      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
      expect(request.request.headers.get('Accept')).toBe('application/json');
      expect(request.request.headers.has('Authorization')).toBe(false);
      const body = refreshBody(request);
      expect(body.get('grant_type')).toBe('refresh_token');
      expect(body.get('refresh_token')).toBe(TOKEN_RESPONSE.refresh_token);
      expect(body.get('client_id')).toBe(TEST_CONFIG.clientId);
      expect(body.has('client_secret')).toBe(false);
      expect(body.has('scope')).toBe(false);
      expect(Array.from(body.keys()).sort()).toEqual(['client_id', 'grant_type', 'refresh_token']);

      request.flush({
        token_type: 'Bearer',
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 7200,
      });
      await expect(refreshing).resolves.toBe(true);

      const after = service.getSession()!;
      expect(after.accessToken).toBe('new-access-token');
      expect(after.refreshToken).toBe('new-refresh-token');
      expect(after.expiresAt).toBeGreaterThan(before.expiresAt!);
      expect(after.user).toEqual(EXPECTED_USER);
      expect(storedSession()).toEqual(after);
      httpTesting.expectNone(TEST_CONFIG.userInfoEndpoint);
    });

    it('repeats the configured scope when there is one', async () => {
      TestBed.resetTestingModule();
      TestBed.configureTestingModule({
        providers: [
          provideHttpClient(),
          provideHttpClientTesting(),
          { provide: AUTH_CONFIG, useValue: { ...TEST_CONFIG, scope: 'read write' } },
          { provide: EXTERNAL_REDIRECT, useValue: (url: string) => redirect(url) },
          { provide: CLOCK, useValue: clock },
        ],
      });
      service = TestBed.inject(AuthService);
      httpTesting = TestBed.inject(HttpTestingController);
      await signIn();

      const refreshing = service.refreshSession();
      const request = httpTesting.expectOne(TEST_CONFIG.tokenEndpoint);
      expect(refreshBody(request).get('scope')).toBe('read write');
      request.flush({ token_type: 'Bearer', access_token: 'new-access-token', expires_in: 60 });
      await refreshing;
    });

    it('replaces the stored refresh token with the rotated one', async () => {
      await signIn();

      const refreshing = service.refreshSession();
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).flush({
        token_type: 'Bearer',
        access_token: 'new-access-token',
        refresh_token: 'rotated-refresh-token',
        expires_in: 60,
      });
      await refreshing;

      expect(service.getSession()!.refreshToken).toBe('rotated-refresh-token');
      expect(storedSession()!.refreshToken).toBe('rotated-refresh-token');

      // The next refresh uses the rotated token, never the old one.
      const again = service.refreshSession();
      const request = httpTesting.expectOne(TEST_CONFIG.tokenEndpoint);
      expect(refreshBody(request).get('refresh_token')).toBe('rotated-refresh-token');
      request.flush({ token_type: 'Bearer', access_token: 'third-token', expires_in: 60 });
      await again;
    });

    it('keeps the previous refresh token when the server does not rotate it', async () => {
      await signIn();

      const refreshing = service.refreshSession();
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'new-access-token', expires_in: 60 });
      await refreshing;

      expect(service.getSession()!.refreshToken).toBe(TOKEN_RESPONSE.refresh_token);
    });

    it('shares one request between concurrent callers', async () => {
      await signIn();

      const first = service.refreshSession();
      const second = service.refreshSession();
      const third = service.refreshSession();
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'new-access-token', expires_in: 60 });

      await expect(Promise.all([first, second, third])).resolves.toEqual([true, true, true]);
      httpTesting.expectNone(TEST_CONFIG.tokenEndpoint);
      expect(service.getAccessToken()).toBe('new-access-token');

      // Once settled, a new call starts a new request.
      const later = service.refreshSession();
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ token_type: 'Bearer', access_token: 'later-token', expires_in: 60 });
      await expect(later).resolves.toBe(true);
    });

    it('shares one failed request between concurrent callers', async () => {
      await signIn();

      const first = service.refreshSession();
      const second = service.refreshSession();
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' });

      await expect(Promise.all([first, second])).resolves.toEqual([false, false]);
      expect(service.isAuthenticated()).toBe(false);
    });

    it('signs the user out when the server refuses the refresh token', async () => {
      await signIn();

      const refreshing = service.refreshSession();
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush({ error: 'invalid_grant' }, { status: 400, statusText: 'Bad Request' });

      await expect(refreshing).resolves.toBe(false);
      expect(service.isAuthenticated()).toBe(false);
      expect(storedSession()).toBeNull();
    });

    it.each([401, 403, 500])('signs the user out when the refresh answers %s', async (code) => {
      await signIn();

      const refreshing = service.refreshSession();
      httpTesting
        .expectOne(TEST_CONFIG.tokenEndpoint)
        .flush(null, { status: code, statusText: 'Error' });

      await expect(refreshing).resolves.toBe(false);
      expect(service.isAuthenticated()).toBe(false);
      expect(storedSession()).toBeNull();
    });

    it('signs the user out when the server cannot be reached', async () => {
      await signIn();

      const refreshing = service.refreshSession();
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).error(new ProgressEvent('error'));

      await expect(refreshing).resolves.toBe(false);
      expect(service.isAuthenticated()).toBe(false);
      expect(storedSession()).toBeNull();
    });

    it('signs the user out when the response is not a token response', async () => {
      await signIn();

      const refreshing = service.refreshSession();
      httpTesting.expectOne(TEST_CONFIG.tokenEndpoint).flush({ token_type: 'MAC' });

      await expect(refreshing).resolves.toBe(false);
      expect(service.isAuthenticated()).toBe(false);
      expect(storedSession()).toBeNull();
    });

    it('does not use a second refresh token while a refresh is already in flight', async () => {
      await signIn();

      void service.refreshSession();
      void service.refreshSession();

      const requests = httpTesting.match(TEST_CONFIG.tokenEndpoint);
      expect(requests).toHaveLength(1);
      requests[0].flush({ token_type: 'Bearer', access_token: 'x' });
    });
  });

  describe('logout', () => {
    it('revokes the token with the configured method, the encoded username and the bearer token', async () => {
      storeTransaction();
      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn({ username: 'jane doe@example.test', name: 'Jane' });
      await pending;

      const logout = service.logout();
      const request = httpTesting.expectOne(
        `${TEST_CONFIG.logoutEndpoint}/jane%20doe%40example.test`,
      );

      expect(request.request.method).toBe('POST');
      expect(request.request.headers.get('Authorization')).toBe(
        `Bearer ${TOKEN_RESPONSE.access_token}`,
      );
      expect(request.request.headers.get('Accept')).toBe('application/json');

      request.flush(null, { status: 204, statusText: 'No Content' });
      await expect(logout).resolves.toEqual({ status: 'success' });
    });

    it('keeps the full identifier in the logout URL even though only the username is displayed', async () => {
      storeTransaction();
      const pending = service.handleCallback({ code: VALID_CODE, state: VALID_STATE });
      await flushSignIn({ username: 'jane@550e8400-e29b-41d4-a716-446655440000' });
      await pending;
      expect(service.user()?.displayName).toBe('jane');

      const logout = service.logout();
      httpTesting
        .expectOne(`${TEST_CONFIG.logoutEndpoint}/jane%40550e8400-e29b-41d4-a716-446655440000`)
        .flush(null, { status: 204, statusText: 'No Content' });
      await expect(logout).resolves.toEqual({ status: 'success' });
    });

    it('clears the session and the pending transaction only after the server confirmed', async () => {
      await signIn();
      storeTransaction();

      const logout = service.logout();
      expect(service.isAuthenticated()).toBe(true);

      expect(storedSession()).not.toBeNull();
      httpTesting.expectOne(`${TEST_CONFIG.logoutEndpoint}/jane.doe`).flush({ revoked: true });
      await logout;

      expect(service.isAuthenticated()).toBe(false);
      expect(service.getAccessToken()).toBeNull();
      expect(service.user()).toBeNull();
      expect(storedTransaction()).toBeNull();
      expect(storedSession()).toBeNull();
    });

    it('keeps the session and explains when the server rejects the revocation', async () => {
      await signIn();

      const logout = service.logout();
      httpTesting
        .expectOne(`${TEST_CONFIG.logoutEndpoint}/jane.doe`)
        .flush({ message: 'Server error' }, { status: 500, statusText: 'Internal Server Error' });

      const result = await logout;
      expect(result.status).toBe('error');
      expect((result as { message: string }).message).toMatch(/still signed in/i);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.user()).toEqual(EXPECTED_USER);
      // The stored copy is kept too, so a reload does not silently sign the user out.
      expect(storedSession()).toEqual(service.getSession());
    });

    it('keeps the session untouched and explains when the server answers 401', async () => {
      await signIn();
      const before = service.getSession()!;

      const logout = service.logout();
      httpTesting
        .expectOne(`${TEST_CONFIG.logoutEndpoint}/jane.doe`)
        .flush({ message: 'Unauthenticated.' }, { status: 401, statusText: 'Unauthorized' });

      const result = await logout;
      expect(result.status).toBe('error');
      expect((result as { message: string }).message).toMatch(/not revoked/i);
      expect((result as { message: string }).message).toMatch(/still signed in/i);
      expect(service.isAuthenticated()).toBe(true);
      expect(service.getSession()).toEqual(before);
      expect(storedSession()).toEqual(before);
    });

    it('does not revive an expired session when its revocation is refused', async () => {
      await signIn();
      const expiresAt = service.getSession()!.expiresAt!;
      clock.set(expiresAt + 1);
      expect(service.isSessionExpired()).toBe(true);

      const logout = service.logout();
      httpTesting
        .expectOne(`${TEST_CONFIG.logoutEndpoint}/jane.doe`)
        .flush(null, { status: 401, statusText: 'Unauthorized' });
      await expect(logout).resolves.toMatchObject({ status: 'error' });

      expect(service.isAuthenticated()).toBe(true);
      expect(service.isSessionExpired()).toBe(true);
      expect(service.getSession()!.expiresAt).toBe(expiresAt);
      expect(storedSession()!.expiresAt).toBe(expiresAt);
    });

    it('keeps the session and explains when the server cannot be reached', async () => {
      await signIn();

      const logout = service.logout();
      httpTesting
        .expectOne(`${TEST_CONFIG.logoutEndpoint}/jane.doe`)
        .error(new ProgressEvent('error'));

      const result = await logout;
      expect(result).toMatchObject({ status: 'error' });
      expect((result as { message: string }).message).toMatch(/could not be reached/i);
      expect(service.isAuthenticated()).toBe(true);
    });

    it('succeeds without any request when nobody is signed in', async () => {
      storeTransaction();

      await expect(service.logout()).resolves.toEqual({ status: 'success' });

      httpTesting.expectNone(() => true);
      expect(storedTransaction()).toBeNull();
    });

    it('never writes the token to the console during logout', async () => {
      await signIn();

      const logout = service.logout();
      httpTesting
        .expectOne(`${TEST_CONFIG.logoutEndpoint}/jane.doe`)
        .flush({ message: 'nope' }, { status: 500, statusText: 'Internal Server Error' });
      await logout;

      const text = consoleSpies
        .flatMap((spy) => spy.mock.calls)
        .map((args) => args.map((arg: unknown) => JSON.stringify(arg) ?? String(arg)).join(' '))
        .join('\n');
      expect(text).not.toContain(TOKEN_RESPONSE.access_token);
    });
  });
});
