/**
 * Core rules of the local OAuth 2.0 test provider (authorization code grant
 * with PKCE, refresh grant, user-info, revocation, tenant resource).
 *
 * This module knows nothing about HTTP: it takes plain parameter objects and
 * returns plain result objects, so that the rules can be tested directly and
 * the HTTP layer (`http.mjs`) stays a thin adapter.
 *
 * It is a development tool only. Tokens live in memory and disappear with the
 * process; nothing here is suitable for production use.
 */

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const DEFAULT_CODE_TTL_SECONDS = 60;
export const DEFAULT_ACCESS_TOKEN_TTL_SECONDS = 300;
export const DEFAULT_REFRESH_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** RFC 7636, section 4.1. */
const CODE_VERIFIER_PATTERN = /^[A-Za-z0-9\-._~]{43,128}$/;
/** A base64url-encoded SHA-256 digest is always 43 characters long. */
const CODE_CHALLENGE_PATTERN = /^[A-Za-z0-9\-_]{43}$/;

/**
 * OAuth error codes the token endpoint can be told to answer with, and the
 * HTTP status each one carries (RFC 6749, section 5.2).
 */
export const TOKEN_ERROR_STATUS = Object.freeze({
  invalid_request: 400,
  invalid_client: 401,
  invalid_grant: 400,
  unauthorized_client: 400,
  unsupported_grant_type: 400,
  invalid_scope: 400,
  server_error: 500,
  temporarily_unavailable: 503,
});

/**
 * Pseudo error that makes the HTTP layer drop the connection instead of
 * answering, so that the client sees a network failure (status 0).
 */
export const NETWORK_FAILURE = 'network_failure';

/** Accepted values of a token-error scenario. */
export const TOKEN_ERROR_SCENARIOS = Object.freeze([
  ...Object.keys(TOKEN_ERROR_STATUS),
  NETWORK_FAILURE,
]);

export function isTokenErrorScenario(value) {
  return typeof value === 'string' && TOKEN_ERROR_SCENARIOS.includes(value);
}

