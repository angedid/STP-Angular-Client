import { AuthConfig } from '../app/auth.config';
import { LOCAL_DEMO_AUTH_CONFIG } from '../app/auth.config.local-demo';

/**
 * Environment of the local demo (`ng serve --configuration demo`): the client
 * is pointed at the test provider of `tools/mock-oauth-server/`. Substituted
 * for `environment.ts` by `fileReplacements`; never part of other builds.
 */
export const environment: { readonly name: string; readonly authConfig: AuthConfig } = {
  name: 'local-demo',
  authConfig: LOCAL_DEMO_AUTH_CONFIG,
};
