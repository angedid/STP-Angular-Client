import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';

import { AuthService } from '../auth.service';
import { LoginComponent } from './login.component';

describe('LoginComponent', () => {
  let fixture: ComponentFixture<LoginComponent>;
  let authService: { startLogin: ReturnType<typeof vi.fn> };

  const text = (): string => (fixture.nativeElement as HTMLElement).textContent ?? '';

  /** Lets pending promise callbacks run, then waits for change detection. */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  };

  const createComponent = (queryParams: Record<string, string> = {}): void => {
    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: authService },
        {
          provide: ActivatedRoute,
          useValue: { snapshot: { queryParamMap: convertToParamMap(queryParams) } },
        },
      ],
    });
    fixture = TestBed.createComponent(LoginComponent);
    fixture.detectChanges();
  };

  beforeEach(() => {
    authService = { startLogin: vi.fn().mockResolvedValue(undefined) };
  });

  it('should create', () => {
    createComponent();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('starts the sign-in once and tells the user it is redirecting', async () => {
    createComponent();
    await settle();

    expect(authService.startLogin).toHaveBeenCalledTimes(1);
    expect(authService.startLogin).toHaveBeenCalledWith(null);
    expect(text()).toContain('Redirecting to sign-in');
  });

  it('forwards the returnUrl set by the route guard', async () => {
    createComponent({ returnUrl: '/tenants' });
    await settle();

    expect(authService.startLogin).toHaveBeenCalledWith('/tenants');
  });

  it('explains the failure and lets the user try again when sign-in cannot start', async () => {
    authService.startLogin.mockRejectedValueOnce(new Error('storage unavailable'));
    createComponent();
    await settle();

    expect(text()).toContain('Sign-in could not be started');
    const retry = (fixture.nativeElement as HTMLElement).querySelector<HTMLButtonElement>(
      'button.login-retry',
    );
    expect(retry).not.toBeNull();

    retry!.click();
    await settle();

    expect(authService.startLogin).toHaveBeenCalledTimes(2);
    expect(text()).toContain('Redirecting to sign-in');
  });
});
