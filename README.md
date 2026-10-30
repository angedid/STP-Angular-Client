# Smart Trade Platform — Angular Client

Web interface prototype for **Smart Trade Platform (STP)**, a project designed to support supplier credit tracking in informal retail trade across sub-Saharan Africa.

**Project lead:** NKALLA EHAWE Didier Junior  
**Status:** prototype under development; not intended for production use in its current state.

## Why this project exists

In many markets, wholesalers supply goods on credit to vendors, who repay them after selling the goods. Stock issued, product returns and repayments are often recorded on paper. Errors and lost records can lead to disputes and make it difficult for each party to understand their commitments.

STP aims to make these transactions easier to track. Over time, a reliable trading history could help vendors and wholesalers demonstrate their business activity to financial institutions. Lending decisions remain with those institutions; the platform does not guarantee access to credit.

This repository provides a starting point for the web client. Its original technical name, `asso-angular-client`, is still used in `package.json`, configuration files and Angular output paths. Introducing the STP product name does not mean that the technical project has already been renamed.

## Product vision and prototype status

| Audience | Planned STP capabilities | Available in this repository |
| --- | --- | --- |
| Wholesalers | Goods issued on credit, credit limits per vendor, repayments, returns, alerts and dashboards | Not implemented |
| Vendors | Tracking debts, repayments, returns and payment deadlines | Not implemented |
| Banks and financial institutions | Authorized access to trading history and information supporting creditworthiness assessment | Not implemented |
| Web client users | Sign-in and access to a personal area | OAuth/PKCE sign-in, session kept across reloads of the tab, protected routes, account menu with logout (token revocation), profile photo |

Trading history, creditworthiness assessment, payments and financial data sharing are roadmap items. The prototype does not provide them yet. The STP executive summary describes the product vision rather than capabilities already delivered.

## Current scope

The code currently includes:

- a landing page and public navigation toolbar;
- routes for sign-in, registration, the OAuth callback, the user home page and a not-found page;
- a manual implementation of the OAuth 2.0 Authorization Code flow with PKCE (the Angular client is a public client, so no client secret is involved);
- session management: the session survives a reload of the tab, the signed-in routes are protected by a guard that brings the user back to the requested page after sign-in, the access token is attached to API calls by an interceptor, and an expired token is renewed with the refresh token when the server issued one;
- two layouts: visitors get the public toolbar with the registration and sign-in links; signed-in users get a sidebar layout (brand, profile photo and name opening the account menu — Profile, Tenants, Eligibility, Logout —, the main sections and the "Espace" Grossiste/Banque switch) next to the page content;
- a wholesaler dashboard ("Tableau de bord") with key figures and recent vendors, currently fed with placeholder data;
- a Tenant Detail page (Tenants menu entry) showing the tenant of the signed-in user;
- standalone components and a unit test suite that exercises the sign-in, session, access-control and logout rules against mocked HTTP responses.

The registration and user home screens remain minimal, and the Profile and Eligibility entries lead to placeholder screens. Although `angular-oauth2-oidc` is listed as a dependency, the active authentication flow is implemented in `AuthService`.

## Technology stack

Angular 21, TypeScript 5.9, Angular Material, Bootstrap, RxJS and Vitest. Resolved dependency versions are recorded in `package-lock.json`.

## Prerequisites

- A Node.js version compatible with the locked dependencies: `^20.19.0`, `^22.12.0` or `>=24.0.0` for Angular.
- npm; the project manifest declares `npm@11.6.4`.
- To test authentication against a real provider, an OAuth server compatible with the endpoints described below. That server is not included.

The reference commit was checked using Node.js `24.22.1` and npm `11.9.0`.

## Installation and development server

```bash
npm ci
npm start
```

The application is available at `http://localhost:4200/`.

To reproduce the exact installation command verified during the reference commit review:

```bash
npm ci --ignore-scripts --no-audit --no-fund
```

This variant does not run dependency lifecycle scripts. Installation with `npm ci` without `--ignore-scripts` still needs to be checked separately and was not validated during that review.

## OAuth configuration

The public settings of the flow are centralized in `src/app/auth.config.ts`. `DEVELOPMENT_AUTH_CONFIG` holds the development values and is exposed through the `AUTH_CONFIG` injection token. `app.config.ts` provides that token from the build-time environment (`src/environments/`):

