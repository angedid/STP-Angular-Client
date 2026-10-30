/**
 * HTTP contract of the local OAuth test provider, exercised over a real
 * socket on an ephemeral port: what the browser and the Angular client see.
 *
 *   node --test tools/mock-oauth-server/
 */

import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, beforeEach, describe, it } from 'node:test';

import { DEMO_CLIENT, DEMO_TENANTS, DEMO_USERS } from './fixtures.mjs';
import { createRequestHandler } from './http.mjs';
import { NETWORK_FAILURE, createProvider } from './provider.mjs';

const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';
const STATE = 'c2VjcmV0LXN0YXRlLXZhbHVlLTEyMzQ1Ng';
const APP_ORIGIN = 'http://localhost:4200';
const REDIRECT_URI = DEMO_CLIENT.redirectUris[0];
const ROSE = DEMO_USERS[0];

const authorizeParams = (overrides = {}) =>
  new URLSearchParams({
    response_type: 'code',
    client_id: DEMO_CLIENT.id,
    redirect_uri: REDIRECT_URI,
    scope: '',
    state: STATE,
    code_challenge: CHALLENGE,
    code_challenge_method: 'S256',
    ...overrides,
  });

describe('local OAuth test provider over HTTP', () => {
  let server;
  let base;
  let provider;
  let logLines;

  const request = (path, init = {}) =>
    fetch(`${base}${path}`, { redirect: 'manual', ...init });

  /** Posts the sign-in form as the browser does and returns the callback URL. */
  const approve = async (extra = {}) => {
    const body = new URLSearchParams({
      ...Object.fromEntries(authorizeParams()),
      username: ROSE.username,
      decision: 'approve',
      token_error: '',
      ...extra,
    });
    const response = await request('/oauth/authorize', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    assert.equal(response.status, 303);
    return new URL(response.headers.get('location'));
  };

  /** Exchanges a code exactly as `AuthService.exchangeCode` does. */
  const exchange = (code, overrides = {}) =>
    request('/oauth/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
        Origin: APP_ORIGIN,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: DEMO_CLIENT.id,
        redirect_uri: REDIRECT_URI,
        code,
        code_verifier: VERIFIER,
        ...overrides,
      }),
    });

  const signIn = async () => {
    const callback = await approve();
    const response = await exchange(callback.searchParams.get('code'));
    assert.equal(response.status, 200);
    return response.json();
  };

  before(async () => {
    provider = createProvider({
      clients: [DEMO_CLIENT],
      users: DEMO_USERS,
      tenants: DEMO_TENANTS,
      issuer: 'http://localhost:9001',
    });
    logLines = [];
    server = createServer(
      createRequestHandler(provider, {
        allowedOrigins: [APP_ORIGIN],
        log: (line) => logLines.push(line),
      }),
    );
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
  });

  after(async () => {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  });

  beforeEach(() => {
    provider.reset();
    logLines.length = 0;
  });

  describe('authorization endpoint', () => {
    it('shows the sign-in page for a valid request, carrying the request in the form', async () => {
      const response = await request(`/oauth/authorize?${authorizeParams()}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^text\/html/);
      const html = await response.text();
      assert.match(html, /<form method="post" action="\/oauth\/authorize">/);
      assert.match(html, new RegExp(`name="state" value="${STATE}"`));
      assert.match(html, new RegExp(`name="code_challenge" value="${CHALLENGE}"`));
      assert.match(html, /name="decision" value="approve"/);
      assert.match(html, /name="decision" value="deny"/);
      for (const user of DEMO_USERS) {
        assert.ok(html.includes(`value="${user.username}"`), user.username);
      }
      assert.match(html, /name="token_error"/);
    });

    it('escapes request values when echoing them into the page', async () => {
      const response = await request(
        `/oauth/authorize?${authorizeParams({ state: '"><script>alert(1)</script>' })}`,
      );
      const html = await response.text();
      assert.equal(html.includes('<script>alert(1)</script>'), false);
      assert.ok(html.includes('&quot;&gt;&lt;script&gt;'));
    });

    it('answers 400 without redirecting for an unknown client or redirect URI', async () => {
      for (const overrides of [
        { client_id: 'unknown' },
        { redirect_uri: 'http://evil.test/callback' },
      ]) {
        const response = await request(`/oauth/authorize?${authorizeParams(overrides)}`);
        assert.equal(response.status, 400, JSON.stringify(overrides));
        assert.equal(response.headers.get('location'), null);
        assert.match(await response.text(), /Invalid authorization request/);
      }
    });

    it('redirects OAuth-level errors to the registered redirect URI', async () => {
      const response = await request(
        `/oauth/authorize?${authorizeParams({ code_challenge_method: 'plain' })}`,
      );
      assert.equal(response.status, 302);
      const location = new URL(response.headers.get('location'));
      assert.equal(location.origin + location.pathname, REDIRECT_URI);
      assert.equal(location.searchParams.get('error'), 'invalid_request');
      assert.equal(location.searchParams.get('state'), STATE);
    });

    it('redirects with a code and the state when the form approves', async () => {
      const callback = await approve();
      assert.equal(callback.origin + callback.pathname, REDIRECT_URI);
      assert.match(callback.searchParams.get('code'), /^[0-9a-f]{64}$/);
      assert.equal(callback.searchParams.get('state'), STATE);
    });

    it('redirects with access_denied when the form denies', async () => {
      const callback = await approve({ decision: 'deny' });
      assert.equal(callback.searchParams.get('error'), 'access_denied');
      assert.equal(callback.searchParams.get('state'), STATE);
      assert.equal(callback.searchParams.get('code'), null);
    });

    it('re-validates tampered hidden fields on submission', async () => {
      const body = new URLSearchParams({
        ...Object.fromEntries(authorizeParams({ redirect_uri: 'http://evil.test/callback' })),
        username: ROSE.username,
        decision: 'approve',
      });
      const response = await request('/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
      assert.equal(response.status, 400);
      assert.equal(response.headers.get('location'), null);
    });
  });

  describe('token endpoint', () => {
    it('answers the form-encoded exchange with a JSON bearer token and no-store caching', async () => {
      const callback = await approve();
      const response = await exchange(callback.searchParams.get('code'));
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /^application\/json/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('access-control-allow-origin'), APP_ORIGIN);
      const body = await response.json();
      assert.equal(body.token_type, 'Bearer');
      assert.equal(typeof body.expires_in, 'number');
      assert.ok(body.access_token && body.refresh_token);
    });

    it('rejects a second exchange of the same code', async () => {
      const callback = await approve();
      const code = callback.searchParams.get('code');
      assert.equal((await exchange(code)).status, 200);
      const replay = await exchange(code);
      assert.equal(replay.status, 400);
      assert.equal((await replay.json()).error, 'invalid_grant');
    });

    it('rejects a wrong verifier with invalid_grant', async () => {
      const callback = await approve();
      const response = await exchange(callback.searchParams.get('code'), {
        code_verifier: 'x'.repeat(43),
      });
      assert.equal(response.status, 400);
      assert.equal((await response.json()).error, 'invalid_grant');
    });

    it('requires a form-encoded body and the POST method', async () => {
      const json = await request('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'authorization_code' }),
      });
      assert.equal(json.status, 400);
      assert.equal((await json.json()).error, 'invalid_request');

      const get = await request('/oauth/token');
      assert.equal(get.status, 405);
    });

    it('returns the error chosen on the sign-in page', async () => {
      const callback = await approve({ token_error: 'server_error' });
      const response = await exchange(callback.searchParams.get('code'));
      assert.equal(response.status, 500);
      assert.deepEqual(await response.json(), {
        error: 'server_error',
        error_description: 'Failure requested on the authorization page.',
      });
    });

    it('drops the connection for the network-failure scenario', async () => {
      const callback = await approve({ token_error: NETWORK_FAILURE });
      await assert.rejects(exchange(callback.searchParams.get('code')), TypeError);
      assert.ok(logLines.some((line) => line.includes('connection dropped')));
    });
  });

  describe('CORS', () => {
    it('answers the preflight the browser sends for bearer requests', async () => {
      const response = await request('/api/user', {
        method: 'OPTIONS',
        headers: {
          Origin: APP_ORIGIN,
          'Access-Control-Request-Method': 'GET',
          'Access-Control-Request-Headers': 'authorization',
        },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), APP_ORIGIN);
      assert.match(response.headers.get('access-control-allow-headers'), /Authorization/);
      assert.match(response.headers.get('access-control-allow-methods'), /DELETE/);
      assert.equal(response.headers.get('vary'), 'Origin');
    });

    it('does not allow other origins', async () => {
      const response = await request('/api/user', {
        method: 'OPTIONS',
        headers: { Origin: 'http://evil.test', 'Access-Control-Request-Method': 'GET' },
      });
      assert.equal(response.status, 204);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
    });
  });

  describe('resource endpoints', () => {
    it('serves the profile, the tenant and the avatar with a bearer token', async () => {
      const tokens = await signIn();
      const headers = { Authorization: `Bearer ${tokens.access_token}`, Origin: APP_ORIGIN };

      const user = await request('/api/user', { headers });
      assert.equal(user.status, 200);
      assert.equal(user.headers.get('access-control-allow-origin'), APP_ORIGIN);
      const profile = await user.json();
      assert.equal(profile.username, ROSE.username);
      assert.equal(profile.photo_url, 'http://localhost:9001/images/avatars/rose-eyenga.svg');

      const tenant = await request(`/api/tenants/${DEMO_TENANTS[0].id}`, { headers });
      assert.equal(tenant.status, 200);
      assert.equal((await tenant.json()).data.name, DEMO_TENANTS[0].name);

      const avatar = await request('/images/avatars/rose-eyenga.svg');
      assert.equal(avatar.status, 200);
      assert.match(avatar.headers.get('content-type'), /^image\/svg\+xml/);
      assert.match(await avatar.text(), />RE</);
    });

    it('answers 401 with a challenge when the token is missing', async () => {
      const response = await request('/api/user');
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('www-authenticate'), 'Bearer error="invalid_token"');
    });

    it('revokes the session through the URL-encoded logout path the client builds', async () => {
      const tokens = await signIn();
      const headers = { Authorization: `Bearer ${tokens.access_token}`, Accept: 'application/json' };
      const path = `/api/logout/${encodeURIComponent(ROSE.username)}`;
      assert.ok(path.includes('%40'));

      const response = await request(path, { method: 'POST', headers });
      assert.equal(response.status, 200);
      assert.equal((await request('/api/user', { headers })).status, 401);
    });

    it('accepts the alternative logout verbs the client can be configured with', async () => {
      for (const method of ['DELETE', 'GET']) {
        const tokens = await signIn();
        const response = await request(`/api/logout/${encodeURIComponent(ROSE.username)}`, {
          method,
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        assert.equal(response.status, 200, method);
      }
    });

    it('answers unknown routes with a JSON 404', async () => {
      const response = await request('/api/nothing');
      assert.equal(response.status, 404);
      assert.equal((await response.json()).error, 'not_found');
    });
  });

  describe('demo controls', () => {
    it('revokes access tokens (refresh keeps working) or everything', async () => {
      const tokens = await signIn();
      const headers = { Authorization: `Bearer ${tokens.access_token}` };

      const revoke = await request('/__demo/revoke', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });
      assert.equal(revoke.status, 200);
      assert.equal((await request('/api/user', { headers })).status, 401);

      const refresh = await request('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: DEMO_CLIENT.id,
          refresh_token: tokens.refresh_token,
        }),
      });
      assert.equal(refresh.status, 200);
      const renewed = await refresh.json();

      await request('/__demo/revoke?refresh=1', { method: 'POST' });
      const refused = await request('/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: DEMO_CLIENT.id,
          refresh_token: renewed.refresh_token,
        }),
      });
      assert.equal(refused.status, 400);
    });

    it('arms a logout failure and a token error, and reports state without secrets', async () => {
      const tokens = await signIn();

      await request('/__demo/logout-failure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: true }),
      });
      const logout = await request(`/api/logout/${encodeURIComponent(ROSE.username)}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      assert.equal(logout.status, 500);

      const armed = await request('/__demo/token-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'temporarily_unavailable', times: 2 }),
      });
      assert.equal(armed.status, 200);
      const state = await request('/__demo/state').then((r) => r.json());
      assert.deepEqual(state.scenario, {
        failLogout: true,
        tokenError: { error: 'temporarily_unavailable', remaining: 2 },
      });
      assert.equal(JSON.stringify(state).includes(tokens.access_token), false);

      const unknown = await request('/__demo/token-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: 'kaboom' }),
      });
      assert.equal(unknown.status, 400);
    });

    it('lists the fictional accounts for test code to discover', async () => {
      const response = await request('/__demo/users');
      assert.equal(response.status, 200);
      const users = await response.json();
      assert.deepEqual(
        users.map((user) => user.username),
        DEMO_USERS.map((user) => user.username),
      );
      const rose = users.find((user) => user.username === ROSE.username);
      assert.equal(rose.hasTenant, true);
      assert.equal(rose.tenantName, DEMO_TENANTS[0].name);
      const legacy = users.find((user) => user.username === 'legacy.user');
      assert.equal(legacy.hasTenant, false);
      assert.equal(legacy.tenantName, null);
    });

    it('redirects back to the index when driven from its HTML forms', async () => {
      const response = await request('/__demo/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: '',
      });
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('location'), '/');
      const index = await request('/');
      assert.equal(index.status, 200);
      assert.match(await index.text(), /Local OAuth test provider/);
    });
  });

  describe('logging', () => {
    it('records method, path and status only — never query strings, codes or tokens', async () => {
      const callback = await approve();
      const code = callback.searchParams.get('code');
      const response = await exchange(code);
      const tokens = await response.json();
      await request('/api/user', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      await request(`/oauth/authorize?${authorizeParams()}`);

      const joined = logLines.join('\n');
      assert.equal(joined.includes(code), false);
      assert.equal(joined.includes(tokens.access_token), false);
      assert.equal(joined.includes(CHALLENGE), false);
      assert.equal(joined.includes(STATE), false);
      assert.ok(logLines.includes('POST /oauth/token -> 200'));
      assert.ok(logLines.includes('GET /oauth/authorize -> 200'));
    });
  });
});
