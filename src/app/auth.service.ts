import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { computed, DOCUMENT, inject, Injectable, InjectionToken, signal } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { AUTH_CONFIG } from './auth.config';
import { AuthSession, AuthSessionStore, UserProfile } from './auth-session';
import { AuthTransaction, AuthTransactionStore, isSafeReturnUrl } from './auth-transaction';
import { CLOCK } from './clock';
import {
  isExpiredAt,
  SessionTokens,
  toSessionTokens,
  validateTokenResponse,
} from './token-response';
import { createCodeChallenge, generateCodeVerifier, generateState } from './pkce';
import { usernameOf } from './user-identifier';

/**
 * Performs a full-page redirect to an external URL.
 *
 * Isolated behind a token so that unit tests can observe the authorization URL
 * without leaving the test page.
 */
export const EXTERNAL_REDIRECT = new InjectionToken<(url: string) => void>('EXTERNAL_REDIRECT', {
  providedIn: 'root',
  factory: () => {
    const document = inject(DOCUMENT);
    return (url: string) => document.location.assign(url);
  },
});

/** Query parameters the authorization server may append to the redirect URI. */
export interface AuthorizationCallbackParams {
  readonly code?: string | null;
  readonly state?: string | null;
  readonly error?: string | null;
}

/** Why a callback could not be turned into a session. */
export type AuthErrorReason =
  | 'authorization_denied'
  | 'invalid_callback'
  | 'transaction_missing'
  | 'transaction_expired'
  | 'transaction_malformed'
  | 'state_mismatch'
  | 'token_request_rejected'
  | 'network_error'
  | 'invalid_token_response'
  | 'profile_request_failed'
  | 'invalid_profile_response'
  | 'unexpected_error';

export interface AuthCallbackError {
  readonly status: 'error';
  readonly reason: AuthErrorReason;
  readonly message: string;
}

export type AuthCallbackResult =
  | {
      readonly status: 'success';
      /** In-app path the sign-in was started from, when there was one. */
      readonly returnUrl?: string;
    }
  | AuthCallbackError;

export type { AuthSession, UserProfile } from './auth-session';

/** Outcome of {@link AuthService.logout}. */
export type LogoutResult =
  | { readonly status: 'success' }
  | { readonly status: 'error'; readonly message: string };

const AUTHORIZATION_CODE_PATTERN = /^[\x21-\x7E]{1,2048}$/;
const STATE_PATTERN = /^[A-Za-z0-9\-_]{16,256}$/;
const OAUTH_ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;

