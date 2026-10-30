import { TestBed } from '@angular/core/testing';
import {
  ActivatedRouteSnapshot,
  provideRouter,
  Router,
  RouterStateSnapshot,
  UrlTree,
} from '@angular/router';

import { authGuard } from './auth.guard';
import { AuthService } from './auth.service';

/**
 * Unit tests with a stubbed `AuthService`; the real session rules (expiry,
 * refresh, clearing) are exercised against the route table in
 * `session-routing.spec.ts`.
 */
describe('authGuard', () => {
  let router: Router;
  let ensureValidSession: ReturnType<typeof vi.fn>;

  const run = (url = '/tenants'): Promise<boolean | UrlTree> =>
    TestBed.runInInjectionContext(() =>
      Promise.resolve(
        authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot) as
          | boolean
          | UrlTree
          | Promise<boolean | UrlTree>,
      ),
    );

  beforeEach(() => {
    ensureValidSession = vi.fn().mockResolvedValue(false);
    TestBed.configureTestingModule({
      providers: [provideRouter([]), { provide: AuthService, useValue: { ensureValidSession } }],
    });
    router = TestBed.inject(Router);
  });

  it('lets a valid session through', async () => {
    ensureValidSession.mockResolvedValue(true);

    await expect(run()).resolves.toBe(true);
    expect(ensureValidSession).toHaveBeenCalledTimes(1);
  });

  it('redirects to the sign-in page with the requested URL otherwise', async () => {
    const result = await run('/tenants?tab=1');

    expect(result).toBeInstanceOf(UrlTree);
    expect(router.serializeUrl(result as UrlTree)).toBe('/login?returnUrl=%2Ftenants%3Ftab%3D1');
  });

  it('waits for the session check before deciding', async () => {
    let decide!: (valid: boolean) => void;
    ensureValidSession.mockReturnValue(new Promise<boolean>((resolve) => (decide = resolve)));
    let settled = false;

    const pending = run().then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    decide(true);
    await expect(pending).resolves.toBe(true);
  });

  it('only uses an in-app path as return destination', async () => {
    const result = await run('//evil.test/phish');

    expect(router.serializeUrl(result as UrlTree)).toBe('/login');
  });
});
