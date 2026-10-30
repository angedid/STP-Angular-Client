import { TestBed } from '@angular/core/testing';

import { environment as defaultEnvironment } from '../environments/environment';
import { environment as demoEnvironment } from '../environments/environment.demo';
import { appConfig } from './app.config';
import { AUTH_CONFIG, AuthConfig, DEVELOPMENT_AUTH_CONFIG } from './auth.config';
import { LOCAL_DEMO_AUTH_CONFIG } from './auth.config.local-demo';
import { isLogoutUrl, isProtectedUrl, protectedOrigins } from './auth.interceptor';

const PROVIDER_ORIGIN = 'http://localhost:9001';
const APP_ORIGIN = 'http://localhost:4200';

const originOf = (url: string): string => new URL(url).origin;

/**
 * The local demo configuration must point the unchanged authentication code at
 * the test provider, and nothing else may change between the demo and the
 * development settings.
 */
describe('LOCAL_DEMO_AUTH_CONFIG', () => {
  it('targets the test provider for every server endpoint', () => {
    const endpoints: ReadonlyArray<keyof AuthConfig> = [
      'authorizationEndpoint',
      'tokenEndpoint',
      'userInfoEndpoint',
      'logoutEndpoint',
      'tenantsEndpoint',
    ];
    for (const key of endpoints) {
      expect(originOf(String(LOCAL_DEMO_AUTH_CONFIG[key])), key).toBe(PROVIDER_ORIGIN);
    }
    expect(LOCAL_DEMO_AUTH_CONFIG.authorizationEndpoint).toBe(`${PROVIDER_ORIGIN}/oauth/authorize`);
    expect(LOCAL_DEMO_AUTH_CONFIG.tokenEndpoint).toBe(`${PROVIDER_ORIGIN}/oauth/token`);
    expect(LOCAL_DEMO_AUTH_CONFIG.userInfoEndpoint).toBe(`${PROVIDER_ORIGIN}/api/user`);
    expect(LOCAL_DEMO_AUTH_CONFIG.logoutEndpoint).toBe(`${PROVIDER_ORIGIN}/api/logout`);
    expect(LOCAL_DEMO_AUTH_CONFIG.tenantsEndpoint).toBe(`${PROVIDER_ORIGIN}/api/tenants`);
  });

  it('registers this application as the fictional public client of the provider fixtures', () => {
    // Mirrors DEMO_CLIENT in tools/mock-oauth-server/fixtures.mjs; the Node
    // test suite checks the other direction.
    expect(LOCAL_DEMO_AUTH_CONFIG.clientId).toBe('019cf354-99fe-7116-b8cd-c0a3a648e102');
    expect(LOCAL_DEMO_AUTH_CONFIG.redirectUri).toBe(`${APP_ORIGIN}/oauth/callback`);
    expect(LOCAL_DEMO_AUTH_CONFIG.scope).toBe('');
    expect(LOCAL_DEMO_AUTH_CONFIG.logoutMethod).toBe('POST');
  });

  it('has exactly the public settings of AuthConfig and no secret', () => {
    const keys = Object.keys(LOCAL_DEMO_AUTH_CONFIG).sort();
    expect(keys).toEqual(Object.keys(DEVELOPMENT_AUTH_CONFIG).sort());
    expect(keys.some((key) => /secret|password/i.test(key))).toBe(false);
  });

  it('keeps the session behaviour of the development settings', () => {
    expect(LOCAL_DEMO_AUTH_CONFIG.transactionStorageKey).toBe(
      DEVELOPMENT_AUTH_CONFIG.transactionStorageKey,
    );
    expect(LOCAL_DEMO_AUTH_CONFIG.transactionTtlMs).toBe(DEVELOPMENT_AUTH_CONFIG.transactionTtlMs);
    expect(LOCAL_DEMO_AUTH_CONFIG.sessionStorageKey).toBe(DEVELOPMENT_AUTH_CONFIG.sessionStorageKey);
  });

  it('lets the interceptor protect the stubbed API and spare the OAuth endpoints', () => {
    const config = LOCAL_DEMO_AUTH_CONFIG;
    expect([...protectedOrigins(config)]).toEqual([PROVIDER_ORIGIN]);
    expect(isProtectedUrl(config.userInfoEndpoint, config)).toBe(true);
    expect(isProtectedUrl(`${config.logoutEndpoint}/rose.eyenga%40tenant`, config)).toBe(true);
    expect(isProtectedUrl(`${config.tenantsEndpoint}/7b1c3f0e-5d2a-4c8b-9e6f-1a2b3c4d5e6f`, config)).toBe(true);
    expect(isProtectedUrl(config.tokenEndpoint, config)).toBe(false);
    expect(isProtectedUrl(config.authorizationEndpoint, config)).toBe(false);
    expect(isLogoutUrl(`${config.logoutEndpoint}/rose.eyenga%40tenant`, config)).toBe(true);
    expect(isLogoutUrl(config.userInfoEndpoint, config)).toBe(false);
  });
});

describe('environments', () => {
  it('default environment keeps the development settings (used by production builds)', () => {
    expect(defaultEnvironment.name).toBe('default');
    expect(defaultEnvironment.authConfig).toBe(DEVELOPMENT_AUTH_CONFIG);
  });

  it('demo environment selects the local demo settings', () => {
    expect(demoEnvironment.name).toBe('local-demo');
    expect(demoEnvironment.authConfig).toBe(LOCAL_DEMO_AUTH_CONFIG);
  });

  it('appConfig provides AUTH_CONFIG from the active environment', () => {
    TestBed.configureTestingModule({ providers: appConfig.providers });
    expect(TestBed.inject(AUTH_CONFIG)).toBe(defaultEnvironment.authConfig);
  });
});
