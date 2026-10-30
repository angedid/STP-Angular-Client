import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';

import { AuthService, LogoutResult, UserProfile } from '../auth.service';
import { WorkspaceService } from '../workspace.service';
import { SidebarComponent } from './sidebar.component';

const JANE: UserProfile = { username: 'jane.doe', displayName: 'Jane Doe', photoUrl: null };

describe('SidebarComponent', () => {
  let fixture: ComponentFixture<SidebarComponent>;
  let router: Router;
  const user = signal<UserProfile | null>(JANE);
  let logout: ReturnType<typeof vi.fn>;

  const element = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const menuPanel = (): HTMLElement | null => document.querySelector('.mat-mdc-menu-panel');
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await fixture.whenStable();
  };
  const openMenu = async (): Promise<HTMLElement> => {
    element().querySelector<HTMLButtonElement>('button.user-menu-trigger')!.click();
    await settle();
    return menuPanel()!;
  };

  beforeEach(async () => {
    user.set(JANE);
    logout = vi.fn();
    await TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [provideRouter([]), { provide: AuthService, useValue: { user, logout } }],
    }).compileComponents();

    router = TestBed.inject(Router);
    vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    fixture = TestBed.createComponent(SidebarComponent);
    await fixture.whenStable();
  });

  afterEach(() => {
    fixture.destroy();
  });

  it('shows the brand, the user photo and the user name', () => {
    expect(element().querySelector('.sidebar-brand-name')?.textContent).toContain('STP');
    expect(element().querySelector('.sidebar-brand-tagline')?.textContent).toContain('Portail Web');
    expect(element().querySelector('img.sidebar-logo')).not.toBeNull();
    expect(element().querySelector('img.profile-photo')).not.toBeNull();
    const trigger = element().querySelector('button.user-menu-trigger');
    expect(trigger?.textContent).toContain('Jane Doe');
    expect(trigger?.getAttribute('aria-haspopup')).toBe('menu');
  });

  it('lists the main sections in order', () => {
    const links = Array.from(element().querySelectorAll('a.sidebar-link'));
    expect(links.map((link) => link.querySelector('span')?.textContent?.trim())).toEqual([
      'Tableau de bord',
      'Vendeurs',
      'Score portefeuille',
      'Alertes',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/home',
      '/vendors',
      '/eligibility',
      '/alerts',
    ]);
  });

  it('switches the workspace between Grossiste and Banque', async () => {
    const workspaceService = TestBed.inject(WorkspaceService);
    expect(workspaceService.workspace()).toBe('grossiste');

    const toggles = element().querySelectorAll<HTMLButtonElement>('mat-button-toggle button');
    expect(Array.from(toggles).map((toggle) => toggle.textContent?.trim())).toEqual([
      'Grossiste',
      'Banque',
    ]);

    toggles[1].click();
    await settle();
    expect(workspaceService.workspace()).toBe('banque');
  });

  it('opens an account menu with Profile, Tenants, Eligibility and Logout', async () => {
    const panel = await openMenu();
    const items = Array.from(panel.querySelectorAll('[mat-menu-item]')).map((item) =>
      item.textContent?.trim(),
    );
    expect(items).toEqual(['Profile', 'Tenants', 'Eligibility', 'Logout']);
    expect(panel.querySelector('a[href="/tenants"]')).not.toBeNull();
  });

  it('returns to the landing page after a confirmed logout', async () => {
    logout.mockImplementation(async (): Promise<LogoutResult> => {
      user.set(null);
      return { status: 'success' };
    });

    const panel = await openMenu();
    panel.querySelector<HTMLButtonElement>('button.logout-item')!.click();
    await settle();

    expect(logout).toHaveBeenCalledTimes(1);
    expect(router.navigateByUrl).toHaveBeenCalledWith('/');
    expect(element().querySelector('[role="alert"]')).toBeNull();
  });

  it('keeps the user signed in and shows an error when revocation fails', async () => {
    logout.mockResolvedValue({
      status: 'error',
      message: 'Logout failed: the server did not revoke the session. You are still signed in.',
    });

    const panel = await openMenu();
    panel.querySelector<HTMLButtonElement>('button.logout-item')!.click();
    await settle();

    expect(router.navigateByUrl).not.toHaveBeenCalled();
    expect(element().querySelector('[role="alert"]')?.textContent).toContain('still signed in');
    expect(element().querySelector('button.user-menu-trigger')?.textContent).toContain('Jane Doe');

    element().querySelector<HTMLButtonElement>('button.sidebar-error-dismiss')!.click();
    await settle();
    expect(element().querySelector('[role="alert"]')).toBeNull();
  });
});
