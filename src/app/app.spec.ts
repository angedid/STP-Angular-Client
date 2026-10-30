import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { App } from './app';
import { AuthService, UserProfile } from './auth.service';

describe('App', () => {
  const user = signal<UserProfile | null>(null);
  const isAuthenticated = signal(false);

  beforeEach(async () => {
    user.set(null);
    isAuthenticated.set(false);
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        { provide: AuthService, useValue: { user, isAuthenticated, logout: vi.fn() } },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('gives visitors the public toolbar above the content', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    expect(compiled.querySelector('app-guest-toolbar')).not.toBeNull();
    expect(compiled.querySelector('router-outlet')).not.toBeNull();
    expect(compiled.querySelector('app-sidebar')).toBeNull();
  });

  it('switches to the sidebar layout while signed in, and back on sign-out', async () => {
    const fixture = TestBed.createComponent(App);
    await fixture.whenStable();
    const compiled = fixture.nativeElement as HTMLElement;

    user.set({ username: 'jane', displayName: 'Jane Doe', photoUrl: null });
    isAuthenticated.set(true);
    await fixture.whenStable();
    expect(compiled.querySelector('app-sidebar img.profile-photo')).not.toBeNull();
    expect(compiled.querySelector('.shell-main router-outlet')).not.toBeNull();
    expect(compiled.querySelector('app-guest-toolbar')).toBeNull();

    user.set(null);
    isAuthenticated.set(false);
    await fixture.whenStable();
    expect(compiled.querySelector('app-sidebar')).toBeNull();
    expect(compiled.querySelector('app-guest-toolbar')).not.toBeNull();
  });
});