| Build / serve configuration | Environment file | `AUTH_CONFIG` |
| --- | --- | --- |
| `production` (default for `ng build`), `development` (default for `ng serve`) | `environment.ts` | `DEVELOPMENT_AUTH_CONFIG` — unchanged behaviour |
| `demo` (`npm run start:demo`, `npm run demo`) | `environment.demo.ts`, substituted by `fileReplacements` | `LOCAL_DEMO_AUTH_CONFIG` (`src/app/auth.config.local-demo.ts`) — the local test provider |

The `demo` configuration is the only one that names the test provider; it is never part of a default or production build. Test modules keep overriding `AUTH_CONFIG` directly.

| Setting | Development value |
| --- | --- |
| `authorizationEndpoint` | `http://localhost:9001/oauth/authorize` |
| `tokenEndpoint` | `http://localhost:9001/oauth/token` |
| `redirectUri` | `http://localhost:4200/oauth/callback` |
| `clientId` | Public client identifier; adapt it to your development server |
| `scope` | Empty (server defaults) |
| `userInfoEndpoint` | `http://localhost:9001/api/user` |
| `logoutEndpoint` | `http://localhost:9001/api/logout` (the URL-encoded username is appended) |
| `logoutMethod` | `POST` |
| `tenantsEndpoint` | `http://localhost:9001/api/tenants` (the tenant UUID is appended) |
| `transactionStorageKey` | `stp.oauth.transaction` (`sessionStorage`) |
| `transactionTtlMs` | 10 minutes |
| `sessionStorageKey` | `stp.oauth.session` (`sessionStorage`) |

No client secret is configured anywhere, and none must ever be added: the browser application is a public client.

### How the flow works

1. `/login` asks `AuthService.startLogin()` to generate a `code_verifier` and, independently, a random `state`. The transaction (`state`, `code_verifier`, redirect URI, creation and expiry times, and the optional in-app `returnUrl` the route guard asked for) is saved in `sessionStorage` for ten minutes, then the browser is redirected to the authorization endpoint with an `S256` code challenge. The `returnUrl` is never sent to the server and only same-origin paths are accepted (`/…`, not `//…` nor absolute URLs), so it cannot be used to redirect the user elsewhere.
2. The authorization server sends the user back to `/oauth/callback`. The component reads the query parameters once and hands them to `AuthService.handleCallback()`.
3. The service validates the `code`, the `state` and the stored transaction **before** contacting the token endpoint. A missing, expired, malformed or mismatching transaction, or an `error` parameter from the server, ends the attempt without any token request. The transaction is always consumed at this point, so the same transaction can never trigger two exchanges, even if the callback is processed more than once.
4. The token request is awaited. The callback screen shows "Signing you in…" until the server answers, then either a success message followed by navigation to the page the sign-in was started from (or `/home`), or an understandable error message with a "Restart sign-in" button. A rejected request, a network failure or an invalid token response all lead to the error screen.
5. Right after the token response, the service calls `userInfoEndpoint` with `Authorization: Bearer <access_token>` to learn who signed in. Sign-in is only reported as successful once that profile is known; if the profile request fails, the token is dropped and the user is invited to start again.
6. Tokens and the profile become the session: `AuthService` keeps them in a signal that drives the interface and writes them through to `sessionStorage` (see below). Reloading `/oauth/callback` after a successful sign-in does not start a second exchange: the restored session is kept and the user is taken to `/home`.

Authorization codes, code verifiers and tokens are never written to the console.

### Session management

The in-memory session signal of `AuthService` is the single source of truth for the interface (layout, sidebar, logout). It is fed by the authentication result at the end of the callback and made durable as follows:

- **Typed model and validation.** `token-response.ts` validates every answer of the token endpoint (authorization-code exchange and refresh alike) before it is trusted: `access_token` non-empty string, `token_type` bearer (case-insensitive), optional `expires_in` as a finite number of seconds ≥ 0 (strings are refused), optional non-empty `refresh_token`, optional `scope`; `null` values count as absent, unknown fields are ignored. A refused response fails the sign-in (`invalid_token_response`) or ends the session (refresh). The validated response is resolved into `SessionTokens` with `expiresAt = receivedAt + expires_in × 1000` (milliseconds, rounded), dated from the instant the response was received; `expires_in: 0` is therefore already expired, and a missing `expires_in` means no local expiry. The session (`AuthSession` = `SessionTokens` + `UserProfile`) is kept in memory in a signal.
- **Injectable clock.** Every expiry decision — token expiry (`now >= expiresAt`), pending-transaction validity, stored-session validity — reads the time through the `CLOCK` injection token (`clock.ts`, defaulting to the wall clock), so tests place themselves at an exact instant (`testing/fake-clock.ts`) rather than racing `Date.now()`. The expiry boundary is exact: valid at `expiresAt − 1 ms`, expired at `expiresAt`.

