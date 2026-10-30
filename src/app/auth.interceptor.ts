import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject, Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { from, Observable, throwError } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AUTH_CONFIG, AuthConfig } from './auth.config';
import { AuthService } from './auth.service';
import { isSafeReturnUrl } from './auth-transaction';

/** Origin (`scheme://host[:port]`) of an absolute URL, or `null` when it is not one. */
function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

function withoutQuery(url: string): string {
  return url.split('?')[0];
}

/**
 * Origins that receive the access token: those of the API endpoints named in
 * the configuration. The token endpoint is excluded even when it shares an
 * origin, since OAuth requests must never carry a bearer token.
 */
export function protectedOrigins(config: AuthConfig): ReadonlySet<string> {
  const origins = [config.userInfoEndpoint, config.logoutEndpoint, config.tenantsEndpoint]
    .map(originOf)
    .filter((origin): origin is string => origin !== null);
  return new Set(origins);
}

/** `true` when a request to `url` should carry the access token. */
export function isProtectedUrl(url: string, config: AuthConfig): boolean {
  const origin = originOf(url);
  if (origin === null || !protectedOrigins(config).has(origin)) {
    return false;
  }
  const requestUrl = withoutQuery(url);
  return (
    requestUrl !== withoutQuery(config.tokenEndpoint) &&
    requestUrl !== withoutQuery(config.authorizationEndpoint)
  );
}

/** `true` for the revocation endpoint (`{logoutEndpoint}` or `{logoutEndpoint}/{username}`). */
export function isLogoutUrl(url: string, config: AuthConfig): boolean {
  const requestUrl = withoutQuery(url);
  const base = withoutQuery(config.logoutEndpoint);
  return requestUrl === base || requestUrl.startsWith(`${base}/`);
}

/**
 * Ends the local session when it can no longer be used, and sends the user to
 * the sign-in page.
 *
 * The session is cleared when it still exists (a failed refresh has usually
 * already cleared it); clearing is skipped otherwise so that the pending
 * transaction of a sign-in just started from `/login` is never wiped. Several
 * requests often fail together (a page loads more than one resource): a
 * single navigation is started, and further calls are ignored while it is in
 * flight or once the sign-in page is reached.
 */
@Injectable({ providedIn: 'root' })
export class SessionEndHandler {
  private readonly authService = inject(AuthService);
  private readonly router = inject(Router);
  private redirecting: Promise<boolean> | null = null;

  endSession(): void {
    if (this.authService.isAuthenticated()) {
      this.authService.clearSession();
    }

    const current = this.router.url;
    if (this.redirecting !== null || current.startsWith('/login')) {
      return;
    }
    const queryParams = isSafeReturnUrl(current) && current !== '/' ? { returnUrl: current } : {};
    this.redirecting = this.router
      .navigateByUrl(this.router.createUrlTree(['/login'], { queryParams }))
      .finally(() => {
        this.redirecting = null;
      });
  }
}

function withBearer(request: HttpRequest<unknown>, accessToken: string): HttpRequest<unknown> {
  return request.clone({ setHeaders: { Authorization: `Bearer ${accessToken}` } });
}

/** The answer a caller gets when its request was not sent because the session is over. */
function sessionExpiredResponse(url: string): HttpErrorResponse {
  return new HttpErrorResponse({
    status: 401,
    statusText: 'Unauthorized',
    url,
    error: { error: 'session_expired' },
  });
}

function isUnauthorized(failure: unknown): failure is HttpErrorResponse {
  return failure instanceof HttpErrorResponse && failure.status === 401;
}

/** Token to send with a request, and whether it was just obtained by a refresh. */
interface TokenChoice {
  readonly accessToken: string;
  readonly renewed: boolean;
}

/**
 * Token for the first attempt: the current one while it is valid, a renewed
 * one when it had expired (same rule as the route guard, through
 * `AuthService.ensureValidSession`), or `null` when the session is over.
 */
