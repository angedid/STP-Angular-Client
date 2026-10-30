import { TestBed } from '@angular/core/testing';

import { AUTH_CONFIG, AuthConfig, DEVELOPMENT_AUTH_CONFIG } from './auth.config';
import { AuthTransaction, AuthTransactionStore, isSafeReturnUrl } from './auth-transaction';
import { CLOCK } from './clock';
import { FakeClock } from './testing/fake-clock';

const CONFIG: AuthConfig = { ...DEVELOPMENT_AUTH_CONFIG, transactionStorageKey: 'test.transaction' };

const transaction = (now: number): AuthTransaction => ({
  state: 'c2VjcmV0LXN0YXRlLXZhbHVlLTEyMzQ1Ng',
  codeVerifier: 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
  redirectUri: CONFIG.redirectUri,
  createdAt: now,
  expiresAt: now + CONFIG.transactionTtlMs,
});

describe('AuthTransactionStore', () => {
  let store: AuthTransactionStore;
  let clock: FakeClock;

  beforeEach(() => {
    sessionStorage.clear();
    clock = new FakeClock(1000);
    TestBed.configureTestingModule({
      providers: [
        { provide: AUTH_CONFIG, useValue: CONFIG },
        { provide: CLOCK, useValue: clock },
      ],
    });
    store = TestBed.inject(AuthTransactionStore);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('saves the transaction under the configured sessionStorage key', () => {
    const saved = transaction(1000);
    store.save(saved);

    expect(JSON.parse(sessionStorage.getItem(CONFIG.transactionStorageKey)!)).toEqual(saved);
    expect(localStorage.getItem(CONFIG.transactionStorageKey)).toBeNull();
  });

  it('returns and removes a valid transaction', () => {
    const saved = transaction(1000);
    store.save(saved);

    clock.set(1000 + CONFIG.transactionTtlMs - 1);
    expect(store.consume()).toEqual({
      kind: 'ok',
      transaction: saved,
    });
    expect(store.consume()).toEqual({ kind: 'missing' });
  });

  it('reports a missing transaction', () => {
    expect(store.consume()).toEqual({ kind: 'missing' });
  });

  it('reports and removes an expired transaction', () => {
    store.save(transaction(1000));

    clock.set(1000 + CONFIG.transactionTtlMs);
    expect(store.consume()).toEqual({ kind: 'expired' });
    expect(sessionStorage.getItem(CONFIG.transactionStorageKey)).toBeNull();
  });

  it.each([
    ['invalid JSON', '{'],
    ['an array', '[]'],
    ['a missing state', JSON.stringify({ ...transaction(1), state: undefined })],
    ['a bad state', JSON.stringify({ ...transaction(1), state: 'x y' })],
    ['a bad verifier', JSON.stringify({ ...transaction(1), codeVerifier: 'nope' })],
    ['an empty redirect URI', JSON.stringify({ ...transaction(1), redirectUri: '' })],
    ['a string expiry', JSON.stringify({ ...transaction(1), expiresAt: 'later' })],
    ['an external return URL', JSON.stringify({ ...transaction(1), returnUrl: 'https://evil' })],
    ['a protocol-relative return URL', JSON.stringify({ ...transaction(1), returnUrl: '//evil' })],
  ])('reports and removes a malformed transaction (%s)', (_label, raw) => {
    sessionStorage.setItem(CONFIG.transactionStorageKey, raw);

    expect(store.consume()).toEqual({ kind: 'malformed' });
    expect(sessionStorage.getItem(CONFIG.transactionStorageKey)).toBeNull();
  });

  it('keeps a same-origin return URL', () => {
    const saved = { ...transaction(1000), returnUrl: '/tenants?tab=1' };
    store.save(saved);

    expect(store.consume()).toEqual({ kind: 'ok', transaction: saved });
  });

  it('treats unavailable storage as a missing transaction', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(store.consume()).toEqual({ kind: 'missing' });
  });

  it('propagates save failures so the caller can report them', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });

    expect(() => store.save(transaction(1))).toThrow();
  });

  it('clear never throws', () => {
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    expect(() => store.clear()).not.toThrow();
  });
});

describe('isSafeReturnUrl', () => {
  it.each(['/', '/home', '/tenants?tab=1', '/credits/new#top'])('accepts %s', (url) => {
    expect(isSafeReturnUrl(url)).toBe(true);
  });

  it.each([
    ['an absolute URL', 'https://evil.test/home'],
    ['a protocol-relative URL', '//evil.test/home'],
    ['a backslash trick', '/\\evil.test'],
    ['a relative path', 'home'],
    ['an empty string', ''],
    ['a javascript URL', 'javascript:alert(1)'],
    ['a non-string', null],
    ['an over-long path', '/' + 'a'.repeat(2048)],
  ])('rejects %s', (_label, url) => {
    expect(isSafeReturnUrl(url)).toBe(false);
  });
});
