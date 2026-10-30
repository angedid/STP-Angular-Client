/**
 * Typed model and validation of the token endpoint's answer (RFC 6749,
 * section 5.1), shared by the authorization-code exchange and the refresh
 * grant.
 */

/** A successful token response, as accepted by this client. */
export interface TokenResponse {
  readonly accessToken: string;
  /** Only bearer tokens are supported; kept as sent by the server (case preserved). */
  readonly tokenType: string;
  /** Lifetime of the access token in seconds, or `null` when not announced. */
  readonly expiresIn: number | null;
  readonly refreshToken: string | null;
  /** Granted scope when the server repeats it, `null` otherwise. */
  readonly scope: string | null;
}

/** Why a token response was refused. */
export type TokenResponseProblem =
  | 'not_an_object'
  | 'missing_access_token'
  | 'unsupported_token_type'
  | 'invalid_expires_in'
  | 'invalid_refresh_token'
  | 'invalid_scope';

export type TokenResponseValidation =
  | { readonly ok: true; readonly tokens: TokenResponse }
  | { readonly ok: false; readonly problem: TokenResponseProblem };

/** The tokens of a session, with the lifetime resolved to an absolute instant. */
export interface SessionTokens {
  readonly accessToken: string;
  readonly tokenType: string;
  readonly refreshToken: string | null;
  /** Unix epoch milliseconds at which the access token stops being valid, or `null`. */
  readonly expiresAt: number | null;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

/**
 * Validates the JSON body of a token response.
 *
 * - `access_token`: required, non-empty string;
 * - `token_type`: required, `bearer` (case-insensitive);
 * - `expires_in`: optional; when present, a finite number of seconds >= 0
 *   (`0` means the token is already unusable). Strings are refused;
 * - `refresh_token`: optional; when present, a non-empty string;
 * - `scope`: optional; when present, a string.
 *
 * `null` values are treated as absent, as some servers serialise them.
 */
export function validateTokenResponse(body: unknown): TokenResponseValidation {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return { ok: false, problem: 'not_an_object' };
  }
  const fields = body as Record<string, unknown>;

  const accessToken = fields['access_token'];
  if (typeof accessToken !== 'string' || accessToken.length === 0) {
    return { ok: false, problem: 'missing_access_token' };
  }

  const tokenType = fields['token_type'];
  if (typeof tokenType !== 'string' || tokenType.toLowerCase() !== 'bearer') {
    return { ok: false, problem: 'unsupported_token_type' };
  }

  const expiresIn = fields['expires_in'] ?? null;
  if (expiresIn !== null && !isNonNegativeFiniteNumber(expiresIn)) {
    return { ok: false, problem: 'invalid_expires_in' };
  }

  const refreshToken = fields['refresh_token'] ?? null;
  if (refreshToken !== null && (typeof refreshToken !== 'string' || refreshToken.length === 0)) {
    return { ok: false, problem: 'invalid_refresh_token' };
  }

  const scope = fields['scope'] ?? null;
  if (scope !== null && typeof scope !== 'string') {
    return { ok: false, problem: 'invalid_scope' };
  }

  return {
    ok: true,
    tokens: { accessToken, tokenType, expiresIn, refreshToken, scope },
  };
}

/**
 * Absolute expiry of an access token received at `receivedAt`:
 * `receivedAt + expires_in * 1000`, rounded to the millisecond. The token is
 * considered expired from that instant on (see {@link isExpiredAt}).
 */
export function expiresAtOf(tokens: TokenResponse, receivedAt: number): number | null {
  return tokens.expiresIn === null ? null : receivedAt + Math.round(tokens.expiresIn * 1000);
}

/** Resolves a validated response into session tokens, dating the lifetime from `receivedAt`. */
export function toSessionTokens(tokens: TokenResponse, receivedAt: number): SessionTokens {
  return {
    accessToken: tokens.accessToken,
    tokenType: tokens.tokenType,
    refreshToken: tokens.refreshToken,
    expiresAt: expiresAtOf(tokens, receivedAt),
  };
}

/**
 * `true` from the announced expiry instant onwards (`now >= expiresAt`).
 * Tokens without announced expiry never expire locally.
 */
export function isExpiredAt(expiresAt: number | null, now: number): boolean {
  return expiresAt !== null && now >= expiresAt;
}
