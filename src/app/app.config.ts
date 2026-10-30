import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideRouter } from '@angular/router';

import { environment } from '../environments/environment';
import { routes } from './app.routes';
import { AUTH_CONFIG } from './auth.config';
import { authInterceptor } from './auth.interceptor';

/**
 * Application providers.
 *
 * The OAuth settings (`AUTH_CONFIG`, see `auth.config.ts`) are taken from the
 * build-time environment: the development values by default and in
 * production, the local-demo values under `ng serve --configuration demo`
 * (`src/environments/`). `authInterceptor` adds the access token to API calls.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    { provide: AUTH_CONFIG, useValue: environment.authConfig },
  ],
};
