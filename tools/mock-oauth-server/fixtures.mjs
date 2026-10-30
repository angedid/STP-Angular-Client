/**
 * Fictional data of the local OAuth test provider.
 *
 * Everything here is invented for the demo: no real person, company, account
 * or credential is represented. The identifiers follow the conventions the
 * Angular client expects (`{username}@{tenant_uuid}`, UUID tenant ids) so
 * that every screen of the client can be exercised without the private
 * server.
 */

/**
 * The Angular application, registered as a *public* client: no secret exists
 * anywhere. `id` and `redirectUris` mirror `DEVELOPMENT_AUTH_CONFIG` in
 * `src/app/auth.config.ts`; change them together or override them with the
 * `CLIENT_ID` / `REDIRECT_URI` environment variables of `server.mjs`.
 */
export const DEMO_CLIENT = Object.freeze({
  id: '019cf354-99fe-7116-b8cd-c0a3a648e102',
  name: 'Smart Trade Platform — Angular client (public, PKCE)',
  redirectUris: Object.freeze(['http://localhost:4200/oauth/callback']),
});

/** Fictional tenants (wholesaler establishments). */
export const DEMO_TENANTS = Object.freeze([
  Object.freeze({
    id: '7b1c3f0e-5d2a-4c8b-9e6f-1a2b3c4d5e6f',
    name: 'Établissements Rose Eyenga',
    market: 'Marché Mokolo',
    city: 'Yaoundé',
    country: 'CM',
    plan: 'pilot',
    created_at: '2025-03-12T08:30:00Z',
  }),
  Object.freeze({
    id: 'c0ffee00-1234-4abc-8def-0123456789ab',
    name: 'Maison Moussa & Fils',
    market: 'Marché Central',
    city: 'Douala',
    country: 'CM',
    plan: 'pilot',
    created_at: '2025-06-01T10:00:00Z',
  }),
]);

/**
 * Fictional users. There is no password: the authorization page simply lets
 * the tester pick one of them.
 *
 * - `rose.eyenga` has a name and a photo, and belongs to the first tenant;
 * - `aicha.moussa` has no `name` and no photo, so the client falls back to the
 *   username part of the identifier and to the default avatar;
 * - `legacy.user` has no tenant suffix: the Tenants page must report a
 *   malformed identifier without sending any request.
 */
export const DEMO_USERS = Object.freeze([
  Object.freeze({
    id: 1,
    username: `rose.eyenga@${DEMO_TENANTS[0].id}`,
    name: 'Rose Eyenga',
    email: 'rose.eyenga@example.test',
    /** Path, relative to the provider origin, of the generated avatar. */
    photoPath: '/images/avatars/rose-eyenga.svg',
    label: 'Rose Eyenga — wholesaler, Établissements Rose Eyenga',
  }),
  Object.freeze({
    id: 2,
    username: `aicha.moussa@${DEMO_TENANTS[1].id}`,
    name: null,
    email: 'aicha.moussa@example.test',
    photoPath: null,
    label: 'Aïcha Moussa — wholesaler, Maison Moussa & Fils (no display name, no photo)',
  }),
  Object.freeze({
    id: 3,
    username: 'legacy.user',
    name: 'Legacy User',
    email: 'legacy.user@example.test',
    photoPath: null,
    label: 'Legacy User — account without tenant (Tenants page shows an identifier error)',
  }),
]);