/**
 * OAuth 2.0 Authorization Code flow with PKCE for a public browser client.
 *
 * Security notes:
 * - no client secret is used anywhere;
 * - `state` and `code_verifier` are generated independently;
 * - the pending transaction lives in `sessionStorage` for a limited time and is
 *   consumed by the first callback that references it, so a given transaction
 *   can trigger at most one token request;
 * - nothing is written to the console: codes, verifiers and tokens must never
 *   end up in logs.
 *
 * Session management: the in-memory `session` signal is the single source of
 * truth for the interface. It is written through to {@link AuthSessionStore}
 * (`sessionStorage`) whenever it changes and restored from there when the
 * service is created, so that a reload of the tab keeps the user signed in.
 */
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly config = inject(AUTH_CONFIG);
  private readonly transactions = inject(AuthTransactionStore);
  private readonly sessions = inject(AuthSessionStore);
  private readonly redirect = inject(EXTERNAL_REDIRECT);
  private readonly clock = inject(CLOCK);

  /** Restored synchronously so that guards and the shell see it on first render. */
  private readonly session = signal<AuthSession | null>(this.sessions.load());
  /** Token exchanges in flight, keyed by `state`, to absorb duplicate callbacks. */
  private readonly pendingExchanges = new Map<string, Promise<AuthCallbackResult>>();
  /** Refresh in flight, shared by concurrent callers. */
  private refreshInFlight: Promise<boolean> | null = null;

  /** `true` once a token response has been accepted. */
  readonly isAuthenticated = computed(() => this.session() !== null);

  /** Profile of the signed-in user, or `null` when signed out. */
  readonly user = computed(() => this.session()?.user ?? null);

  /** Current in-memory session, or `null` when signed out. */
  getSession(): AuthSession | null {
    return this.session();
  }

  /** Current access token, or `null` when signed out. */
  getAccessToken(): string | null {
    return this.session()?.accessToken ?? null;
  }

  /**
   * `true` when a session exists and the clock has reached the expiry
   * announced by the server (`now >= expiresAt`). A session without announced
   * expiry never counts as expired here; the server's `401` answers still do.
   */
  isSessionExpired(): boolean {
    const session = this.session();
    return session !== null && isExpiredAt(session.expiresAt, this.clock.now());
  }

  /**
   * Makes sure the session can be used right now.
   *
   * Resolves `true` when a session exists and its access token is valid on
   * the clock, renewing it first with the refresh token when it has expired.
   * Resolves `false` when there is no session or it could not be renewed; in
   * the latter case the session has been cleared. Never rejects.
   */
  async ensureValidSession(): Promise<boolean> {
    if (!this.isAuthenticated()) {
      return false;
    }
    if (!this.isSessionExpired()) {
      return true;
    }
    if (await this.refreshSession()) {
      return !this.isSessionExpired();
    }
    this.clearSession();
    return false;
  }

  /**
   * Forgets the local session and any pending transaction without contacting
   * the server. Meant for tokens the server already considers invalid (for
   * example after expiry); use {@link logout} for a user-initiated sign-out.
   */
  clearSession(): void {
    this.session.set(null);
    this.sessions.clear();
    this.transactions.clear();
  }

  /**
   * Renews the access token with the refresh token (RFC 6749, section 6).
   *
   * The request is `POST {tokenEndpoint}` with a form-encoded body
   * `grant_type=refresh_token`, `refresh_token`, `client_id` and, when one is
   * configured, `scope`; being a public client, no secret and no bearer
   * header are sent. The answer is a standard token response: the new access
   * token replaces the current one, a rotated `refresh_token` replaces the
   * stored one (the previous one is kept only when the server omits it), and
   * the profile is preserved.
   *
   * Resolves `true` when the session was renewed. Any failure (refresh token
   * rejected, server unreachable, unreadable answer) ends the session: it is
   * cleared locally and `false` is returned, so callers only have to send the
   * user to sign in again. Without a session or a refresh token, nothing is
   * sent and `false` is returned. Concurrent calls share one request. Never
   * rejects.
   */
  refreshSession(): Promise<boolean> {
    if (this.refreshInFlight === null) {
      this.refreshInFlight = this.performRefresh().finally(() => {
        this.refreshInFlight = null;
      });
    }
    return this.refreshInFlight;
  }

  private async performRefresh(): Promise<boolean> {
    const session = this.session();
    if (session === null || session.refreshToken === null) {
      return false;
    }

    const body = new URLSearchParams();
    body.set('grant_type', 'refresh_token');
    body.set('refresh_token', session.refreshToken);
    body.set('client_id', this.config.clientId);
    if (this.config.scope.length > 0) {
      body.set('scope', this.config.scope);
    }

    let response: unknown;
    try {
      response = await firstValueFrom(
        this.http.post<unknown>(this.config.tokenEndpoint, body.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        }),
      );
    } catch {
      // Rejected refresh token or unreachable server: the session is over.
      this.clearSession();
      return false;
    }

    const tokens = this.sessionTokensFrom(response);
    if (tokens === null) {
      this.clearSession();
      return false;
    }
    // A rotated refresh token replaces the stored one; servers that do not
    // rotate omit it from the response, in which case the current one stays.
    this.storeSession({
      ...tokens,
      refreshToken: tokens.refreshToken ?? session.refreshToken,
      user: session.user,
    });
    return true;
  }

  /**
   * Revokes the access token on the server, then forgets the local session.
   *
   * The local state is only cleared after the server confirmed the revocation;
   * when the request fails (including with `401`) the session is kept exactly
   * as it is and an explanation is returned, so that the interface never
   * claims a logout that did not happen. Keeping the session does not validate
   * it: an expired session stays expired. Never rejects.
   */
  async logout(): Promise<LogoutResult> {
    const session = this.session();
    if (session === null) {
      this.clearSession();
      return { status: 'success' };
    }

    const url = `${this.config.logoutEndpoint}/${encodeURIComponent(session.user.username)}`;
    try {
      await firstValueFrom(
        this.http.request<unknown>(this.config.logoutMethod, url, {
          headers: this.authorizationHeaders(session),
          observe: 'response',
        }),
      );
    } catch (failure) {
      return { status: 'error', message: describeLogoutFailure(failure) };
    }

    this.clearSession();
    return { status: 'success' };
  }

  /**
   * Starts the sign-in: stores a fresh transaction and sends the browser to the
   * authorization endpoint. Rejects when the transaction cannot be prepared
   * (for example when `sessionStorage` or Web Crypto are unavailable).
   *
   * `returnUrl` is the in-app path to open once signed in; anything that is
   * not a same-origin path is ignored and the user lands on the home page.
   */
  async startLogin(returnUrl: string | null = null): Promise<void> {
    const url = await this.createAuthorizationUrl(returnUrl);
    this.redirect(url);
  }

  /**
   * Prepares a new transaction and returns the authorization URL to open.
   *
   * Exposed separately from {@link startLogin} so that the request can be
   * inspected without navigating.
   */
  async createAuthorizationUrl(returnUrl: string | null = null): Promise<string> {
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = await createCodeChallenge(codeVerifier);
    const state = generateState();
    const now = this.clock.now();

    const transaction: AuthTransaction = {
      state,
      codeVerifier,
      redirectUri: this.config.redirectUri,
      createdAt: now,
      expiresAt: now + this.config.transactionTtlMs,
      ...(isSafeReturnUrl(returnUrl) ? { returnUrl } : {}),
    };
    this.transactions.save(transaction);

    const url = new URL(this.config.authorizationEndpoint);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', this.config.clientId);
    url.searchParams.set('redirect_uri', this.config.redirectUri);
    url.searchParams.set('scope', this.config.scope);
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }

  /**
   * Processes the parameters received on the redirect URI.
   *
   * The code, the state and the stored transaction are validated before any
   * request is sent; the token endpoint is only contacted when everything is
   * consistent. The returned promise settles with the real outcome of that
   * request and never rejects.
   */
  handleCallback(params: AuthorizationCallbackParams): Promise<AuthCallbackResult> {
    const state = params.state ?? '';
    const inFlight = this.pendingExchanges.get(state);
    if (inFlight) {
      return inFlight;
    }

    const exchange = this.processCallback(params).catch(
      (): AuthCallbackResult => ({
        status: 'error',
        reason: 'unexpected_error',
        message: 'Sign-in failed because of an unexpected error. Please start again.',
      }),
    );
    this.pendingExchanges.set(state, exchange);
    void exchange.finally(() => this.pendingExchanges.delete(state));
    return exchange;
  }

  private async processCallback(params: AuthorizationCallbackParams): Promise<AuthCallbackResult> {
    const validation = this.validateCallback(params);
    if (validation.status === 'error') {
      // Whatever went wrong, the pending transaction is no longer usable.
      this.transactions.clear();
      return validation;
    }
    const { code, state } = validation;

    const consumed = this.transactions.consume();
    switch (consumed.kind) {
      case 'missing':
        return error(
          'transaction_missing',
          'No sign-in request is pending in this browser tab. Please start sign-in again.',
        );
      case 'expired':
        return error('transaction_expired', 'The sign-in request has expired. Please start again.');
      case 'malformed':
        return error(
          'transaction_malformed',
          'The pending sign-in request could not be read. Please start again.',
        );
      case 'ok':
        break;
    }

    const transaction = consumed.transaction;
    if (transaction.state !== state) {
      return error(
        'state_mismatch',
        'The response from the sign-in server does not match the pending request. Please start again.',
      );
    }

    return this.exchangeCode(code, transaction);
  }

  private validateCallback(
    params: AuthorizationCallbackParams,
  ): { status: 'ok'; code: string; state: string } | AuthCallbackError {
    const errorCode = params.error;
    if (typeof errorCode === 'string' && errorCode.length > 0) {
      const shownCode = OAUTH_ERROR_CODE_PATTERN.test(errorCode) ? errorCode : 'unknown error';
      return error(
        'authorization_denied',
        `The sign-in server did not authorize the request (${shownCode}). Please start again.`,
      );
    }

    const code = params.code;
    const state = params.state;
    if (typeof code !== 'string' || !AUTHORIZATION_CODE_PATTERN.test(code)) {
      return error(
        'invalid_callback',
        'The response from the sign-in server is incomplete or invalid. Please start again.',
      );
    }
    if (typeof state !== 'string' || !STATE_PATTERN.test(state)) {
      return error(
        'invalid_callback',
        'The response from the sign-in server is incomplete or invalid. Please start again.',
      );
    }
    return { status: 'ok', code, state };
  }

  private async exchangeCode(
    code: string,
    transaction: AuthTransaction,
  ): Promise<AuthCallbackResult> {
    const body = new URLSearchParams();
    body.set('grant_type', 'authorization_code');
    body.set('client_id', this.config.clientId);
    body.set('redirect_uri', transaction.redirectUri);
    body.set('code', code);
    body.set('code_verifier', transaction.codeVerifier);

    let response: unknown;
    try {
      response = await firstValueFrom(
        this.http.post<unknown>(this.config.tokenEndpoint, body.toString(), {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        }),
      );
    } catch (failure) {
      return describeHttpFailure(failure);
    }

    const tokens = this.sessionTokensFrom(response);
    if (tokens === null) {
      return error(
        'invalid_token_response',
        'The sign-in server returned an unexpected response. Please start again.',
      );
    }

    let profileResponse: unknown;
    try {
      profileResponse = await firstValueFrom(
        this.http.get<unknown>(this.config.userInfoEndpoint, {
          headers: this.authorizationHeaders(tokens),
        }),
      );
    } catch {
      // The freshly issued token is dropped: sign-in is only complete once the
      // user is known, and the interface needs the username to log out.
      return error(
        'profile_request_failed',
        'You were authenticated, but your profile could not be loaded. Please start again.',
      );
    }

    const user = parseUserProfile(profileResponse);
    if (user === null) {
      return error(
        'invalid_profile_response',
        'The profile returned by the server could not be read. Please start again.',
      );
    }

    this.storeSession({ ...tokens, user });
    return transaction.returnUrl === undefined
      ? { status: 'success' }
      : { status: 'success', returnUrl: transaction.returnUrl };
  }

  /**
   * Makes the session current and persists it. A storage failure (quota,
   * disabled storage) degrades to an in-memory session rather than failing the
   * sign-in: the user is signed in for this page at least.
   */
  private storeSession(session: AuthSession): void {
    this.session.set(session);
    try {
      this.sessions.save(session);
    } catch {
      // Keep the in-memory session; a reload will simply require signing in again.
    }
  }

  /**
   * Validates a token response and dates its lifetime from the moment it was
   * received, as read on the injected clock. `null` when the body is not an
   * acceptable token response.
   */
  private sessionTokensFrom(response: unknown): SessionTokens | null {
    const validation = validateTokenResponse(response);
    return validation.ok ? toSessionTokens(validation.tokens, this.clock.now()) : null;
  }

  private authorizationHeaders(tokens: Pick<AuthSession, 'accessToken'>): Record<string, string> {
    return {
      Authorization: `Bearer ${tokens.accessToken}`,
      Accept: 'application/json',
    };
  }
}