async function initialToken(authService: AuthService): Promise<TokenChoice | null> {
  const renewed = authService.isSessionExpired();
  if (!(await authService.ensureValidSession())) {
    return null;
  }
  const accessToken = authService.getAccessToken();
  return accessToken === null ? null : { accessToken, renewed };
}

/**
 * Token for a retry after the server rejected `rejectedToken`: the current
 * one when another request already renewed the session in the meantime (so
 * that concurrent failures trigger a single refresh), otherwise the outcome of
 * a refresh. `null` when the session could not be renewed.
 */
async function renewedToken(
  authService: AuthService,
  rejectedToken: string,
): Promise<TokenChoice | null> {
  const current = authService.getAccessToken();
  if (current !== null && current !== rejectedToken && !authService.isSessionExpired()) {
    return { accessToken: current, renewed: true };
  }
  const renewed = await authService.refreshSession();
  const accessToken = authService.getAccessToken();
  return renewed && accessToken !== null ? { accessToken, renewed: true } : null;
}

/**
 * Attaches `Authorization: Bearer <access_token>` to the API requests of the
 * signed-in user, renews the session with the refresh token when needed, and
 * ends the session when it can no longer be used.
 *
 * Only requests to the configured API origins are touched, never the OAuth
 * endpoints nor third-party hosts, and a request that already carries an
 * `Authorization` header is left as is (this is how the profile request of the
 * callback, made before any session exists, stays outside this logic).
 *
 * For API requests:
 * - an access token past its announced expiry is renewed before the request
 *   is sent, so that an expired token never travels;
 * - a `401` answer triggers one refresh and one retry of that request with the
 *   new token. Requests failing together share a single refresh
 *   (`AuthService.refreshSession` deduplicates it, and a request whose token
 *   was already replaced by another one's refresh simply retries). A request
 *   is retried at most once: a `401` on the retry, or on a request that was
 *   already sent with a freshly renewed token, ends the session;
 * - when the refresh fails or the refresh token is rejected, the session is
 *   cleared, the user is sent to `/login` once, and the original failure is
 *   propagated so that callers keep their own error handling.
 *
 * The logout endpoint is the explicit exception: its request is sent with the
 * token as it stands, without renewal nor retry, and a `401` (or any failure)
 * never clears the session, because only a confirmed revocation may sign the
 * user out. This exception does not validate nor prolong the session: an
 * expired session stays expired and the route guard keeps treating it as such.
 */
export const authInterceptor: HttpInterceptorFn = (request, next) => {
  const config = inject(AUTH_CONFIG);
  const authService = inject(AuthService);
  const sessionEnd = inject(SessionEndHandler);

  if (request.headers.has('Authorization') || !isProtectedUrl(request.url, config)) {
    return next(request);
  }
  const accessToken = authService.getAccessToken();
  if (accessToken === null) {
    return next(request);
  }

  if (isLogoutUrl(request.url, config)) {
    return next(withBearer(request, accessToken));
  }

  const endSession = (failure: unknown): Observable<never> => {
    sessionEnd.endSession();
    return throwError(() => failure);
  };

  const attempt = (choice: TokenChoice, isRetry: boolean): ReturnType<typeof next> =>
    next(withBearer(request, choice.accessToken)).pipe(
      catchError((failure: unknown) => {
        if (!isUnauthorized(failure)) {
          return throwError(() => failure);
        }
        if (authService.getAccessToken() === null) {
          // Late failure: the session was already ended (and the user
          // redirected) because of another request.
          return throwError(() => failure);
        }
        if (isRetry || choice.renewed) {
          return endSession(failure);
        }
        return from(renewedToken(authService, choice.accessToken)).pipe(
          switchMap((retryChoice) =>
            retryChoice === null ? endSession(failure) : attempt(retryChoice, true),
          ),
        );
      }),
    );

  return from(initialToken(authService)).pipe(
    switchMap((choice) =>
      choice === null ? endSession(sessionExpiredResponse(request.url)) : attempt(choice, false),
    ),
  );
};
