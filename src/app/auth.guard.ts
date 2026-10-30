import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { isSafeReturnUrl } from './auth-transaction';

/**
 * Protects the signed-in routes with the validity of the session.
 *
 * Activation is allowed when {@link AuthService.ensureValidSession} confirms
 * a session whose token is valid on the clock, renewing it first with the
 * refresh token when it has expired. Otherwise (visitor, or expired session
 * that could not be renewed, which is then cleared) the user is sent to
 * `/login`. The requested URL travels as `returnUrl` so that the sign-in
 * brings the user back; only an in-app path is ever used as destination.
 */
export const authGuard: CanActivateFn = async (_route, state) => {
  const authService = inject(AuthService);
  const router = inject(Router);

  if (await authService.ensureValidSession()) {
    return true;
  }
  const queryParams = isSafeReturnUrl(state.url) ? { returnUrl: state.url } : {};
  return router.createUrlTree(['/login'], { queryParams });
};
