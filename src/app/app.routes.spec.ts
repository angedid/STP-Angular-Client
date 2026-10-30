import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ActivatedRouteSnapshot, provideRouter, Router } from '@angular/router';

import { routes } from './app.routes';
import { AuthService } from './auth.service';
import { AuthorizationCallbackComponent } from './authorization-callback/authorization-callback.component';
import { FourOFour } from './four-ofour/four-ofour';
import { HomeComponent } from './home/home.component';
import { LoginComponent } from './login/login.component';
import { PlaceholderComponent } from './placeholder/placeholder.component';
import { TenantDetailComponent } from './tenant-detail/tenant-detail.component';

describe('routes', () => {
  let router: Router;
  const isAuthenticated = signal(true);
  let authService: {
    isAuthenticated: typeof isAuthenticated;
    ensureValidSession: () => Promise<boolean>;
  };

  const leafComponent = (): unknown => {
    let snapshot: ActivatedRouteSnapshot = router.routerState.snapshot.root;
    while (snapshot.firstChild) {
      snapshot = snapshot.firstChild;
    }
    return snapshot.component;
  };

  beforeEach(() => {
    isAuthenticated.set(true);
    authService = { isAuthenticated, ensureValidSession: async () => isAuthenticated() };
    TestBed.configureTestingModule({
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AuthService, useValue: authService },
      ],
    });
    router = TestBed.inject(Router);
  });

  it('keeps the wildcard route last', () => {
    expect(routes.at(-1)?.path).toBe('**');
    expect(routes.filter((route) => route.path === '**')).toHaveLength(1);
  });

  it('resolves the signed-in home page instead of the not-found page', async () => {
    await expect(router.navigateByUrl('/home')).resolves.toBe(true);
    expect(leafComponent()).toBe(HomeComponent);
  });

  it('resolves the OAuth callback route', async () => {
    await expect(router.navigateByUrl('/oauth/callback?code=abc&state=xyz')).resolves.toBe(true);
    expect(leafComponent()).toBe(AuthorizationCallbackComponent);
  });

  it('resolves the login route', async () => {
    await expect(router.navigateByUrl('/login')).resolves.toBe(true);
    expect(leafComponent()).toBe(LoginComponent);
  });

  it.each(['/profile', '/eligibility', '/vendors', '/alerts', '/credits/new'])(
    'resolves the placeholder route %s',
    async (path) => {
      await expect(router.navigateByUrl(path)).resolves.toBe(true);
      expect(leafComponent()).toBe(PlaceholderComponent);
    },
  );

  it('resolves the Tenants menu entry to the tenant detail page', async () => {
    await expect(router.navigateByUrl('/tenants')).resolves.toBe(true);
    expect(leafComponent()).toBe(TenantDetailComponent);
  });

  it('falls back to the not-found page for unknown paths', async () => {
    await expect(router.navigateByUrl('/does-not-exist')).resolves.toBe(true);
    expect(leafComponent()).toBe(FourOFour);
  });

  describe('access control', () => {
    const protectedPaths = [
      '/home',
      '/profile',
      '/tenants',
      '/eligibility',
      '/vendors',
      '/alerts',
      '/credits/new',
    ];

    it.each(protectedPaths)(
      'sends visitors opening %s to the sign-in page with a returnUrl',
      async (path) => {
        isAuthenticated.set(false);

        await expect(router.navigateByUrl(path)).resolves.toBe(true);

        expect(leafComponent()).toBe(LoginComponent);
        expect(router.url).toBe(`/login?returnUrl=${encodeURIComponent(path)}`);
      },
    );

    it('keeps the query string of the requested page in the returnUrl', async () => {
      isAuthenticated.set(false);

      await router.navigateByUrl('/vendors?page=2');

      expect(router.parseUrl(router.url).queryParams['returnUrl']).toBe('/vendors?page=2');
    });

    it('leaves the public pages reachable without a session', async () => {
      isAuthenticated.set(false);

      await expect(router.navigateByUrl('/login')).resolves.toBe(true);
      expect(leafComponent()).toBe(LoginComponent);
      await expect(router.navigateByUrl('/oauth/callback?code=abc&state=xyz')).resolves.toBe(true);
      expect(leafComponent()).toBe(AuthorizationCallbackComponent);
    });

  });
});
