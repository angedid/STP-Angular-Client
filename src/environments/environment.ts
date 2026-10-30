import { AuthConfig, DEVELOPMENT_AUTH_CONFIG } from '../app/auth.config';

/**
 * Build-time environment of the default, development and production
 * configurations: the OAuth settings are the development ones, exactly as
 * before this file existed. `ng serve --configuration demo` replaces this
 * file with `environment.demo.ts` (see `fileReplacements` in `angular.json`).
 */
export const environment: { readonly name: string; readonly authConfig: AuthConfig } = {
  name: 'default',
  authConfig: DEVELOPMENT_AUTH_CONFIG,
};
