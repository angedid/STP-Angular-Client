#!/usr/bin/env node
/**
 * Local OAuth 2.0 test provider for the Angular client.
 *
 * Stands in for the private server during development: authorization code
 * flow with PKCE (S256), refresh grant with rotation, user-info, logout and
 * tenant endpoints, all answered from the fictional fixtures. No dependency
 * beyond Node.js itself.
 *
 *   npm run mock:auth
 *
 * Environment variables (all optional):
 *   PORT               listening port (default 9001, as in auth.config.ts)
 *   ISSUER             public origin used in photo URLs (default http://localhost:PORT)
 *   CLIENT_ID          overrides the registered public client id
 *   REDIRECT_URI       overrides the registered redirect URI (comma-separated list allowed)
 *   CLIENT_ORIGIN      origins allowed by CORS (comma-separated; default http://localhost:4200)
 *   ACCESS_TOKEN_TTL   access token lifetime in seconds (default 300)
 *   REFRESH_TOKEN_TTL  refresh token lifetime in seconds (default 86400)
 *   CODE_TTL           authorization code lifetime in seconds (default 60)
 *   FAIL_LOGOUT        "1" makes every revocation answer 500 until reset
 */

import { createServer } from 'node:http';
import { createRequestHandler } from './http.mjs';
import { DEMO_CLIENT, DEMO_TENANTS, DEMO_USERS } from './fixtures.mjs';
import {
  DEFAULT_ACCESS_TOKEN_TTL_SECONDS,
  DEFAULT_CODE_TTL_SECONDS,
  DEFAULT_REFRESH_TOKEN_TTL_SECONDS,
  createProvider,
} from './provider.mjs';

function positiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function list(value, fallback) {
  const items = (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return items.length > 0 ? items : fallback;
}

const env = process.env;
const port = positiveInteger(env.PORT, 9001);
const issuer = env.ISSUER ?? `http://localhost:${port}`;
const allowedOrigins = list(env.CLIENT_ORIGIN, ['http://localhost:4200']);

const client = {
  ...DEMO_CLIENT,
  id: env.CLIENT_ID ?? DEMO_CLIENT.id,
  redirectUris: list(env.REDIRECT_URI, DEMO_CLIENT.redirectUris),
};

const provider = createProvider({
  clients: [client],
  users: DEMO_USERS,
  tenants: DEMO_TENANTS,
  issuer,
  codeTtlSeconds: positiveInteger(env.CODE_TTL, DEFAULT_CODE_TTL_SECONDS),
  accessTokenTtlSeconds: positiveInteger(env.ACCESS_TOKEN_TTL, DEFAULT_ACCESS_TOKEN_TTL_SECONDS),
  refreshTokenTtlSeconds: positiveInteger(env.REFRESH_TOKEN_TTL, DEFAULT_REFRESH_TOKEN_TTL_SECONDS),
});
if (env.FAIL_LOGOUT === '1') {
  provider.setLogoutFailure(true);
}

const server = createServer(
  createRequestHandler(provider, {
    allowedOrigins,
    log: (line) => console.log(`[mock-oauth] ${new Date().toISOString()} ${line}`),
  }),
);

server.listen(port, () => {
  console.log(`Local OAuth test provider listening on ${issuer}`);
  console.log(`  client id     : ${client.id}`);
  console.log(`  redirect URIs : ${client.redirectUris.join(', ')}`);
  console.log(`  CORS origins  : ${allowedOrigins.join(', ')}`);
  console.log(`  access token  : ${provider.accessTokenTtlSeconds}s`);
  console.log('  accounts      :');
  for (const user of DEMO_USERS) {
    console.log(`    - ${user.username}`);
  }
  console.log(`  demo controls : ${issuer}/ (revoke tokens, fail logout, token errors, reset)`);
  console.log('Fictional data only. Press Ctrl+C to stop.');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}