- **Persistence.** The session (`access_token`, `token_type`, `refresh_token`, announced expiry, profile) is written to `sessionStorage` under `sessionStorageKey` once sign-in succeeds, and read back synchronously when `AuthService` is created, so a reload of the tab keeps the user signed in and the sidebar appears immediately. A stored value that is malformed, or expired without a refresh token, is discarded and removed. `sessionStorage` is scoped to the tab and discarded when it closes: a new tab starts signed out. If storage refuses the write, the user is still signed in for the current page.
- **Route guard.** Every route of the signed-in area (`authRoutes` in `app.routes.ts`) is protected by `authGuard`; the public routes (`/`, `/login`, `/register`, `/oauth/callback`) and the not-found page (`**`, kept last) never are, in any session state. The guard asks `AuthService.ensureValidSession()` — the same rule the interceptor applies before sending a request: a session whose token is valid on the clock passes; a session at or past its expiry instant is first renewed with the refresh token (see below); a visitor, or a session that could not be renewed (then cleared), is sent to `/login?returnUrl=<requested page>` and lands on that page, query string included, after signing in. Only an in-app path (`/…`, never `//…` or an absolute URL) is used as return destination, both when the guard sets it and when `/login` reads it. An unknown path shows the not-found page rather than the sign-in page.
- **Refresh.** The authorization server issues refresh tokens to this public client. `AuthService.refreshSession()` implements the refresh grant of RFC 6749 section 6: `POST {tokenEndpoint}` with `Content-Type: application/x-www-form-urlencoded`, `Accept: application/json`, and the body `grant_type=refresh_token&refresh_token=<stored token>&client_id=<clientId>` (plus `scope=<scope>` when one is configured). No client secret and no `Authorization` header are sent. The answer is a standard token response: the new `access_token` and `expires_in` replace the current ones, the profile is kept, and when the server returns a rotated `refresh_token` it **replaces** the stored one (the previous one is only kept when the server omits it, as non-rotating servers do). The renewed session is written back to `sessionStorage`. Concurrent callers share a single refresh request. **Any failure** — refresh token rejected (`400 invalid_grant`, `401`, …), server unreachable, unreadable answer — clears the session; the guard and the interceptor then redirect to `/login`. If your server uses a different contract, `performRefresh` in `auth.service.ts` is the only place to adjust.
- **Access token on API calls.** `authInterceptor` (registered in `app.config.ts`) adds `Authorization: Bearer <access_token>` to requests sent to the origins of `userInfoEndpoint`, `logoutEndpoint` and `tenantsEndpoint`, never to the token or authorization endpoints, third-party hosts or relative URLs, and never over an `Authorization` header set explicitly (the callback's profile request, made before any session exists, sets its own header and stays outside the interceptor's logic). New API services only need `HttpClient`.
- **Renewal and end of session (`401`), centralised in the interceptor.** For every API request except the logout endpoint:
  - an access token past its announced expiry is renewed *before* the request is sent, so an expired token never travels; if the renewal fails the request is not sent and fails with a local `401`;
  - a `401` answer from the server triggers one refresh and **one retry** of that request (same method, body and URL) with the new token. Requests that fail together trigger a **single** refresh operation — `AuthService.refreshSession()` shares the in-flight request, and a request whose token was already replaced by another request's refresh simply retries with the current token. A request is retried at most once: a `401` on the retry, or on a request that was already sent with a freshly renewed token, ends the session;
  - when the refresh fails or the refresh token is rejected, the session is cleared (memory and storage), the user is sent once to `/login?returnUrl=<current page>`, and the original failure is propagated to the caller, which keeps its own error mapping (`TenantService` reports `session_expired`, and the Tenant Detail page announces it). Further failures of the same wave are ignored while the navigation is in flight or once `/login` is reached, and a late `401` arriving after the session is gone is simply propagated, so it can never wipe the transaction of a sign-in just started from `/login`. Other statuses (`403`, `404`, `5xx`, network failures) never touch the session.
