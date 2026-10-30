import { InjectionToken } from '@angular/core';

/**
 * Public settings of the OAuth 2.0 Authorization Code + PKCE flow.
 *
 * Everything here is safe to ship to the browser. A public client never holds a
 * client secret, so none is (or should ever be) part of this configuration.
 */
export interface AuthConfig {
  /** Authorization endpoint the user is redirected to in order to sign in. */
  readonly authorizationEndpoint: string;
  /** Token endpoint used to exchange the authorization code. */
  readonly tokenEndpoint: string;
  /** Identifier of the public client registered on the authorization server. */
  readonly clientId: string;
  /** Redirect URI registered for that client. Must match exactly. */
  readonly redirectUri: string;
  /** Space-separated scopes. An empty string requests the default scopes. */
  readonly scope: string;
  /**
   * Endpoint returning the signed-in user's profile as JSON, called with the
   * access token right after the token exchange.
   */
  readonly userInfoEndpoint: string;
  /**
   * Base of the token revocation endpoint; the URL-encoded username is appended
   * as a path segment (`{logoutEndpoint}/{username}`).
   */
  readonly logoutEndpoint: string;
  /** HTTP method expected by the revocation endpoint. */
  readonly logoutMethod: 'POST' | 'DELETE' | 'GET';
  /**
   * Base of the tenant resource; the tenant UUID is appended as a path segment
   * (`{tenantsEndpoint}/{tenant_id}`).
   */
  readonly tenantsEndpoint: string;
  /** `sessionStorage` key under which the pending transaction is kept. */
  readonly transactionStorageKey: string;
  /** How long a pending transaction stays valid, in milliseconds. */
  readonly transactionTtlMs: number;
  /**
   * `sessionStorage` key under which the signed-in session (tokens and
   * profile) is kept so that it survives a reload of the same browser tab.
   */
  readonly sessionStorageKey: string;
}

/**
 * Development settings for the local authorization server.
 *
 * The server itself is not part of this repository. Register a public client
 * with the redirect URI below and put its identifier in `clientId`.
 */
export const DEVELOPMENT_AUTH_CONFIG: AuthConfig = {
  authorizationEndpoint: 'http://localhost:9001/oauth/authorize',
  tokenEndpoint: 'http://localhost:9001/oauth/token',
  clientId: '019cf354-99fe-7116-b8cd-c0a3a648e102',
  redirectUri: 'http://localhost:4200/oauth/callback',
  scope: '',
  userInfoEndpoint: 'http://localhost:9001/api/user',
  logoutEndpoint: 'http://localhost:9001/api/logout',
  logoutMethod: 'POST',
  tenantsEndpoint: 'http://localhost:9001/api/tenants',
  transactionStorageKey: 'stp.oauth.transaction',
  transactionTtlMs: 10 * 60 * 1000,
  sessionStorageKey: 'stp.oauth.session',
};

/**
 * Injection token resolving to the active {@link AuthConfig}.
 *
 * Defaults to {@link DEVELOPMENT_AUTH_CONFIG}; override it in `app.config.ts`
 * or in a test module to point the flow at another server.
 */
export const AUTH_CONFIG = new InjectionToken<AuthConfig>('AUTH_CONFIG', {
  providedIn: 'root',
  factory: () => DEVELOPMENT_AUTH_CONFIG,
});
