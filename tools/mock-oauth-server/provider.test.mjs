/**
 * Rules of the local OAuth test provider, tested directly (no HTTP).
 *
 *   node --test tools/mock-oauth-server/
 */

import assert from 'node:assert/strict';
import { beforeEach, describe, it } from 'node:test';

import { DEMO_CLIENT, DEMO_TENANTS, DEMO_USERS } from './fixtures.mjs';
import { NETWORK_FAILURE, createProvider, s256Challenge } from './provider.mjs';

/** Same verifier/challenge pair as RFC 7636, appendix B. */
const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'c2VjcmV0LXN0YXRlLXZhbHVlLTEyMzQ1Ng';
const NOW = 1_700_000_000_000;
const REDIRECT_URI = DEMO_CLIENT.redirectUris[0];
const ROSE = DEMO_USERS[0];
const AICHA = DEMO_USERS[1];

const authorizeRequest = (overrides = {}) => ({
  response_type: 'code',
  client_id: DEMO_CLIENT.id,
  redirect_uri: REDIRECT_URI,
  scope: '',
  state: STATE,
  code_challenge: CHALLENGE,
  code_challenge_method: 'S256',
  ...overrides,
});

const exchangeRequest = (code, overrides = {}) => ({
  grant_type: 'authorization_code',
  client_id: DEMO_CLIENT.id,
  redirect_uri: REDIRECT_URI,
  code,
  code_verifier: VERIFIER,
  ...overrides,
});

const paramsOf = (location) => Object.fromEntries(new URL(location).searchParams);
const originOf = (location) => new URL(location).origin + new URL(location).pathname;

