import { TestBed } from '@angular/core/testing';

import { AUTH_CONFIG, AuthConfig, DEVELOPMENT_AUTH_CONFIG } from './auth.config';
import { AuthSession, AuthSessionStore, isAuthSession } from './auth-session';
import { CLOCK } from './clock';
import { FakeClock } from './testing/fake-clock';

const CONFIG: AuthConfig = { ...DEVELOPMENT_AUTH_CONFIG, sessionStorageKey: 'test.session' };

const session = (expiresAt: number | null = null): AuthSession => ({
  accessToken: 'access-token-value',
  tokenType: 'Bearer',
  refreshToken: 'refresh-token-value',
  expiresAt,
  user: { username: 'jane@tenant', displayName: 'Jane', photoUrl: null },
});

describe('AuthSessionStore', () => {
  let store: AuthSessionStore;
  let clock: FakeClock;

  const stored = (): string | null => sessionStorage.getItem(CONFIG.sessionStorageKey);

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    clock = new FakeClock(4_999);
    TestBed.configureTestingModule({
      providers: [
        { provide: AUTH_CONFIG, useValue: CONFIG },
        { provide: CLOCK, useValue: clock },
      ],
    });
    store = TestBed.inject(AuthSessionStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves the session under the configured sessionStorage key only', () => {
    store.save(session());

    expect(JSON.parse(stored()!)).toEqual(session());
    expect(localStorage.length).toBe(0);
  });

  it('loads a valid session and keeps it stored', () => {
    store.save(session(5_000));

    expect(store.load()).toEqual(session(5_000));
    expect(stored()).not.toBeNull();
  });

  it('loads a session without announced expiry whatever the time', () => {
    store.save(session(null));

    clock.set(Number.MAX_SAFE_INTEGER);
    expect(store.load()).toEqual(session(null));
  });

  it('returns null when nothing is stored', () => {
    expect(store.load()).toBeNull();
  });

  it('discards an expired session that has no refresh token, from the expiry instant on', () => {
    store.save({ ...session(5_000), refreshToken: null });

    clock.set(4_999);
    expect(store.load()).not.toBeNull();
    clock.set(5_000);
    expect(store.load()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('keeps an expired session that can be renewed with its refresh token', () => {
    store.save(session(5_000));

    clock.set(5_000);
    expect(store.load()).toEqual(session(5_000));
    expect(stored()).not.toBeNull();
  });

  it.each([
    ['invalid JSON', '{'],
    ['an array', '[]'],
    ['an empty access token', JSON.stringify({ ...session(), accessToken: '' })],
    ['a numeric access token', JSON.stringify({ ...session(), accessToken: 123 })],
    ['a missing token type', JSON.stringify({ ...session(), tokenType: undefined })],
    ['a string expiry', JSON.stringify({ ...session(), expiresAt: 'later' })],
    ['a numeric refresh token', JSON.stringify({ ...session(), refreshToken: 42 })],
    ['a missing user', JSON.stringify({ ...session(), user: undefined })],
    [
      'a user without username',
      JSON.stringify({ ...session(), user: { displayName: 'Jane', photoUrl: null } }),
    ],
    [
      'a user with a numeric photo',
      JSON.stringify({ ...session(), user: { ...session().user, photoUrl: 1 } }),
    ],
  ])('discards a malformed session (%s)', (_label, raw) => {
    sessionStorage.setItem(CONFIG.sessionStorageKey, raw);

    expect(store.load()).toBeNull();
    expect(stored()).toBeNull();
  });

  it('clears the stored session', () => {
    store.save(session());

    store.clear();

    expect(stored()).toBeNull();
  });

  it('treats unavailable storage as no session', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(store.load()).toBeNull();
  });

  it('propagates save failures so the caller can decide', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => store.save(session())).toThrow();
  });

  it('clear never throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => store.clear()).not.toThrow();
  });
});

describe('isAuthSession', () => {
  it('accepts a complete session with or without optional values', () => {
    expect(isAuthSession(session())).toBe(true);
    expect(isAuthSession({ ...session(), refreshToken: null, expiresAt: null })).toBe(true);
    const withPhoto = { ...session().user, photoUrl: 'https://cdn.test/a.png' };
    expect(isAuthSession({ ...session(), user: withPhoto })).toBe(true);
  });

  it('rejects non-objects', () => {
    expect(isAuthSession(null)).toBe(false);
    expect(isAuthSession('session')).toBe(false);
    expect(isAuthSession([])).toBe(false);
  });
});