function error(reason: AuthErrorReason, message: string): AuthCallbackError {
  return { status: 'error', reason, message };
}

function describeHttpFailure(failure: unknown): AuthCallbackResult {
  if (failure instanceof HttpErrorResponse) {
    if (failure.status === 0) {
      return error(
        'network_error',
        'The sign-in server could not be reached. Check your connection and start again.',
      );
    }
    const serverCode = oauthErrorCode(failure.error);
    const detail = serverCode ? ` (${serverCode})` : '';
    return error(
      'token_request_rejected',
      `The sign-in server rejected the request${detail}. Please start again.`,
    );
  }
  return error(
    'unexpected_error',
    'Sign-in failed because of an unexpected error. Please start again.',
  );
}

function oauthErrorCode(body: unknown): string | null {
  if (typeof body !== 'object' || body === null) {
    return null;
  }
  const code = (body as Record<string, unknown>)['error'];
  return typeof code === 'string' && OAUTH_ERROR_CODE_PATTERN.test(code) ? code : null;
}

function describeLogoutFailure(failure: unknown): string {
  if (failure instanceof HttpErrorResponse && failure.status === 0) {
    return 'Logout failed: the server could not be reached. You are still signed in.';
  }
  if (failure instanceof HttpErrorResponse && failure.status === 401) {
    return (
      'Logout failed: the server did not accept your session token, so it was not revoked. ' +
      'You are still signed in on this device; try again or sign in again.'
    );
  }
  return 'Logout failed: the server did not revoke the session. You are still signed in.';
}

/** Reads a string property, or `null` when it is absent or empty. */
function stringField(body: Record<string, unknown>, key: string): string | null {
  const value = body[key];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

/**
 * Accepts the common shapes of a user-info payload: `username` (falling back
 * to `email`) identifies the user, `name` is shown (defaulting to the username
 * part of the identifier), and the photo comes from the first of `photo_url`,
 * `avatar_url`, `profile_photo_url` or `picture`.
 */
function parseUserProfile(response: unknown): UserProfile | null {
  if (typeof response !== 'object' || response === null || Array.isArray(response)) {
    return null;
  }
  const body = response as Record<string, unknown>;
  const username = stringField(body, 'username') ?? stringField(body, 'email');
  if (username === null) {
    return null;
  }
  const displayName = stringField(body, 'name') ?? usernameOf(username);
  const photoCandidate =
    stringField(body, 'photo_url') ??
    stringField(body, 'avatar_url') ??
    stringField(body, 'profile_photo_url') ??
    stringField(body, 'picture');
  return {
    username,
    displayName,
    photoUrl: photoCandidate !== null && /^https?:\/\//i.test(photoCandidate) ? photoCandidate : null,
  };
}
