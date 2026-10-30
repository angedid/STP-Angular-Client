import { AuthConfig } from './auth.config';

/**
 * Settings of the local demo: the client talks to the test provider of
 * `tools/mock-oauth-server/` instead of the private server.
 *
 * Selected by `ng serve --configuration demo` (see `environment.demo.ts`),
 * never by a default or production build. The values are written out in full
 * on purpose: they are the contract with `tools/mock-oauth-server/fixtures.mjs`
 * (client id, redirect URI) and `server.mjs` (origin, paths), and they must
 * stay valid even if `DEVELOPMENT_AUTH_CONFIG` is later pointed elsewhere.
 *
 * Only the endpoints and the client registration differ from a real
 * deployment; the flow, the storage keys and the lifetimes are the same, so
 * the demo exercises the very code paths used against a real server.
 */
export const LOCAL_DEMO_AUTH_CONFIG: AuthConfig = {
  // Sign-in page of the test provider (fictional accounts, Approve/Deny).
  authorizationEndpoint: 'http://localhost:9001/oauth/authorize',
  // Authorization-code (PKCE S256) and refresh grants; form-encoded requests.
  tokenEndpoint: 'http://localhost:9001/oauth/token',
  // Fictional public client registered in `fixtures.mjs` as DEMO_CLIENT.
  clientId: '019cf354-99fe-7116-b8cd-c0a3a648e102',
  // Registered verbatim on the provider; any other value is refused without a redirect.
  redirectUri: 'http://localhost:4200/oauth/callback',
  scope: '',
  // Test-only stubs of the private server's API (see README, "Simulated interactions").
  userInfoEndpoint: 'http://localhost:9001/api/user',
  logoutEndpoint: 'http://localhost:9001/api/logout',
  logoutMethod: 'POST',
  tenantsEndpoint: 'http://localhost:9001/api/tenants',
  // Same storage keys and lifetimes as the development settings.
  transactionStorageKey: 'stp.oauth.transaction',
  transactionTtlMs: 10 * 60 * 1000,
  sessionStorageKey: 'stp.oauth.session',
};