- **Logout is the explicit exception.** The revocation request is sent with the token as it stands (no renewal), and a `401` — like any other failure — never clears the session: only a confirmed revocation signs the user out. `AuthService.logout()` returns an error that the sidebar displays ("the server did not accept your session token, so it was not revoked. You are still signed in…"). This exception does not validate nor prolong the session: an expired session that survives a refused revocation stays expired, its `expiresAt` is untouched, and the next guarded navigation or API request ends it as described above.
- **Sign-out.** `clearSession()` and a confirmed logout remove both the in-memory and the stored session. A failed logout keeps both, so a reload does not silently sign the user out.

### Expected user-info payload

The server is not part of this repository, so `AuthService` reads the profile leniently. The JSON object must provide a `username` (or, failing that, an `email`), which identifies the user in API paths such as the logout URL. `name` is shown in the sidebar; when it is absent, only the username part of the identifier (the portion before the tenant UUID, see below) is shown — never the full `{username}@{tenant_id}` value, which is kept intact in the authentication state and in API requests. The photo is taken from the first of `photo_url`, `avatar_url`, `profile_photo_url` or `picture` and must be an absolute `http(s)` URL; otherwise the default avatar (`public/images/default-avatar.svg`) is shown. Adjust `parseUserProfile` in `auth.service.ts` if your server uses other field names.

### Signed-in layout and dashboard

Once signed in, the page is split into a 240 px navigation column and a main area (`app.html`). The column (`sidebar/`) holds the logo with "STP / Portail Web", the profile photo and the user's name (trigger of the account menu), the sections *Tableau de bord*, *Vendeurs*, *Score portefeuille* and *Alertes*, and the "Espace" switch (`WorkspaceService`, not used by any screen yet). Below 900 px the column becomes a compact header with a horizontally scrollable navigation; below 600 px the dashboard rows stack.

The dashboard (`home/`) shows the establishment name under the title, three key figures (total outstanding credit, active vendors, late alerts) and the recent vendors with their market, outstanding amount and status. **These figures are placeholders** (`PLACEHOLDER_OVERVIEW` in `dashboard.service.ts`, fictitious names): no server endpoint exists for them yet. Replace `DashboardService.getOverview()` when it does. The establishment name is the tenant's `name` when the tenant endpoint answers, and the placeholder otherwise. *Vendeurs*, *Alertes* and *Nouveau crédit* lead to placeholder screens.

The layout reuses the existing theme: the Material 3 rose palette declared in `src/material-theme.scss`, the `#D3045D` brand colour for titles and the white surfaces of the original toolbar; the screenshot's own palette was not adopted.

### Tenant Detail page

The user identifier returned by the user-info endpoint follows the format `{username}@{tenant_id}`, where `tenant_id` is the tenant's UUID (`user-identifier.ts` splits on the last `@`, so usernames containing `@` are supported). When the user opens **Tenants**:

1. The tenant UUID is extracted from the identifier and its format is validated. A malformed identifier or an invalid UUID produces an explicit error and no request is sent.
2. `GET {tenantsEndpoint}/{tenant_id}` (by default `http://localhost:9001/api/tenants/{tenant_id}`, single slash) is called; `authInterceptor` adds `Authorization: Bearer <access_token>`.
3. An expired token (the request is then not sent) or a `401` answer are handled by the interceptor, which clears the local session and redirects the user to `/login`; the service reports `session_expired` so that the page can say so in the meantime. See "Session management" above.
4. The page shows a loading state, then either every top-level property of the returned object (a `{ "data": { ... } }` envelope is unwrapped; `name` becomes the title) or an understandable error with a retry action for transient failures.

If your server really expects the double-slash path `/api//tenants/{tenant_id}`, set `tenantsEndpoint` to `http://localhost:9001/api//tenants`; the client does not normalise the configured value.

### Logout

