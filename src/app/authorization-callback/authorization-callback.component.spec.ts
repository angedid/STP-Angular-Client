import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from '@angular/router';

import { AuthCallbackResult, AuthService } from '../auth.service';
import { AuthorizationCallbackComponent } from './authorization-callback.component';

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

/** Lets pending promise callbacks run, then waits for change detection. */
async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await fixture.whenStable();
}

describe('AuthorizationCallbackComponent', () => {
  let fixture: ComponentFixture<AuthorizationCallbackComponent>;
  let authService: {
    handleCallback: ReturnType<typeof vi.fn>;
    startLogin: ReturnType<typeof vi.fn>;
    isAuthenticated: ReturnType<typeof vi.fn>;
  };
  let router: Router;
  let exchange: Deferred<AuthCallbackResult>;

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';
  const query = <T extends Element>(selector: string): T | null =>
    (fixture.nativeElement as HTMLElement).querySelector<T>(selector);

  const createComponent = (queryParams: Record<string, string>): void => {
    TestBed.configureTestingModule({
      imports: [AuthorizationCallbackComponent],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: authService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    });
    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(AuthorizationCallbackComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    exchange = deferred<AuthCallbackResult>();
    authService = {
      handleCallback: vi.fn().mockReturnValue(exchange.promise),
      startLogin: vi.fn().mockResolvedValue(undefined),
      isAuthenticated: vi.fn().mockReturnValue(false),
    };
  });

  it('should create', () => {
    createComponent({ code: 'abc', state: 'xyz' });
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('passes the callback parameters to the service exactly once', () => {
    createComponent({ code: 'abc', state: 'xyz', error: 'access_denied' });

    expect(authService.handleCallback).toHaveBeenCalledTimes(1);
    expect(authService.handleCallback).toHaveBeenCalledWith({
      code: 'abc',
      state: 'xyz',
      error: 'access_denied',
    });
  });

  it('shows that sign-in is in progress while the token request is pending', async () => {
    createComponent({ code: 'abc', state: 'xyz' });
    await settle(fixture);

    expect(text()).toContain('Signing you in');
    expect(text()).not.toContain('You are signed in');
    expect(query('mat-progress-bar')).not.toBeNull();
    expect(query('[role="status"]')).not.toBeNull();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('shows success and navigates home only after the server answered', async () => {
    createComponent({ code: 'abc', state: 'xyz' });

    exchange.resolve({ status: 'success' });
    await settle(fixture);

    expect(text()).toContain('You are signed in');
    expect(text()).not.toContain('Signing you in');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/home');
  });

  it('returns the user to the page the sign-in was started from', async () => {
    createComponent({ code: 'abc', state: 'xyz' });

    exchange.resolve({ status: 'success', returnUrl: '/tenants' });
    await settle(fixture);

    expect(router.navigateByUrl).toHaveBeenCalledWith('/tenants');
  });

  it('does not exchange again when the page is reloaded after a successful sign-in', async () => {
    authService.isAuthenticated.mockReturnValue(true);
    createComponent({ code: 'abc', state: 'xyz' });
    await settle(fixture);

    expect(authService.handleCallback).not.toHaveBeenCalled();
    expect(text()).toContain('You are signed in');
    expect(router.navigateByUrl).toHaveBeenCalledWith('/home');
  });

  it('shows the error message and a restart action when the exchange fails', async () => {
    createComponent({ code: 'abc', state: 'xyz' });

    exchange.resolve({
      status: 'error',
      reason: 'token_request_rejected',
      message: 'The sign-in server rejected the request (invalid_grant). Please start again.',
    });
    await settle(fixture);

    expect(text()).toContain('Sign-in could not be completed');
    expect(query('[role="alert"]')?.textContent).toContain('invalid_grant');
    expect(query<HTMLButtonElement>('button.callback-restart')).not.toBeNull();
    expect(text()).not.toContain('You are signed in');
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });

  it('restarts the sign-in from the error screen', async () => {
    createComponent({ state: 'xyz' });
    exchange.resolve({
      status: 'error',
      reason: 'invalid_callback',
      message: 'The response from the sign-in server is incomplete or invalid.',
    });
    await settle(fixture);

    query<HTMLButtonElement>('button.callback-restart')!.click();
    await settle(fixture);

    expect(authService.startLogin).toHaveBeenCalledTimes(1);
    expect(query<HTMLButtonElement>('button.callback-restart')!.disabled).toBe(true);
  });

  it('explains when the restart itself fails', async () => {
    authService.startLogin.mockRejectedValue(new Error('storage unavailable'));
    createComponent({ state: 'xyz' });
    exchange.resolve({ status: 'error', reason: 'transaction_missing', message: 'No pending request.' });
    await settle(fixture);

    query<HTMLButtonElement>('button.callback-restart')!.click();
    await settle(fixture);

    expect(query('[role="alert"]')?.textContent).toContain('could not be restarted');
    expect(query<HTMLButtonElement>('button.callback-restart')!.disabled).toBe(false);
  });
});