describe('local OAuth test provider', () => {
  let clock;
  let provider;

  /** Runs a successful authorization and returns the code. */
  const issueCode = (decision = {}, request = {}) => {
    const result = provider.authorize(authorizeRequest(request), {
      approve: true,
      username: ROSE.username,
      ...decision,
    });
    assert.equal(result.kind, 'redirect');
    return paramsOf(result.location).code;
  };

  /** Full sign-in: returns the token response body. */
  const signIn = (decision = {}) => {
    const result = provider.token(exchangeRequest(issueCode(decision)));
    assert.equal(result.status, 200, JSON.stringify(result.body));
    return result.body;
  };
  const bearer = (tokens) => `Bearer ${tokens.access_token}`;

  beforeEach(() => {
    clock = NOW;
    provider = createProvider({
      clients: [DEMO_CLIENT],
      users: DEMO_USERS,
      tenants: DEMO_TENANTS,
      issuer: 'http://localhost:9001',
      now: () => clock,
      codeTtlSeconds: 60,
      accessTokenTtlSeconds: 300,
      refreshTokenTtlSeconds: 3600,
    });
  });

  describe('S256 helper', () => {
    it('matches the RFC 7636 appendix B example', () => {
      assert.equal(s256Challenge(VERIFIER), CHALLENGE);
    });
  });

  describe('authorization request validation', () => {
    it('accepts the request the Angular client builds', () => {
      const result = provider.validateAuthorizationRequest(authorizeRequest());
      assert.equal(result.kind, 'ok');
      assert.equal(result.client.id, DEMO_CLIENT.id);
      assert.deepEqual(result.request, {
        clientId: DEMO_CLIENT.id,
        redirectUri: REDIRECT_URI,
        state: STATE,
        codeChallenge: CHALLENGE,
        scope: '',
      });
    });

    it('refuses an unknown client without redirecting', () => {
      const result = provider.validateAuthorizationRequest(
        authorizeRequest({ client_id: 'not-registered' }),
      );
      assert.equal(result.kind, 'invalid');
      assert.equal(result.error, 'invalid_client');
    });

    it('refuses a missing client id without redirecting', () => {
      const result = provider.validateAuthorizationRequest(authorizeRequest({ client_id: undefined }));
      assert.equal(result.kind, 'invalid');
      assert.equal(result.error, 'invalid_client');
    });

    it('refuses an unregistered redirect URI without redirecting', () => {
      for (const redirectUri of [
        'http://localhost:4200/oauth/callback/',
        'http://localhost:4200/oauth/callback?x=1',
        'https://localhost:4200/oauth/callback',
        'http://evil.test/oauth/callback',
        undefined,
      ]) {
        const result = provider.validateAuthorizationRequest(
          authorizeRequest({ redirect_uri: redirectUri }),
        );
        assert.equal(result.kind, 'invalid', String(redirectUri));
        assert.equal(result.error, 'invalid_redirect_uri');
      }
    });

    it('reports an unsupported response type through the redirect URI, with the state', () => {
      const result = provider.validateAuthorizationRequest(authorizeRequest({ response_type: 'token' }));
      assert.equal(result.kind, 'redirect');
      assert.equal(originOf(result.location), REDIRECT_URI);
      const params = paramsOf(result.location);
      assert.equal(params.error, 'unsupported_response_type');
      assert.equal(params.state, STATE);
      assert.equal(params.code, undefined);
    });

    it('requires PKCE with the S256 method', () => {
      for (const overrides of [
        { code_challenge_method: 'plain' },
        { code_challenge_method: undefined },
        { code_challenge: undefined },
        { code_challenge: 'too-short' },
        { code_challenge: `${CHALLENGE}=` },
      ]) {
        const result = provider.validateAuthorizationRequest(authorizeRequest(overrides));
        assert.equal(result.kind, 'redirect', JSON.stringify(overrides));
        assert.equal(paramsOf(result.location).error, 'invalid_request');
        assert.equal(paramsOf(result.location).state, STATE);
      }
    });

    it('accepts a request without state', () => {
      const result = provider.validateAuthorizationRequest(authorizeRequest({ state: undefined }));
      assert.equal(result.kind, 'ok');
      assert.equal(result.request.state, null);
    });
  });

  describe('authorization decision', () => {
    it('redirects with a fresh code and the unchanged state on approval', () => {
      const result = provider.authorize(authorizeRequest(), { approve: true, username: ROSE.username });
      assert.equal(result.kind, 'redirect');
      assert.equal(originOf(result.location), REDIRECT_URI);
      const params = paramsOf(result.location);
      assert.match(params.code, /^[0-9a-f]{64}$/);
      assert.equal(params.state, STATE);
      assert.equal(params.error, undefined);
      assert.equal(provider.snapshot().pendingCodes, 1);
    });

    it('issues a different code every time', () => {
      assert.notEqual(issueCode(), issueCode());
    });

    it('redirects with access_denied and the state on denial, without issuing a code', () => {
      const result = provider.authorize(authorizeRequest(), { approve: false });
      assert.equal(result.kind, 'redirect');
      const params = paramsOf(result.location);
      assert.equal(params.error, 'access_denied');
      assert.equal(params.state, STATE);
      assert.equal(params.code, undefined);
      assert.equal(provider.snapshot().pendingCodes, 0);
    });

    it('re-validates the request before recording a decision', () => {
      const result = provider.authorize(authorizeRequest({ redirect_uri: 'http://evil.test/cb' }), {
        approve: true,
        username: ROSE.username,
      });
      assert.equal(result.kind, 'invalid');
      assert.equal(result.error, 'invalid_redirect_uri');
      assert.equal(provider.snapshot().pendingCodes, 0);
    });

    it('refuses an account that is not in the fixtures', () => {
      const result = provider.authorize(authorizeRequest(), { approve: true, username: 'nobody' });
      assert.equal(result.kind, 'invalid');
      assert.equal(result.error, 'unknown_user');
    });

    it('refuses an unknown token-error scenario', () => {
      const result = provider.authorize(authorizeRequest(), {
        approve: true,
        username: ROSE.username,
        tokenError: 'explode',
      });
      assert.equal(result.kind, 'invalid');
      assert.equal(result.error, 'unknown_scenario');
    });
  });

  describe('authorization code exchange', () => {
    it('issues bearer tokens the Angular client accepts when the verifier matches', () => {
      const result = provider.token(exchangeRequest(issueCode()));
      assert.equal(result.kind, 'response');
      assert.equal(result.status, 200);
      assert.equal(result.body.token_type, 'Bearer');
      assert.equal(result.body.expires_in, 300);
      assert.match(result.body.access_token, /^[0-9a-f]{64}$/);
      assert.match(result.body.refresh_token, /^[0-9a-f]{64}$/);
      assert.equal('scope' in result.body, false);
    });

    it('echoes a non-empty scope', () => {
      const code = issueCode({}, { scope: 'profile tenants' });
      assert.equal(provider.token(exchangeRequest(code)).body.scope, 'profile tenants');
    });

    it('rejects a wrong code verifier (S256 check)', () => {
      const wrongVerifier = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
      const result = provider.token(exchangeRequest(issueCode(), { code_verifier: wrongVerifier }));
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'invalid_grant');
      assert.equal(provider.snapshot().accessTokens, 0);
    });

    it('rejects a verifier with an invalid syntax', () => {
      for (const verifier of ['short', `${VERIFIER}!`, 'x'.repeat(129)]) {
        const result = provider.token(exchangeRequest(issueCode(), { code_verifier: verifier }));
        assert.equal(result.body.error, 'invalid_grant', verifier);
      }
    });

    it('requires a verifier', () => {
      const result = provider.token(exchangeRequest(issueCode(), { code_verifier: undefined }));
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'invalid_request');
    });

    it('accepts an authorization code only once', () => {
      const code = issueCode();
      const first = provider.token(exchangeRequest(code));
      assert.equal(first.status, 200);

      const second = provider.token(exchangeRequest(code));
      assert.equal(second.status, 400);
      assert.equal(second.body.error, 'invalid_grant');
    });

    it('revokes the tokens issued from a code that is replayed', () => {
      const code = issueCode();
      const tokens = provider.token(exchangeRequest(code)).body;
      assert.equal(provider.userInfo(bearer(tokens)).status, 200);

      provider.token(exchangeRequest(code));
      assert.equal(provider.userInfo(bearer(tokens)).status, 401);
      assert.equal(
        provider.token({
          grant_type: 'refresh_token',
          client_id: DEMO_CLIENT.id,
          refresh_token: tokens.refresh_token,
        }).body.error,
        'invalid_grant',
      );
    });

    it('consumes the code even when the first exchange attempt fails', () => {
      const code = issueCode();
      const failed = provider.token(exchangeRequest(code, { code_verifier: 'x'.repeat(43) }));
      assert.equal(failed.body.error, 'invalid_grant');

      const retried = provider.token(exchangeRequest(code));
      assert.equal(retried.body.error, 'invalid_grant');
      assert.equal(provider.snapshot().accessTokens, 0);
    });

    it('rejects an expired code', () => {
      const code = issueCode();
      clock += 60_000;
      const result = provider.token(exchangeRequest(code));
      assert.equal(result.body.error, 'invalid_grant');
    });

    it('accepts a code up to the last millisecond of its lifetime', () => {
      const code = issueCode();
      clock += 59_999;
      assert.equal(provider.token(exchangeRequest(code)).status, 200);
    });

    it('rejects an unknown code', () => {
      const result = provider.token(exchangeRequest('0'.repeat(64)));
      assert.equal(result.body.error, 'invalid_grant');
    });

    it('rejects a redirect URI that differs from the authorization request', () => {
      const result = provider.token(
        exchangeRequest(issueCode(), { redirect_uri: 'http://localhost:4200/oauth/callback/' }),
      );
      assert.equal(result.body.error, 'invalid_grant');
    });

    it('rejects an unknown client with 401 invalid_client', () => {
      const result = provider.token(exchangeRequest(issueCode(), { client_id: 'someone-else' }));
      assert.equal(result.status, 401);
      assert.equal(result.body.error, 'invalid_client');
    });

    it('rejects a code presented by another registered client', () => {
      const other = { id: 'other-client', name: 'Other', redirectUris: [REDIRECT_URI] };
      provider = createProvider({
        clients: [DEMO_CLIENT, other],
        users: DEMO_USERS,
        tenants: DEMO_TENANTS,
        now: () => clock,
      });
      const result = provider.token(exchangeRequest(issueCode(), { client_id: other.id }));
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'invalid_grant');
    });

    it('reports missing and unsupported grant types', () => {
      const base = { client_id: DEMO_CLIENT.id };
      assert.equal(provider.token(base).body.error, 'invalid_request');
      assert.equal(
        provider.token({ ...base, grant_type: 'password' }).body.error,
        'unsupported_grant_type',
      );
    });

    it('never needs a client secret', () => {
      const result = provider.token(exchangeRequest(issueCode(), { client_secret: 'anything' }));
      assert.equal(result.status, 200);
    });
  });

  describe('controlled token-error scenario', () => {
    it('fails the exchange with the error chosen on the authorization page, consuming the code', () => {
      const code = issueCode({ tokenError: 'invalid_grant' });
      const result = provider.token(exchangeRequest(code));
      assert.equal(result.kind, 'response');
      assert.equal(result.status, 400);
      assert.deepEqual(Object.keys(result.body).sort(), ['error', 'error_description']);
      assert.equal(result.body.error, 'invalid_grant');
      assert.equal(provider.snapshot().accessTokens, 0);

      assert.equal(provider.token(exchangeRequest(code)).body.error, 'invalid_grant');
      assert.equal(provider.snapshot().pendingCodes, 0);
    });

    it('maps each scenario to the matching HTTP status', () => {
      const expectations = {
        invalid_request: 400,
        invalid_client: 401,
        invalid_grant: 400,
        server_error: 500,
        temporarily_unavailable: 503,
      };
      for (const [error, status] of Object.entries(expectations)) {
        const result = provider.token(exchangeRequest(issueCode({ tokenError: error })));
        assert.equal(result.status, status, error);
        assert.equal(result.body.error, error);
      }
    });

    it('only fails when the S256 check passed, so the scenario cannot mask a PKCE bug', () => {
      const code = issueCode({ tokenError: 'server_error' });
      const result = provider.token(exchangeRequest(code, { code_verifier: 'x'.repeat(43) }));
      assert.equal(result.status, 400);
      assert.equal(result.body.error, 'invalid_grant');
    });

    it('asks the transport to drop the connection for the network-failure scenario', () => {
      const result = provider.token(exchangeRequest(issueCode({ tokenError: NETWORK_FAILURE })));
      assert.deepEqual(result, { kind: 'network_failure' });
    });

    it('fails the next N token requests when armed globally, then recovers', () => {
      const tokens = signIn();
      provider.setTokenError('temporarily_unavailable', 2);
      // The armed failure also hits refreshes, which is what the demo needs.
      const refresh = {
        grant_type: 'refresh_token',
        client_id: DEMO_CLIENT.id,
        refresh_token: tokens.refresh_token,
      };
      assert.equal(provider.token(refresh).status, 503);
      assert.equal(provider.token(refresh).status, 503);
      assert.equal(provider.snapshot().scenario.tokenError, null);
      assert.equal(provider.token(refresh).status, 200);
    });

    it('refuses to arm an unknown scenario and can be disarmed', () => {
      assert.throws(() => provider.setTokenError('kaboom'), RangeError);
      provider.setTokenError('server_error', 3);
      provider.setTokenError(null);
      assert.equal(provider.snapshot().scenario.tokenError, null);
      assert.equal(provider.token(exchangeRequest(issueCode())).status, 200);
    });
  });

  describe('refresh grant', () => {
    const refreshRequest = (tokens, overrides = {}) => ({
      grant_type: 'refresh_token',
      client_id: DEMO_CLIENT.id,
      refresh_token: tokens.refresh_token,
      ...overrides,
    });

    it('issues a new access token and rotates the refresh token', () => {
      const tokens = signIn();
      const renewed = provider.token(refreshRequest(tokens));
      assert.equal(renewed.status, 200);
      assert.equal(renewed.body.token_type, 'Bearer');
      assert.notEqual(renewed.body.access_token, tokens.access_token);
      assert.notEqual(renewed.body.refresh_token, tokens.refresh_token);
      assert.equal(provider.userInfo(bearer(renewed.body)).status, 200);
    });

    it('retires the presented refresh token', () => {
      const tokens = signIn();
      provider.token(refreshRequest(tokens));
      assert.equal(provider.token(refreshRequest(tokens)).body.error, 'invalid_grant');
    });

    it('rejects an unknown refresh token and a foreign client', () => {
      const tokens = signIn();
      assert.equal(
        provider.token(refreshRequest(tokens, { refresh_token: 'f'.repeat(64) })).body.error,
        'invalid_grant',
      );
      assert.equal(
        provider.token(refreshRequest(tokens, { client_id: 'someone-else' })).body.error,
        'invalid_client',
      );
    });

    it('rejects an expired refresh token', () => {
      const tokens = signIn();
      clock += 3_600_000;
      assert.equal(provider.token(refreshRequest(tokens)).body.error, 'invalid_grant');
    });

    it('keeps working after the access tokens were revoked by the demo control', () => {
      const tokens = signIn();
      provider.revokeAccessTokens();
      assert.equal(provider.userInfo(bearer(tokens)).status, 401);
      assert.equal(provider.token(refreshRequest(tokens)).status, 200);
    });

    it('is refused after everything was revoked by the demo control', () => {
      const tokens = signIn();
      provider.revokeAllTokens();
      assert.equal(provider.token(refreshRequest(tokens)).body.error, 'invalid_grant');
    });
  });

  describe('user-info endpoint', () => {
    it('returns the profile shape the Angular client parses', () => {
      const result = provider.userInfo(bearer(signIn()));
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, {
        id: ROSE.id,
        username: ROSE.username,
        email: ROSE.email,
        name: ROSE.name,
        photo_url: 'http://localhost:9001/images/avatars/rose-eyenga.svg',
      });
    });

    it('omits name and photo for the account that has none', () => {
      const result = provider.userInfo(bearer(signIn({ username: AICHA.username })));
      assert.equal(result.status, 200);
      assert.equal('name' in result.body, false);
      assert.equal('photo_url' in result.body, false);
      assert.equal(result.body.username, AICHA.username);
    });

    it('answers 401 with a WWW-Authenticate challenge for missing, unknown or expired tokens', () => {
      const tokens = signIn();
      for (const header of [undefined, '', 'Basic abc', 'Bearer', 'Bearer nope']) {
        const result = provider.userInfo(header);
        assert.equal(result.status, 401, String(header));
        assert.equal(result.body.error, 'invalid_token');
        assert.equal(result.headers['WWW-Authenticate'], 'Bearer error="invalid_token"');
      }
      clock += 300_000;
      assert.equal(provider.userInfo(bearer(tokens)).status, 401);
    });

    it('accepts a token until the last millisecond of its lifetime', () => {
      const tokens = signIn();
      clock += 299_999;
      assert.equal(provider.userInfo(bearer(tokens)).status, 200);
    });
  });

  describe('logout endpoint', () => {
    it('revokes the whole session of the token', () => {
      const tokens = signIn();
      const result = provider.logout(bearer(tokens), ROSE.username);
      assert.equal(result.status, 200);
      assert.equal(provider.userInfo(bearer(tokens)).status, 401);
      assert.equal(
        provider.token({
          grant_type: 'refresh_token',
          client_id: DEMO_CLIENT.id,
          refresh_token: tokens.refresh_token,
        }).body.error,
        'invalid_grant',
      );
    });

    it('leaves other sessions of the same user alone', () => {
      const first = signIn();
      const second = signIn();
      provider.logout(bearer(first), ROSE.username);
      assert.equal(provider.userInfo(bearer(second)).status, 200);
    });

    it('answers 401 for an invalid token and 403 for another user', () => {
      const tokens = signIn();
      assert.equal(provider.logout('Bearer nope', ROSE.username).status, 401);
      assert.equal(provider.logout(bearer(tokens), AICHA.username).status, 403);
      assert.equal(provider.userInfo(bearer(tokens)).status, 200);
    });

    it('answers 500 and keeps the session when the failure scenario is armed', () => {
      const tokens = signIn();
      provider.setLogoutFailure(true);
      const result = provider.logout(bearer(tokens), ROSE.username);
      assert.equal(result.status, 500);
      assert.equal(result.body.error, 'server_error');
      assert.equal(provider.userInfo(bearer(tokens)).status, 200);

      provider.setLogoutFailure(false);
      assert.equal(provider.logout(bearer(tokens), ROSE.username).status, 200);
    });
  });

  describe('tenant endpoint', () => {
    it("returns the user's own tenant in a data envelope", () => {
      const result = provider.tenant(bearer(signIn()), DEMO_TENANTS[0].id);
      assert.equal(result.status, 200);
      assert.deepEqual(result.body, { data: DEMO_TENANTS[0] });
    });

    it('matches the tenant id case-insensitively', () => {
      const result = provider.tenant(bearer(signIn()), DEMO_TENANTS[0].id.toUpperCase());
      assert.equal(result.status, 200);
    });

    it('answers 401, 403 and 404 as the client expects', () => {
      const tokens = signIn();
      assert.equal(provider.tenant('Bearer nope', DEMO_TENANTS[0].id).status, 401);
      assert.equal(provider.tenant(bearer(tokens), DEMO_TENANTS[1].id).status, 403);
      assert.equal(
        provider.tenant(bearer(tokens), '00000000-0000-4000-8000-000000000000').status,
        404,
      );
    });
  });

  describe('snapshot and reset', () => {
    it('never exposes token or code values', () => {
      const code = issueCode();
      const tokens = provider.token(exchangeRequest(code)).body;
      const serialized = JSON.stringify(provider.snapshot());
      assert.equal(serialized.includes(code), false);
      assert.equal(serialized.includes(tokens.access_token), false);
      assert.equal(serialized.includes(tokens.refresh_token), false);
    });

    it('reset forgets codes, tokens and scenarios', () => {
      issueCode();
      const tokens = signIn();
      provider.setLogoutFailure(true);
      provider.setTokenError('server_error', 5);
      provider.reset();
      assert.deepEqual(provider.snapshot(), {
        pendingCodes: 0,
        accessTokens: 0,
        refreshTokens: 0,
        scenario: { tokenError: null, failLogout: false },
        counters: { tokenRequests: 0, refreshes: 0, logouts: 0 },
      });
      assert.equal(provider.userInfo(bearer(tokens)).status, 401);
    });
  });
});