export function base64UrlEncode(buffer) {
  return Buffer.from(buffer)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/** S256 transformation of RFC 7636, section 4.2. */
export function s256Challenge(codeVerifier) {
  return base64UrlEncode(createHash('sha256').update(codeVerifier, 'ascii').digest());
}

function randomToken() {
  return randomBytes(32).toString('hex');
}

function randomId() {
  return randomBytes(8).toString('hex');
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function stringParam(params, key) {
  const value = params?.[key];
  return typeof value === 'string' ? value : null;
}

/** Appends query parameters (skipping `null`s) to a redirect URI. */
export function withQuery(uri, params) {
  const url = new URL(uri);
  for (const [key, value] of Object.entries(params)) {
    if (value !== null && value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  return url.toString();
}

/** Tenant id of a `{username}@{tenant_id}` identifier, or `null`. */
export function tenantIdOf(username) {
  const separator = username.lastIndexOf('@');
  return separator > 0 && separator < username.length - 1
    ? username.slice(separator + 1)
    : null;
}

function tokenErrorResponse(error, description) {
  if (error === NETWORK_FAILURE) {
    return { kind: 'network_failure' };
  }
  return {
    kind: 'response',
    status: TOKEN_ERROR_STATUS[error] ?? 400,
    body: { error, error_description: description },
  };
}

function apiError(status, error, description) {
  const body = description === undefined ? { error } : { error, error_description: description };
  const headers = status === 401 ? { 'WWW-Authenticate': `Bearer error="${error}"` } : {};
  return { status, body, headers };
}

/**
 * Creates an isolated provider instance.
 *
 * @param {object} options
 * @param {ReadonlyArray<{id: string, name: string, redirectUris: ReadonlyArray<string>}>} options.clients
 * @param {ReadonlyArray<{id: number, username: string, name: string | null, email: string, photoPath: string | null}>} options.users
 * @param {ReadonlyArray<{id: string, name: string}>} options.tenants
 * @param {string} [options.issuer] Origin used to build absolute photo URLs.
 * @param {() => number} [options.now] Clock, in epoch milliseconds.
 * @param {number} [options.codeTtlSeconds]
 * @param {number} [options.accessTokenTtlSeconds]
 * @param {number} [options.refreshTokenTtlSeconds]
 */
export function createProvider(options) {
  const clients = options.clients;
  const users = options.users;
  const tenants = options.tenants;
  const issuer = (options.issuer ?? 'http://localhost:9001').replace(/\/+$/, '');
  const now = options.now ?? (() => Date.now());
  const codeTtlMs = (options.codeTtlSeconds ?? DEFAULT_CODE_TTL_SECONDS) * 1000;
  const accessTokenTtlSeconds = options.accessTokenTtlSeconds ?? DEFAULT_ACCESS_TOKEN_TTL_SECONDS;
  const refreshTokenTtlMs =
    (options.refreshTokenTtlSeconds ?? DEFAULT_REFRESH_TOKEN_TTL_SECONDS) * 1000;

  /** @type {Map<string, {clientId: string, redirectUri: string, codeChallenge: string, username: string, scope: string, expiresAt: number, used: boolean, tokenError: string | null, sessionId: string}>} */
  const codes = new Map();
  /** @type {Map<string, {username: string, clientId: string, scope: string, expiresAt: number, sessionId: string}>} */
  const accessTokens = new Map();
  /** @type {Map<string, {username: string, clientId: string, scope: string, expiresAt: number, sessionId: string}>} */
  const refreshTokens = new Map();

  const scenario = {
    /** `{ error, remaining }` while the next token requests must fail. */
    tokenError: null,
    failLogout: false,
  };
  const counters = { tokenRequests: 0, refreshes: 0, logouts: 0 };

  const findClient = (clientId) => clients.find((client) => client.id === clientId) ?? null;
  const findUser = (username) => users.find((user) => user.username === username) ?? null;

  function revokeSession(sessionId) {
    for (const [token, record] of accessTokens) {
      if (record.sessionId === sessionId) accessTokens.delete(token);
    }
    for (const [token, record] of refreshTokens) {
      if (record.sessionId === sessionId) refreshTokens.delete(token);
    }
  }

  function issueTokens(record) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const issuedAt = now();
    const base = {
      username: record.username,
      clientId: record.clientId,
      scope: record.scope,
      sessionId: record.sessionId,
    };
    accessTokens.set(accessToken, { ...base, expiresAt: issuedAt + accessTokenTtlSeconds * 1000 });
    refreshTokens.set(refreshToken, { ...base, expiresAt: issuedAt + refreshTokenTtlMs });
    const body = {
      token_type: 'Bearer',
      expires_in: accessTokenTtlSeconds,
      access_token: accessToken,
      refresh_token: refreshToken,
    };
    if (record.scope.length > 0) {
      body.scope = record.scope;
    }
    return { kind: 'response', status: 200, body };
  }

  /**
   * Validates an authorization request (RFC 6749, section 4.1.1).
   *
   * An unknown client or an unregistered redirect URI must never cause a
   * redirect (section 4.1.2.1): those come back as `kind: 'invalid'` for the
   * HTTP layer to show an error page. Any other problem is reported to the
   * client through its redirect URI (`kind: 'redirect'`).
   */
  function validateAuthorizationRequest(params) {
    const clientId = stringParam(params, 'client_id');
    const client = clientId === null ? null : findClient(clientId);
    if (client === null) {
      return {
        kind: 'invalid',
        error: 'invalid_client',
        description: 'Unknown client_id: the application is not registered with this provider.',
      };
    }
    const redirectUri = stringParam(params, 'redirect_uri');
    if (redirectUri === null || !client.redirectUris.includes(redirectUri)) {
      return {
        kind: 'invalid',
        error: 'invalid_redirect_uri',
        description: 'The redirect_uri is missing or is not registered for this client.',
      };
    }

    const state = stringParam(params, 'state');
    const fail = (error, description) => ({
      kind: 'redirect',
      location: withQuery(redirectUri, { error, error_description: description, state }),
    });

    if (stringParam(params, 'response_type') !== 'code') {
      return fail('unsupported_response_type', 'Only response_type=code is supported.');
    }
    if (stringParam(params, 'code_challenge_method') !== 'S256') {
      return fail('invalid_request', 'code_challenge_method must be S256 (PKCE is mandatory).');
    }
    const codeChallenge = stringParam(params, 'code_challenge');
    if (codeChallenge === null || !CODE_CHALLENGE_PATTERN.test(codeChallenge)) {
      return fail('invalid_request', 'code_challenge must be a base64url-encoded SHA-256 digest.');
    }
    const scope = (stringParam(params, 'scope') ?? '').trim();

    return {
      kind: 'ok',
      client,
      request: { clientId: client.id, redirectUri, state, codeChallenge, scope },
    };
  }

  /**
   * Records the resource owner's decision and produces the redirect.
   *
   * @param {object} params The original authorization request parameters.
   * @param {{approve: boolean, username?: string, tokenError?: string | null}} decision
   */
  function authorize(params, decision) {
    const validation = validateAuthorizationRequest(params);
    if (validation.kind !== 'ok') {
      return validation;
    }
    const { request } = validation;

    if (!decision.approve) {
      return {
        kind: 'redirect',
        location: withQuery(request.redirectUri, {
          error: 'access_denied',
          error_description: 'The resource owner denied the request.',
          state: request.state,
        }),
      };
    }

    const user = decision.username === undefined ? null : findUser(decision.username);
    if (user === null) {
      return {
        kind: 'invalid',
        error: 'unknown_user',
        description: 'The selected account does not exist in the demo fixtures.',
      };
    }
    const tokenError = decision.tokenError ?? null;
    if (tokenError !== null && !isTokenErrorScenario(tokenError)) {
      return {
        kind: 'invalid',
        error: 'unknown_scenario',
        description: `Unknown token-error scenario: ${tokenError}.`,
      };
    }

    const code = randomToken();
    codes.set(code, {
      clientId: request.clientId,
      redirectUri: request.redirectUri,
      codeChallenge: request.codeChallenge,
      username: user.username,
      scope: request.scope,
      expiresAt: now() + codeTtlMs,
      used: false,
      tokenError,
      sessionId: randomId(),
    });
    return {
      kind: 'redirect',
      location: withQuery(request.redirectUri, { code, state: request.state }),
    };
  }

  /**
   * Token endpoint (RFC 6749, sections 4.1.3 and 6; RFC 7636, section 4.6).
   *
   * @param {object} body Form fields of the request.
   * @returns {{kind: 'response', status: number, body: object} | {kind: 'network_failure'}}
   */
  function token(body) {
    counters.tokenRequests += 1;

    if (scenario.tokenError !== null) {
      const { error } = scenario.tokenError;
      scenario.tokenError.remaining -= 1;
      if (scenario.tokenError.remaining <= 0) {
        scenario.tokenError = null;
      }
      return tokenErrorResponse(error, 'Failure requested by the demo scenario.');
    }

    const clientId = stringParam(body, 'client_id');
    if (clientId === null || findClient(clientId) === null) {
      return tokenErrorResponse('invalid_client', 'Unknown or missing client_id.');
    }

    switch (stringParam(body, 'grant_type')) {
      case 'authorization_code':
        return exchangeCode(body, clientId);
      case 'refresh_token':
        return refresh(body, clientId);
      case null:
        return tokenErrorResponse('invalid_request', 'grant_type is required.');
      default:
        return tokenErrorResponse(
          'unsupported_grant_type',
          'Only authorization_code and refresh_token are supported.',
        );
    }
  }

  function exchangeCode(body, clientId) {
    const code = stringParam(body, 'code');
    const record = code === null ? undefined : codes.get(code);
    if (record === undefined) {
      return tokenErrorResponse('invalid_grant', 'Unknown authorization code.');
    }
    if (record.used) {
      // RFC 6749, section 4.1.2: a replayed code revokes what it produced.
      revokeSession(record.sessionId);
      return tokenErrorResponse('invalid_grant', 'The authorization code was already used.');
    }
    // One-time use: the code is consumed by its first exchange attempt,
    // whatever the outcome.
    record.used = true;

    if (record.expiresAt <= now()) {
      return tokenErrorResponse('invalid_grant', 'The authorization code has expired.');
    }
    if (record.clientId !== clientId) {
      return tokenErrorResponse('invalid_grant', 'The code was issued to another client.');
    }
    if (stringParam(body, 'redirect_uri') !== record.redirectUri) {
      return tokenErrorResponse(
        'invalid_grant',
        'redirect_uri does not match the authorization request.',
      );
    }
    const verifier = stringParam(body, 'code_verifier');
    if (verifier === null) {
      return tokenErrorResponse('invalid_request', 'code_verifier is required.');
    }
    if (!CODE_VERIFIER_PATTERN.test(verifier) || !safeEqual(s256Challenge(verifier), record.codeChallenge)) {
      return tokenErrorResponse('invalid_grant', 'code_verifier does not match code_challenge.');
    }
    if (record.tokenError !== null) {
      return tokenErrorResponse(record.tokenError, 'Failure requested on the authorization page.');
    }
    return issueTokens(record);
  }

  function refresh(body, clientId) {
    const presented = stringParam(body, 'refresh_token');
    const record = presented === null ? undefined : refreshTokens.get(presented);
    if (record === undefined || record.clientId !== clientId) {
      return tokenErrorResponse('invalid_grant', 'Unknown refresh token.');
    }
    // Rotation: the presented token is retired even if it turns out expired.
    refreshTokens.delete(presented);
    if (record.expiresAt <= now()) {
      return tokenErrorResponse('invalid_grant', 'The refresh token has expired.');
    }
    counters.refreshes += 1;
    return issueTokens(record);
  }

  /** Access-token record behind an `Authorization` header, or `null`. */
  function authenticate(authorizationHeader) {
    if (typeof authorizationHeader !== 'string') {
      return null;
    }
    const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader.trim());
    if (match === null) {
      return null;
    }
    const record = accessTokens.get(match[1]);
    if (record === undefined || record.expiresAt <= now()) {
      return null;
    }
    return record;
  }

  // --- Test-only stubs of the private server's API ---------------------------
  //
  // The Angular client makes three non-OAuth calls; these are the smallest
  // answers that let every client screen run. They are not a model of the
  // real API: see README, "Simulated interactions".

  function userInfoBody(user) {
    const body = { id: user.id, username: user.username, email: user.email };
    if (user.name !== null) {
      body.name = user.name;
    }
    if (user.photoPath !== null) {
      body.photo_url = `${issuer}${user.photoPath}`;
    }
    return body;
  }

  /** `GET /api/user`. */
  function userInfo(authorizationHeader) {
    const record = authenticate(authorizationHeader);
    if (record === null) {
      return apiError(401, 'invalid_token');
    }
    const user = findUser(record.username);
    if (user === null) {
      return apiError(401, 'invalid_token');
    }
    return { status: 200, body: userInfoBody(user), headers: {} };
  }

  /** `{METHOD} /api/logout/{username}`: revokes the whole session of the token. */
  function logout(authorizationHeader, username) {
    const record = authenticate(authorizationHeader);
    if (record === null) {
      return apiError(401, 'invalid_token');
    }
    if (record.username !== username) {
      return apiError(403, 'forbidden', 'The token does not belong to that user.');
    }
    if (scenario.failLogout) {
      return apiError(500, 'server_error', 'Logout failure requested by the demo scenario.');
    }
    revokeSession(record.sessionId);
    counters.logouts += 1;
    return { status: 200, body: { message: 'Logged out.' }, headers: {} };
  }

  /** `GET /api/tenants/{tenant_id}`: only the user's own tenant is readable. */
  function tenant(authorizationHeader, tenantId) {
    const record = authenticate(authorizationHeader);
    if (record === null) {
      return apiError(401, 'invalid_token');
    }
    const found = tenants.find((candidate) => candidate.id.toLowerCase() === String(tenantId).toLowerCase());
    if (found === undefined) {
      return apiError(404, 'not_found', 'No tenant has this identifier.');
    }
    if ((tenantIdOf(record.username) ?? '').toLowerCase() !== found.id.toLowerCase()) {
      return apiError(403, 'forbidden', 'You are not a member of this tenant.');
    }
    return { status: 200, body: { data: found }, headers: {} };
  }

  // --- Demo controls ---------------------------------------------------------

  /** Makes the next `times` token requests fail with `error`. */
  function setTokenError(error, times = 1) {
    if (error === null) {
      scenario.tokenError = null;
      return;
    }
    if (!isTokenErrorScenario(error)) {
      throw new RangeError(`Unknown token-error scenario: ${error}`);
    }
    const remaining = Number.isInteger(times) && times > 0 ? times : 1;
    scenario.tokenError = { error, remaining };
  }

  function setLogoutFailure(enabled) {
    scenario.failLogout = Boolean(enabled);
  }

  /** Invalidates every access token; refresh tokens keep working (401 → refresh → retry). */
  function revokeAccessTokens() {
    accessTokens.clear();
  }

  /** Invalidates every token; the next refresh is refused (401 → session ended). */
  function revokeAllTokens() {
    accessTokens.clear();
    refreshTokens.clear();
  }

  function reset() {
    codes.clear();
    revokeAllTokens();
    scenario.tokenError = null;
    scenario.failLogout = false;
    counters.tokenRequests = 0;
    counters.refreshes = 0;
    counters.logouts = 0;
  }

  /** Observable state without any secret value. */
  function snapshot() {
    let pendingCodes = 0;
    for (const record of codes.values()) {
      if (!record.used && record.expiresAt > now()) pendingCodes += 1;
    }
    return {
      pendingCodes,
      accessTokens: accessTokens.size,
      refreshTokens: refreshTokens.size,
      scenario: {
        tokenError: scenario.tokenError === null ? null : { ...scenario.tokenError },
        failLogout: scenario.failLogout,
      },
      counters: { ...counters },
    };
  }

  return {
    clients,
    users,
    tenants,
    issuer,
    accessTokenTtlSeconds,
    validateAuthorizationRequest,
    authorize,
    token,
    authenticate,
    userInfo,
    logout,
    tenant,
    setTokenError,
    setLogoutFailure,
    revokeAccessTokens,
    revokeAllTokens,
    reset,
    snapshot,
  };
}