The Logout entry of the account menu calls `{logoutEndpoint}/{username}` (by default `POST http://localhost:9001/api/logout/{username}`, with the username URL-encoded) with the `Authorization: Bearer` header to revoke the token. Only a successful response clears the local state, returns the user to the landing page and restores the registration and sign-in links. If the revocation is rejected (including with `401`: the logout endpoint is explicitly excluded from the interceptor's end-of-session handling) or the server cannot be reached, the user stays signed in and an error message is displayed in the sidebar; the interface never claims that the logout succeeded, and it never treats the retained session as more valid than it was. Change `logoutMethod` in `auth.config.ts` if your API expects another verb.

`sessionStorage` and the ten-minute validity were chosen so that a transaction stays confined to the tab that started it and cannot be replayed later. Both can be changed in `auth.config.ts` if a project constraint requires it.

### Testing against a development provider

1. Start your development OAuth server.
2. Register a public client with the exact redirect URI shown above. Do not embed a client secret in the Angular application.
3. Update `clientId` and, if needed, the endpoints in `DEVELOPMENT_AUTH_CONFIG`.
4. Configure the server to allow requests from the development client's origin where required for token endpoint calls.
5. Start Angular and open `/login` using a test account.

The local HTTP URLs are for development only. The server, its migrations, user accounts and production configuration are not provided. Do not assume that adding a `.env` file will configure Angular automatically: no such loading mechanism is configured in this repository.

### Local demo without the private server

`tools/mock-oauth-server/` is a stand-in authorization and resource server written with Node.js built-ins only (no extra dependency, nothing added to `npm ci`). It implements the contract described above exactly as `AuthService`, `authInterceptor` and `TenantService` use it, with **fictional** accounts and tenants: no real person, company or credential is represented, and nothing here is meant for production.

```bash
npm run demo          # provider on http://localhost:9001 + Angular (demo configuration) on http://localhost:4200
```

or, in two terminals, `npm run mock:auth` and `npm run start:demo` (`ng serve --configuration demo`). Then open `http://localhost:4200/`, press *Connexion*, and pick an account on the provider's sign-in page.

The client is connected to the provider through an explicit configuration, `LOCAL_DEMO_AUTH_CONFIG` in `src/app/auth.config.local-demo.ts`, selected only by the `demo` configuration (see "OAuth configuration"). It registers this application as the provider's fictional public client (`DEMO_CLIENT` in `tools/mock-oauth-server/fixtures.mjs`: same `clientId`, same redirect URI, no secret) and points the five endpoints at `http://localhost:9001`; the storage keys and lifetimes are those of the development settings, so the session behaviour is identical. The authentication code (`AuthService`, `authInterceptor`, `authGuard`, the stores) is not aware of the demo: it runs unchanged against the provider, which allows CORS from `http://localhost:4200`. A unit test (`auth.config.local-demo.spec.ts`) and a provider test (`client-config.test.mjs`) check that the two sides of this contract agree.

What the provider enforces, so that the client is exercised against realistic rules:

- `client_id` and `redirect_uri` are validated first; when either is wrong the provider shows an error page and **does not redirect** (RFC 6749 §4.1.2.1). Any other problem (`response_type`, missing PKCE) is reported through the redirect URI with the `state`.
- PKCE is mandatory with `S256`; the `code_verifier` is checked against the `code_challenge` at exchange time.
- Authorization codes are single-use and valid for 60 s; a replayed code is refused and revokes the tokens it produced.
- Refresh tokens rotate: the presented one is retired and a new one is returned.
- The sign-in page offers an **Approve** and a **Deny** button (`error=access_denied`).
- Logs contain the method, the path and the status only; codes and tokens are never written out.

Accounts offered on the sign-in page (no password):

| Identifier | Purpose |
| --- | --- |
| `rose.eyenga@7b1c3f0e-5d2a-4c8b-9e6f-1a2b3c4d5e6f` | Name and photo; `/tenants` shows "Établissements Rose Eyenga" |
| `aicha.moussa@c0ffee00-1234-4abc-8def-0123456789ab` | No `name` and no photo: the sidebar falls back to `aicha.moussa` and the default avatar |
| `legacy.user` | No tenant suffix: `/tenants` reports a malformed identifier without sending a request |

Reproducing the manual checks listed below, each with a control of the provider (`http://localhost:9001/` offers them as buttons; they also accept JSON for scripts):

| Scenario to observe in the client | How to trigger it |
| --- | --- |
| Sign-in refused by the server (`authorization_denied`) | Press **Deny** on the sign-in page |
| Token exchange rejected, server error or unreachable (`token_request_rejected`, `network_error`) | Choose a scenario in the "Token exchange scenario" list before approving; the code is consumed either way |
| Failed refresh (`POST /__demo/token-error`) | `{"error":"invalid_grant","times":1}` makes the next token request fail |
| `401` → refresh → retry (`POST /__demo/revoke`) | Revokes every access token; refresh tokens keep working, so the page reloads its data after one refresh |
| `401` → session ended → `/login?returnUrl=…` (`POST /__demo/revoke?refresh=1`) | Revokes everything; the next refresh is refused and the client signs the user out |
| Failed logout, session kept (`POST /__demo/logout-failure`) | `{"enabled":true}` (or `FAIL_LOGOUT=1` at start-up) makes revocation answer `500` |
| Token expiry on the clock | Start with `ACCESS_TOKEN_TTL=30`; the guard and the interceptor renew the token before sending a request once it has expired |

`GET /__demo/state` reports counters and the armed scenarios without any secret value; `POST /__demo/reset` clears everything. Other settings (`PORT`, `CLIENT_ID`, `REDIRECT_URI`, `CLIENT_ORIGIN`, `CODE_TTL`, `REFRESH_TOKEN_TTL`) are documented at the top of `tools/mock-oauth-server/server.mjs`.

#### Simulated interactions

The provider only answers what the client actually calls. Everything below the OAuth rows is a **test-only stub** of the private server's API (`provider.mjs`, section "Test-only stubs"): the smallest answer that lets the screen run, not a model of the real API.

| Interaction of the client | In the demo | Faithful to a real server? |
| --- | --- | --- |
| Redirect to `/oauth/authorize` | Sign-in page listing the fictional accounts; no password, no consent memory | Rules yes (client, redirect URI, PKCE, `state`); the page itself is a stand-in |
| `POST /oauth/token` (code exchange, refresh) | Real grant handling: S256 check, one-time codes, refresh rotation, opaque random tokens | Yes, except that tokens are opaque hex strings (no JWT) and live in memory |
| `GET /api/user` | Fixed profile of the chosen account (`username`, `email`, optional `name` and `photo_url`) | Stub: fields limited to what `parseUserProfile` reads |
| `POST /api/logout/{username}` | Revokes the access and refresh tokens of that session; `403` for another user's name; `500` when the failure scenario is armed | Stub: revocation semantics chosen for the demo |
| `GET /api/tenants/{tenant_id}` | `{ "data": { id, name, market, city, country, plan, created_at } }` for the user's own tenant; `403` for another tenant, `404` when unknown | Stub: fictional fields and access rule |
| Profile photo (`<img src>`) | SVG with the user's initials, generated by the provider | Stub |
| Dashboard figures ("Tableau de bord") | Not requested from the provider: the client still uses `PLACEHOLDER_OVERVIEW` | No server call exists yet |
| Registration (`/register`) | No server call: the screen is a placeholder in the client | Nothing to simulate |
| `401` handling, refresh, session expiry | Triggered from the provider's demo controls, handled by the client's real code | Yes |

The provider has its own test suite, run with Node's built-in runner so that it needs no installation:

```bash
npm run test:mock-auth
```

It covers the rules above (client and redirect URI validation, S256 verification, one-time codes, approval and denial, controlled token errors, refresh rotation, user-info, logout and tenant answers, CORS, secret-free logging) directly and over HTTP. It does not replace the Angular unit tests, which keep mocking the endpoints with `HttpTestingController`.

Fully offline, `index.html` still references Google Fonts for Roboto and the Material Icons font: without network access the interface falls back to system fonts and icon names appear as text. This is cosmetic and unrelated to the provider.

### Browser tests

No browser-testing tool (Playwright, Cypress, WebdriverIO, …) was part of this repository before; the existing automated tests are all Vitest unit/component tests run in jsdom (`npm test`), which cannot drive a real cross-origin redirect to an authorization server or open a second tab, so they could not be reused for this purpose. **[Playwright Test](https://playwright.dev/) was added as a new, standard devDependency** (`@playwright/test`) for that reason.

#### Installation

```bash
npm install                 # already pulls in @playwright/test (see package.json)
npx playwright install chromium   # downloads a Chromium build Playwright manages;
                                   # add --with-deps on a fresh Linux machine
```

This needs to be run once per machine (or CI cache). Nothing else is required: `npx playwright test` starts the provider and the Angular `demo` configuration itself (see `playwright.config.ts`, `webServer`) and stops them afterwards.

On a network that can reach `registry.npmjs.org` but not Playwright's browser-download host, set `E2E_CHROMIUM_EXECUTABLE` to the path of any compatible Chromium/Chrome binary instead of running `playwright install`; `playwright.config.ts` then launches that executable. This is how the suite below was run and verified in the sandboxed environment used to develop it, using [`@sparticuz/chromium`](https://www.npmjs.com/package/@sparticuz/chromium) (a Chromium build distributed as an npm package) as a throwaway, `--no-save` local install — that package is **not** a dependency of this project.

#### Running

```bash
npm run e2e
```

Runs headless against `http://localhost:4200` (the `demo` configuration) and `http://localhost:9001` (the test provider), both started fresh for the run. Add `--ui` or `--headed` (Playwright CLI flags) while working on a test; a trace is kept for any failure (`npx playwright show-trace test-results/.../trace.zip`).

#### What is covered

Each spec file under `e2e/` resets the provider (`POST /__demo/reset`) before its tests and discovers the fictional accounts from `GET /__demo/users` rather than duplicating them, so a test only hardcodes the behaviour it is about:

| File | Scenario | Visible state / route transitions checked |
| --- | --- | --- |
| `sign-in.spec.ts` | Successful sign-in and navigation | Guest toolbar → `/login` → provider → `/home` with the sidebar, the signed-in user's name and the tenant's establishment name; `/home` → `/tenants` → back to `/home` without losing the session |
| `authorization-denial.spec.ts` | Authorization denial | Pressing **Deny** lands on `/oauth/callback` with the `access_denied` message and a *Restart sign-in* action, the route does not move on its own, and the visitor is still sent to `/login` afterwards |
| `token-failure.spec.ts` | Token failure | A code issued but rejected at exchange (`invalid_grant`, `server_error`), an unreachable token endpoint (`network_failure`), and a code consumed by a failed attempt not being exchangeable again — each shown as the matching error screen, never as a session |
| `repeated-callback.spec.ts` | Repeated callback handling | Reloading `/oauth/callback` after success keeps the existing session with **no new token request**; opening the exact redirect link in a **new tab** (a fresh, tab-scoped `sessionStorage`) finds no pending transaction and does not replay the code either — both checked against the provider's request counters, not just the UI |
| `unauthenticated-access.spec.ts` | Unauthenticated protected access | `/tenants` without a session → `/login?returnUrl=%2Ftenants` → back to `/tenants` after sign-in; a crafted `//…` `returnUrl` is rejected and sign-in lands on `/home` instead |
| `logout.spec.ts` | Logout | A confirmed revocation clears `sessionStorage`, restores the guest toolbar and makes guarded routes ask again; a refused revocation (`POST /__demo/logout-failure`) leaves the session, the route and the sidebar exactly as they were, with the error message shown |

Because the redirect chain `guard → /login → provider` (or `/login → provider` directly) can complete before a polling `expect(page).toHaveURL(...)` assertion samples it, tests that need to prove an in-app step was reached use `watchNavigations`/`expectVisited` (`e2e/support.ts`), which records every main-frame navigation as it happens instead of polling for one.

## Verification commands

```bash
npm run build
npm test -- --watch=false
npm run test:mock-auth      # rules of the local test provider and its contract with the demo configuration
npm run e2e                 # browser tests of the authentication flow (needs `npx playwright install chromium` once)
```

The unit tests cover the sign-in, session, access-control, logout and tenant rules without a real server: the token, user-info, logout and tenant endpoints are mocked with Angular's `HttpTestingController`, so rejected requests, network failures, invalid or malformed token responses, the exact expiry boundary (driven by a fake clock), expired or malformed transactions, duplicate callbacks, session restoration after a reload, refreshes (request contract, successful renewal, token rotation, one shared request for concurrent callers, rejected or unreachable refresh ending the session), guarded routes (visitor, valid, expired at the exact instant, renewed, rejected refresh, public and unknown routes, return destinations), `401` answers (refresh and single retry, one refresh for simultaneous failures, single redirect, logout exception, expired session never revived) and failed revocations are all verified offline.

To check session management against a development provider: sign in, press F5 on `/home` (the sidebar must stay), open `/tenants` by URL, then close the tab and reopen the application (signed out, as expected with `sessionStorage`). As a visitor, open `/tenants` directly: you must land on `/login?returnUrl=%2Ftenants` and, after signing in, on `/tenants`. Logout must remove `stp.oauth.session` from DevTools › Application › Session Storage and restore the toolbar; a failed logout must leave it in place. To see the `401` handling, revoke the token server-side (or wait for it to expire) and open `/tenants`: the page must briefly say "Session expired", then land on `/login?returnUrl=%2Ftenants`, with a single navigation even if several requests failed.

## Relevant source files

| Path under `src/app/` | Purpose |
| --- | --- |
| `auth.config.ts` | Centralized public OAuth settings (`AUTH_CONFIG`) |
| `auth.service.ts` | Authorization request, callback validation, token exchange, profile loading, session (restored from storage), refresh grant with rotation and logout |
| `auth-transaction.ts` | `sessionStorage` store for the pending transaction (single use, time-limited, optional `returnUrl`) |
| `token-response.ts` | Typed token-response model, validation and expiry calculation (`expiresAt`, `isExpiredAt`) |
| `clock.ts` | `CLOCK` injection token (current time), defaulting to the wall clock; `testing/fake-clock.ts` for tests |
| `auth-session.ts` | Session and profile types; `sessionStorage` store for the signed-in session (validated on load) |
| `auth.guard.ts` | `authGuard`: lets valid (or renewed) sessions through, sends everyone else to `/login` with an in-app `returnUrl` |
| `session-routing.spec.ts` | Routing tests against the real route table, guard, interceptor and `AuthService`: visitor, signed-in, expired and renewed sessions, return destinations, unknown routes |
| `auth.interceptor.ts` | Adds `Authorization: Bearer` to API requests; renews the token before expiry and on `401` (one shared refresh, one retry per request); ends the session and redirects once to `/login` when renewal fails (logout excepted) |
| `pkce.ts` | Pure PKCE and `state` helpers (random values, SHA-256, S256 challenge) |
| `app.routes.ts` | Public and guarded user routes; the wildcard route is last |
| `user-identifier.ts` | Parsing and validation of the `{username}@{tenant_id}` identifier |
| `tenant.service.ts` | Tenant lookup with identifier and UUID checks before the request; tenant-specific error mapping |
| `tenant-detail/` | Tenant Detail page (loading, success, expired-session and error states) |
| `guest-toolbar/` | Top bar of the public pages (registration and sign-in links) |
| `sidebar/` | Navigation column of the signed-in layout: brand, account menu, sections, "Espace" switch |
| `page-header/` | Title band shared by the signed-in pages |
| `dashboard.service.ts` | Dashboard figures (placeholder data for now) |
| `fcfa.pipe.ts` | `94000` → `94 000 FCFA` |
| `workspace.service.ts` | Selected "Espace" (Grossiste or Banque) |
| `profile-photo/` | Profile photo of the signed-in user, with a default avatar fallback |
| `placeholder/` | Stand-in screen for Profile, Eligibility, Vendeurs, Alertes and Nouveau crédit |
| `app.config.ts` | Application provider configuration; provides `AUTH_CONFIG` from the build-time environment |
| `auth.config.local-demo.ts` | `LOCAL_DEMO_AUTH_CONFIG`: explicit settings of the local demo against the test provider (`demo` configuration only) |
| `../environments/` | `environment.ts` (development settings, also used by production builds) and `environment.demo.ts` (local demo), swapped by `fileReplacements` |
| `login/` | Sign-in initiation |
| `authorization-callback/` | OAuth callback handling |
| `home/` | Dashboard ("Tableau de bord") |
| `register/` | Minimal registration screen |

Outside `src/app/`, `tools/mock-oauth-server/` holds the local OAuth test provider (`provider.mjs` rules and test-only API stubs, `http.mjs` adapter, `server.mjs` entry point, `fixtures.mjs` fictional data, `*.test.mjs` tests) and `tools/local-demo.mjs` starts the provider and the Angular `demo` configuration together; see "Local demo without the private server". `playwright.config.ts` and `e2e/` (`support.ts` helpers, one spec file per scenario) hold the browser tests described in "Browser tests".

## Next development step

The business screens (credit, repayments, returns) can now be built on the session: new API services only need `HttpClient`, the interceptor adds the token. Open point on the session side: if sign-in must be shared across tabs, swap the store to `localStorage` with a `storage`-event listener.

Use development data and accounts only.


## License

Original code for which the copyright holder owns the relevant rights is proposed under the MIT License; see [LICENSE](LICENSE). Dependencies and third-party content remain subject to their respective licenses. This license does not authorize the use of real personal data or transfer rights belonging to third parties.

## Product background

The product vision is based on “Smart Trade Platform — Executive Summary,” version 1.0, August 2026, by Didier Junior NKALLA EHAWE. The future capabilities described above are development goals.
